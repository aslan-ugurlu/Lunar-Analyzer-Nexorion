// UX of error / missing-data states in a real browser.
// REAL: DEM_MISSING comes from the real backend (lola_80m file is absent).
// MOCKED (labelled): backend offline (network abort), SPICE_MISSING 503, QUEUE_FULL 429,
// WORKER_UNAVAILABLE job and 409 HORIZON_NOT_READY are injected with Playwright routes,
// because they cannot be produced safely on the live server. No scientific values are mocked.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
const API = 'http://127.0.0.1:8000';
const OUT = process.argv[2] ?? '../logs/e2e';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (m) => { log.push(m); console.log(m); };
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = {};

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}
async function fillSite(page, lat = '-89.4512', lon = '-137.1427') {
  await page.getByLabel('Enlem (°, planetosentrik)').fill(lat);
  await page.getByLabel('Boylam (°, doğu-pozitif)').fill(lon);
}
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

try {
  // 1) REAL DEM_MISSING: select a catalogued layer whose file is not present.
  {
    const { ctx, page } = await fresh();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByLabel('NASA LOLA arazi katmanı (dataset)').selectOption('lola_80m');
    await page.getByText(/Bu katmanın dosyası sunucuda yok/).waitFor();
    await fillSite(page);
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    await page.getByText('DEM_MISSING', { exact: true }).first().waitFor({ timeout: 15000 });
    results.dem_missing_real = true;
    await page.screenshot({ path: join(OUT, 's1_dem_missing_real.png'), fullPage: false });
    await ctx.close();
  }
  // 2) MOCK: backend offline (network failure for every API call).
  {
    const { ctx, page } = await fresh();
    await page.route(`${API}/**`, (r) => r.abort('connectionrefused'));
    await page.goto(BASE);
    await page.getByText('Backend çevrimdışı').first().waitFor({ timeout: 20000 });
    results.offline = (await page.getByText('Offline', { exact: true }).count()) > 0;
    await page.getByRole('tab', { name: 'Sky View' }).click();
    results.offline_no_chart = (await page.locator('.main-svg').count()) === 0;
    await page.getByRole('tab', { name: 'Mission Setup' }).click();
    await page.screenshot({ path: join(OUT, 's2_offline_mock.png'), fullPage: false });
    await ctx.close();
  }
  // 3) MOCK: SPICE_MISSING on POST /analyses and degraded health.
  {
    const { ctx, page } = await fresh();
    await page.route(`${API}/analyses`, (r) => r.fulfill(json(503, { error: { code: 'SPICE_MISSING', message: 'Required SPICE files are unavailable', request_id: 'mock' } })));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await fillSite(page);
    await page.getByRole('button', { name: 'Analizi başlat' }).click();
    await page.getByText('SPICE kernel dosyaları eksik').waitFor();
    results.spice_missing = true;
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
    await page.getByText('Kuyruk dolu').waitFor();
    results.queue_full = true;
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
    await page.getByText('Hesap süreci çöktü').first().waitFor({ timeout: 15000 });
    results.worker_unavailable = true;
    await page.getByRole('tab', { name: 'Sky View' }).click();
    results.worker_failed_no_chart = (await page.locator('.main-svg').count()) === 0;
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
} catch (error) {
  note(`FAILED: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  process.exitCode = 1;
} finally {
  note(JSON.stringify(results));
  writeFileSync(join(OUT, 'states.json'), JSON.stringify(results, null, 2), 'utf-8');
  await browser.close();
}
