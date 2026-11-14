import type { AnalysisInput, Constraints, UncertaintyMode } from '../api/types';
import { PRODUCT_END_MS, utcPartsToMs, msToIsoZ } from './utc';

/** Limits mirrored from backend/main.py AnalysisInput / Constraints (keep in sync). */
export const LIMITS = {
  latitude: { min: -90, max: -80 },
  longitude: { min: -180, max: 180 },
  duration_hours: { minExclusive: 0, max: 720 },
  buffer_hours: { min: 0, max: 168 },
  step_minutes: { min: 10, max: 120 },
  horizon_radius_km: { min: 10, max: 200 },
  observer_height_m: { min: 0, max: 100 },
  err_k: { min: 0, max: 3 },
  dark_fraction_threshold: { min: 0, max: 0.1 },
  shift_hours: { min: 0, max: 168, maxCount: 5 },
  hours_constraint: { min: 0, max: 720 },
  fraction_constraint: { min: 0, max: 1 },
  max_slope_deg: { min: 0, max: 90 },
  slope_footprint_radius_m: { min: 5, max: 200 },
  max_points: 6000,
  max_points_total: 12000,
} as const;

/** Raw form state: strings so partially typed numbers are not coerced silently. */
export interface MissionForm {
  dataset_id: string;
  latitude: string;
  longitude: string;
  landing_date: string; // YYYY-MM-DD, interpreted as UTC
  landing_time: string; // HH:MM, interpreted as UTC
  duration_hours: string;
  buffer_hours: string;
  step_minutes: string;
  horizon_radius_km: string;
  sun_observer_height_m: string;
  earth_observer_height_m: string;
  uncertainty_mode: UncertaintyMode;
  err_k: string;
  dark_fraction_threshold: string;
  shifts: number[];
  max_darkness_hours: string;
  min_sun_fraction_pct: string;
  min_dte_fraction_pct: string;
  max_dte_gap_hours: string;
  max_slope_deg: string;
  slope_footprint_radius_m: string;
}

/** Example mission profile (documented example values, NOT recommended or official limits). */
export const DEFAULT_FORM: MissionForm = {
  dataset_id: 'lola_240m',
  latitude: '',
  longitude: '',
  landing_date: '2026-12-01',
  landing_time: '12:00',
  duration_hours: '48',
  buffer_hours: '12',
  step_minutes: '30',
  horizon_radius_km: '200',
  sun_observer_height_m: '4',
  earth_observer_height_m: '4',
  uncertainty_mode: 'nominal',
  err_k: '1',
  dark_fraction_threshold: '0.01',
  shifts: [0, 24, 48, 72],
  max_darkness_hours: '8',
  min_sun_fraction_pct: '50',
  min_dte_fraction_pct: '50',
  max_dte_gap_hours: '8',
  max_slope_deg: '',
  slope_footprint_radius_m: '30',
};

export type FieldErrors = Partial<Record<keyof MissionForm | 'constraints' | 'budget', string>>;

