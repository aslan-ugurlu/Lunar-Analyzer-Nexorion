/**
 * Halk wizard / Mühendis cockpit (Faz 9 redesign). The redesign is presentation only:
 * both layouts edit the same form state and POST the identical request body.
 * The /analyses responses below are a MOCKED transport (labelled), never scientific values.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import { __setFetchForTests } from '../../api/client';
import type { AnalysisInput, JobRecord, SitesResponse } from '../../api/types';
import { AppStateProvider, useApp, type Mode } from '../../state/AppState';
import { MissionForm, WIZARD_STEPS } from '../MissionForm';
import { ResultSummary } from '../ResultSummary';
import { Header } from '../Header';

afterEach(() => __setFetchForTests(null));

/** Records POST /analyses bodies; answers polling with "queued" (transport mock only). */
function mockTransport() {
  const posted: unknown[] = [];
  __setFetchForTests(async (url, init) => {
    const u = String(url);
    if (u.endsWith('/analyses') && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ analysis_id: `mock${posted.length}`, status: 'queued', request_id: 'mock' }), { status: 202 });
    }
    return new Response(JSON.stringify({ id: u.split('/').pop(), status: 'queued', result: null, error: null, parent_id: null }), { status: 200 });
  });
  return posted;
}

const renderForm = (mode: Mode, sites: SitesResponse | null = null) =>
  render(<AppStateProvider initialMode={mode}><Header health={null} healthError={null} /><MissionForm sites={sites} health={null} /></AppStateProvider>);

const visibleStep = () => document.querySelector('section[data-step]:not([hidden])')?.getAttribute('data-step');

describe('Halk: Görev Sihirbazı', () => {
  it('shows one step at a time with an accessible stepper; every field stays in the form', () => {
    renderForm('public');
    expect(screen.getByRole('heading', { name: 'Görev Sihirbazı' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Görev sihirbazı adımları' });
    const steps = within(nav).getAllByRole('button');
    expect(steps).toHaveLength(WIZARD_STEPS.length);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveAccessibleName(/^Adım 1: Konum/);
    expect(visibleStep()).toBe('site');
    expect(document.querySelectorAll('section[data-step][hidden]')).toHaveLength(3);
    // Fields of later steps are mounted (hidden), so the request is always complete.
    expect(screen.getByLabelText('İniş tarihi (UTC)')).not.toBeVisible();
    expect(screen.getByLabelText('Enlem (°, planetosentrik)')).toBeVisible();
  });

  it('“İleri” validates the current step, then moves and focuses the next step heading', async () => {
    const user = userEvent.setup();
    renderForm('public');
    await user.click(screen.getByRole('button', { name: /^İleri: Zaman/ }));
    expect(visibleStep()).toBe('site');
    expect(screen.getByText('Enlem gerekli')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Enlem (°, planetosentrik)'));
    await user.type(screen.getByLabelText('Enlem (°, planetosentrik)'), '-89.54');
    await user.type(screen.getByLabelText('Boylam (°, doğu-pozitif)'), '0');
    await user.click(screen.getByRole('button', { name: /^İleri: Zaman/ }));
    expect(visibleStep()).toBe('time');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'İniş ne zaman, görev ne kadar sürecek?' }));
    expect(within(screen.getByRole('navigation')).getAllByRole('button')[0]).toHaveAccessibleName(/tamamlandı/);
  });

  it('submit from step 1 jumps to the step holding the first invalid field', async () => {
    const user = userEvent.setup();
    const posted = mockTransport();
    renderForm('public');
    await user.type(screen.getByLabelText('Enlem (°, planetosentrik)'), '-89.54');
    await user.type(screen.getByLabelText('Boylam (°, doğu-pozitif)'), '0');
    await user.clear(screen.getByLabelText('Görev süresi (saat)'));
    await user.click(screen.getByRole('button', { name: 'Analizi başlat' }));
    expect(visibleStep()).toBe('time');
    expect(screen.getByText('Görev süresi 0’dan büyük ve ≤ 720 saat olmalı')).toBeVisible();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.activeElement).toBe(screen.getByLabelText('Görev süresi (saat)'));
    expect(posted).toHaveLength(0);
  });

  it('site quick-picks use the real /sites raster centre and say it is not an official landing site', async () => {
    const user = userEvent.setup();
    // Shape and values copied from the live GET /sites (Site01 tile, 2026-11-14).
    const sites: SitesResponse = { site_coordinates: 'raster', sites: [
      { id: 'lola_240m', resolution_m: 240, kind: 'global', available: true, uncertainty_err_available: true, note: '' },
      { id: 'site01_5m', resolution_m: 5, kind: 'site', available: true, uncertainty_err_available: true, region_name: 'Connecting ridge', note: '',
        footprint: { center: { lat: -89.46316, lon: -137.48955 }, lat_range: [-89.49, -89.43], width_km: 2.0, height_km: 2.0, contains_pole: false, pixel_size_m: 5 } },
    ] };
    renderForm('public', sites);
    expect(screen.getByText(/resmi iniş adayı değildir/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Connecting ridge/ }));
    expect(screen.getByLabelText('NASA LOLA arazi katmanı (dataset)')).toHaveValue('site01_5m');
    expect(screen.getByLabelText('Enlem (°, planetosentrik)')).toHaveValue(-89.46316);
    expect(screen.getByLabelText('Boylam (°, doğu-pozitif)')).toHaveValue(-137.48955);
  });
});

