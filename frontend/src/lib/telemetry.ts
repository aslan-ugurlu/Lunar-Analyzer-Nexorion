/**
 * Presentation-only summaries of API data for Halk / Mühendis views.
 * Nothing here alters or re-scores a scientific result: every number is either
 * copied from the API or a direct descriptive statistic of API arrays.
 */
import type { AnalysisInput, Horizon, HorizonProfile, Mission, Scenario, TimelinePoint, ValidMetrics, Violation } from '../api/types';
import { baselineScenario, intervalUtc, validMetrics, violationInterval } from './result';

export const MOON_RADIUS_KM = 1737.4;
export const FRAME = 'MOON_ME_DE440_ME421';

/* ---------------- horizon statistics (Sky View, engineer) ---------------- */
export interface ProfileExtremes {
  min: number;
  minAz: number;
  max: number;
  maxAz: number;
  missing: number;
}

export function profileExtremes(azimuths: number[], values: (number | null)[]): ProfileExtremes | null {
  let min = Infinity;
  let max = -Infinity;
  let minAz = NaN;
  let maxAz = NaN;
  let missing = 0;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      missing += 1;
      return;
    }
    if (v < min) { min = v; minAz = azimuths[i] ?? NaN; }
    if (v > max) { max = v; maxAz = azimuths[i] ?? NaN; }
  });
  return Number.isFinite(min) ? { min, minAz, max, maxAz, missing } : null;
}

export interface ProfileDifference {
  maxAbs: number;
  atAz: number;
  mean: number;
  n: number;
}

/** a - b for two profiles on the same azimuth grid (e.g. DTE antenna vs solar panel). */
export function profileDifference(azimuths: number[], a: (number | null)[], b: (number | null)[]): ProfileDifference | null {
  let maxAbs = -1;
  let atAz = NaN;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === null || y === null || x === undefined || y === undefined) continue;
    const d = x - y;
    sum += d;
    n += 1;
    if (Math.abs(d) > maxAbs) { maxAbs = Math.abs(d); atAz = azimuths[i] ?? NaN; }
  }
  return n > 0 ? { maxAbs, atAz, mean: sum / n, n } : null;
}

export function bandWidth(profile: HorizonProfile): { min: number; max: number; mean: number } | null {
  if (!profile.cautious || !profile.optimistic) return null;
  const widths: number[] = [];
  profile.cautious.forEach((c, i) => {
    const o = profile.optimistic?.[i];
    if (c !== null && o !== null && o !== undefined) widths.push(c - o);
  });
  if (widths.length === 0) return null;
  return { min: Math.min(...widths), max: Math.max(...widths), mean: widths.reduce((s, w) => s + w, 0) / widths.length };
}

/* ---------------- observer geometry (engineer) ---------------- */
export interface ObserverAltitude {
  body: 'sun' | 'earth';
  demM: number;
  sensorM: number;
  totalM: number;
  radiusKm: number;
}

/** h_DEM + h_sensor above the 1737.4 km reference sphere (same formula as astro_engine). */
export function observerAltitudes(horizon: Horizon): ObserverAltitude[] {
  const dem = horizon.geometry.observer_dem_m;
  return (['sun', 'earth'] as const).map((body) => {
    const sensor = horizon.geometry.observer_height_m[body];
    return { body, demM: dem, sensorM: sensor, totalM: dem + sensor, radiusKm: MOON_RADIUS_KM + (dem + sensor) / 1000 };
  });
}

/* ---------------- violations with UTC intervals (engineer table) ---------------- */
export interface ViolationRow extends Violation {
  shift: number;
  variant: 'nominal' | 'cautious';
  start: string | null;
  end: string | null;
}

export function violationRows(mission: Mission | undefined): ViolationRow[] {
  const rows: ViolationRow[] = [];
  for (const s of mission?.scenarios ?? []) {
    for (const variant of ['nominal', 'cautious'] as const) {
      const v = s.variants[variant];
      const m = validMetrics(v);
      for (const viol of v?.violations ?? []) {
        const span = m ? intervalUtc(s, violationInterval(viol.code, m)) : null;
        rows.push({ ...viol, shift: s.shift_hours, variant, start: span?.start ?? null, end: span?.end ?? null });
      }
    }
  }
  return rows;
}

/* ---------------- public KPI cards ---------------- */
export type ConstraintState = 'met' | 'violated' | 'not_set' | 'unknown';

