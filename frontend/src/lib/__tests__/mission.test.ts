import { describe, expect, it } from 'vitest';
import { buildRequest, DEFAULT_FORM, missionProfileKey, fieldForApiPath } from '../mission';

const valid = { ...DEFAULT_FORM, latitude: '-89.54', longitude: '0' };

describe('mission form → AnalysisInput', () => {
  it('requires explicit coordinates (no invented default site)', () => {
    const r = buildRequest(DEFAULT_FORM);
    expect(r.input).toBeNull();
    expect(r.errors.latitude).toBeDefined();
    expect(r.errors.longitude).toBeDefined();
  });

  it('builds the exact backend body with UTC Z and fractions', () => {
    const { input, errors, points, scenarioCount } = buildRequest(valid);
    expect(errors).toEqual({});
    expect(input).toMatchObject({
      dataset_id: 'lola_240m', latitude: -89.54, longitude: 0, landing_utc: '2026-12-01T12:00:00Z',
      duration_hours: 48, buffer_hours: 12, step_minutes: 30, horizon_radius_km: 200,
      sun_observer_height_m: 4, earth_observer_height_m: 4, uncertainty_mode: 'nominal',
      shifts_hours: [0, 24, 48, 72],
      constraints: { max_darkness_hours: 8, min_sun_fraction: 0.5, min_dte_fraction: 0.5, max_dte_gap_hours: 8, slope_footprint_radius_m: 30 },
    });
    expect(input?.constraints.max_slope_deg).toBeUndefined();
    expect(points).toBe(121);
    expect(scenarioCount).toBe(4);
  });

  it.each([
    ['latitude', '-79'], ['latitude', '-91'], ['longitude', '181'], ['step_minutes', '5'], ['step_minutes', '12.5'],
    ['horizon_radius_km', '250'], ['sun_observer_height_m', '-1'], ['err_k', '4'], ['duration_hours', '0'],
  ])('rejects %s = %s like the backend', (key, value) => {
    expect(buildRequest({ ...valid, [key]: value }).input).toBeNull();
  });

  it('requires at least one constraint', () => {
    const r = buildRequest({ ...valid, max_darkness_hours: '', min_sun_fraction_pct: '', min_dte_fraction_pct: '', max_dte_gap_hours: '' });
    expect(r.errors.constraints).toBeDefined();
  });

  it('enforces the sampling budget and product window', () => {
    expect(buildRequest({ ...valid, duration_hours: '720', step_minutes: '10' }).errors.budget).toMatch(/bütçe/);
    expect(buildRequest({ ...valid, landing_date: '2035-12-31', landing_time: '00:00' }).errors.budget).toMatch(/2035/);
    expect(buildRequest({ ...valid, landing_date: '2025-12-31' }).errors.landing_date).toBeDefined();
  });

  it('profile key ignores only location and dataset (same rule as /compare)', () => {
    const a = buildRequest(valid).input!;
    const b = buildRequest({ ...valid, latitude: '-88', longitude: '45', dataset_id: 'lola_80m' }).input!;
    const c = buildRequest({ ...valid, latitude: '-88', sun_observer_height_m: '40' }).input!;
    expect(missionProfileKey(a)).toBe(missionProfileKey(b));
    expect(missionProfileKey(a)).not.toBe(missionProfileKey(c));
  });

  it('maps backend 422 field paths to form fields', () => {
    expect(fieldForApiPath('constraints.min_sun_fraction')).toBe('min_sun_fraction_pct');
    expect(fieldForApiPath('latitude')).toBe('latitude');
    expect(fieldForApiPath(null)).toBeNull();
  });
});