describe('Mode never changes the request (presentation only)', () => {
  async function submitIn(mode: Mode) {
    const user = userEvent.setup();
    const posted = mockTransport();
    const { unmount } = renderForm(mode);
    await user.type(screen.getByLabelText('Enlem (°, planetosentrik)'), '-89.4512');
    await user.type(screen.getByLabelText('Boylam (°, doğu-pozitif)'), '-137.1427');
    await user.click(screen.getByRole('button', { name: 'Analizi başlat' }));
    await screen.findByText(/Analiz kuyruğa alındı \(HTTP 202\)/);
    unmount();
    return posted[0];
  }

  it('Halk wizard and Mühendis cockpit POST the identical /analyses body', async () => {
    const pub = await submitIn('public');
    const eng = await submitIn('engineer');
    expect(pub).toEqual(eng);
    expect(pub).toMatchObject({ latitude: -89.4512, longitude: -137.1427, landing_utc: '2026-12-01T12:00:00Z', uncertainty_mode: 'nominal' });
  });

  it('switching Halk → Mühendis keeps every typed value', async () => {
    const user = userEvent.setup();
    renderForm('public');
    await user.type(screen.getByLabelText('Enlem (°, planetosentrik)'), '-89.9');
    await user.click(screen.getByRole('button', { name: /^Adım 3:/ }));
    const dark = screen.getByLabelText('En fazla kaç saat karanlıkta kalınabilir?');
    await user.clear(dark);
    await user.type(dark, '30');
    await user.click(screen.getByRole('button', { name: 'Mühendis' }));
    expect(screen.getByRole('heading', { name: 'Görev tanımı — tüm parametreler' })).toBeInTheDocument();
    expect(screen.getByLabelText('Enlem (°, planetosentrik)')).toHaveValue(-89.9);
    expect(screen.getByLabelText('Azami kesintisiz karanlık (saat)')).toHaveValue(30);
  });
});

describe('Mühendis cockpit', () => {
  it('shows the MOON_ME unit vector of the typed site and the live request body', async () => {
    const user = userEvent.setup();
    renderForm('engineer');
    expect(screen.getByText(/2 alan bekliyor/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Enlem (°, planetosentrik)'), '-90');
    await user.type(screen.getByLabelText('Boylam (°, doğu-pozitif)'), '0');
    expect(screen.getByText(/û = \(0\.00000, 0\.00000, -1\.00000\)/)).toBeInTheDocument();
    expect(screen.getByText('gövde geçerli')).toBeInTheDocument();
    expect(screen.getByText(/"landing_utc": "2026-12-01T12:00:00Z"/)).toBeInTheDocument();
  });
});

// Real fixture (trimmed REAL API response): RED, nominal mode, no Earth view at +0 h.
const job = real as unknown as JobRecord & { _request: AnalysisInput };
function Seeded() {
  const { register, selected } = useApp();
  useEffect(() => register(job.id, job._request), [register]);
  return selected ? <ResultSummary entry={{ ...selected, job }} /> : null;
}

describe('Result infographics and cockpit read-out (real result)', () => {
  it('Halk: verdict banner, ring/bar KPIs, mission-window strip and slip scenarios from API values', () => {
    render(<AppStateProvider initialMode="public"><Seeded /></AppStateProvider>);
    expect(screen.getByText('Tanımladığınız kısıtlardan en az biri normal hesapta bile sağlanmıyor.')).toBeInTheDocument();
    const strip = screen.getByRole('region', { name: 'Görev penceresi zaman şeridi' });
    expect(strip.textContent).toContain('2026-12-01 12:00 UTC');
    expect(strip.textContent).toContain('Dünya zamanın %0 kadarında görünür');
    const slips = within(screen.getByRole('region', { name: 'İniş kayma senaryoları' })).getAllByRole('listitem');
    expect(slips.map((li) => li.textContent)).toEqual(['+0 saKısıt aşıldı', '+24 saKısıt aşıldı', '+48 saKısıt aşıldı', '+72 saKısıt aşıldı']);
  });

  it('Mühendis: decision read-out, MOON_ME x/y/z of both sensors and horizon statistics', () => {
    render(<AppStateProvider initialMode="engineer"><Seeded /></AppStateProvider>);
    const readout = screen.getByRole('region', { name: 'Karar özeti (sunucu sonucu)' });
    expect(readout.textContent).toContain('kararRED');
    expect(readout.textContent).toContain('nominal ihlal16'); // server list: 4 constraints × 4 slip scenarios
    // r = 1737.4 + (h_DEM −754.0757 m + h_obs 4 m)/1000 km at (−89.54°, 0°); expected value computed independently (Python).
    expect(screen.getByText(/panel \(13\.9426, 0\.0000, -1736\.5940\)/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ufuk özeti' }).textContent).toContain('ışın DEM kapsaması');
  });
});
