import { explainCode, headingFor } from '../api/errors';
import { formatLatLon, shortId } from '../lib/format';
import { jobDecision } from '../lib/result';
import { formatUtc } from '../lib/utc';
import { isActive, useApp, type AnalysisEntry } from '../state/AppState';
import { DecisionBadge, EmptyState, Icon } from './ui';
import { defineStrings, useStrings } from '../i18n';

const STR = defineStrings({
  en: {
    status: {
      queued: 'Queued',
      running: 'Computing',
      completed: 'Completed',
      partial: 'Partial (GRAY)',
      failed: 'Failed',
    } as Record<string, string>,
    lostEngineer: 'Not found on the server (ANALYSIS_NOT_FOUND) — the server may have been restarted',
    lostPublic: (heading: string) => `${heading} — the server may have been restarted`,
    polling: (code: string) => `· polling: ${code}`,
    pollFailed: (heading: string) => `· status cannot be checked (${heading.toLocaleLowerCase('en')})`,
    emptyTitle: 'No analyses yet',
    empty: 'Fill in the form on the left and choose “Start analysis”. The server returns 202 + an analysis id, and the status is checked every 2 seconds. ' +
      'Analyses are kept only for this session (nothing is stored in the browser).',
    listLabel: 'Analyses',
    slipParent: (parent: string) => `slip · parent ${parent}`,
    selected: 'Selected',
    select: 'Select',
    removeLabel: (id: string) => `Remove analysis ${id} from the list`,
    remove: 'Remove',
  },
  tr: {
    status: {
      queued: 'Kuyrukta',
      running: 'Hesaplanıyor',
      completed: 'Tamamlandı',
      partial: 'Kısmi (GRAY)',
      failed: 'Başarısız',
    },
    lostEngineer: 'Sunucuda bulunamadı (ANALYSIS_NOT_FOUND) — sunucu yeniden başlatılmış olabilir',
    lostPublic: (heading: string) => `${heading} — sunucu yeniden başlatılmış olabilir`,
    polling: (code: string) => `· izleme: ${code}`,
    pollFailed: (heading: string) => `· durum sorgulanamıyor (${heading.toLocaleLowerCase('tr')})`,
    emptyTitle: 'Henüz analiz yok',
    empty: 'Soldaki formu doldurup “Analizi başlat” deyin. Sunucu 202 + analiz kimliği döndürür, durum 2 saniyede bir sorgulanır. ' +
      'Analizler yalnızca bu oturumda tutulur (tarayıcıya kalıcı yazılmaz).',
    listLabel: 'Analizler',
    slipParent: (parent: string) => `kayma · ebeveyn ${parent}`,
    selected: 'Seçili',
    select: 'Seç',
    removeLabel: (id: string) => `${id} analizini listeden kaldır`,
    remove: 'Kaldır',
  },
});

export function JobStatusLine({ entry }: { entry: AnalysisEntry }) {
  const { mode } = useApp();
  const s = useStrings(STR);
  if (entry.lost) {
    return mode === 'engineer'
      ? <span className="text-caution">{s.lostEngineer}</span>
      : <span className="text-caution">{s.lostPublic(headingFor(explainCode('ANALYSIS_NOT_FOUND'), 'public'))}</span>;
  }
  const status = entry.job?.status ?? 'queued';
  return (
    <span className="inline-flex items-center gap-1.5">
      {isActive(entry) && <Icon name="spinner" className="h-3.5 w-3.5 text-accent" />}
      <span>{s.status[status] ?? status}</span>
      {mode === 'engineer' && <span className="mono text-muted">({status})</span>}
      {entry.job?.error && (mode === 'engineer'
        ? <span className="mono text-stop">· {entry.job.error}</span>
        : <span className="text-stop">· {headingFor(explainCode(entry.job.error), 'public')}</span>)}
      {entry.pollErrorCode && (mode === 'engineer'
        ? <span className="mono text-caution">{s.polling(entry.pollErrorCode)}</span>
        : <span className="text-caution">{s.pollFailed(headingFor(explainCode(entry.pollErrorCode), 'public'))}</span>)}
    </span>
  );
}

export function AnalysisList() {
  const { list, selectedId, select, remove, mode } = useApp();
  const s = useStrings(STR);
  if (list.length === 0) {
    return <EmptyState title={s.emptyTitle}>{s.empty}</EmptyState>;
  }
  return (
    <ul className="space-y-2" aria-live="polite" aria-label={s.listLabel}>
      {list.map((entry) => {
        const decision = jobDecision(entry.job);
        const selected = entry.id === selectedId;
        const code = entry.job?.result?.error_code;
        return (
          <li key={entry.id} className={`rounded-xl border p-3 text-sm transition ${selected ? 'border-accent/70 bg-accent/10 shadow-[0_0_24px_-12px_var(--color-neon)]' : 'border-line bg-panel-2 hover:border-line-strong'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium text-ink">
                  <span className="mono">{shortId(entry.id)}</span>
                  {entry.kind === 'shift' && <span className="ml-2 chip border-line text-muted">{s.slipParent(shortId(entry.parentId ?? ''))}</span>}
                </p>
                <p className="mono text-xs text-muted">{formatLatLon(entry.input.latitude, entry.input.longitude)} · {entry.input.dataset_id} · {formatUtc(entry.input.landing_utc)}</p>
                <p className="text-xs"><JobStatusLine entry={entry} /></p>
                {code && <p className="text-xs text-caution">{mode === 'engineer' ? <>{explainCode(code).title} <span className="mono">({code})</span></> : headingFor(explainCode(code), 'public')}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {decision && <DecisionBadge status={decision} size="sm" />}
                <div className="flex gap-2">
                  <button type="button" className="btn min-h-8 px-2 py-1 text-xs" aria-pressed={selected} onClick={() => select(entry.id)}>
                    {selected ? s.selected : s.select}
                  </button>
                  <button type="button" className="btn min-h-8 px-2 py-1 text-xs" onClick={() => remove(entry.id)} aria-label={s.removeLabel(shortId(entry.id))}>
                    {s.remove}
                  </button>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