function num(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function check(errors: FieldErrors, key: keyof FieldErrors, value: number | null, min: number, max: number,
               label: string, required = true, integer = false) {
  if (value === null) {
    if (required) errors[key] = `${label} gerekli`;
    return;
  }
  if (Number.isNaN(value)) errors[key] = `${label} sayı olmalı`;
  else if (value < min || value > max) errors[key] = `${label} ${min} … ${max} aralığında olmalı`;
  else if (integer && !Number.isInteger(value)) errors[key] = `${label} tam sayı olmalı`;
}

export interface BuiltRequest {
  input: AnalysisInput | null;
  errors: FieldErrors;
  points: number | null;
  scenarioCount: number;
}

/** Validates the form against backend limits and builds the exact request body. */
export function buildRequest(form: MissionForm): BuiltRequest {
  const errors: FieldErrors = {};
  const lat = num(form.latitude);
  const lon = num(form.longitude);
  check(errors, 'latitude', lat, LIMITS.latitude.min, LIMITS.latitude.max, 'Enlem');
  check(errors, 'longitude', lon, LIMITS.longitude.min, LIMITS.longitude.max, 'Boylam');
  const startMs = utcPartsToMs(form.landing_date, form.landing_time);
  if (startMs === null) errors.landing_date = 'Geçerli bir UTC tarih ve saat girin';
  else if (startMs < Date.UTC(2026, 0, 1) || startMs >= PRODUCT_END_MS) errors.landing_date = 'Desteklenen aralık 2026-01-01 … 2035-12-31 UTC';
  const duration = num(form.duration_hours);
  if (duration === null || Number.isNaN(duration) || duration <= 0 || duration > 720) errors.duration_hours = 'Görev süresi 0’dan büyük ve ≤ 720 saat olmalı';
  const buffer = num(form.buffer_hours);
  check(errors, 'buffer_hours', buffer, 0, 168, 'Tampon süre');
  const step = num(form.step_minutes);
  check(errors, 'step_minutes', step, 10, 120, 'Zaman adımı', true, true);
  const radius = num(form.horizon_radius_km);
  check(errors, 'horizon_radius_km', radius, 10, 200, 'Ufuk yarıçapı');
  const sunH = num(form.sun_observer_height_m);
  const earthH = num(form.earth_observer_height_m);
  check(errors, 'sun_observer_height_m', sunH, 0, 100, 'Güneş paneli yüksekliği');
  check(errors, 'earth_observer_height_m', earthH, 0, 100, 'DTE anten yüksekliği');
  const k = num(form.err_k);
  check(errors, 'err_k', k, 0, 3, 'ERR k');
  const dark = num(form.dark_fraction_threshold);
  check(errors, 'dark_fraction_threshold', dark, 0, 0.1, 'Karanlık eşiği');

  const shifts = [...new Set(form.shifts)].sort((a, b) => a - b);
  if (shifts.length === 0) errors.shifts = 'En az bir senaryo seçin';
  else if (shifts.length > 5) errors.shifts = 'En fazla 5 kayma senaryosu';
  else if (shifts.some((s) => !Number.isInteger(s) || s < 0 || s > 168)) errors.shifts = 'Kaymalar 0 … 168 tam saat olmalı';

  const maxDark = num(form.max_darkness_hours);
  const minSun = num(form.min_sun_fraction_pct);
  const minDte = num(form.min_dte_fraction_pct);
  const maxGap = num(form.max_dte_gap_hours);
  const maxSlope = num(form.max_slope_deg);
  const footprint = num(form.slope_footprint_radius_m);
  check(errors, 'max_darkness_hours', maxDark, 0, 720, 'Azami karanlık', false);
  check(errors, 'min_sun_fraction_pct', minSun, 0, 100, 'Asgari Güneş görünürlüğü (%)', false);
  check(errors, 'min_dte_fraction_pct', minDte, 0, 100, 'Asgari DTE (%)', false);
  check(errors, 'max_dte_gap_hours', maxGap, 0, 720, 'Azami DTE kesintisi', false);
  check(errors, 'max_slope_deg', maxSlope, 0, 90, 'Azami eğim', false);
  check(errors, 'slope_footprint_radius_m', footprint, 5, 200, 'Eğim ayak izi yarıçapı');
  if ([maxDark, minSun, minDte, maxGap, maxSlope].every((v) => v === null)) {
    errors.constraints = 'En az bir görev kısıtı girin';
  }

  let points: number | null = null;
  const scenarioCount = new Set([...shifts, 0]).size;
  if (duration !== null && buffer !== null && step !== null && !errors.duration_hours && !errors.buffer_hours && !errors.step_minutes) {
    points = Math.ceil(((duration + buffer) * 60) / step) + 1;
    if (points > LIMITS.max_points || points * scenarioCount > LIMITS.max_points_total) {
      errors.budget = `Örnekleme bütçesi aşıldı: ${points} nokta × ${scenarioCount} senaryo (sınır 6000 / toplam 12000). Adımı büyütün veya süreyi kısaltın.`;
    }
    if (startMs !== null && !errors.landing_date) {
      const end = startMs + (duration + buffer + Math.max(...shifts, 0)) * 3600_000;
      if (end >= PRODUCT_END_MS) errors.budget = 'Görev sonu 2035-12-31 UTC sonrasına taşıyor';
    }
  }

  if (Object.keys(errors).length > 0 || lat === null || lon === null || startMs === null) {
    return { input: null, errors, points, scenarioCount };
  }
  const constraints: Constraints = { slope_footprint_radius_m: footprint as number };
  if (maxDark !== null) constraints.max_darkness_hours = maxDark;
  if (minSun !== null) constraints.min_sun_fraction = minSun / 100;
  if (minDte !== null) constraints.min_dte_fraction = minDte / 100;
  if (maxGap !== null) constraints.max_dte_gap_hours = maxGap;
  if (maxSlope !== null) constraints.max_slope_deg = maxSlope;
  return {
    input: {
      dataset_id: form.dataset_id,
      latitude: lat,
      longitude: lon,
      landing_utc: msToIsoZ(startMs),
      duration_hours: duration as number,
      buffer_hours: buffer as number,
      step_minutes: step as number,
      horizon_radius_km: radius as number,
      sun_observer_height_m: sunH as number,
      earth_observer_height_m: earthH as number,
      uncertainty_mode: form.uncertainty_mode,
      err_k: k as number,
      dark_fraction_threshold: dark as number,
      shifts_hours: shifts,
      constraints,
    },
    errors,
    points,
    scenarioCount,
  };
}

/**
 * Same canonicalisation as backend /compare: everything except latitude,
 * longitude and dataset_id must match for an apples-to-apples comparison.
 */
export function missionProfileKey(input: AnalysisInput): string {
  const rest: Record<string, unknown> = { ...input };
  delete rest.latitude;
  delete rest.longitude;
  delete rest.dataset_id;
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
    }
    return v;
  };
  return JSON.stringify(sortKeys(rest));
}

/** Map backend 422 `details[].field` (e.g. "constraints.min_sun_fraction") to form keys. */
export function fieldForApiPath(path: string | null): keyof FieldErrors | null {
  if (!path) return null;
  const map: Record<string, keyof FieldErrors> = {
    latitude: 'latitude', longitude: 'longitude', landing_utc: 'landing_date', duration_hours: 'duration_hours',
    buffer_hours: 'buffer_hours', step_minutes: 'step_minutes', horizon_radius_km: 'horizon_radius_km',
    sun_observer_height_m: 'sun_observer_height_m', earth_observer_height_m: 'earth_observer_height_m',
    err_k: 'err_k', dark_fraction_threshold: 'dark_fraction_threshold', shifts_hours: 'shifts', dataset_id: 'dataset_id',
    'constraints.max_darkness_hours': 'max_darkness_hours', 'constraints.min_sun_fraction': 'min_sun_fraction_pct',
    'constraints.min_dte_fraction': 'min_dte_fraction_pct', 'constraints.max_dte_gap_hours': 'max_dte_gap_hours',
    'constraints.max_slope_deg': 'max_slope_deg', 'constraints.slope_footprint_radius_m': 'slope_footprint_radius_m',
    constraints: 'constraints',
  };
  return map[path] ?? null;
}
