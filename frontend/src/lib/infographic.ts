/**
 * Geometry for the Halk-mode infographics. Presentation only: every shape is drawn from
 * API values (timeline samples, server intervals, server violation lists). Nothing here
 * classifies, re-scores or interpolates a scientific result.
 */
import type { Mission, TimelinePoint } from '../api/types';
import { runs, validMetrics } from './result';
import { minMaxIndices } from './sky';

/* ---------------- per-scenario outcome (from the server's violation lists) ---------------- */
export type ScenarioOutcome = 'violated' | 'cautious' | 'pass' | 'nominal_only' | 'unknown';

export function scenarioOutcomes(mission: Mission | undefined): { shift: number; outcome: ScenarioOutcome }[] {
  return (mission?.scenarios ?? []).map((s) => {
    const nominal = s.variants.nominal;
    const cautious = s.variants.cautious;
    let outcome: ScenarioOutcome;
    if ((nominal?.violations.length ?? 0) > 0) outcome = 'violated';
    else if ((cautious?.violations.length ?? 0) > 0) outcome = 'cautious';
    else if (!validMetrics(nominal) || (nominal?.unknown.length ?? 0) > 0 || (cautious && (!validMetrics(cautious) || cautious.unknown.length > 0))) outcome = 'unknown';
    else if (cautious) outcome = 'pass';
    else outcome = 'nominal_only';
    return { shift: s.shift_hours, outcome };
  });
}

/* ---------------- duration bar scale ---------------- */
/** Value and limit as fractions of one shared scale (25 % headroom above the larger of the two). */
export function durationScale(valueH: number | null, limitH: number | null): { maxH: number; value: number | null; limit: number | null } {
  const maxH = Math.max(valueH ?? 0, limitH ?? 0, 1) * 1.25;
  return { maxH, value: valueH === null ? null : valueH / maxH, limit: limitH === null ? null : limitH / maxH };
}

/* ---------------- mission-window strip ---------------- */
export type Span = [number, number];

/** Sample run [start, end] → fraction span, widened by half a sample on each side so single samples stay visible. */
export function sampleSpan(start: number, end: number, n: number): Span {
  if (n <= 1) return [0, 1];
  return [Math.max(0, (start - 0.5) / (n - 1)), Math.min(1, (end + 0.5) / (n - 1))];
}

export interface StripGeometry {
  n: number;
  /** Closed SVG paths (step-after, like the Timeline chart) of f_sun in a width × height box; gaps where f_sun is null. */
  sunAreas: string[];
  unknownSun: Span[];
  earth: { span: Span; value: boolean | null }[];
  darkness: Span | null;
  gap: Span | null;
}

export function stripGeometry(
  timeline: TimelinePoint[],
  intervals: { darkness: [number, number] | null; gap: [number, number] | null },
  width = 1000,
  height = 40,
  maxPoints = 800,
): StripGeometry {
  const n = timeline.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width);
  const idx = minMaxIndices(timeline.map((t) => t.sun_visible_fraction), maxPoints);
  const areas: string[] = [];
  let current: string[] = [];
  let lastX = 0;
  let lastY = height;
  const flush = () => {
    if (current.length === 0) return;
    current.push(`L${lastX.toFixed(1)},${height}`, 'Z');
    areas.push(current.join(' '));
    current = [];
  };
  for (const i of idx) {
    const f = timeline[i]?.sun_visible_fraction;
    if (f === null || f === undefined || !Number.isFinite(f)) {
      flush();
      continue;
    }
    const px = x(i);
    const py = height - Math.max(0, Math.min(1, f)) * height;
    if (current.length === 0) current.push(`M${px.toFixed(1)},${height}`, `L${px.toFixed(1)},${py.toFixed(2)}`);
    else current.push(`L${px.toFixed(1)},${lastY.toFixed(2)}`, `L${px.toFixed(1)},${py.toFixed(2)}`);
    lastX = px;
    lastY = py;
  }
  flush();

  const unknownSun = runs(timeline.map((t) => t.sun_visible_fraction === null))
    .filter((r) => r.value === true)
    .map((r) => sampleSpan(r.start, r.end, n));
  const earth = runs(timeline.map((t) => t.dte_visible)).map((r) => ({ span: sampleSpan(r.start, r.end, n), value: r.value }));
  return {
    n,
    sunAreas: areas,
    unknownSun,
    earth,
    darkness: intervals.darkness ? sampleSpan(intervals.darkness[0], intervals.darkness[1], n) : null,
    gap: intervals.gap ? sampleSpan(intervals.gap[0], intervals.gap[1], n) : null,
  };
}

/** Hour offsets (from scenario start) for axis ticks; 12 h steps up to 4 days, then 24 h / 72 h. */
export function hourTicks(totalHours: number): number[] {
  const step = totalHours <= 96 ? 12 : totalHours <= 240 ? 24 : 72;
  const out: number[] = [];
  for (let h = step; h < totalHours; h += step) out.push(h);
  return out;
}
