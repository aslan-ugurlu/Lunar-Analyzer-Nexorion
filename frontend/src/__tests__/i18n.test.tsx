import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import real from '../test/fixtures/real_analysis_62e783c2.json';
import type { JobRecord, Mission } from '../api/types';
import { getLang, I18nProvider, LANG_STORAGE_KEY, useLang } from '../i18n';
import { AppStateProvider } from '../state/AppState';
import { Header } from '../components/Header';
import { missionLabel, missionPublicExplanation } from '../lib/decisionText';
import { formatHours, formatLatLon, formatPercent } from '../lib/format';

function renderHeader() {
  return render(
    <I18nProvider>
      <AppStateProvider initialMode="public">
        <Header health={null} healthError={null} />
      </AppStateProvider>
    </I18nProvider>,
  );
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('interface language', () => {
  it('starts in English and switches to Turkish from the header; the choice is remembered', async () => {
    const user = userEvent.setup();
    renderHeader();
    expect(getLang()).toBe('en');
    expect(screen.getByText(/A screening \/ decision-support tool/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /EN English/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /TR Türkçe/ }));
    expect(screen.getByText(/Ön eleme \/ karar destek aracıdır/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /TR Türkçe/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Halk' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('tr');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('tr');
    expect(getLang()).toBe('tr');
  });

  it('restores the remembered language, and ?lang= overrides it', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'tr');
    const first = renderHeader();
    expect(screen.getByRole('button', { name: 'Mühendis' })).toBeInTheDocument();
    first.unmount();

    window.history.replaceState(null, '', '/?lang=en');
    renderHeader();
    expect(screen.getByRole('button', { name: 'Engineer' })).toBeInTheDocument();
  });

  it('ignores unknown stored or URL values and falls back to English', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'de');
    window.history.replaceState(null, '', '/?lang=xx');
    renderHeader();
    expect(screen.getByRole('button', { name: 'Public' })).toBeInTheDocument();
  });

  it('changing the language does not change the mode', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('button', { name: 'Engineer' }));
    await user.click(screen.getByRole('button', { name: /TR Türkçe/ }));
    expect(screen.getByRole('button', { name: 'Mühendis' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('units follow the language; values do not', () => {
  function Probe() {
    useLang();
    return <p>{`${formatHours(45000)} | ${formatPercent(0.4)} | ${formatLatLon(-89.45, -137.14)}`}</p>;
  }
  it('formats the same numbers with English or Turkish units', () => {
    const en = render(<I18nProvider lang="en"><Probe /></I18nProvider>);
    expect(screen.getByText('12.5 h | 40% | 89.4500° S, 137.1400° W')).toBeInTheDocument();
    en.unmount();
    render(<I18nProvider lang="tr"><Probe /></I18nProvider>);
    expect(screen.getByText('12.5 sa | %40 | 89.4500° G, 137.1400° B')).toBeInTheDocument();
  });
});

describe('decision wording rebuilt from structured API fields', () => {
  const job = real as unknown as JobRecord & { _request: { uncertainty_mode: string } };
  const mission = job.result!.mission as Mission;

  it('Turkish wording is identical to the backend label and public explanation', () => {
    render(<I18nProvider lang="tr"><span /></I18nProvider>);
    expect(missionLabel(mission, job._request.uncertainty_mode)).toBe(mission.label);
    expect(missionPublicExplanation(mission, job._request.uncertainty_mode)).toBe(mission.explanations?.public);
  });

  it('English wording keeps the same decision', () => {
    render(<I18nProvider lang="en"><span /></I18nProvider>);
    expect(mission.status).toBe('RED');
    expect(missionLabel(mission)).toBe('Nominal mission constraints are not met');
    expect(missionPublicExplanation(mission)).toBe('Nominal mission constraints are not met. This result is not a landing-safety certification.');
  });

  it('a capped 135-km result explains the 200-km requirement in both languages', () => {
    const capped: Pick<Mission, 'status' | 'radius_policy'> = {
      status: 'YELLOW',
      radius_policy: {
        code: 'REDUCED_HORIZON_RADIUS', radius_km: 135, reference_radius_km: 200, below_reference: true,
        status_before_policy: 'GREEN', status_after_policy: 'YELLOW', capped: true, note: 'synthetic',
      },
    };
    render(<I18nProvider lang="en"><span /></I18nProvider>);
    expect(missionLabel(capped)).toBe('Nominal and conservative checks passed in the 135 km quick scan; GREEN requires the 200 km reference analysis');
    render(<I18nProvider lang="tr"><span /></I18nProvider>);
    expect(missionLabel(capped)).toBe('Nominal ve ihtiyatlı kontroller 135 km hızlı taramada geçti; GREEN için 200 km referans analizi gerekli');
  });
});
