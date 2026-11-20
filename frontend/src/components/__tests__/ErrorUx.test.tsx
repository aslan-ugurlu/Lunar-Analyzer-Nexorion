import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import { explainCode, headingFor, KNOWN_CODES } from '../../api/errors';
import type { AnalysisInput, JobRecord, Mission } from '../../api/types';
import { AppStateProvider, useApp, type AnalysisEntry, type Mode } from '../../state/AppState';
import { Notice } from '../ui';
import { ResultSummary } from '../ResultSummary';
import { I18nProvider, type Lang } from '../../i18n';

function renderNotice(code: string, mode: Mode, lang: Lang = 'en') {
  // explainCode() reads the provider's language, so it is called inside the provider.
  function Inner() {
    return <Notice explained={explainCode(code)} />;
  }
  return render(<I18nProvider lang={lang}><AppStateProvider initialMode={mode}><Inner /></AppStateProvider></I18nProvider>);
}

describe('Public / Engineer error UX', () => {
  it.each(['en', 'tr'] as Lang[])('every catalogued code has a plain-language Public heading that is not a raw code (%s)', (lang) => {
    render(<I18nProvider lang={lang}><span /></I18nProvider>);
    expect(KNOWN_CODES.length).toBeGreaterThanOrEqual(20);
    for (const code of KNOWN_CODES) {
      const explained = explainCode(code);
      const heading = headingFor(explained, 'public');
      expect(heading, code).not.toMatch(/[A-Z]{3,}_[A-Z]/);
      expect(heading, code).not.toContain(code);
      // A code missing from one language would fall back to the "unknown status" entry.
      expect(explained.title, code).not.toMatch(/^(Unknown status|Bilinmeyen durum)/);
    }
  });

  it('Public: DEM_MISSING leads with plain language; the code is only inside “Technical details”', async () => {
    const user = userEvent.setup();
    renderNotice('DEM_MISSING', 'public');
    expect(screen.getByText('Terrain data is not available yet')).toBeVisible();
    const code = screen.getByText('DEM_MISSING', { exact: true });
    expect(code).not.toBeVisible();
    const summary = screen.getByText('Technical details');
    expect(summary.tagName).toBe('SUMMARY');
    await user.click(summary);
    expect(code).toBeVisible();
    expect(screen.getByText(/python -m backend.download_data --include-lola-240m/)).toBeVisible();
  });

  it('Halk (Turkish): DEM_MISSING leads with plain Turkish; the code is only inside “Teknik detaylar”', async () => {
    const user = userEvent.setup();
    renderNotice('DEM_MISSING', 'public', 'tr');
    expect(screen.getByText('Arazi verisi henüz mevcut değil')).toBeVisible();
    const code = screen.getByText('DEM_MISSING', { exact: true });
    expect(code).not.toBeVisible();
    const summary = screen.getByText('Teknik detaylar');
    expect(summary.tagName).toBe('SUMMARY');
    await user.click(summary);
    expect(code).toBeVisible();
  });

  it('Engineer: the verbatim code is visible directly next to the technical title', () => {
    renderNotice('DEM_MISSING', 'engineer');
    expect(screen.getByText('DEM_MISSING', { exact: true })).toBeVisible();
    expect(screen.getByText(/NASA LOLA terrain data \(DEM\) missing/)).toBeVisible();
    expect(screen.queryByText('Technical details')).toBeNull();
  });

  it('Mühendis (Turkish): the verbatim code is visible next to the Turkish technical title', () => {
    renderNotice('DEM_MISSING', 'engineer', 'tr');
    expect(screen.getByText('DEM_MISSING', { exact: true })).toBeVisible();
    expect(screen.getByText(/NASA LOLA arazi verisi \(DEM\) eksik/)).toBeVisible();
    expect(screen.queryByText('Teknik detaylar')).toBeNull();
  });

  it.each([
    ['SPICE_MISSING', 'Sun and Earth position data is not available yet', 'Güneş ve Dünya konum verisi henüz mevcut değil'],
    ['CLONE_NOT_PRECOMPUTED', 'Data for this uncertainty method is not ready yet', 'Bu belirsizlik yöntemi için veri henüz hazır değil'],
    ['QUEUE_FULL', 'The server is very busy right now', 'Sunucu şu an çok meşgul'],
    ['WORKER_UNAVAILABLE', 'The computation was interrupted', 'Hesaplama yarıda kesildi'],
  ])('Public heading for %s in English and Turkish', (code, en, tr) => {
    renderNotice(code, 'public');
    expect(screen.getByText(en)).toBeVisible();
    expect(screen.getByText(code, { exact: true })).not.toBeVisible();
    cleanup();
    renderNotice(code, 'public', 'tr');
    expect(screen.getByText(tr)).toBeVisible();
  });

  it('error notices keep role=alert (announced) and can take focus after a failed submit', () => {
    render(<AppStateProvider initialMode="public"><Notice explained={explainCode('SPICE_MISSING')} focusOnMount /></AppStateProvider>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-code', 'SPICE_MISSING');
    expect(document.activeElement).toBe(alert);
  });
});

// SYNTHETIC UI DOUBLE (labelled): the real fixture with status/radius_policy replaced to exercise
// rendering of a 135-km capped result. It is never used as a scientific value.
const job = structuredClone(real) as unknown as JobRecord & { _request: AnalysisInput };
const mission = job.result!.mission as Mission;
mission.status = 'YELLOW';
mission.nominal_violations = [];
mission.cautious_violations = [];
for (const s of mission.scenarios) for (const v of Object.values(s.variants)) if (v) v.violations = [];
mission.radius_policy = {
  code: 'REDUCED_HORIZON_RADIUS', radius_km: 135, reference_radius_km: 200, below_reference: true,
  status_before_policy: 'GREEN', status_after_policy: 'YELLOW', capped: true, note: 'synthetic',
};
job.result!.status = 'YELLOW';
const ENTRY: AnalysisEntry = {
  id: job.id, input: { ...job._request, horizon_radius_km: 135 }, kind: 'analysis', parentId: null, createdAtMs: 0, job, lost: false, pollErrorCode: null,
};
function Seeded() {
  const { register, selected } = useApp();
  useEffect(() => register(ENTRY.id, ENTRY.input), [register]);
  return selected ? <ResultSummary entry={{ ...selected, job }} /> : null;
}

const CAPPED = {
  en: {
    badge: 'Caution: extra checks needed',
    notice: 'Quick scan used: a full scan is needed for a definite “suitable” decision',
    story: /the horizon was scanned only to 135 km \(quick mode\)/,
    engineerNotice: /decision GREEN → YELLOW \(GREEN cap\)/,
    telemetry: /REDUCED_HORIZON_RADIUS · r 135 km \/ reference 200 km · GREEN → YELLOW \(GREEN cap\)/,
  },
  tr: {
    badge: 'Dikkat: ek kontrol gerekiyor',
    notice: 'Hızlı tarama yapıldı: kesin “uygun” kararı için tam tarama gerekli',
    story: /ufuk yalnızca 135 km’ye kadar tarandı \(hızlı mod\)/,
    engineerNotice: /karar GREEN → YELLOW \(GREEN tavanı\)/,
    telemetry: /REDUCED_HORIZON_RADIUS · r 135 km \/ referans 200 km · GREEN → YELLOW \(GREEN tavanı\)/,
  },
};

describe('135-km fast mode capped result (rendering only)', () => {
  it.each(['en', 'tr'] as Lang[])('Public: YELLOW badge, plain reason, story asks for a 200-km run (%s)', (lang) => {
    const t = CAPPED[lang];
    render(<I18nProvider lang={lang}><AppStateProvider initialMode="public"><Seeded /></AppStateProvider></I18nProvider>);
    expect(document.querySelector('[data-decision="YELLOW"]')?.textContent).toContain(t.badge);
    const box = document.querySelector('[data-code="REDUCED_HORIZON_RADIUS"]') as HTMLElement;
    expect(within(box).getByText(t.notice)).toBeVisible();
    expect(within(box).getByText('REDUCED_HORIZON_RADIUS', { exact: true })).not.toBeVisible();
    expect(screen.getByText(t.story)).toBeInTheDocument();
  });

  it.each(['en', 'tr'] as Lang[])('Engineer: code, before→after and the telemetry row are visible (%s)', (lang) => {
    const t = CAPPED[lang];
    render(<I18nProvider lang={lang}><AppStateProvider initialMode="engineer"><Seeded /></AppStateProvider></I18nProvider>);
    expect(document.querySelector('[data-decision="YELLOW"]')).not.toBeNull();
    const box = document.querySelector('[data-code="REDUCED_HORIZON_RADIUS"]') as HTMLElement;
    expect(within(box).getByText('REDUCED_HORIZON_RADIUS', { exact: true })).toBeVisible();
    expect(within(box).getByText(t.engineerNotice)).toBeVisible();
    expect(screen.getByText(t.telemetry)).toBeInTheDocument();
  });
});
