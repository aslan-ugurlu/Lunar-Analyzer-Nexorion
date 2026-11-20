import { useState } from 'react';
import { AppStateProvider, useApp } from './state/AppState';
import { useHealth, useSites } from './hooks/useBackend';
import { MissionSetup } from './components/MissionSetup';
import { SkyView } from './components/SkyView';
import { TimelineView } from './components/TimelineView';
import { CursorProvider } from './state/Cursor';
import { ComparePanel } from './components/ComparePanel';
import { DataValidation } from './components/DataValidation';
import { Header } from './components/Header';
import { Tabs, TabPanel, type TabDef } from './components/Tabs';
import { Notice, ExternalLink } from './components/ui';
import { explainCode, explainError, type Explained } from './api/errors';
import { defineStrings, I18nProvider, useStrings } from './i18n';

const STR = defineStrings({
  en: {
    degradedTitle: (title: string) => `Service status: degraded — ${title}`,
    demMissingPublic: 'No NASA terrain map (LOLA DEM) is loaded on the server yet, so an analysis cannot be started. No result is invented.',
    spiceMissingPublic: 'The NASA/NAIF files needed to compute the positions of the Sun and Earth are not on the server, so an analysis cannot be started.',
    demMissingEngineer: 'SPICE files are present, but no NASA LOLA terrain raster is loaded. An analysis cannot be started (DEM_MISSING).',
    spiceMissingEngineer: 'SPICE kernel files are missing (SPICE_MISSING).',
    seeDataTab: ' Details and download commands are in the “Data & Validation” tab.',
    degradedAction: 'See the “Data & Validation” tab for the data status and sources.',
    tabs: { setup: 'Mission Setup', sky: 'Sky View', timeline: 'Timeline', compare: 'Compare', data: 'Data & Validation' },
    tabsLabel: 'App sections',
    skip: 'Skip to content',
    pgda: 'NASA GSFC PGDA (LOLA DEM products)',
    naif: 'NASA JPL NAIF (SPICE kernels)',
    credit: 'Data sources and credit: NASA/GSFC PGDA LOLA (Barker et al. 2023), NASA/JPL NAIF SPICE. This tool is not a NASA-endorsed product.',
    sourcesLabel: 'NASA data sources',
  },
  tr: {
    degradedTitle: (title: string) => `Hizmet durumu: degraded — ${title}`,
    demMissingPublic: 'Sunucuda henüz hiçbir NASA arazi haritası (LOLA DEM) yüklü değil, bu yüzden analiz başlatılamaz. Sonuç uydurulmaz.',
    spiceMissingPublic: 'Güneş ve Dünya’nın konumunu hesaplamak için gereken NASA/NAIF dosyaları sunucuda yok, bu yüzden analiz başlatılamaz.',
    demMissingEngineer: 'SPICE dosyaları mevcut, fakat hiçbir NASA LOLA arazi rasterı yüklü değil. Analiz başlatılamaz (DEM_MISSING).',
    spiceMissingEngineer: 'SPICE kernel dosyaları eksik (SPICE_MISSING).',
    seeDataTab: ' Ayrıntı ve indirme komutları “Veri ve Doğrulama” sekmesinde.',
    degradedAction: 'Veri durumu ve kaynaklar için “Veri ve Doğrulama” sekmesine bakın.',
    tabs: { setup: 'Görev Kurulumu', sky: 'Gökyüzü Görünümü', timeline: 'Zaman Çizelgesi', compare: 'Karşılaştır', data: 'Veri ve Doğrulama' },
    tabsLabel: 'Uygulama bölümleri',
    skip: 'İçeriğe atla',
    pgda: 'NASA GSFC PGDA (LOLA DEM ürünleri)',
    naif: 'NASA JPL NAIF (SPICE kernel)',
    credit: 'Veri kaynakları ve kredi: NASA/GSFC PGDA LOLA (Barker vd. 2023), NASA/JPL NAIF SPICE. Bu araç NASA tarafından onaylanmış bir ürün değildir.',
    sourcesLabel: 'NASA veri kaynakları',
  },
});
type Str = (typeof STR)['en'];

