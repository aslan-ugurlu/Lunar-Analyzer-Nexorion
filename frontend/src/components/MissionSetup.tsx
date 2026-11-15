import type { ApiError } from '../api/client';
import { explainError } from '../api/errors';
import type { Health, SitesResponse } from '../api/types';
import { useApp } from '../state/AppState';
import { AnalysisList } from './AnalysisList';
import { EarthMoonCard } from './EarthMoonCard';
import { MissionForm } from './MissionForm';
import { ResultSummary } from './ResultSummary';
import { Icon, Notice } from './ui';

/**
 * Halk: wizard on the left; results (infographics) and the featured Earth-vs-Moon card on the right.
 * Mühendis: compact cockpit form on the left; dense telemetry results get the wider column.
 * Both modes render the same form state and the same server result; only the layout differs.
 */
export function MissionSetup({ sites, sitesError, health }: { sites: SitesResponse | null; sitesError: ApiError | null; health: Health | null }) {
  const { selected, mode } = useApp();
  const engineer = mode === 'engineer';
  return (
    <div className={`grid grid-cols-1 gap-4 ${engineer
      ? 'xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]'
      : 'lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]'}`}>
      <div className="panel min-w-0 self-start">
        {sitesError && sitesError.code !== 'BACKEND_OFFLINE' && <div className="mb-3"><Notice explained={explainError(sitesError)} /></div>}
        <MissionForm sites={sites} health={health} />
      </div>
      <div className="min-w-0 space-y-4">
        <section className="panel space-y-3" aria-labelledby="analyses-title">
          <div className="flex items-center gap-2">
            <Icon name={engineer ? 'terminal' : 'satellite'} className="h-4 w-4 text-accent" />
            <h2 id="analyses-title" className="panel-title">Analizler (bu oturum)</h2>
          </div>
          <AnalysisList />
        </section>
        <section className="panel" aria-label="Seçili analiz sonucu">
          <ResultSummary entry={selected} />
        </section>
        {!engineer && (
          <div className="rounded-[1.1rem] bg-[linear-gradient(135deg,rgb(76_201_255/0.55),rgb(179_157_255/0.35),rgb(255_204_77/0.4))] p-px shadow-[0_0_40px_-18px_var(--color-neon)]">
            <EarthMoonCard />
          </div>
        )}
      </div>
    </div>
  );
}
