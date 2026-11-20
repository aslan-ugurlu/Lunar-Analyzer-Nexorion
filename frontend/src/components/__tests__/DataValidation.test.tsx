/**
 * DataValidation in both interface languages. /validation is MOCKED with the backend's shape
 * (labelled mock: UI contract only, not a scientific result). Backend-provided report fields
 * (summary, note, source) must appear verbatim in both languages.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __setFetchForTests, ApiError } from '../../api/client';
import type { Health, SitesResponse, ValidationResponse } from '../../api/types';
import { I18nProvider, type Lang } from '../../i18n';
import { AppStateProvider } from '../../state/AppState';
import { DataValidation } from '../DataValidation';

const VALIDATION: ValidationResponse = {
  tests: {
    'A-04': { status: 'NOT_RUN', summary: 'mock summary from backend', evidence: null, run_utc: null },
    'V-07': { status: 'PASS', summary: 'mock quadrature summary', evidence: { n: 1 }, run_utc: '2026-11-14T21:48:51Z' },
  },
  source: null,
  generated_utc: null,
  note: 'mock backend note',
};

const HEALTH: Health = {
  status: 'degraded',
  spice_files_present: true,
  kernels: { 'naif0012.tls': true, 'de440s.bsp': false },
  datasets: { lola_240m: false },
  note: 'mock',
  jobs_pending: 0,
  limits: { max_workers: 2, max_pending: 6, analyses_per_minute_per_client: 5, analysis_timeout_s: 900 },
};

const SITES: SitesResponse = {
  site_coordinates: 'mock',
  sites: [{ id: 'lola_240m', resolution_m: 240, kind: 'global', available: false, uncertainty_err_available: false, effres_available: false,
    expected_folder: 'data/dem', expected_file: 'LDEM_60S_240MPP_ADJ.TIF', note: 'mock' }],
};

afterEach(() => __setFetchForTests(null));

function renderPanel(lang: Lang, props: { health: Health | null; healthError: ApiError | null; sites: SitesResponse | null }) {
  __setFetchForTests(async () => new Response(JSON.stringify(VALIDATION), { status: 200 }));
  return render(
    <I18nProvider lang={lang}>
      <AppStateProvider initialMode="engineer">
        <DataValidation {...props} />
      </AppStateProvider>
    </I18nProvider>,
  );
}

describe('DataValidation', () => {
  it('English: own wording translated, backend report fields verbatim, honesty notes kept', async () => {
    renderPanel('en', { health: HEALTH, healthError: null, sites: SITES });
    expect(screen.getByRole('heading', { name: 'Service and data status (GET /health, /sites)' })).toBeInTheDocument();
    expect(screen.getByText('download needed')).toBeInTheDocument();
    expect(screen.getByText(/Limits: 2 spawn workers · 6 pending\/running jobs · 5 analyses\/min per client/)).toBeInTheDocument();
    expect(await screen.findByText('JPL Horizons comparison (Sun + Earth direction, ≤ 0.005°)')).toBeInTheDocument();
    expect(screen.getByText('mock summary from backend')).toBeInTheDocument();
    expect(screen.getByText(/mock backend note\. Without a recorded real run the status is NOT_RUN\./)).toBeInTheDocument();
    expect(screen.getByText(/they are not endorsed or certified by NASA/)).toBeInTheDocument();
    expect(screen.getByText(/Local SHA-256 values are for local traceability only/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Known scientific limitations' })).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
  });

  it('Turkish: existing wording unchanged, same backend fields and statuses', async () => {
    renderPanel('tr', { health: HEALTH, healthError: null, sites: SITES });
    expect(screen.getByRole('heading', { name: 'Hizmet ve veri durumu (GET /health, /sites)' })).toBeInTheDocument();
    expect(screen.getByText('indirilmeli')).toBeInTheDocument();
    expect(screen.getByText(/Sınırlar: 2 spawn worker · 6 bekleyen\/çalışan iş · istemci başına 5 analiz\/dk/)).toBeInTheDocument();
    expect(await screen.findByText('JPL Horizons karşılaştırması (Güneş + Dünya yönü, ≤ 0.005°)')).toBeInTheDocument();
    expect(screen.getByText('mock summary from backend')).toBeInTheDocument();
    expect(screen.getByText(/mock backend note\. Kayıtlı gerçek koşu yoksa durum NOT_RUN’dır\./)).toBeInTheDocument();
    expect(screen.getByText(/NASA tarafından onaylanmış veya sertifikalandırılmış değildir/)).toBeInTheDocument();
    expect(screen.getByText(/Yerel SHA-256 değerleri yalnızca yerel izlenebilirlik içindir/)).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('NOT_RUN')).toBeInTheDocument();
  });

  it('offline backend: the error notice is shown in the interface language', async () => {
    const offline = new ApiError(0, 'BACKEND_OFFLINE', 'offline');
    const en = renderPanel('en', { health: null, healthError: offline, sites: null });
    expect(screen.getByText('Backend offline')).toBeInTheDocument();
    await screen.findByText('mock backend note', { exact: false });
    en.unmount();
    renderPanel('tr', { health: null, healthError: offline, sites: null });
    expect(screen.getByText('Backend çevrimdışı')).toBeInTheDocument();
    await screen.findByText('mock backend note', { exact: false });
  });
});
