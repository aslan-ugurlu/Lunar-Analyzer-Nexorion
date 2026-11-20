// UX of error / missing-data states in a real browser, in BOTH modes.
// Halk (default): a plain-language heading leads; the verbatim technical code is NOT the heading and
// is only visible after opening the keyboard-accessible “Teknik detaylar” disclosure.
// Mühendis: the verbatim code chip is visible directly.
// REAL: DEM_MISSING comes from the real backend (lola_20m is catalogued but never downloaded).
// MOCKED (labelled): backend offline (network abort), SPICE_MISSING 503, QUEUE_FULL 429,
// WORKER_UNAVAILABLE job and 409 HORIZON_NOT_READY are injected with Playwright routes,
// because they cannot be produced safely on the live server. No scientific values are mocked.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs in Turkish (?lang=tr): its wording is unchanged from the original UI, so the selectors stay stable.
const BASE = (() => {
  const u = new URL(process.env.APP_URL ?? 'http://localhost:5173');
  u.searchParams.set('lang', 'tr');
  return u.toString();
})();
const API = 'http://127.0.0.1:8000';
const OUT = process.argv[2] ?? '../logs/e2e';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AXE = fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url));
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (m) => { log.push(m); console.log(m); };
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = {};
const axe = [];

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}
async function fillSite(page, lat = '-89.4512', lon = '-137.1427') {
  await page.getByLabel('Enlem (°, planetosentrik)').fill(lat);
  await page.getByLabel('Boylam (°, doğu-pozitif)').fill(lon);
}
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Halk-mode contract for one notice: plain heading visible, code hidden until “Teknik detaylar”
 * is opened WITH THE KEYBOARD, then visible. Returns true only if every step held.
 */
async function checkPublicNotice(page, code, heading) {
  const box = page.locator(`[data-code="${code}"]`).first();
  await box.getByText(heading, { exact: true }).waitFor({ timeout: 20000 });
  const codeChip = box.getByText(code, { exact: true });
  const hiddenBefore = !(await codeChip.isVisible());
  const summary = box.locator('summary', { hasText: 'Teknik detaylar' });
  await summary.focus();
  await page.keyboard.press('Enter');
  await codeChip.waitFor({ state: 'visible', timeout: 5000 });
  return hiddenBefore;
}
async function toEngineer(page) {
  await page.getByRole('button', { name: 'Mühendis' }).click();
}
async function engineerCodeVisible(page, code) {
  const chip = page.locator(`[data-code="${code}"]`).first().getByText(code, { exact: true });
  await chip.waitFor({ state: 'visible', timeout: 5000 });
  return true;
}
async function scan(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') }));
  });
  axe.push({ state: label, violations: res });
  note(`axe ${label}: ${res.length} rule(s) violated${res.length ? ` → ${res.map((v) => `${v.id}(${v.impact})×${v.nodes}`).join(', ')}` : ''}`);
  return res.length;
}

