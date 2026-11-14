import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import type { AnalysisInput, JobRecord, Mission } from '../../api/types';
import { AppStateProvider, useApp, type AnalysisEntry } from '../../state/AppState';
import { ResultSummary } from '../ResultSummary';

// SYNTHETIC UI DOUBLE (labelled): the real fixture with a clone-style cautious variant whose metrics
// lack the per-sample series and the integration-difference field (as a v1.3 clone variant may).
// Regression for: engineer table crashed with "reading 'toExponential'" (Faz 7, 2026-11-14).
const job = structuredClone(real) as unknown as JobRecord & { _request: AnalysisInput };
const mission = job.result!.mission as Mission;
for (const s of mission.scenarios) {
  s.variants.cautious = {
    metrics: { valid: true, method: 'clone_p95', n_clones: 100, mean_sun_visible_fraction: 0.5, dte_visible_fraction: 0.5,
      max_continuous_darkness_s: 0, max_continuous_dte_gap_s: 0, darkness_interval: null, dte_gap_interval: null },
    violations: [], unknown: [],
    clone: { n: 100, pass_count: 73, pass_fraction: 0.73 },
  } as unknown as NonNullable<typeof s.variants.cautious>;
}
const ENTRY: AnalysisEntry = { id: job.id, input: job._request, kind: 'analysis', parentId: null, createdAtMs: 0, job, lost: false, pollErrorCode: null };

function Seeded() {
  const { register, selected } = useApp();
  useEffect(() => register(ENTRY.id, ENTRY.input), [register]);
  return selected ? <ResultSummary entry={{ ...selected, job }} /> : null;
}

describe('clone variant in the engineer table', () => {
  it('renders without crashing and shows method + clone pass count; missing fields show "—"', () => {
    render(<AppStateProvider initialMode="engineer"><Seeded /></AppStateProvider>);
    expect(screen.getAllByText(/clone_p95 · 73\/100 clone geçti/).length).toBe(mission.scenarios.length);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
