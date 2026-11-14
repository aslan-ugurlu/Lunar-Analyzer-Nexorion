import { describe, expect, it } from 'vitest';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import type { AnalysisInput, Horizon, JobRecord } from '../../api/types';
import {
  bandWidth, baselineKpis, CSV_COLUMNS, exportMeta, observerAltitudes, profileDifference, profileExtremes,
  scenarioViolationSummary, timelineToCsv, violationRows,
} from '../telemetry';

// Trimmed copy of a REAL API response (see fixture _provenance).
const job = real as unknown as JobRecord & { _request: AnalysisInput };
const mission = job.result!.mission!;
const horizon = job.result!.horizon as Horizon;

describe('horizon statistics are plain descriptive statistics of API arrays', () => {
  it('extremes with azimuth and missing count', () => {
    const e = profileExtremes([0, 90, 180, 270], [1, null, -2, 5]);
    expect(e).toEqual({ min: -2, minAz: 180, max: 5, maxAz: 270, missing: 1 });
    expect(profileExtremes([0], [null])).toBeNull();
  });

  it('real profile extremes match the array', () => {
    const e = profileExtremes(horizon.azimuth_deg, horizon.profiles.sun.nominal)!;
    const vals = horizon.profiles.sun.nominal.filter((v): v is number => v !== null);
    expect(e.max).toBe(Math.max(...vals));
    expect(e.min).toBe(Math.min(...vals));
  });

  it('difference and ERR band width', () => {
    expect(profileDifference([0, 1, 2], [1, 2, null], [0.5, 2.5, 1])).toEqual({ maxAbs: 0.5, atAz: 0, mean: 0, n: 2 });
    expect(bandWidth({ nominal: [0], coverage: [1] })).toBeNull();
    const band = bandWidth({ nominal: [0, 0], coverage: [1, 1], cautious: [0.2, 0.3], optimistic: [-0.1, 0.1] })!;
    expect(band.min).toBeCloseTo(0.2, 12);
    expect(band.max).toBeCloseTo(0.3, 12);
    expect(band.mean).toBeCloseTo(0.25, 12);
  });
});

describe('engineer telemetry', () => {
  it('observer altitude follows r = 1737.4 km + (h_DEM + h_obs)/1000', () => {
    const [sun] = observerAltitudes(horizon);
    expect(sun!.demM).toBeCloseTo(-754.0757, 3);
    expect(sun!.totalM).toBeCloseTo(-750.0757, 3);
    expect(sun!.radiusKm).toBeCloseTo(1737.4 - 0.7500757, 6);
  });

  it('violation rows carry UTC intervals for duration constraints only', () => {
    const rows = violationRows(mission);
    expect(rows.length).toBe(16);
    const dark = rows.find((r) => r.code === 'MAX_DARKNESS' && r.shift === 0)!;
    expect(dark.start).toBe('2026-12-01T12:00:00.000Z');
    expect(dark.end).toBe('2026-12-04T00:00:00.000Z');
    const sun = rows.find((r) => r.code === 'MIN_ILLUMINATION' && r.shift === 0)!;
    expect(sun.start).toBeNull();
  });
});

describe('public KPI cards', () => {
  it('use +0 h nominal metrics and the server violation flags', () => {
    const kpis = baselineKpis(mission, job._request);
    expect(kpis.map((k) => [k.key, k.value, k.state])).toEqual([
      ['sun', 0, 'violated'], ['darkness', 60, 'violated'], ['dte', 0, 'violated'], ['gap', 60, 'violated'],
    ]);
    expect(scenarioViolationSummary(mission)).toEqual({ total: 4, withViolations: [0, 24, 48, 72] });
  });

  it('marks constraints that were not set', () => {
    const input = { ...job._request, constraints: { max_darkness_hours: 8 } };
    expect(baselineKpis(mission, input).find((k) => k.key === 'sun')!.state).toBe('not_set');
  });
});

describe('raw CSV export', () => {
  it('contains only API values with metadata comments', () => {
    const s0 = mission.scenarios[0]!;
    const csv = timelineToCsv(s0.timeline, exportMeta(job.id, job._request, s0, horizon));
    const lines = csv.trim().split('\n');
    const header = lines.findIndex((l) => l.startsWith('utc,'));
    expect(lines.slice(0, header).every((l) => l.startsWith('# '))).toBe(true);
    expect(lines[header]).toBe(CSV_COLUMNS.join(','));
    expect(lines.length - header - 1).toBe(s0.timeline.length);
    const first = lines[header + 1]!.split(',');
    expect(first[0]).toBe(s0.timeline[0]!.utc);
    expect(Number(first[2])).toBe(s0.timeline[0]!.sun.el_deg);
    expect(first[10]).toBe(String(s0.timeline[0]!.dte_visible));
    expect(csv).toContain('# frame: MOON_ME_DE440_ME421');
  });
});
