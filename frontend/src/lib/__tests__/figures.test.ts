import { describe, expect, it } from 'vitest';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import type { Horizon, JobRecord, TimelinePoint } from '../../api/types';
import { diskOutline, horizonAt, minMaxIndices, wrappedDisks } from '../sky';
import { buildSkyFigure, pathWithWrapGaps } from '../skyFigure';
import { buildTimelineFigure, displayIndices, plotlyUtc } from '../timelineFigure';

// Trimmed copy of a REAL API response (see fixture _provenance); horizon subsampled to 1°.
const job = real as unknown as JobRecord;
const horizon = job.result!.horizon as Horizon;
const scenario0 = job.result!.mission!.scenarios[0]!;
const timeline = scenario0.timeline;

describe('sky geometry', () => {
  it('scales disc width by 1/cos(elevation) like the backend quadrature', () => {
    const d = diskOutline(100, 60, 0.25);
    expect(Math.max(...d.x) - Math.min(...d.x)).toBeCloseTo(2 * 0.25 / Math.cos(Math.PI / 3), 6);
    expect(Math.max(...d.y) - Math.min(...d.y)).toBeCloseTo(0.5, 6);
  });

  it('splits discs that straddle 0°/360°', () => {
    expect(wrappedDisks(180, 0, 0.27)).toHaveLength(1);
    const near0 = wrappedDisks(0.1, 1, 0.27);
    expect(near0).toHaveLength(2);
    expect(Math.max(...near0[1]!.x)).toBeGreaterThan(360);
    const near360 = wrappedDisks(359.9, 1, 0.95);
    expect(near360).toHaveLength(2);
    expect(Math.min(...near360[1]!.x)).toBeLessThan(0);
  });

  it('periodic horizon interpolation matches samples and wraps', () => {
    const p = [0, 1, 2, 3];
    expect(horizonAt(p, 0)).toBe(0);
    expect(horizonAt(p, 45)).toBeCloseTo(0.5);
    expect(horizonAt(p, 315)).toBeCloseTo(1.5); // between last (3) and first (0)
    expect(horizonAt([0, null, 2, 3], 100)).toBeNull();
  });

  it('min/max decimation keeps extremes, ends and nulls', () => {
    const values = Array.from({ length: 10000 }, (_, i) => (i === 5000 ? 9 : i === 7000 ? -9 : i === 8000 ? null : Math.sin(i / 50)));
    const idx = minMaxIndices(values, 1000);
    expect(idx.length).toBeLessThanOrEqual(1100);
    expect(idx).toContain(0);
    expect(idx).toContain(9999);
    expect(idx).toContain(5000);
    expect(idx).toContain(7000);
    expect(idx).toContain(8000);
  });
});

