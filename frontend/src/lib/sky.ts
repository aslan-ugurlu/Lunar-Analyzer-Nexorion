/**
 * Sky-View drawing geometry (presentation only; never fed back into science).
 *
 * A body of angular radius r centred at (az0, el0) is drawn with the same
 * small-angle mapping the backend uses for the solar-disk quadrature in
 * terrain_engine.sun_disk_fraction: az = az0 + r·cos t / cos(el0), el = el0 + r·sin t.
 * Discs straddling 0°/360° are split into copies shifted by ±360° so the
 * visible [0, 360] window shows both halves.
 */

export interface Polyline {
  x: number[];
  y: number[];
}

export function diskOutline(azDeg: number, elDeg: number, radiusDeg: number, segments = 72): Polyline {
  const cosEl = Math.max(1e-8, Math.cos((elDeg * Math.PI) / 180));
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (2 * Math.PI * i) / segments;
    x.push(azDeg + (radiusDeg * Math.cos(t)) / cosEl);
    y.push(elDeg + radiusDeg * Math.sin(t));
  }
  return { x, y };
}

/** Disc outlines needed to render a body inside the [0, 360] azimuth window. */
export function wrappedDisks(azDeg: number, elDeg: number, radiusDeg: number, segments = 72): Polyline[] {
  const az = ((azDeg % 360) + 360) % 360;
  const base = diskOutline(az, elDeg, radiusDeg, segments);
  const minX = Math.min(...base.x);
  const maxX = Math.max(...base.x);
  const out = [base];
  if (minX < 0) out.push({ x: base.x.map((v) => v + 360), y: base.y });
  if (maxX > 360) out.push({ x: base.x.map((v) => v - 360), y: base.y });
  return out;
}

/** Linear periodic interpolation of a 0.1°-sampled profile (same rule as terrain_engine.horizon_at). */
export function horizonAt(profile: (number | null)[], azDeg: number): number | null {
  const n = profile.length;
  if (n === 0) return null;
  const scaled = ((((azDeg % 360) + 360) % 360) / 360) * n;
  const lower = Math.floor(scaled) % n;
  const upper = (lower + 1) % n;
  const t = scaled - Math.floor(scaled);
  const a = profile[lower];
  const b = profile[upper];
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a * (1 - t) + b * t;
}

/**
 * Visualisation-only min/max decimation for long time series: keeps the first,
 * last, and per-bucket extreme samples so on/off transitions remain visible.
 * Returns indices into the original arrays (the original data is untouched).
 */
export function minMaxIndices(values: (number | null)[], maxPoints: number): number[] {
  const n = values.length;
  if (n <= maxPoints || maxPoints < 4) return Array.from({ length: n }, (_, i) => i);
  const buckets = Math.floor((maxPoints - 2) / 2);
  const size = (n - 2) / buckets;
  const keep = new Set<number>([0, n - 1]);
  for (let b = 0; b < buckets; b += 1) {
    const start = 1 + Math.floor(b * size);
    const end = Math.min(n - 1, 1 + Math.floor((b + 1) * size));
    let lo = -1;
    let hi = -1;
    for (let i = start; i < end; i += 1) {
      const v = values[i];
      if (v === null || v === undefined) {
        keep.add(i); // never hide missing samples
        continue;
      }
      if (lo < 0 || v < (values[lo] as number)) lo = i;
      if (hi < 0 || v > (values[hi] as number)) hi = i;
    }
    if (lo >= 0) keep.add(lo);
    if (hi >= 0) keep.add(hi);
  }
  return [...keep].sort((a, b) => a - b);
}

export function countMissing(profile: (number | null)[]): number {
  return profile.reduce<number>((acc, v) => acc + (v === null ? 1 : 0), 0);
}
