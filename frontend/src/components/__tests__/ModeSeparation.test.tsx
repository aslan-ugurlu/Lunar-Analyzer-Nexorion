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

// Fixture = trimmed copy of a REAL API response (see _provenance).
const job = real as unknown as JobRecord & { _request: AnalysisInput };

function Seeded() {
  const { register, selected } = useApp();
  useEffect(() => {
    register(job.id, job._request);
  }, [register]);
  return <><Header health={null} healthError={null} />{selected && <ResultSummary entry={{ ...selected, job }} />}</>;
}

const renderResult = (mode: Mode) => render(<AppStateProvider initialMode={mode}><Seeded /></AppStateProvider>);
const renderForm = (mode: Mode) => render(<AppStateProvider initialMode={mode}><MissionForm sites={null} health={null} /></AppStateProvider>);

describe('Mission form by mode', () => {
  it('Halk: technical parameters live in a closed "Gelişmiş görev ayarları" accordion', () => {
    renderForm('public');
    const adv = screen.getByTestId('advanced-settings');
    expect(adv).not.toHaveAttribute('open');
    expect(within(adv).getByText('Gelişmiş görev ayarları')).toBeInTheDocument();
    for (const label of ['Tampon (saat)', 'Zaman adımı (dakika)', 'Ufuk tarama yarıçapı (km)', 'Eğim ayak izi yarıçapı (m)', 'Azami eğim (°, isteğe bağlı)']) {
      expect(within(adv).getByLabelText(label)).toBeInTheDocument();
    }
    // Main mission questions stay visible outside the accordion.
    expect(screen.getByLabelText('En fazla kaç saat karanlıkta kalınabilir?')).toBeInTheDocument();
  });

  it('Halk: accordion opens itself when a hidden field is invalid on submit', async () => {
    const user = userEvent.setup();
    renderForm('public');
    await user.type(screen.getByLabelText('Enlem (°, planetosentrik)'), '-89.5');
    await user.type(screen.getByLabelText('Boylam (°, doğu-pozitif)'), '0');
    const step = within(screen.getByTestId('advanced-settings')).getByLabelText('Zaman adımı (dakika)');
    await user.clear(step);
    await user.type(step, '5');
    await user.click(screen.getByRole('button', { name: 'Analizi başlat' }));
    expect(screen.getByTestId('advanced-settings')).toHaveAttribute('open');
    expect(screen.getByText('Zaman adımı 10 … 120 aralığında olmalı')).toBeInTheDocument();
  });

  it('Mühendis: every parameter is shown inline, no accordion', () => {
    renderForm('engineer');
    expect(screen.queryByTestId('advanced-settings')).toBeNull();
    expect(screen.getByLabelText('Tampon (saat)')).toBeVisible();
    expect(screen.getByLabelText('Azami kesintisiz karanlık (saat)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Görev tanımı — tüm parametreler' })).toBeInTheDocument();
  });
});

describe('Result summary by mode (same server result)', () => {
  it('Halk: KPI cards + story, no telemetry, provenance or metric tables', () => {
    renderResult('public');
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(4);
    const sunCard = document.querySelector('[data-kpi="sun"]') as HTMLElement;
    expect(sunCard.textContent).toContain('%0');
    expect(sunCard.textContent).toContain('hedef ≥ %50 · sağlanmıyor');
    expect(screen.getByText(/İnişi \+0, \+24, \+48, \+72 saat kaydırarak denedik: 4 senaryoda kısıt aşıldı/)).toBeInTheDocument();
    expect(screen.queryByText('Telemetri ve izlenebilirlik')).toBeNull();
    expect(screen.queryByText(/a0571dc6f088/)).toBeNull(); // cache key hidden
    expect(screen.queryByRole('region', { name: /metrik tablosu/ })).toBeNull();
  });

  it('Mühendis: telemetry (frame, DEM, observer altitude, cache key) and UTC violation table on top', () => {
    renderResult('engineer');
    const tel = screen.getByRole('heading', { name: 'Telemetri ve izlenebilirlik' }).parentElement as HTMLElement;
    expect(tel.textContent).toContain('MOON_ME_DE440_ME421 · referans küre R = 1737.4 km');
    expect(tel.textContent).toMatch(/lola_240m · .* · lola\/LDEM_60S_240MPP_ADJ\.TIF/);
    expect(tel.textContent).toContain('a0571dc6f088e3df085c284e5051f08a9c9a6d87d90a65a9f4e11260fe87a33d');
    const altitude = within(tel).getByRole('region', { name: 'Gözlemci kotu tablosu' });
    expect(altitude.textContent).toContain('-754.08');
    expect(altitude.textContent).toContain('1736.64992');
    const violations = within(tel).getByRole('region', { name: 'Kısıt ihlal UTC aralıkları tablosu' });
    expect(within(violations).getAllByText('MAX_DARKNESS')).toHaveLength(4);
    expect(within(violations).getAllByText('2026-12-01 12:00:00 UTC').length).toBeGreaterThan(0);
    // Telemetry precedes the metric table.
    const metric = screen.getByRole('region', { name: /metrik tablosu/ });
    expect(tel.compareDocumentPosition(metric) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelectorAll('[data-kpi]')).toHaveLength(0);
  });

  it('switching mode keeps the identical decision', async () => {
    const user = userEvent.setup();
    renderResult('public');
    expect(document.querySelector('[data-decision]')?.getAttribute('data-decision')).toBe('RED');
    await user.click(screen.getByRole('button', { name: 'Mühendis' }));
    expect(document.querySelector('[data-decision]')?.getAttribute('data-decision')).toBe('RED');
  });
});
