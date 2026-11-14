import { useState } from 'react';
import { AppStateProvider } from './state/AppState';
import { useHealth, useSites } from './hooks/useBackend';
import { MissionSetup } from './components/MissionSetup';
import { SkyView } from './components/SkyView';
import { TimelineView } from './components/TimelineView';
import { CursorProvider } from './state/Cursor';
import { Header } from './components/Header';
import { Tabs, TabPanel, type TabDef } from './components/Tabs';
import { Notice, ExternalLink } from './components/ui';
import { explainError } from './api/errors';

export type TabKey = 'setup' | 'sky' | 'timeline' | 'compare' | 'data';

const TABS: TabDef<TabKey>[] = [
  { key: 'setup', label: 'Mission Setup' },
  { key: 'sky', label: 'Sky View' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'compare', label: 'Compare' },
  { key: 'data', label: 'Data & Validation' },
];

export const NASA_SOURCES = [
  { href: 'https://pgda.gsfc.nasa.gov/', label: 'NASA GSFC PGDA (LOLA DEM ürünleri)' },
  { href: 'https://naif.jpl.nasa.gov/naif/', label: 'NASA JPL NAIF (SPICE kernel)' },
  { href: 'https://trek.nasa.gov/moon/', label: 'NASA Moon Trek' },
  { href: 'https://quickmap.lroc.asu.edu/', label: 'LROC QuickMap (ASU)' },
];

function Shell() {
  const [tab, setTab] = useState<TabKey>('setup');
  const health = useHealth();
  const offline = health.error?.code === 'BACKEND_OFFLINE';
  // Refetch /sites whenever the set of present layers changes (e.g. a DEM finished downloading).
  const layerKey = health.data ? JSON.stringify(health.data.layers ?? health.data.datasets) : 'none';
  const sites = useSites(layerKey);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        İçeriğe atla
      </a>
      <Header health={health.data} healthError={health.error} />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-4">
        {offline && <Notice explained={explainError(health.error)} />}
        {!offline && health.data?.status === 'degraded' && (
          <div role="status" className="rounded-lg border border-caution/60 bg-caution/10 p-3 text-sm">
            <p className="font-semibold text-caution">Hizmet durumu: degraded</p>
            <p className="text-ink/90">
              {health.data.spice_files_present
                ? 'SPICE dosyaları mevcut, fakat hiçbir NASA LOLA arazi rasterı yüklü değil. Analiz başlatılamaz (DEM_MISSING).'
                : 'SPICE kernel dosyaları eksik (SPICE_MISSING).'}{' '}
              Ayrıntı ve indirme komutları “Data & Validation” sekmesinde.
            </p>
          </div>
        )}
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <TabPanel id="setup" active={tab === 'setup'}>
          <MissionSetup sites={sites.data} sitesError={sites.error} health={health.data} />
        </TabPanel>
        <TabPanel id="sky" active={tab === 'sky'}>
          <SkyView />
        </TabPanel>
        <TabPanel id="timeline" active={tab === 'timeline'}>
          <TimelineView />
        </TabPanel>
        {TABS.filter((t) => !['setup', 'sky', 'timeline'].includes(t.key)).map((t) => (
          <TabPanel key={t.key} id={t.key} active={tab === t.key}>
            <div className="panel">
              <p className="text-sm text-muted">{t.label} — yapım aşamasında.</p>
            </div>
          </TabPanel>
        ))}
      </main>
      <footer className="border-t border-line px-4 py-4 text-xs text-muted">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p>Veri kaynakları ve kredi: NASA/GSFC PGDA LOLA (Barker vd. 2023), NASA/JPL NAIF SPICE. Bu araç NASA tarafından onaylanmış bir ürün değildir.</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {NASA_SOURCES.map((s) => (
              <li key={s.href}><ExternalLink href={s.href}>{s.label}</ExternalLink></li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <CursorProvider>
        <Shell />
      </CursorProvider>
    </AppStateProvider>
  );
}
