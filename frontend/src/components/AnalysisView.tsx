import { useId, type ReactNode } from 'react';
import type { ApiError } from '../api/client';
import { explainCode, explainError } from '../api/errors';
import type { Horizon, TimelineResponse } from '../api/types';
import { useHorizon, useTimeline } from '../hooks/useBackend';
import { formatLatLon, shortId } from '../lib/format';
import { jobDecision } from '../lib/result';
import { formatUtc } from '../lib/utc';
import { useCursor } from '../state/Cursor';
import { isActive, useApp, type AnalysisEntry } from '../state/AppState';
import { EmptyState, Icon, Notice } from './ui';
import { defineStrings, useStrings } from '../i18n';

const STR = defineStrings({
  en: {
    shownAnalysis: 'Analysis shown',
    choose: '— select —',
    slip: ' · slip',
    queued: 'queued',
    noAnalysisTitle: 'No analysis to show',
    noAnalysis: 'First start an analysis with real NASA data in the Mission Setup tab and select it from the list. Without data no chart is drawn; no sample/fake curve is shown.',
    computing: (id: string, status: string) => `Analysis ${id} is still being computed (${status}). Charts are drawn when the result arrives.`,
    noHorizon: 'This analysis could not produce a terrain horizon; no chart is drawn.',
    fetching: 'Fetching the horizon and timeline…',
    noChartDataTitle: 'No chart data for this analysis',
    noChartData: 'The server returned no horizon or timeline (e.g. partial horizon → GRAY). No values are invented.',
    emptyTimelineTitle: 'Timeline empty',
    emptyTimeline: 'No time samples for this scenario (e.g. GRAY because of a partial horizon).',
    slipLegend: 'Landing slip scenario',
    hours: 'h',
    timeLabel: (i: number, n: number) => `Time (UTC) — sample ${i} / ${n}`,
    previous: 'Previous time step',
    next: 'Next time step',
    hint: (start: string, end: string) => `You can also navigate with the arrow keys, Home/End and PageUp/PageDown. Scenario: ${start} → ${end}.`,
  },
  tr: {
    shownAnalysis: 'Gösterilen analiz',
    choose: '— seçin —',
    slip: ' · kayma',
    queued: 'kuyrukta',
    noAnalysisTitle: 'Gösterilecek analiz yok',
    noAnalysis: 'Önce Görev Kurulumu sekmesinde gerçek NASA verisiyle bir analiz başlatın ve listeden seçin. Veri yoksa grafik çizilmez; örnek/sahte eğri gösterilmez.',
    computing: (id: string, status: string) => `Analiz ${id} henüz hesaplanıyor (${status}). Grafikler sonuç gelince çizilir.`,
    noHorizon: 'Bu analiz arazi ufku üretemedi; grafik çizilmez.',
    fetching: 'Ufuk ve zaman çizelgesi alınıyor…',
    noChartDataTitle: 'Bu analiz için grafik verisi yok',
    noChartData: 'Sunucu ufuk veya zaman çizelgesi döndürmedi (ör. kısmi ufuk → GRAY). Değer uydurulmaz.',
    emptyTimelineTitle: 'Zaman çizelgesi boş',
    emptyTimeline: 'Bu senaryo için zaman örneği yok (ör. kısmi ufuk nedeniyle GRAY).',
    slipLegend: 'İniş kayma senaryosu',
    hours: 'sa',
    timeLabel: (i: number, n: number) => `Zaman (UTC) — örnek ${i} / ${n}`,
    previous: 'Önceki zaman adımı',
    next: 'Sonraki zaman adımı',
    hint: (start: string, end: string) => `Ok tuşları, Home/End ve PageUp/PageDown ile de gezinebilirsiniz. Senaryo: ${start} → ${end}.`,
  },
});

export interface AnalysisData {
  entry: AnalysisEntry;
  horizon: Horizon | null;
  timeline: TimelineResponse | null;
  horizonError: ApiError | null;
  timelineError: ApiError | null;
  loading: boolean;
}

/** Fetch /horizon and /timeline only after the job is terminal and has the artefact. */
export function useAnalysisData(entry: AnalysisEntry | null): AnalysisData | null {
  const ready = entry && !isActive(entry) && entry.job?.result;
  const hasHorizon = Boolean(ready && entry?.job?.result?.horizon);
  const hasMission = Boolean(ready && entry?.job?.result?.mission);
  const horizon = useHorizon(hasHorizon && entry ? entry.id : null);
  const timeline = useTimeline(hasMission && entry ? entry.id : null);
  if (!entry) return null;
  return {
    entry,
    horizon: horizon.data,
    timeline: timeline.data,
    horizonError: horizon.error,
    timelineError: timeline.error,
    loading: horizon.loading || timeline.loading,
  };
}

