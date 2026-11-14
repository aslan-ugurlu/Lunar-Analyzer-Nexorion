/**
 * MOCK NOTICE: fetch is stubbed with hand-written job-status responses to test
 * the polling lifecycle only. No scientific result is produced or asserted.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { __setFetchForTests } from '../../api/client';
import type { AnalysisInput } from '../../api/types';
import { AppStateProvider, POLL_INTERVAL_MS, useApp } from '../AppState';

const INPUT = { latitude: -89, longitude: 0 } as AnalysisInput;

function Register({ id, onState }: { id: string; onState: (s: string | undefined) => void }) {
  const { register, entries } = useApp();
  useEffect(() => {
    register(id, INPUT);
  }, [id, register]);
  const entry = entries[id];
  useEffect(() => {
    onState(entry?.lost ? 'lost' : entry?.job?.status);
  }, [entry, onState]);
  return null;
}

function respond(statuses: (number | string)[]) {
  const calls: string[] = [];
  let i = 0;
  __setFetchForTests(async (url) => {
    calls.push(String(url));
    const s = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    if (s === 404) return new Response(JSON.stringify({ error: { code: 'ANALYSIS_NOT_FOUND', message: 'x' } }), { status: 404 });
    return new Response(JSON.stringify({ id: 'job1', status: s, result: null, error: null, parent_id: null }), { status: 200 });
  });
  return calls;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  __setFetchForTests(null);
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('job polling', () => {
  it('polls every ~2 s and stops at a terminal status', async () => {
    const calls = respond(['queued', 'running', 'completed']);
    const seen: (string | undefined)[] = [];
    render(<AppStateProvider><Register id="job1" onState={(s) => seen.push(s)} /></AppStateProvider>);
    await advance(10);
    await advance(POLL_INTERVAL_MS);
    await advance(POLL_INTERVAL_MS);
    expect(seen).toContain('completed');
    const n = calls.length;
    await advance(POLL_INTERVAL_MS * 5);
    expect(calls.length).toBe(n); // no polling after completion
    expect(n).toBe(3);
  });

  it('treats partial and failed as terminal too', async () => {
    for (const terminal of ['partial', 'failed']) {
      const calls = respond(['running', terminal]);
      const { unmount } = render(<AppStateProvider><Register id="job1" onState={() => undefined} /></AppStateProvider>);
      await advance(10);
      await advance(POLL_INTERVAL_MS);
      const n = calls.length;
      await advance(POLL_INTERVAL_MS * 3);
      expect(calls.length).toBe(n);
      unmount();
    }
  });

  it('marks 404 as lost and stops', async () => {
    const calls = respond([404]);
    const seen: (string | undefined)[] = [];
    render(<AppStateProvider><Register id="job1" onState={(s) => seen.push(s)} /></AppStateProvider>);
    await advance(10);
    expect(seen).toContain('lost');
    await advance(POLL_INTERVAL_MS * 3);
    expect(calls.length).toBe(1);
  });

  it('cleans up timers on unmount', async () => {
    const calls = respond(['running']);
    const { unmount } = render(<AppStateProvider><Register id="job1" onState={() => undefined} /></AppStateProvider>);
    await advance(10);
    unmount();
    const n = calls.length;
    await advance(POLL_INTERVAL_MS * 5);
    expect(calls.length).toBe(n);
  });
});
