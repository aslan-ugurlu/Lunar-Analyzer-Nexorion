import type { ApiError } from '../api/client';
import { explainError } from '../api/errors';
import type { Health, SitesResponse } from '../api/types';
import { useApp } from '../state/AppState';
import { AnalysisList } from './AnalysisList';
import { EarthMoonCard } from './EarthMoonCard';
import { MissionForm } from './MissionForm';
import { ResultSummary } from './ResultSummary';
import { Notice } from './ui';

export function MissionSetup({ sites, sitesError, health }: { sites: SitesResponse | null; sitesError: ApiError | null; health: Health | null }) {
  const { selected, mode } = useApp();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="panel">
        {sitesError && sitesError.code !== 'BACKEND_OFFLINE' && <div className="mb-3"><Notice explained={explainError(sitesError)} /></div>}
        <MissionForm sites={sites} health={health} />
      </div>
      <div className="space-y-4">
        <section className="panel space-y-3" aria-labelledby="analyses-title">
          <h2 id="analyses-title" className="panel-title">Analizler (bu oturum)</h2>
          <AnalysisList />
        </section>
        <section className="panel" aria-label="Seçili analiz sonucu">
          <ResultSummary entry={selected} />
        </section>
        {mode === 'public' && <EarthMoonCard />}
      </div>
    </div>
  );
}
