import { describe, expect, it } from 'vitest';
import { effresText } from '../TelemetryPanel';

describe('EFFRES telemetry text (values copied from the API, metres)', () => {
  it('formats OK layers and states missing / not published layers explicitly', () => {
    const text = effresText({
      lola_80m: { status: 'OK', pixel_m: 80, band_km: [0, 30], at_observer_m: 412.4, median_m: 380, p90_m: 950 },
      lola_240m: { status: 'MISSING', pixel_m: 240, band_km: [30, 200] },
      site01_5m: { status: 'NOT_PUBLISHED', pixel_m: 5, band_km: [0, 5] },
    });
    expect(text).toContain('lola_80m (80 m piksel, 0–30 km): gözlemci 412 m · medyan 380 m · p90 950 m');
    expect(text).toContain('lola_240m: indirilmedi');
    expect(text).toContain('site01_5m: PGDA yayımlamıyor (_toterr kullanılır)');
  });
});
