/**
 * Uses two entries built from the REAL fixture (trimmed API response) and a MOCKED
 * /compare response with the backend's shape (labelled mock: UI contract only).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import { __setFetchForTests } from '../../api/client';
import type { AnalysisInput, JobRecord } from '../../api/types';
import { AppStateProvider, useApp } from '../../state/AppState';
import { ComparePanel } from '../ComparePanel';

const job = real as unknown as JobRecord & { _request: AnalysisInput };
const A = { id: 'aaaaaaaa1111', input: job._request };
const B = { id: 'bbbbbbbb2222', input: { ...job._request, latitude: -89.4512, longitude: -137.1427 } };
const C = { id: 'cccccccc3333', input: { ...job._request, sun_observer_height_m: 40 } }; // different profile

/** Registers entries and injects the real job payload through the polling path. */
function Seed() {
  const { register } = useApp();
  useEffect(() => {
    for (const e of [C, B, A]) register(e.id, e.input);
  }, [register]);
  return null;
}

let calls: { url: string; body: unknown }[] = [];
afterEach(() => __setFetchForTests(null));

function mockBackend() {
  calls = [];
  __setFetchForTests(async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith('/compare')) {
      return new Response(JSON.stringify({ priority: 'balanced', green: [], yellow: [],
        excluded: [{ id: A.id, status: 'RED' }, { id: B.id, status: 'RED' }], note: 'Pareto dominance uses four nominal metrics' }), { status: 200 });
    }
    const id = u.split('/analyses/')[1] ?? '';
    return new Response(JSON.stringify({ ...job, id }), { status: 200 });
  });
}

describe('ComparePanel', () => {
  it('only allows identical mission profiles and shows excluded RED candidates with reasons', async () => {
    mockBackend();
    const user = userEvent.setup();
    render(<AppStateProvider initialMode="public"><Seed /><ComparePanel /></AppStateProvider>);
    const boxA = await screen.findByRole('checkbox', { name: /aaaaaaaa/ });
    await user.click(boxA);
    const boxC = screen.getByRole('checkbox', { name: /cccccccc/ });
    expect(boxC).toBeDisabled();
    expect(screen.getByText('Farklı görev profili — karşılaştırılamaz')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /bbbbbbbb/ }));
    await user.click(screen.getByRole('button', { name: 'Karşılaştır (2)' }));

    const compareCall = calls.find((c) => c.url.endsWith('/compare'));
    expect(compareCall?.body).toEqual({ analysis_ids: [A.id, B.id], priority: 'balanced' });
    const excluded = await screen.findByRole('heading', { name: /Sıralama dışı bırakılanlar/ });
    const section = excluded.parentElement as HTMLElement;
    expect(within(section).getAllByText('RED').length).toBe(2);
    expect(within(section).getAllByText('Dünya yeterince uzun süre görünmüyor').length).toBeGreaterThan(0);
    expect(within(section).getAllByRole('link', { name: /^LROC QuickMap’te Aç/ }).length).toBe(2);
    expect(screen.getByText(/arayüz bunlardan bir sıralama uydurmaz/)).toBeInTheDocument();
  });
});