export function AnalysisPicker() {
  const { list, selectedId, select } = useApp();
  const s = useStrings(STR);
  const id = useId();
  if (list.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor={id} className="text-sm font-medium text-ink">{s.shownAnalysis}</label>
      <select id={id} className="input sm:max-w-xl" value={selectedId ?? ''} onChange={(e) => select(e.target.value || null)}>
        <option value="">{s.choose}</option>
        {list.map((e) => (
          <option key={e.id} value={e.id}>
            {shortId(e.id)} · {formatLatLon(e.input.latitude, e.input.longitude)} · {formatUtc(e.input.landing_utc)}
            {e.kind === 'shift' ? s.slip : ''} · {jobDecision(e.job) ?? e.job?.status ?? s.queued}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Shared empty / loading / error states for Sky View and Timeline. */
export function AnalysisGate({ data, need, children }: { data: AnalysisData | null; need: 'horizon' | 'timeline' | 'both'; children: ReactNode }) {
  const s = useStrings(STR);
  if (!data) {
    return <EmptyState title={s.noAnalysisTitle}>{s.noAnalysis}</EmptyState>;
  }
  const { entry } = data;
  if (isActive(entry)) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
        <Icon name="spinner" className="h-4 w-4 text-accent" /> {s.computing(shortId(entry.id), entry.job?.status ?? 'queued')}
      </p>
    );
  }
  const result = entry.job?.result;
  if (entry.job?.status === 'failed' || !result) {
    if (entry.lost) return <Notice explained={explainCode('ANALYSIS_NOT_FOUND')} />;
    return <Notice explained={explainCode(entry.job?.error ?? 'CALCULATION_ERROR')} />;
  }
  if (result.error_code && !result.horizon) {
    return (
      <Notice explained={explainCode(result.error_code)}>
        <p className="text-xs text-muted">{s.noHorizon}{result.reason ? ` (${result.reason})` : ''}</p>
      </Notice>
    );
  }
  if ((need === 'horizon' || need === 'both') && data.horizonError) return <Notice explained={explainError(data.horizonError)} />;
  if ((need === 'timeline' || need === 'both') && data.timelineError) return <Notice explained={explainError(data.timelineError)} />;
  const missing = (need !== 'timeline' && !data.horizon) || (need !== 'horizon' && !data.timeline);
  if (missing) {
    return data.loading ? (
      <p role="status" className="flex items-center gap-2 text-sm text-muted"><Icon name="spinner" /> {s.fetching}</p>
    ) : (
      <EmptyState title={s.noChartDataTitle}>
        {result.mission?.reason ?? s.noChartData}
      </EmptyState>
    );
  }
  return <>{children}</>;
}

/** Scenario selector + accessible time scrubber bound to the shared cursor. */
export function Scrubber({ data }: { data: AnalysisData }) {
  const cursor = useCursor();
  const t = useStrings(STR);
  const sliderId = useId();
  const scenarios = data.timeline?.scenarios ?? [];
  const shifts = scenarios.map((s) => s.shift_hours);
  const shift = cursor.shiftFor(data.entry.id, shifts);
  const scenario = scenarios.find((s) => s.shift_hours === shift) ?? scenarios[0];
  if (!scenario || scenario.timeline.length === 0) {
    return <EmptyState title={t.emptyTimelineTitle}>{t.emptyTimeline}</EmptyState>;
  }
  const n = scenario.timeline.length;
  const index = cursor.indexFor(data.entry.id, scenario.shift_hours, n);
  const point = scenario.timeline[index];
  const set = (i: number) => cursor.setIndex(data.entry.id, scenario.shift_hours, Math.min(n - 1, Math.max(0, i)));

  return (
    <div className="space-y-3 rounded-lg border border-line bg-panel-2 p-3">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">{t.slipLegend}</legend>
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s) => (
            <label key={s.shift_hours} className={`chip cursor-pointer px-3 py-1.5 text-sm ${s.shift_hours === scenario.shift_hours ? 'border-accent bg-accent/15 text-accent' : 'border-line text-ink'}`}>
              <input type="radio" className="sr-only" name={`${sliderId}-shift`} checked={s.shift_hours === scenario.shift_hours}
                onChange={() => cursor.setShift(data.entry.id, s.shift_hours)} />
              +{s.shift_hours} {t.hours}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={sliderId} className="label">{t.timeLabel(index + 1, n)}</label>
        <div className="flex items-center gap-2">
          <button type="button" className="btn px-2" onClick={() => set(index - 1)} disabled={index === 0} aria-label={t.previous}>◀</button>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={n - 1}
            step={1}
            value={index}
            onChange={(e) => set(Number(e.target.value))}
            aria-valuetext={point ? formatUtc(point.utc) : undefined}
            className="h-2 w-full cursor-pointer accent-[var(--color-accent)]"
          />
          <button type="button" className="btn px-2" onClick={() => set(index + 1)} disabled={index === n - 1} aria-label={t.next}>▶</button>
        </div>
        <p className="mono mt-1 text-sm text-ink" aria-live="polite">{point ? formatUtc(point.utc, true) : '—'}</p>
        <p className="hint">{t.hint(formatUtc(scenario.start_utc), formatUtc(scenario.end_utc))}</p>
      </div>
    </div>
  );
}

/** Current scenario/point for a given analysis according to the shared cursor. */
export function useCurrentPoint(data: AnalysisData | null) {
  const cursor = useCursor();
  const scenarios = data?.timeline?.scenarios ?? [];
  if (!data || scenarios.length === 0) return null;
  const shift = cursor.shiftFor(data.entry.id, scenarios.map((s) => s.shift_hours));
  const scenario = scenarios.find((s) => s.shift_hours === shift) ?? scenarios[0];
  if (!scenario) return null;
  const index = cursor.indexFor(data.entry.id, scenario.shift_hours, scenario.timeline.length);
  const point = scenario.timeline[index] ?? null;
  const missionScenario = data.entry.job?.result?.mission?.scenarios.find((s) => s.shift_hours === scenario.shift_hours) ?? null;
  return { scenario, index, point, missionScenario };
}
