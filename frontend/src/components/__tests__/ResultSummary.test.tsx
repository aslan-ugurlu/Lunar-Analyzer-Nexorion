import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import real from '../../test/fixtures/real_analysis_62e783c2.json';
import type { AnalysisInput, JobRecord } from '../../api/types';
import { AppStateProvider, useApp, type AnalysisEntry, type Mode } from '../../state/AppState';
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

function renderWith(mode: Mode, withHeader = false) {
  return render(<AppStateProvider initialMode={mode}><Seeded withHeader={withHeader} /></AppStateProvider>);
}

describe('ResultSummary with a real analysis result', () => {
  it('public mode: RED with icon+word, plain-language answers, violation UTC span', () => {
    renderWith('public');
    const badge = document.querySelector('[data-decision="RED"]');
    expect(badge?.textContent).toContain('RED');
    expect(badge?.textContent).toContain('Kısıtlar sağlanmıyor');
    expect(badge?.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Bu bölgede Güneş ne kadar görünüyor?')).toBeInTheDocument();
    expect(screen.getByText('Dünya ile doğrudan görüş ne zaman kapanıyor?')).toBeInTheDocument();
    expect(screen.getAllByText(/en uzun aralık: 2026-12-01 12:00 UTC → 2026-12-04 00:00 UTC/).length).toBeGreaterThan(0);
    expect(screen.getByText('Bu sonuç bir iniş sertifikası değildir.')).toBeInTheDocument();
  });

  it('engineer mode shows the same decision plus codes and provenance', () => {
    renderWith('engineer');
    expect(document.querySelector('[data-decision="RED"]')).not.toBeNull();
    expect(screen.getAllByText(/MAX_DARKNESS · Azami kesintisiz karanlık/).length).toBeGreaterThan(0);
    expect(screen.getByText(/MOON_ME_DE440_ME421 · R = 1737.4 km/)).toBeInTheDocument();
    expect(screen.getByText(/lola_240m: lola\/LDEM_60S_240MPP_ADJ.TIF/)).toBeInTheDocument();
  });

  it('switching Halk → Mühendis never changes the decision', async () => {
    const user = userEvent.setup();
    renderWith('public', true);
    const before = document.querySelector('[data-decision]')?.getAttribute('data-decision');
    await user.click(screen.getByRole('button', { name: 'Mühendis' }));
    const after = document.querySelector('[data-decision]')?.getAttribute('data-decision');
    expect(before).toBe('RED');
    expect(after).toBe(before);
    expect(screen.getByRole('button', { name: 'Mühendis' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('copyable summary is built only from the server result', () => {
    const text = buildSummaryText(ENTRY);
    expect(text).toContain('Karar: RED');
    expect(text).toContain('İHLAL MAX_DARKNESS (nominal)');
    expect(text).toContain('iniş sertifikası değildir');
    expect(text).toContain('https://quickmap.lroc.im-ldi.com/?proj=27&center=0.000000,-89.540000&resolution=20');
  });
});