describe('Sky View figure from a real result', () => {
  it('draws the real horizon, both bodies at the API position, and no invented ERR band', () => {
    const fig = buildSkyFigure({ horizon, timeline, index: 0, zoom: 'full', showPaths: true });
    expect(fig.hasErrBand).toBe(false);
    expect(fig.data.some((t) => String((t as { name?: string }).name).includes('ERR'))).toBe(false);
    const ring = fig.data.find((t) => (t as { name?: string }).name === 'Konum işaretçisi (büyütülmüş)') as { x: number[]; y: number[] };
    expect(ring.x[0]).toBe(timeline[0]!.sun.az_deg);
    expect(ring.y[1]).toBe(timeline[0]!.earth.el_deg);
    const terrain = fig.data[1] as { y: (number | null)[] };
    expect(terrain.y.slice(0, horizon.profiles.sun.nominal.length)).toEqual(horizon.profiles.sun.nominal);
    expect(fig.missing.sun).toBe(0);
    // Same panel and antenna height -> no separate DTE horizon trace.
    expect(fig.data.some((t) => String((t as { name?: string }).name).startsWith('Arazi ufku · DTE'))).toBe(false);
  });

  it('adds the ERR band only when the API provides cautious/optimistic profiles', () => {
    const withErr: Horizon = { ...horizon, k: 1, uncertainty_mode: 'err', profiles: {
      ...horizon.profiles,
      sun: { ...horizon.profiles.sun, cautious: horizon.profiles.sun.nominal.map((v) => (v === null ? null : v + 0.1)), optimistic: horizon.profiles.sun.nominal },
    } };
    const fig = buildSkyFigure({ horizon: withErr, timeline, index: 0, zoom: 'full', showPaths: false });
    expect(fig.hasErrBand).toBe(true);
    expect(fig.data.some((t) => String((t as { name?: string }).name).includes('güven aralığı değil'))).toBe(true);
  });

  it('shows a separate DTE horizon when antenna height differs', () => {
    const h: Horizon = { ...horizon, geometry: { ...horizon.geometry, observer_height_m: { sun: 4, earth: 40 } } };
    const fig = buildSkyFigure({ horizon: h, timeline, index: 0, zoom: 'full', showPaths: false });
    expect(fig.data.some((t) => String((t as { name?: string }).name).includes('DTE anten 40 m'))).toBe(true);
  });

  it('marks missing horizon rays instead of filling them', () => {
    const nominal = [...horizon.profiles.sun.nominal];
    nominal[10] = null;
    const h: Horizon = { ...horizon, profiles: { ...horizon.profiles, sun: { ...horizon.profiles.sun, nominal } } };
    const fig = buildSkyFigure({ horizon: h, timeline, index: 0, zoom: 'full', showPaths: false });
    expect(fig.missing.sun).toBe(1);
    expect((fig.data[1] as { y: (number | null)[] }).y[10]).toBeNull();
  });

  it('zoom follows the selected body', () => {
    const fig = buildSkyFigure({ horizon, timeline, index: 0, zoom: 'sun', showPaths: false });
    const [x0, x1] = fig.layout.xaxis!.range as [number, number];
    expect((x0 + x1) / 2).toBeCloseTo(timeline[0]!.sun.az_deg, 6);
  });

  it('breaks body paths at the azimuth wrap', () => {
    const p = pathWithWrapGaps([{ az: 358, el: 1 }, { az: 359.5, el: 1 }, { az: 0.5, el: 1 }]);
    expect(p.x).toEqual([358, 359.5, null, 0.5]);
  });
});

describe('Timeline figure', () => {
  it('keeps UTC wall time (no local-zone shift) for Plotly', () => {
    expect(plotlyUtc('2026-12-01T12:00:00.000Z')).toBe('2026-12-01 12:00:00');
    expect(plotlyUtc('2026-12-01T12:00:00Z')).toBe('2026-12-01 12:00:00');
  });

  it('plots API f_sun / DTE values unchanged and maps clicks to original indices', () => {
    const fig = buildTimelineFigure({ timeline, index: 3, metrics: null, darkThreshold: 0.01 });
    const sun = fig.data[0] as { y: (number | null)[]; customdata: number[] };
    expect(fig.decimated).toBe(false);
    expect(sun.y).toEqual(timeline.map((t) => t.sun_visible_fraction));
    expect(sun.customdata).toEqual(timeline.map((_, i) => i));
    const line = (fig.layout.shapes ?? []).find((s) => s.type === 'line');
    expect(line?.x0).toBe(plotlyUtc(timeline[3]!.utc));
  });

  it('decimates only for display beyond 3000 samples', () => {
    const long: TimelinePoint[] = Array.from({ length: 6001 }, (_, i) => ({ ...timeline[0]!, sun_visible_fraction: (i % 97) / 96 }));
    const idx = displayIndices(long);
    expect(idx.length).toBeLessThanOrEqual(3000);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(6000);
  });

  it('highlights the longest darkness interval from the API metrics', () => {
    const metrics = scenario0.variants.nominal!.metrics;
    if (!metrics.valid) throw new Error('fixture metrics must be valid');
    const fig = buildTimelineFigure({ timeline, index: 0, metrics, darkThreshold: 0.01 });
    const rect = (fig.layout.shapes ?? []).find((s) => s.type === 'rect');
    expect(rect?.x0).toBe(plotlyUtc(timeline[metrics.darkness_interval![0]]!.utc));
  });
});