try {
  // 1) REAL DEM_MISSING: select a catalogued layer whose file is not present.
  {
    const { ctx, page } = await fresh();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByLabel('NASA LOLA arazi katmanı (dataset)').selectOption('lola_20m');
    await page.getByText(/Bu katman için arazi verisi henüz mevcut değil/).waitFor();
    await fillSite(page);
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    results.dem_missing_real_public_code_hidden_until_details = await checkPublicNotice(page, 'DEM_MISSING', 'Arazi verisi henüz mevcut değil');
    results.dem_missing_axe_public_violations = await scan(page, 'DEM_MISSING/Halk (Teknik detaylar açık)');
    await page.screenshot({ path: join(OUT, 's1_dem_missing_real_public.png'), fullPage: false });
    await toEngineer(page);
    results.dem_missing_real_engineer_code_visible = await engineerCodeVisible(page, 'DEM_MISSING');
    await page.getByText(/Bu katmanın dosyası sunucuda yok/).waitFor();
    results.dem_missing_axe_engineer_violations = await scan(page, 'DEM_MISSING/Mühendis');
    await page.screenshot({ path: join(OUT, 's1_dem_missing_real_engineer.png'), fullPage: false });
    await ctx.close();
  }
  // 2) MOCK: backend offline (network failure for every API call).
  {
    const { ctx, page } = await fresh();
    await page.route(`${API}/**`, (r) => r.abort('connectionrefused'));
    await page.goto(BASE);
    results.offline_public = await checkPublicNotice(page, 'BACKEND_OFFLINE', 'Hesaplama sunucusuna şu an ulaşılamıyor');
    results.offline = (await page.getByText('Offline', { exact: true }).count()) > 0;
    await page.getByRole('tab', { name: 'Gökyüzü Görünümü', exact: true }).click();
    results.offline_no_chart = (await page.locator('.main-svg').count()) === 0;
    await page.getByRole('tab', { name: 'Görev Kurulumu', exact: true }).click();
    await toEngineer(page);
    await page.getByText('Backend çevrimdışı').first().waitFor();
    results.offline_engineer_code_visible = await engineerCodeVisible(page, 'BACKEND_OFFLINE');
    await page.screenshot({ path: join(OUT, 's2_offline_mock.png'), fullPage: false });
    await ctx.close();
  }
  // 3) MOCK: SPICE_MISSING on POST /analyses. The notice must receive keyboard focus.
  {
    const { ctx, page } = await fresh();
    await page.route(`${API}/analyses`, (r) => r.fulfill(json(503, { error: { code: 'SPICE_MISSING', message: 'Required SPICE files are unavailable', request_id: 'mock' } })));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await fillSite(page);
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    await page.locator('[data-code="SPICE_MISSING"]').first().waitFor();
    results.spice_missing_focus_moved = await page.evaluate(() => document.activeElement?.getAttribute('data-code') === 'SPICE_MISSING');
    results.spice_missing_public = await checkPublicNotice(page, 'SPICE_MISSING', 'Güneş ve Dünya konum verisi henüz mevcut değil');
    await toEngineer(page);
    await page.getByText('SPICE kernel dosyaları eksik').waitFor();
    results.spice_missing_engineer_code_visible = await engineerCodeVisible(page, 'SPICE_MISSING');
    await page.screenshot({ path: join(OUT, 's3_spice_missing_mock.png'), fullPage: false });
    await ctx.close();
  }
  // 4) MOCK: 429 QUEUE_FULL.
  {
    const { ctx, page } = await fresh();
    await page.route(`${API}/analyses`, (r) => r.fulfill(json(429, { error: { code: 'QUEUE_FULL', message: 'Analysis queue is at capacity', request_id: 'mock' } })));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await fillSite(page);
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    results.queue_full_public = await checkPublicNotice(page, 'QUEUE_FULL', 'Sunucu şu an çok meşgul');
    await toEngineer(page);
    await page.getByText('Kuyruk dolu').waitFor();
    results.queue_full_engineer_code_visible = await engineerCodeVisible(page, 'QUEUE_FULL');
    await ctx.close();
  }
  // 5) MOCK: job fails with WORKER_UNAVAILABLE; horizon endpoint 409.
  {
    const { ctx, page } = await fresh();
    await page.route(`${API}/analyses`, (r) => r.fulfill(json(202, { analysis_id: 'mockjob00000000', status: 'queued', request_id: 'mock' })));
    await page.route(`${API}/analyses/mockjob00000000`, (r) => r.fulfill(json(200, { id: 'mockjob00000000', status: 'failed', result: null, error: 'WORKER_UNAVAILABLE', parent_id: null })));
    await page.route(`${API}/analyses/mockjob00000000/horizon`, (r) => r.fulfill(json(409, { error: { code: 'HORIZON_NOT_READY', message: 'x', request_id: 'mock' } })));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await fillSite(page);
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    results.worker_unavailable_public = await checkPublicNotice(page, 'WORKER_UNAVAILABLE', 'Hesaplama yarıda kesildi');
    await page.getByRole('tab', { name: 'Gökyüzü Görünümü', exact: true }).click();
    results.worker_failed_no_chart = (await page.locator('.main-svg').count()) === 0;
    await page.getByRole('tab', { name: 'Görev Kurulumu', exact: true }).click();
    await toEngineer(page);
    await page.getByText('Hesap süreci çöktü').first().waitFor({ timeout: 15000 });
    results.worker_unavailable_engineer_code_visible = await engineerCodeVisible(page, 'WORKER_UNAVAILABLE');
    await page.screenshot({ path: join(OUT, 's5_worker_unavailable_mock.png'), fullPage: false });
    await ctx.close();
  }
  // 6) Client-side 422 prevention: out-of-range latitude never reaches the server.
  {
    const { ctx, page } = await fresh();
    let posted = false;
    page.on('request', (req) => { if (req.method() === 'POST' && req.url().endsWith('/analyses')) posted = true; });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await fillSite(page, '-70', '0');
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    await page.getByText('Enlem -90 … -80 aralığında olmalı').waitFor();
    results.invalid_blocked_client_side = !posted;
    await ctx.close();
  }
  const failed = Object.entries(results).filter(([k, v]) => (k.endsWith('_violations') ? v !== 0 : v !== true));
  if (failed.length) throw new Error(`state checks failed: ${failed.map(([k, v]) => `${k}=${v}`).join(', ')}`);
} catch (error) {
  note(`FAILED: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  process.exitCode = 1;
} finally {
  note(JSON.stringify(results));
  writeFileSync(join(OUT, 'states.json'), JSON.stringify({ results, axe }, null, 2), 'utf-8');
  await browser.close();
}
