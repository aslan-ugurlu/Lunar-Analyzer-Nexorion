import type { Decision, JobRecord, Mission, Scenario, ValidMetrics, Variant } from '../api/types';

/** Decision shown for a job, or null when there is no scientific decision. */
export function jobDecision(job: JobRecord | null): Decision | null {
  if (!job?.result) return null;
  const s = job.result.mission?.status ?? job.result.status;
  return s === 'GREEN' || s === 'YELLOW' || s === 'RED' || s === 'GRAY' ? s : null;
}

export function baselineScenario(mission: Mission | undefined): Scenario | null {
  if (!mission?.scenarios?.length) return null;
  return mission.scenarios.find((s) => s.shift_hours === 0) ?? mission.scenarios[0] ?? null;
}

export function validMetrics(variant: Variant | undefined): ValidMetrics | null {
  return variant?.metrics && variant.metrics.valid ? variant.metrics : null;
}

/** UTC span of a [startIndex, endIndex] interval from decision_engine._longest_true_run. */
export function intervalUtc(scenario: Scenario, interval: [number, number] | null): { start: string; end: string } | null {
  if (!interval) return null;
  const start = scenario.timeline[interval[0]]?.utc;
  const end = scenario.timeline[interval[1]]?.utc;
  return start && end ? { start, end } : null;
}

/** Which recorded interval explains a violation code (only these two are tracked by the backend). */
export function violationInterval(code: string, metrics: ValidMetrics): [number, number] | null {
  if (code === 'MAX_DARKNESS') return metrics.darkness_interval;
  if (code === 'MAX_DTE_GAP') return metrics.dte_gap_interval;
  return null;
}

/** Contiguous index runs where predicate is true (presentation of timeline gaps). */
export function runs(flags: (boolean | null)[]): { start: number; end: number; value: boolean | null }[] {
  const out: { start: number; end: number; value: boolean | null }[] = [];
  let start = 0;
  for (let i = 1; i <= flags.length; i += 1) {
    if (i === flags.length || flags[i] !== flags[start]) {
      out.push({ start, end: i - 1, value: flags[start] ?? null });
      start = i;
    }
  }
  return out.filter((r) => flags.length > 0 && r.end >= r.start);
}
