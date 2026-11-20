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
import { I18nProvider, type Lang } from '../../i18n';
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

const TEXT: Record<Lang, { mismatch: string; compare: string; excluded: RegExp; reason: string; link: RegExp; noRanking: RegExp }> = {
  en: {
    mismatch: 'Different mission profile — not comparable',
    compare: 'Compare (2)',
    excluded: /Excluded from ranking/,
    reason: 'Earth is not visible for long enough',
    link: /^Open in LROC QuickMap/,
    noRanking: /the interface does not invent a ranking from them/,
  },
  tr: {
    mismatch: 'Farklı görev profili — karşılaştırılamaz',
    compare: 'Karşılaştır (2)',
    excluded: /Sıralama dışı bırakılanlar/,
    reason: 'Dünya yeterince uzun süre görünmüyor',
    link: /^LROC QuickMap’te Aç/,
    noRanking: /arayüz bunlardan bir sıralama uydurmaz/,
  },
};

/** Runs the same comparison flow in one language; returns the request and the decisions shown. */
async function compareFlow(lang: Lang) {
  const t = TEXT[lang];
  mockBackend();
  const user = userEvent.setup();
  const view = render(<I18nProvider lang={lang}><AppStateProvider initialMode="public"><Seed /><ComparePanel /></AppStateProvider></I18nProvider>);
  const boxA = await screen.findByRole('checkbox', { name: /aaaaaaaa/ });
  await user.click(boxA);
  const boxC = screen.getByRole('checkbox', { name: /cccccccc/ });
  expect(boxC).toBeDisabled();
  expect(screen.getByText(t.mismatch)).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /bbbbbbbb/ }));
  await user.click(screen.getByRole('button', { name: t.compare }));

  const compareCall = calls.find((c) => c.url.endsWith('/compare'));
  const excluded = await screen.findByRole('heading', { name: t.excluded });
  const section = excluded.parentElement as HTMLElement;
  expect(within(section).getAllByText('RED').length).toBe(2);
  expect(within(section).getAllByText(t.reason).length).toBeGreaterThan(0);
  expect(within(section).getAllByRole('link', { name: t.link }).length).toBe(2);
  expect(screen.getByText(t.noRanking)).toBeInTheDocument();
  const decisions = [...section.querySelectorAll('[data-decision]')].map((el) => el.getAttribute('data-decision'));
  const metrics = [...section.querySelectorAll('dd')].map((el) => el.textContent?.replace(/sa$|h$/, '').replace(/^%|%$/, ''));
  view.unmount();
  return { body: compareCall?.body, decisions, metrics };
}

describe('ComparePanel', () => {
  it('only allows identical mission profiles and shows excluded RED candidates with reasons', async () => {
    const { body } = await compareFlow('en');
    expect(body).toEqual({ analysis_ids: [A.id, B.id], priority: 'balanced' });
  });

  it('Turkish keeps the existing wording and the identical request, decisions and values', async () => {
    const en = await compareFlow('en');
    const tr = await compareFlow('tr');
    expect(tr.body).toEqual(en.body);
    expect(tr.decisions).toEqual(en.decisions);
    expect(tr.decisions).toEqual(['RED', 'RED']);
    expect(tr.metrics).toEqual(en.metrics);
    expect(tr.metrics.length).toBeGreaterThan(0);
  });

  it('empty state is localized', () => {
    const en = render(<I18nProvider lang="en"><AppStateProvider initialMode="public"><ComparePanel /></AppStateProvider></I18nProvider>);
    expect(screen.getByText('No completed analyses to compare')).toBeInTheDocument();
    expect(screen.getByText(/In Mission Setup, start two analyses/)).toBeInTheDocument();
    en.unmount();
    render(<I18nProvider lang="tr"><AppStateProvider initialMode="public"><ComparePanel /></AppStateProvider></I18nProvider>);
    expect(screen.getByText('Karşılaştırılacak tamamlanmış analiz yok')).toBeInTheDocument();
    expect(screen.getByText(/Görev Kurulumu’nda aynı görev ayarlarıyla/)).toBeInTheDocument();
  });
});
