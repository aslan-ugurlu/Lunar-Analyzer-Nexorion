import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import type { AnalysisInput, JobRecord } from '../../api/types';
import { AppStateProvider, useApp, type Mode } from '../../state/AppState';
import { MissionForm } from '../MissionForm';
import { ResultSummary } from '../ResultSummary';
import { Header } from '../Header';
import { I18nProvider, type Lang } from '../../i18n';

// Fixture = trimmed copy of a REAL API response (see _provenance).
const job = real as unknown as JobRecord & { _request: AnalysisInput };

function Seeded() {
  const { register, selected } = useApp();
  useEffect(() => {
    register(job.id, job._request);
  }, [register]);
  return <><Header health={null} healthError={null} />{selected && <ResultSummary entry={{ ...selected, job }} />}</>;
}

const renderResult = (mode: Mode, lang: Lang = 'en') =>
  render(<I18nProvider lang={lang}><AppStateProvider initialMode={mode}><Seeded /></AppStateProvider></I18nProvider>);
const renderForm = (mode: Mode, lang: Lang = 'en') =>
  render(<I18nProvider lang={lang}><AppStateProvider initialMode={mode}><MissionForm sites={null} health={null} /></AppStateProvider></I18nProvider>);

/** Wording per language; Turkish must stay exactly as it was before the English interface was added. */
const T = {
  en: {
    advanced: 'Advanced mission settings',
    advancedLabels: ['Buffer (hours)', 'Time step (minutes)', 'Horizon scan radius (km)', 'Slope footprint radius (m)', 'Maximum slope (°, optional)'],
    darkQuestion: 'At most how many hours can it stay in darkness?',
    lat: 'Latitude (°, planetocentric)',
    lon: 'Longitude (°, east-positive)',
    stepLabel: 'Time step (minutes)',
    start: 'Start analysis',
    stepRange: 'Time step must be within 10 … 120',
    buffer: 'Buffer (hours)',
    darkEngineer: 'Maximum continuous darkness (hours)',
    cockpit: 'Mission definition — all parameters',
    sunPct: '0%',
    sunTarget: 'target ≥ 50% · not met',
    story: /We also tried delaying the landing by \+0, \+24, \+48, \+72 hours: constraints were exceeded in 4 scenarios/,
    telemetry: 'Telemetry and traceability',
    frame: 'MOON_ME_DE440_ME421 · reference sphere R = 1737.4 km',
    metrics: /metrics table/,
    altitude: 'Observer altitude table',
    violations: 'Constraint violation UTC intervals table',
    engineer: 'Engineer',
  },
  tr: {
    advanced: 'Gelişmiş görev ayarları',
    advancedLabels: ['Tampon (saat)', 'Zaman adımı (dakika)', 'Ufuk tarama yarıçapı (km)', 'Eğim ayak izi yarıçapı (m)', 'Azami eğim (°, isteğe bağlı)'],
    darkQuestion: 'En fazla kaç saat karanlıkta kalınabilir?',
    lat: 'Enlem (°, planetosentrik)',
    lon: 'Boylam (°, doğu-pozitif)',
    stepLabel: 'Zaman adımı (dakika)',
    start: 'Analizi başlat',
    stepRange: 'Zaman adımı 10 … 120 aralığında olmalı',
    buffer: 'Tampon (saat)',
    darkEngineer: 'Azami kesintisiz karanlık (saat)',
    cockpit: 'Görev tanımı — tüm parametreler',
    sunPct: '%0',
    sunTarget: 'hedef ≥ %50 · sağlanmıyor',
    story: /İnişi \+0, \+24, \+48, \+72 saat kaydırarak denedik: 4 senaryoda kısıt aşıldı/,
    telemetry: 'Telemetri ve izlenebilirlik',
    frame: 'MOON_ME_DE440_ME421 · referans küre R = 1737.4 km',
    metrics: /metrik tablosu/,
    altitude: 'Gözlemci kotu tablosu',
    violations: 'Kısıt ihlal UTC aralıkları tablosu',
    engineer: 'Mühendis',
  },
};
const LANGS: Lang[] = ['en', 'tr'];

