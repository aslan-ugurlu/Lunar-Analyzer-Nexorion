// End-to-end smoke run against the REAL backend (uvicorn :8000) and Vite (:5173).
// Uses the locally installed Chrome via playwright-core (no browser download).
// Usage: node e2e/smoke.mjs [outDir] ; env SITES="lat,lon;lat,lon" CHROME="path"
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const OUT = process.argv[2] ?? '../logs/e2e';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SITES = (process.env.SITES ?? '-89.54,0').split(';').map((s) => s.split(',').map(Number));
mkdirSync(OUT, { recursive: true });

const log = [];
const note = (msg) => { log.push(`${new Date().toISOString()} ${msg}`); console.log(msg); };
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Lunar Mission Window Analyzer' }).waitFor();
  await page.getByText('Online', { exact: true }).waitFor({ timeout: 15000 });
  note('header + backend Online chip visible');
  await page.screenshot({ path: join(OUT, '01_setup_public.png'), fullPage: true });

  // Optional real-data variants: UNCERTAINTY=err, LANDING_DATE=YYYY-MM-DD, LANDING_TIME=HH:MM (UTC).
  if (process.env.UNCERTAINTY === 'err') await page.getByRole('radio', { name: /ERR ±k/ }).check();
  if (process.env.LANDING_DATE) await page.getByLabel('İniş tarihi (UTC)').fill(process.env.LANDING_DATE);
  if (process.env.LANDING_TIME) await page.getByLabel('İniş saati (UTC, 24 saat)').fill(process.env.LANDING_TIME);
  note(`mode=${process.env.UNCERTAINTY ?? 'nominal'} landing=${process.env.LANDING_DATE ?? 'default'} ${process.env.LANDING_TIME ?? ''}`);
  for (const [lat, lon] of SITES) {
    await page.getByLabel('Enlem (°, planetosentrik)').fill(String(lat));
    await page.getByLabel('Boylam (°, doğu-pozitif)').fill(String(lon));
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    await page.getByText(/Analiz kuyruğa alındı \(HTTP 202\)/).waitFor({ timeout: 20000 });
    await page.locator('li', { hasText: `${Math.abs(lat).toFixed(4)}°` }).getByText(/Tamamlandı|Kısmi|Başarısız/).first().waitFor({ timeout: 600000 });
    note(`analysis ${lat},${lon} terminal after ${((Date.now() - t0) / 1000).toFixed(1)} s (UI polling)`);
  }
  const decision = await page.locator('[data-decision]').first().getAttribute('data-decision');
  note(`decision badge shown: ${decision}`);
  await page.screenshot({ path: join(OUT, '02_result_public.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Sky View' }).click();
  await page.locator('.main-svg').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  note(`sky view traces: ${await page.locator('.scatterlayer .trace').count()}`);
  await page.screenshot({ path: join(OUT, '03_skyview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Güneş’e yakınlaştır' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, '04_skyview_sun_zoom.png'), fullPage: false });

  await page.getByRole('tab', { name: 'Timeline' }).click();
  await page.locator('.main-svg').first().waitFor({ timeout: 30000 });
  const slider = page.getByRole('slider').first();
  await slider.focus();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
  note(`slider aria-valuetext after 10x ArrowRight: ${await slider.getAttribute('aria-valuetext')}`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, '05_timeline_public.png'), fullPage: true });

  // /scenarios/shift: add +6 h, queue (202), poll, and show the new child analysis.
  await page.getByRole('checkbox', { name: '+6 sa' }).check();
  await page.getByRole('button', { name: 'Kayma senaryolarını hesapla' }).click();
  await page.getByRole('button', { name: /Yeni analizi göster/ }).click({ timeout: 20000 });
  await page.getByRole('radio', { name: '+6 sa' }).waitFor({ state: 'attached', timeout: 120000 });
  note(`shift child analysis rendered with +6 h scenario; analyses in picker: ${await page.locator('select option').count() - 1}`);
  await page.getByRole('radio', { name: '+6 sa' }).check({ force: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, '05b_timeline_shift.png'), fullPage: false });

  await page.getByRole('button', { name: 'Mühendis' }).click();
  await page.waitForTimeout(800);
  const decision2 = await page.locator('[data-decision]').count();
  await page.screenshot({ path: join(OUT, '06_timeline_engineer.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Sky View' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, '07_skyview_engineer.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Mission Setup' }).click();
  const decisionEngineer = await page.locator('[data-decision]').first().getAttribute('data-decision');
  note(`decision after mode switch: ${decisionEngineer} (badges on timeline tab: ${decision2})`);
  if (decisionEngineer !== decision) throw new Error('Decision changed when switching mode!');

  // Real /compare between the two site analyses (same mission profile).
  await page.getByRole('tab', { name: 'Compare' }).click();
  // The two site analyses share one mission profile; the shift child (different shifts) must not be mixed in.
  const siteBoxes = page.locator('label', { hasNotText: 'kayma' }).locator('input[type=checkbox]');
  const boxes = await siteBoxes.count();
  if (boxes >= 2) {
    await siteBoxes.nth(0).check();
    await siteBoxes.nth(1).check();
    await page.getByRole('button', { name: /^Karşılaştır \(2\)$/ }).click();
    await page.getByRole('heading', { name: /Sıralama dışı bırakılanlar/ }).waitFor({ timeout: 20000 });
    note(`compare rendered; disabled (incomparable) checkboxes: ${await page.locator('input[type=checkbox][disabled]').count()}`);
    await page.screenshot({ path: join(OUT, '09_compare.png'), fullPage: true });
  } else {
    note(`compare skipped: only ${boxes} comparable analyses`);
  }
  await page.getByRole('tab', { name: 'Data & Validation' }).click();
  await page.getByRole('heading', { name: /Bilimsel doğrulama/ }).waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, '10_data_validation.png'), fullPage: true });

  // Automated accessibility scan (axe-core) on every tab in both modes.
  await page.addScriptTag({ path: fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)) });
  const axeSummary = [];
  for (const mode of ['Halk', 'Mühendis']) {
    await page.getByRole('button', { name: mode }).click();
    for (const tab of ['Mission Setup', 'Sky View', 'Timeline', 'Compare', 'Data & Validation']) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForTimeout(700);
      const res = await page.evaluate(async () => {
        const r = await window.axe.run(document, { resultTypes: ['violations'] });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }));
      });
      axeSummary.push({ mode, tab, violations: res });
      const serious = res.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      note(`axe ${mode}/${tab}: ${res.length} rule(s) violated, serious/critical: ${serious.map((v) => `${v.id}×${v.nodes}`).join(', ') || 'none'}`);
    }
  }
  writeFileSync(join(OUT, 'axe.json'), JSON.stringify(axeSummary, null, 2), 'utf-8');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, '08_mobile_setup.png'), fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  note(`mobile horizontal overflow px: ${overflow}`);
} catch (error) {
  note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  await page.screenshot({ path: join(OUT, 'failure.png'), fullPage: true }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  note(`console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 10).forEach((e) => note(`  console: ${e.slice(0, 300)}`));
  writeFileSync(join(OUT, 'smoke.log'), log.join('\n'), 'utf-8');
  await browser.close();
}
