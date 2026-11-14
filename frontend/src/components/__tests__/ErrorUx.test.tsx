import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import { explainCode, headingFor, KNOWN_CODES } from '../../api/errors';
import type { AnalysisInput, JobRecord, Mission } from '../../api/types';
import { AppStateProvider, useApp, type AnalysisEntry, type Mode } from '../../state/AppState';
import { Notice } from '../ui';
import { ResultSummary } from '../ResultSummary';

function renderNotice(code: string, mode: Mode) {
  return render(<AppStateProvider initialMode={mode}><Notice explained={explainCode(code)} /></AppStateProvider>);
}

describe('Halk / Mühendis error UX', () => {
  it('every catalogued code has a plain-language Halk heading that is not a raw code', () => {
    expect(KNOWN_CODES.length).toBeGreaterThanOrEqual(20);
    for (const code of KNOWN_CODES) {
      const heading = headingFor(explainCode(code), 'public');
      expect(heading, code).not.toMatch(/[A-Z]{3,}_[A-Z]/);
      expect(heading, code).not.toContain(code);
    }
  });

  it('Halk: DEM_MISSING leads with plain Turkish; the code is only inside “Teknik detaylar”', async () => {
    const user = userEvent.setup();
    renderNotice('DEM_MISSING', 'public');
    expect(screen.getByText('Arazi verisi henüz mevcut değil')).toBeVisible();
    const code = screen.getByText('DEM_MISSING', { exact: true });
    expect(code).not.toBeVisible();
    const summary = screen.getByText('Teknik detaylar');
    expect(summary.tagName).toBe('SUMMARY');
    await user.click(summary);
    expect(code).toBeVisible();
    expect(screen.getByText(/python -m backend.download_data --include-lola-240m/)).toBeVisible();
  });

  it('Mühendis: the verbatim code is visible directly next to the technical title', () => {
    renderNotice('DEM_MISSING', 'engineer');
    expect(screen.getByText('DEM_MISSING', { exact: true })).toBeVisible();
    expect(screen.getByText(/NASA LOLA arazi verisi \(DEM\) eksik/)).toBeVisible();
    expect(screen.queryByText('Teknik detaylar')).toBeNull();
  });

  it.each([
    ['SPICE_MISSING', 'Güneş ve Dünya konum verisi henüz mevcut değil'],
    ['CLONE_NOT_PRECOMPUTED', 'Bu belirsizlik yöntemi için veri henüz hazır değil'],
    ['QUEUE_FULL', 'Sunucu şu an çok meşgul'],
    ['WORKER_UNAVAILABLE', 'Hesaplama yarıda kesildi'],
  ])('Halk heading for %s', (code, heading) => {
    renderNotice(code, 'public');
    expect(screen.getByText(heading)).toBeVisible();
    expect(screen.getByText(code, { exact: true })).not.toBeVisible();
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

describe('135-km fast mode capped result (rendering only)', () => {
  it('Halk: YELLOW badge, plain reason, story asks for a 200-km run', () => {
    render(<AppStateProvider initialMode="public"><Seeded /></AppStateProvider>);
    expect(document.querySelector('[data-decision="YELLOW"]')?.textContent).toContain('Dikkat: ek kontrol gerekiyor');
    const box = document.querySelector('[data-code="REDUCED_HORIZON_RADIUS"]') as HTMLElement;
    expect(within(box).getByText('Hızlı tarama yapıldı: kesin “uygun” kararı için tam tarama gerekli')).toBeVisible();
    expect(within(box).getByText('REDUCED_HORIZON_RADIUS', { exact: true })).not.toBeVisible();
    expect(screen.getByText(/ufuk yalnızca 135 km’ye kadar tarandı \(hızlı mod\)/)).toBeInTheDocument();
  });

  it('Mühendis: code, before→after and the telemetry row are visible', () => {
    render(<AppStateProvider initialMode="engineer"><Seeded /></AppStateProvider>);
    expect(document.querySelector('[data-decision="YELLOW"]')).not.toBeNull();
    const box = document.querySelector('[data-code="REDUCED_HORIZON_RADIUS"]') as HTMLElement;
    expect(within(box).getByText('REDUCED_HORIZON_RADIUS', { exact: true })).toBeVisible();
    expect(within(box).getByText(/karar GREEN → YELLOW \(GREEN tavanı\)/)).toBeVisible();
    expect(screen.getByText(/REDUCED_HORIZON_RADIUS · r 135 km \/ referans 200 km · GREEN → YELLOW \(GREEN tavanı\)/)).toBeInTheDocument();
  });
});
