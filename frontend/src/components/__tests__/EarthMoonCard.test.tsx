import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import cardSource from '../EarthMoonCard.tsx?raw';
import { EarthMoonCard, EARTH_MOON_SOURCES } from '../EarthMoonCard';
import { MissionSetup } from '../MissionSetup';
import { AppStateProvider } from '../../state/AppState';

describe('§11.5 Earth vs Moon education card', () => {
  it('shows the required physical comparisons with honest notes', () => {
    render(<EarthMoonCard />); // renders without any app/analysis state
    expect(screen.getByRole('heading', { name: 'Dünya ve Ay’da Güneş neden farklı görünür?' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('yaklaşık 24 saat')).toBeInTheDocument();
    expect(within(table).getByText('yaklaşık 29,5 Dünya günü')).toBeInTheDocument();
    expect(table.textContent).toContain('27,3 gündür');
    expect(table.textContent).toContain('“Ay 29,5 günde döner” demek doğru değildir');
    expect(table.textContent).toContain('yaklaşık 23,4°');
    expect(table.textContent).toContain('yaklaşık 1,5°');
    expect(table.textContent).toContain('kırılma beklenmez');
    expect(table.textContent).toContain('tek bir açı tüm noktaları temsil etmez');
  });

  it('lists NASA sources as safe external links and labels values approximate', () => {
    render(<EarthMoonCard />);
    expect(screen.getByText(/Kaynaklar \(yaklaşık değerler/)).toBeInTheDocument();
    for (const src of EARTH_MOON_SOURCES) {
      const link = screen.getByRole('link', { name: src.label });
      expect(link).toHaveAttribute('href', src.href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(new URL(src.href).hostname.endsWith('nasa.gov')).toBe(true);
    }
  });

  it('is independent of the decision engine (no props, no state, no API imports)', () => {
    expect(EarthMoonCard.length).toBe(0);
    const source = cardSource;
    expect(source).not.toMatch(/from '\.\.\/(api|state|lib)\//);
    expect(source).not.toMatch(/navigator\.geolocation|fetch\(/);
  });

  it('appears in public mode only', () => {
    const { unmount } = render(
      <AppStateProvider initialMode="public"><MissionSetup sites={null} sitesError={null} health={null} /></AppStateProvider>,
    );
    expect(screen.getByRole('heading', { name: /Dünya ve Ay’da Güneş/ })).toBeInTheDocument();
    unmount();
    render(<AppStateProvider initialMode="engineer"><MissionSetup sites={null} sitesError={null} health={null} /></AppStateProvider>);
    expect(screen.queryByRole('heading', { name: /Dünya ve Ay’da Güneş/ })).toBeNull();
  });
});