describe('Mission form by mode', () => {
  it.each(LANGS)('Public: technical parameters live in a closed "advanced settings" accordion (%s)', (lang) => {
    const t = T[lang];
    renderForm('public', lang);
    const adv = screen.getByTestId('advanced-settings');
    expect(adv).not.toHaveAttribute('open');
    expect(within(adv).getByText(t.advanced)).toBeInTheDocument();
    for (const label of t.advancedLabels) {
      expect(within(adv).getByLabelText(label)).toBeInTheDocument();
    }
    // Main mission questions stay visible outside the accordion.
    expect(screen.getByLabelText(t.darkQuestion)).toBeInTheDocument();
  });

  it.each(LANGS)('Public: accordion opens itself when a hidden field is invalid on submit (%s)', async (lang) => {
    const t = T[lang];
    const user = userEvent.setup();
    renderForm('public', lang);
    await user.type(screen.getByLabelText(t.lat), '-89.5');
    await user.type(screen.getByLabelText(t.lon), '0');
    const step = within(screen.getByTestId('advanced-settings')).getByLabelText(t.stepLabel);
    await user.clear(step);
    await user.type(step, '5');
    await user.click(screen.getByRole('button', { name: t.start }));
    expect(screen.getByTestId('advanced-settings')).toHaveAttribute('open');
    expect(screen.getByText(t.stepRange)).toBeInTheDocument();
  });

  it.each(LANGS)('Engineer: every parameter is shown inline, no accordion (%s)', (lang) => {
    const t = T[lang];
    renderForm('engineer', lang);
    expect(screen.queryByTestId('advanced-settings')).toBeNull();
    expect(screen.getByLabelText(t.buffer)).toBeVisible();
    expect(screen.getByLabelText(t.darkEngineer)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t.cockpit })).toBeInTheDocument();
  });
});

describe('Result summary by mode (same server result)', () => {
  it.each(LANGS)('Public: KPI cards + story, no telemetry, provenance or metric tables (%s)', (lang) => {
    const t = T[lang];
    renderResult('public', lang);
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(4);
    const sunCard = document.querySelector('[data-kpi="sun"]') as HTMLElement;
    expect(sunCard.textContent).toContain(t.sunPct);
    expect(sunCard.textContent).toContain(t.sunTarget);
    expect(screen.getByText(t.story)).toBeInTheDocument();
    expect(screen.queryByText(t.telemetry)).toBeNull();
    expect(screen.queryByText(/a0571dc6f088/)).toBeNull(); // cache key hidden
    expect(screen.queryByRole('region', { name: t.metrics })).toBeNull();
  });

  it.each(LANGS)('Engineer: telemetry (frame, DEM, observer altitude, cache key) and UTC violation table on top (%s)', (lang) => {
    const t = T[lang];
    renderResult('engineer', lang);
    const tel = screen.getByRole('heading', { name: t.telemetry }).parentElement as HTMLElement;
    expect(tel.textContent).toContain(t.frame);
    expect(tel.textContent).toMatch(/lola_240m · .* · lola\/LDEM_60S_240MPP_ADJ\.TIF/);
    expect(tel.textContent).toContain('a0571dc6f088e3df085c284e5051f08a9c9a6d87d90a65a9f4e11260fe87a33d');
    const altitude = within(tel).getByRole('region', { name: t.altitude });
    expect(altitude.textContent).toContain('-754.08');
    expect(altitude.textContent).toContain('1736.64992');
    const violations = within(tel).getByRole('region', { name: t.violations });
    expect(within(violations).getAllByText('MAX_DARKNESS')).toHaveLength(4);
    expect(within(violations).getAllByText('2026-12-01 12:00:00 UTC').length).toBeGreaterThan(0);
    // Telemetry precedes the metric table.
    const metric = screen.getByRole('region', { name: t.metrics });
    expect(tel.compareDocumentPosition(metric) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(0);
  });

  it('switching mode keeps the identical decision', async () => {
    const user = userEvent.setup();
    renderResult('public');
    expect(document.querySelector('[data-decision]')?.getAttribute('data-decision')).toBe('RED');
    await user.click(screen.getByRole('button', { name: T.en.engineer }));
    expect(document.querySelector('[data-decision]')?.getAttribute('data-decision')).toBe('RED');
  });

  it('switching language keeps the identical decision and the same numbers', async () => {
    const user = userEvent.setup();
    renderResult('engineer');
    const before = (document.querySelector('[role="region"][aria-label="Observer altitude table"]') as HTMLElement).textContent;
    await user.click(screen.getByRole('button', { name: 'TR Türkçe' }));
    expect(document.querySelector('[data-decision]')?.getAttribute('data-decision')).toBe('RED');
    const after = (document.querySelector('[role="region"][aria-label="Gözlemci kotu tablosu"]') as HTMLElement).textContent;
    const numbers = (text: string | null) => (text ?? '').match(/-?\d+\.\d+/g);
    expect(numbers(after)).toEqual(numbers(before));
  });
});
