import { describe, expect, it } from 'vitest';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import type { JobRecord, Mission, Scenario, TimelinePoint } from '../../api/types';
import { durationScale, hourTicks, sampleSpan, scenarioOutcomes, stripGeometry } from '../infographic';
import { latrecKm, MOON_RADIUS_KM } from '../telemetry';

// Trimmed copy of a REAL API response (see fixture _provenance): RED, nominal mode,
// +0 h scenario has 121 samples, the Sun never clears the horizon and the Earth is never visible.
const job = real as unknown as JobRecord;
const mission = job.result!.mission as Mission;
const s0 = mission.scenarios[0]!;

const point = (f: number | null, dte: boolean | null): TimelinePoint => ({
  utc: '2026-12-01T12:00:00Z',
  sun: { az_deg: 0, el_deg: 0, angular_radius_deg: 0.27, distance_km: 1.5e8 },
  earth: { az_deg: 0, el_deg: 0, angular_radius_deg: 0.95, distance_km: 3.8e5 },
  sun_visible_fraction: f,
  dte_visible: dte,
});

describe('scenario outcomes come from the server violation lists only', () => {
  it('real RED result: every scenario has nominal violations', () => {
    expect(scenarioOutcomes(mission).map((o) => [o.shift, o.outcome])).toEqual([[0, 'violated'], [24, 'violated'], [48, 'violated'], [72, 'violated']]);
  });

  it('distinguishes cautious-only, pass, nominal-only and unknown (synthetic variants, labelled)', () => {
    const ok = { metrics: { ...(s0.variants.nominal!.metrics as object), valid: true }, violations: [], unknown: [] };
    const viol = { ...ok, violations: [{ code: 'MAX_DTE_GAP', observed: 1, limit: 0, excess: 1, unit: 's' }] };
    const synth = (variants: Scenario['variants'], shift: number) => ({ ...s0, shift_hours: shift, variants }) as Scenario;
    const m = { ...mission, scenarios: [
      synth({ nominal: ok as never, cautious: viol as never }, 0),
      synth({ nominal: ok as never, cautious: ok as never }, 24),
      synth({ nominal: ok as never }, 48),
      synth({ nominal: { metrics: { valid: false }, violations: [], unknown: [] } as never }, 72),
    ] } as Mission;
    expect(scenarioOutcomes(m).map((o) => o.outcome)).toEqual(['cautious', 'pass', 'nominal_only', 'unknown']);
  });
});

describe('duration bar scale', () => {
  it('puts value and limit on one scale with 25 % headroom', () => {
    expect(durationScale(60, 8)).toEqual({ maxH: 75, value: 0.8, limit: 8 / 75 });
    expect(durationScale(0, 8).limit).toBeCloseTo(0.8);
    expect(durationScale(null, null)).toEqual({ maxH: 1.25, value: null, limit: null });
  });
});

describe('mission-window strip geometry', () => {
  it('real +0 h scenario: zero-height Sun area, one Earth-hidden run, server intervals span the window', () => {
    const g = stripGeometry(s0.timeline, { darkness: [0, 120], gap: [0, 120] }, 1000, 40);
    expect(g.n).toBe(121);
    expect(g.sunAreas).toHaveLength(1);
    // f_sun = 0 everywhere → every vertex sits on the baseline (y = 40).
    expect([...g.sunAreas[0]!.matchAll(/,(\d+(?:\.\d+)?)/g)].every((m) => Number(m[1]) === 40)).toBe(true);
    expect(g.earth).toEqual([{ span: [0, 1], value: false }]);
    expect(g.darkness).toEqual([0, 1]);
    expect(g.unknownSun).toEqual([]);
  });

  it('breaks the Sun area at unknown samples and hatches them; DTE runs keep null as unknown', () => {
    const tl = [point(1, true), point(0.5, true), point(null, null), point(null, null), point(0, false)];
    const g = stripGeometry(tl, { darkness: null, gap: [4, 4] }, 100, 10);
    expect(g.sunAreas).toHaveLength(2);
    expect(g.sunAreas[0]).toBe('M0.0,10 L0.0,0.00 L25.0,0.00 L25.0,5.00 L25.0,10 Z');
    expect(g.unknownSun).toEqual([sampleSpan(2, 3, 5)]);
    expect(g.earth.map((r) => r.value)).toEqual([true, null, false]);
    expect(g.gap).toEqual([0.875, 1]);
  });

  it('axis ticks every 12 h up to 4 days', () => {
    expect(hourTicks(60)).toEqual([12, 24, 36, 48]);
    expect(hourTicks(200)).toEqual([24, 48, 72, 96, 120, 144, 168, 192]);
  });
});

describe('MOON_ME body-fixed position (same conversion as SPICE latrec)', () => {
  it('maps pole and equator points and preserves the radius', () => {
    const [x, y, z] = latrecKm(MOON_RADIUS_KM, -90, 0);
    expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(Math.abs(y)).toBeLessThan(1e-9);
    expect(z).toBeCloseTo(-MOON_RADIUS_KM, 9);
    const e = latrecKm(1, 0, 90);
    expect(e[0]).toBeCloseTo(0, 12);
    expect(e[1]).toBeCloseTo(1, 12);
    const v = latrecKm(1736.64992, -89.54, 0);
    expect(Math.hypot(...v)).toBeCloseTo(1736.64992, 9);
  });
});