export interface Kpi {
  key: 'sun' | 'darkness' | 'dte' | 'gap';
  value: number | null;
  unit: 'fraction' | 'hours';
  limit: number | null;
  state: ConstraintState;
}

const KPI_CODES: Record<Kpi['key'], string> = { sun: 'MIN_ILLUMINATION', darkness: 'MAX_DARKNESS', dte: 'MIN_DTE', gap: 'MAX_DTE_GAP' };

/** +0 h nominal metrics and whether the server flagged each constraint as violated there. */
export function baselineKpis(mission: Mission | undefined, input: AnalysisInput): Kpi[] {
  const s: Scenario | null = baselineScenario(mission);
  const m: ValidMetrics | null = validMetrics(s?.variants.nominal);
  const violated = new Set((s?.variants.nominal?.violations ?? []).map((v) => v.code));
  const c = input.constraints;
  const limits: Record<Kpi['key'], number | null | undefined> = {
    sun: c.min_sun_fraction, darkness: c.max_darkness_hours, dte: c.min_dte_fraction, gap: c.max_dte_gap_hours,
  };
  const values: Record<Kpi['key'], number | null> = {
    sun: m ? m.mean_sun_visible_fraction : null,
    darkness: m ? m.max_continuous_darkness_s / 3600 : null,
    dte: m ? m.dte_visible_fraction : null,
    gap: m ? m.max_continuous_dte_gap_s / 3600 : null,
  };
  return (['sun', 'darkness', 'dte', 'gap'] as const).map((key) => {
    const limit = limits[key] ?? null;
    const state: ConstraintState = !m ? 'unknown' : limit === null ? 'not_set' : violated.has(KPI_CODES[key]) ? 'violated' : 'met';
    return { key, value: values[key], unit: key === 'sun' || key === 'dte' ? 'fraction' : 'hours', limit, state };
  });
}

/** Number of scenarios (+0/+24/...) whose nominal variant had any violation, per the server. */
export function scenarioViolationSummary(mission: Mission | undefined): { total: number; withViolations: number[] } {
  const scenarios = mission?.scenarios ?? [];
  return {
    total: scenarios.length,
    withViolations: scenarios.filter((s) => (s.variants.nominal?.violations.length ?? 0) > 0).map((s) => s.shift_hours),
  };
}

/* ---------------- raw data export (Timeline, engineer) ---------------- */
export const CSV_COLUMNS = [
  'utc', 'sun_az_deg', 'sun_el_deg', 'sun_angular_radius_deg', 'sun_distance_km',
  'earth_az_deg', 'earth_el_deg', 'earth_angular_radius_deg', 'earth_distance_km',
  'sun_visible_fraction', 'dte_visible',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Raw API timeline values only (no derived columns); metadata as leading '#' comment lines. */
export function timelineToCsv(timeline: TimelinePoint[], meta: Record<string, string | number | null>): string {
  const head = Object.entries(meta).map(([k, v]) => `# ${k}: ${v ?? ''}`);
  const rows = timeline.map((p) => [
    p.utc, p.sun.az_deg, p.sun.el_deg, p.sun.angular_radius_deg, p.sun.distance_km,
    p.earth.az_deg, p.earth.el_deg, p.earth.angular_radius_deg, p.earth.distance_km,
    p.sun_visible_fraction, p.dte_visible,
  ].map(csvCell).join(','));
  return [...head, CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}

export function exportMeta(analysisId: string, input: AnalysisInput, scenario: Pick<Scenario, 'shift_hours' | 'start_utc' | 'end_utc'>, horizon: Horizon | null) {
  return {
    source: 'Lunar Mission Window Analyzer API (raw values, no re-computation)',
    analysis_id: analysisId,
    latitude_deg: input.latitude,
    longitude_deg_east: input.longitude,
    frame: FRAME,
    shift_hours: scenario.shift_hours,
    scenario_start_utc: scenario.start_utc,
    scenario_end_utc: scenario.end_utc,
    step_minutes: input.step_minutes,
    dem_layers: horizon ? Object.entries(horizon.layer_resolution_m ?? {}).map(([k, r]) => `${k}=${r}m`).join(' ') || Object.keys(horizon.sources).join(' ') : null,
    horizon_cache_key: horizon?.cache_key ?? null,
    note: 'Screening data; not a landing certification. DTE = geometric Earth-centre line of sight.',
  };
}