/** /health = degraded: no LOLA raster at all (DEM_MISSING) or SPICE kernels missing (SPICE_MISSING). */
function degradedNotice(spicePresent: boolean, s: Str): Explained {
  const base = explainCode(spicePresent ? 'DEM_MISSING' : 'SPICE_MISSING');
  return {
    ...base,
    tone: 'warning',
    title: s.degradedTitle(base.title),
    publicText: spicePresent ? s.demMissingPublic : s.spiceMissingPublic,
    engineerText: (spicePresent ? s.demMissingEngineer : s.spiceMissingEngineer) + s.seeDataTab,
    publicAction: s.degradedAction,
  };
}

export type TabKey = 'setup' | 'sky' | 'timeline' | 'compare' | 'data';

const TAB_ICONS: Record<TabKey, TabDef<TabKey>['icon']> = {
  setup: 'rocket', sky: 'radar', timeline: 'chart', compare: 'compare', data: 'database',
};

function tabDefs(s: Str): TabDef<TabKey>[] {
  return (Object.keys(TAB_ICONS) as TabKey[]).map((key) => ({ key, label: s.tabs[key], icon: TAB_ICONS[key] }));
}

function nasaSources(s: Str) {
  return [
    { href: 'https://pgda.gsfc.nasa.gov/', label: s.pgda },
    { href: 'https://naif.jpl.nasa.gov/naif/', label: s.naif },
    { href: 'https://trek.nasa.gov/moon/', label: 'NASA Moon Trek' },
    { href: 'https://quickmap.lroc.asu.edu/', label: 'LROC QuickMap (ASU)' },
  ];
}

function Shell() {
  const [tab, setTab] = useState<TabKey>('setup');
  const { mode } = useApp();
  // Reading the language here re-renders the whole tree when it changes, so helpers that use
  // getLang() (formatting, error catalog, figures) pick up the new language everywhere.
  const s = useStrings(STR);
  const health = useHealth();
  const offline = health.error?.code === 'BACKEND_OFFLINE';
  // Refetch /sites whenever the set of present layers changes (e.g. a DEM finished downloading).
  const layerKey = health.data ? JSON.stringify(health.data.layers ?? health.data.datasets) : 'none';
  const sites = useSites(layerKey);

  return (
    <div className="flex min-h-dvh flex-col" data-mode={mode}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        {s.skip}
      </a>
      <Header health={health.data} healthError={health.error} />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 space-y-4 px-4 py-4">
        {offline && <Notice explained={explainError(health.error)} />}
        {!offline && health.data?.status === 'degraded' && (
          <Notice explained={degradedNotice(health.data.spice_files_present, s)} />
        )}
        <Tabs tabs={tabDefs(s)} active={tab} onChange={setTab} ariaLabel={s.tabsLabel} />
        <TabPanel id="setup" active={tab === 'setup'}>
          <MissionSetup sites={sites.data} sitesError={sites.error} health={health.data} />
        </TabPanel>
        <TabPanel id="sky" active={tab === 'sky'}>
          <SkyView />
        </TabPanel>
        <TabPanel id="timeline" active={tab === 'timeline'}>
          <TimelineView />
        </TabPanel>
        <TabPanel id="compare" active={tab === 'compare'}>
          <ComparePanel />
        </TabPanel>
        <TabPanel id="data" active={tab === 'data'}>
          <DataValidation health={health.data} healthError={health.error} sites={sites.data} />
        </TabPanel>
      </main>
      <footer className="mt-6 border-t border-line bg-[rgb(2_5_14/0.72)] px-4 py-5 text-xs text-muted backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p>{s.credit}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={s.sourcesLabel}>
            {nasaSources(s).map((src) => (
              <li key={src.href}><ExternalLink href={src.href}>{src.label}</ExternalLink></li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppStateProvider>
        <CursorProvider>
          <Shell />
        </CursorProvider>
      </AppStateProvider>
    </I18nProvider>
  );
}
