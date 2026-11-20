import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import type { AnalysisInput, JobRecord, Mission } from '../../api/types';
import { AppStateProvider, useApp, type AnalysisEntry, type Mode } from '../../state/AppState';
import { I18nProvider, type Lang } from '../../i18n';
import { ResultSummary } from '../ResultSummary';
import { buildSummaryText } from '../CopySummary';
import { Header } from '../Header';

// Fixture = trimmed copy of a REAL API response (see its _provenance field).
const job = real as unknown as JobRecord & { _request: AnalysisInput };
const ENTRY: AnalysisEntry = {
  id: job.id, input: job._request, kind: 'analysis', parentId: null, createdAtMs: 0, job, lost: false, pollErrorCode: null,
};

/** Registers the analysis, then renders the summary with the real job payload. */
function Seeded({ withHeader = false }: { withHeader?: boolean }) {
  const { register, selected } = useApp();
  useEffect(() => register(ENTRY.id, ENTRY.input), [register]);
  return (
    <>
      {withHeader && <Header health={null} healthError={null} />}
      {selected && <ResultSummary entry={{ ...selected, job }} />}
    </>
  );
}

function renderWith(mode: Mode, withHeader = false, lang: Lang = 'en') {
  return render(<I18nProvider lang={lang}><AppStateProvider initialMode={mode}><Seeded withHeader={withHeader} /></AppStateProvider></I18nProvider>);
}

/** Every number shown on the KPI cards (units and words stripped). */
function kpiNumbers(): string[] {
  return [...document.querySelectorAll('[data-kpi]')].flatMap((el) => el.textContent?.match(/\d+(?:\.\d+)?/g) ?? []);
}

describe('ResultSummary with a real analysis result', () => {
  it('public mode: RED with icon+word, plain-language answers, violation UTC span', () => {
    renderWith('public');
    const badge = document.querySelector('[data-decision="RED"]');
    expect(badge?.textContent).toContain('RED');
    expect(badge?.textContent).toContain('Constraints not met');
    expect(badge?.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('How much is the Sun visible here?')).toBeInTheDocument();
    expect(screen.getByText('When is the direct line of sight to Earth lost?')).toBeInTheDocument();
    expect(screen.getAllByText(/longest interval: 2026-12-01 12:00 UTC → 2026-12-04 00:00 UTC/).length).toBeGreaterThan(0);
    expect(screen.getByText('This result is not a landing certification.')).toBeInTheDocument();
  });

  it('Halk (Turkish): the same RED result keeps the Turkish wording and identical values', () => {
    const en = renderWith('public');
    const enNumbers = kpiNumbers();
    en.unmount();
    renderWith('public', false, 'tr');
    const badge = document.querySelector('[data-decision="RED"]');
    expect(badge?.textContent).toContain('Kısıtlar sağlanmıyor');
    expect(screen.getByText('Bu bölgede Güneş ne kadar görünüyor?')).toBeInTheDocument();
    expect(screen.getByText('Dünya ile doğrudan görüş ne zaman kapanıyor?')).toBeInTheDocument();
    expect(screen.getAllByText(/en uzun aralık: 2026-12-01 12:00 UTC → 2026-12-04 00:00 UTC/).length).toBeGreaterThan(0);
    expect(screen.getByText('Tanımladığınız kısıtlardan en az biri normal hesapta bile sağlanmıyor.')).toBeInTheDocument();
    expect(screen.getByText('Bu sonuç bir iniş sertifikası değildir.')).toBeInTheDocument();
    expect(kpiNumbers()).toEqual(enNumbers);
    expect(enNumbers.length).toBeGreaterThan(0);
  });

  it('engineer mode shows the same decision plus codes and provenance', () => {
    renderWith('engineer');
    expect(document.querySelector('[data-decision="RED"]')).not.toBeNull();
    expect(screen.getAllByText('MAX_DARKNESS').length).toBe(4); // violation table: one per scenario
    expect(screen.getByText(/MOON_ME_DE440_ME421 · reference sphere R = 1737.4 km/)).toBeInTheDocument();
    expect(screen.getByText(/lola_240m · .* · lola\/LDEM_60S_240MPP_ADJ.TIF/)).toBeInTheDocument();
  });

  it('Mühendis (Turkish): same decision and codes, Turkish provenance labels', () => {
    renderWith('engineer', false, 'tr');
    expect(document.querySelector('[data-decision="RED"]')).not.toBeNull();
    expect(screen.getAllByText('MAX_DARKNESS').length).toBe(4);
    expect(screen.getByText(/MOON_ME_DE440_ME421 · referans küre R = 1737.4 km/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Telemetri ve izlenebilirlik' })).toBeInTheDocument();
  });

  it('switching Public → Engineer never changes the decision', async () => {
    const user = userEvent.setup();
    renderWith('public', true);
    const before = document.querySelector('[data-decision]')?.getAttribute('data-decision');
    await user.click(screen.getByRole('button', { name: 'Engineer' }));
    const after = document.querySelector('[data-decision]')?.getAttribute('data-decision');
    expect(before).toBe('RED');
    expect(after).toBe(before);
    expect(screen.getByRole('button', { name: 'Engineer' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switching the language never changes the decision', async () => {
    const user = userEvent.setup();
    renderWith('public', true);
    const before = kpiNumbers();
    await user.click(screen.getByRole('button', { name: /TR Türkçe/ }));
    expect(screen.getByText('Bu bölgede Güneş ne kadar görünüyor?')).toBeInTheDocument();
    expect(document.querySelector('[data-decision]')?.getAttribute('data-decision')).toBe('RED');
    expect(kpiNumbers()).toEqual(before);
  });

  it('copyable summary is built only from the server result', () => {
    const text = buildSummaryText(ENTRY);
    expect(text).toContain('Decision: RED — Nominal mission constraints are not met');
    expect(text).toContain('VIOLATION MAX_DARKNESS (nominal)');
    expect(text).toContain('not a landing certification');
    expect(text).toContain('https://quickmap.lroc.im-ldi.com/?proj=27&center=0.000000,-89.540000&resolution=20');
  });

  it('copyable summary follows the interface language with the same values (Turkish = backend label)', () => {
    const en = buildSummaryText(ENTRY);
    render(<I18nProvider lang="tr"><span /></I18nProvider>);
    const tr = buildSummaryText(ENTRY);
    const mission = job.result!.mission as Mission;
    expect(tr).toContain(`Karar: RED — ${mission.label}`);
    expect(tr).toContain('İHLAL MAX_DARKNESS (nominal)');
    expect(tr).toContain('iniş sertifikası değildir');
    expect(tr.split('\n')).toHaveLength(en.split('\n').length);
    const numbers = (s: string) => s.match(/\d+(?:\.\d+)?/g);
    expect(numbers(tr)).toEqual(numbers(en));
  });
});
