import { useId, useMemo, useState } from 'react';
import { api } from '../api/client';
import { explainCode, explainError, headingFor, violationText } from '../api/errors';
import type { CompareResponse, Decision, Priority, RankedCandidate } from '../api/types';
import { missionLabel } from '../lib/decisionText';
import { formatHours, formatLatLon, formatPercent, shortId } from '../lib/format';
import { missionProfileKey } from '../lib/mission';
import { baselineScenario, jobDecision, validMetrics } from '../lib/result';
import { formatUtc } from '../lib/utc';
import { defineStrings, useStrings } from '../i18n';
import { useApp, type AnalysisEntry } from '../state/AppState';
import { SiteLinks } from './SiteLinks';
import { DecisionBadge, EmptyState, Icon, Notice } from './ui';

type PriorityText = Record<Priority, { label: string; text: string }>;

/**
 * Priority wording describes the backend's own ordering keys (decision_engine.pareto_compare);
 * the interface adds no new scoring. Decision codes (GREEN/YELLOW/RED/GRAY) are never translated.
 */
const STR = defineStrings({
  en: {
    priorities: {
      balanced: { label: 'Balanced', text: 'Non-Pareto-dominated candidates first; then shorter maximum darkness, then shorter maximum DTE outage.' },
      sun: { label: 'Sun', text: 'Non-Pareto-dominated candidates first; then higher mean Sun-disk visibility.' },
      comms: { label: 'Communications (geometric DTE)', text: 'Non-Pareto-dominated candidates first; then shorter maximum DTE outage, then higher DTE share.' },
      resilience: { label: 'Resilience', text: 'Non-Pareto-dominated candidates first; then shorter maximum darkness. Server note: for display only, not an independent tolerance score.' },
    } as PriorityText,
    reducedRadius: (radiusKm: number, referenceKm: number) => `REDUCED_HORIZON_RADIUS · horizon ${radiusKm} km < ${referenceKm} km`,
    nominalNotGreen: 'Nominal mode alone cannot be GREEN (an ERR scenario is required).',
    candidate: (id: string) => `Candidate ${id}`,
    meanSun: 'Mean Sun disk',
    maxDarkness: 'Max darkness',
    dteShare: 'DTE share',
    maxDteGap: 'Max DTE outage',
    noMetrics: 'No valid metrics for the +0 h scenario.',
    dominatedBy: 'Pareto-dominated by candidate(s): ',
    notDominated: 'Not Pareto-dominated (within the same decision class).',
    title: 'Candidate comparison',
    emptyTitle: 'No completed analyses to compare',
    emptyText: 'At least two completed analyses are needed. In Mission Setup, start two analyses with the same mission settings, changing only the location.',
    titleWithEndpoint: 'Candidate comparison (/compare)',
    intro: 'Only analyses that differ in location and DEM layer, with every other mission setting identical, can be compared. Ranking uses the ' +
      'server’s Pareto dominance rule; this interface computes no new score. Only GREEN/YELLOW candidates enter the Pareto ranking.',
    choose: 'Select analyses (at least 2)',
    slip: ' · slip',
    mismatch: 'Different mission profile — not comparable',
    priority: 'Priority',
    comparing: 'Comparing…',
    compare: (n: number) => `Compare (${n})`,
    resultLabel: 'Comparison result',
    serverNote: 'Server note: ',
    groupHeading: (group: 'GREEN' | 'YELLOW', priority: string) => `${group} candidates — priority: ${priority}`,
    emptyClass: 'No candidates in this class.',
    excluded: 'Excluded from ranking (RED / GRAY)',
    none: 'None.',
    noRanking: 'No candidate is GREEN/YELLOW, so the server produced no Pareto ranking. The values in the cards above are the server’s own ' +
      'metrics; the interface does not invent a ranking from them.',
  },
  tr: {
    priorities: {
      balanced: { label: 'Dengeli', text: 'Önce Pareto-baskın olmayanlar; sonra daha kısa azami karanlık, sonra daha kısa azami DTE kesintisi.' },
      sun: { label: 'Güneş', text: 'Önce Pareto-baskın olmayanlar; sonra daha yüksek ortalama Güneş diski görünürlüğü.' },
      comms: { label: 'İletişim (geometrik DTE)', text: 'Önce Pareto-baskın olmayanlar; sonra daha kısa azami DTE kesintisi, sonra daha yüksek DTE payı.' },
      resilience: { label: 'Dayanıklılık', text: 'Önce Pareto-baskın olmayanlar; sonra daha kısa azami karanlık. Sunucu notu: gösterim amaçlıdır, bağımsız tolerans skoru değildir.' },
    },
    reducedRadius: (radiusKm: number, referenceKm: number) => `REDUCED_HORIZON_RADIUS · ufuk ${radiusKm} km < ${referenceKm} km`,
    nominalNotGreen: 'Nominal mod tek başına GREEN olamaz (ERR senaryosu gerekir).',
    candidate: (id: string) => `Aday ${id}`,
    meanSun: 'Ort. Güneş diski',
    maxDarkness: 'Azami karanlık',
    dteShare: 'DTE payı',
    maxDteGap: 'Azami DTE kesintisi',
    noMetrics: '+0 sa senaryosu için geçerli metrik yok.',
    dominatedBy: 'Pareto’da şu aday(lar) tarafından baskılanıyor: ',
    notDominated: 'Pareto-baskın değil (aynı karar sınıfında).',
    title: 'Aday karşılaştırma',
    emptyTitle: 'Karşılaştırılacak tamamlanmış analiz yok',
    emptyText: 'En az iki tamamlanmış analiz gerekir. Görev Kurulumu’nda aynı görev ayarlarıyla, yalnızca konumu değiştirerek iki analiz başlatın.',
    titleWithEndpoint: 'Aday karşılaştırma (/compare)',
    intro: 'Yalnızca konum ve DEM katmanı farklı, diğer tüm görev ayarları aynı olan analizler karşılaştırılabilir. Sıralama sunucudaki Pareto ' +
      'baskınlık kuralıyla yapılır; bu arayüz yeni bir puan hesaplamaz. Pareto sıralamasına yalnızca GREEN/YELLOW adaylar girer.',
    choose: 'Analiz seçin (en az 2)',
    slip: ' · kayma',
    mismatch: 'Farklı görev profili — karşılaştırılamaz',
    priority: 'Öncelik',
    comparing: 'Karşılaştırılıyor…',
    compare: (n: number) => `Karşılaştır (${n})`,
    resultLabel: 'Karşılaştırma sonucu',
    serverNote: 'Sunucu notu: ',
    groupHeading: (group: 'GREEN' | 'YELLOW', priority: string) => `${group} adaylar — öncelik: ${priority}`,
    emptyClass: 'Bu sınıfta aday yok.',
    excluded: 'Sıralama dışı bırakılanlar (RED / GRAY)',
    none: 'Yok.',
    noRanking: 'Hiçbir aday GREEN/YELLOW değil; bu yüzden sunucu Pareto sıralaması üretmedi. Değerler yukarıdaki kartlarda sunucunun kendi ' +
      'metrikleridir; arayüz bunlardan bir sıralama uydurmaz.',
  },
});

const PRIORITY_ORDER: readonly Priority[] = ['balanced', 'sun', 'comms', 'resilience'];

function comparable(entry: AnalysisEntry): boolean {
  return Boolean(entry.job?.result?.mission) && (entry.job?.status === 'completed' || entry.job?.status === 'partial') && !entry.lost;
}

function Reasons({ entry }: { entry: AnalysisEntry }) {
  const { mode } = useApp();
  const s = useStrings(STR);
  const mission = entry.job?.result?.mission;
  if (!mission) return null;
  const violations = [...(mission.nominal_violations ?? []), ...(mission.cautious_violations ?? [])];
  const codes = [...new Set(violations.map((v) => v.code))];
  const unknown = [...new Set((mission.unresolved ?? []).map((u) => u.code))];
  // The backend label is Turkish-only; the same wording is rebuilt from status + radius policy.
  const label = missionLabel(mission, entry.input.uncertainty_mode);
  return (
    <ul className="space-y-0.5 text-xs">
      {codes.map((c) => (
        <li key={c} className="text-stop"><Icon name="stop" className="mr-1 inline h-3.5 w-3.5" />{mode === 'public' ? violationText(c)?.publicLabel ?? c : `${c} · ${violationText(c)?.label ?? ''}`}</li>
      ))}
      {unknown.map((c) => (
        <li key={c} className="text-caution"><Icon name="question" className="mr-1 inline h-3.5 w-3.5" />{mode === 'public' ? headingFor(explainCode(c), 'public') : `${explainCode(c).title} (${c})`}</li>
      ))}
      {mission.radius_policy?.below_reference && (
        <li className="text-caution">
          <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />
          {mode === 'public'
            ? headingFor(explainCode('REDUCED_HORIZON_RADIUS'), 'public')
            : `${s.reducedRadius(mission.radius_policy.radius_km, mission.radius_policy.reference_radius_km)}${mission.radius_policy.capped ? ` (${mission.radius_policy.status_before_policy} → ${mission.status})` : ''}`}
        </li>
      )}
      {codes.length === 0 && unknown.length === 0 && mission.status === 'GRAY' && (
        <li className="text-muted">{mission.reason ?? (entry.input.uncertainty_mode === 'nominal' ? s.nominalNotGreen : label)}</li>
      )}
      {codes.length === 0 && unknown.length === 0 && mission.status !== 'GRAY' && <li className="text-muted">{label}</li>}
    </ul>
  );
}

function CandidateCard({ entry, ranked, rank }: { entry: AnalysisEntry; ranked?: RankedCandidate; rank?: number }) {
  const s = useStrings(STR);
  const decision = jobDecision(entry.job) ?? 'GRAY';
  const m = validMetrics(baselineScenario(entry.job?.result?.mission)?.variants.nominal);
  const metrics = ranked?.metrics ?? (m ? {
    mean_sun_visible_fraction: m.mean_sun_visible_fraction, max_continuous_darkness_s: m.max_continuous_darkness_s,
    dte_visible_fraction: m.dte_visible_fraction, max_continuous_dte_gap_s: m.max_continuous_dte_gap_s,
  } : null);
  return (
    <article className="space-y-2 rounded-lg border border-line bg-panel-2 p-3" aria-label={s.candidate(shortId(entry.id))}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{rank !== undefined && <span className="mr-2 text-accent">#{rank}</span>}<span className="mono">{shortId(entry.id)}</span></p>
          <p className="mono text-xs text-muted">{formatLatLon(entry.input.latitude, entry.input.longitude)} · {entry.input.dataset_id}</p>
        </div>
        <DecisionBadge status={decision as Decision} size="sm" />
      </header>
      {metrics ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">{s.meanSun}</dt><dd className="mono">{formatPercent(metrics.mean_sun_visible_fraction, 1)}</dd>
          <dt className="text-muted">{s.maxDarkness}</dt><dd className="mono">{formatHours(metrics.max_continuous_darkness_s, 2)}</dd>
          <dt className="text-muted">{s.dteShare}</dt><dd className="mono">{formatPercent(metrics.dte_visible_fraction, 1)}</dd>
          <dt className="text-muted">{s.maxDteGap}</dt><dd className="mono">{formatHours(metrics.max_continuous_dte_gap_s, 2)}</dd>
        </dl>
      ) : <p className="text-xs text-muted">{s.noMetrics}</p>}
      {ranked && ranked.dominated_by.length > 0 && (
        <p className="text-xs text-caution">{s.dominatedBy}<span className="mono">{ranked.dominated_by.map(shortId).join(', ')}</span></p>
      )}
      {ranked && ranked.dominated_by.length === 0 && <p className="text-xs text-go">{s.notDominated}</p>}
      <Reasons entry={entry} />
      <SiteLinks lat={entry.input.latitude} lon={entry.input.longitude} />
    </article>
  );
}

export function ComparePanel() {
  const { list } = useApp();
  const s = useStrings(STR);
  const uid = useId();
  const [chosen, setChosen] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority>('balanced');
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => list.filter(comparable), [list]);
  const byId = useMemo(() => Object.fromEntries(list.map((e) => [e.id, e])), [list]);
  const profile = chosen[0] ? byId[chosen[0]] : undefined;
  const profileKey = profile ? missionProfileKey(profile.input) : null;

  const toggle = (id: string) => {
    setResult(null);
    setError(null);
    setChosen((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id].slice(0, 12)));
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.compare(chosen, priority));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="panel">
        <h2 className="panel-title">{s.title}</h2>
        <EmptyState title={s.emptyTitle}>{s.emptyText}</EmptyState>
      </div>
    );
  }

  return (
    <div className="panel space-y-4">
      <h2 className="panel-title">{s.titleWithEndpoint}</h2>
      <p className="text-sm text-muted">{s.intro}</p>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">{s.choose}</legend>
        <ul className="grid gap-2 md:grid-cols-2">
          {candidates.map((e) => {
            const mismatch = profileKey !== null && !chosen.includes(e.id) && missionProfileKey(e.input) !== profileKey;
            return (
              <li key={e.id}>
                <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${chosen.includes(e.id) ? 'border-accent bg-accent/5' : 'border-line'} ${mismatch ? 'opacity-60' : ''}`}>
                  <input type="checkbox" className="mt-1" checked={chosen.includes(e.id)} disabled={mismatch} onChange={() => toggle(e.id)}
                    aria-describedby={mismatch ? `${uid}-${e.id}-mm` : undefined} />
                  <span className="min-w-0">
                    <span className="mono">{shortId(e.id)}</span> · {formatLatLon(e.input.latitude, e.input.longitude)}
                    <span className="block text-xs text-muted">{formatUtc(e.input.landing_utc)} · {e.input.uncertainty_mode} · {jobDecision(e.job)}{e.kind === 'shift' ? s.slip : ''}</span>
                    {mismatch && <span id={`${uid}-${e.id}-mm`} className="block text-xs text-caution">{s.mismatch}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">{s.priority}</legend>
        <div className="grid gap-2 md:grid-cols-4">
          {PRIORITY_ORDER.map((value) => (
            <label key={value} className={`cursor-pointer rounded-md border p-2 text-sm ${priority === value ? 'border-accent bg-accent/10' : 'border-line'}`}>
              <span className="flex items-center gap-2 font-medium"><input type="radio" name={`${uid}-prio`} checked={priority === value} onChange={() => { setPriority(value); setResult(null); }} />{s.priorities[value].label}</span>
              <span className="mt-1 block text-xs text-muted">{s.priorities[value].text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="btn btn-primary" disabled={chosen.length < 2 || busy} onClick={() => void run()}>
        {busy ? <><Icon name="spinner" /> {s.comparing}</> : s.compare(chosen.length)}
      </button>
      {error !== null && <Notice explained={explainError(error)} />}

      {result && (
        <section className="space-y-4" aria-live="polite" aria-label={s.resultLabel}>
          <p className="text-xs text-muted">{s.serverNote}{result.note}</p>
          {(['green', 'yellow'] as const).map((group) => (
            <div key={group} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">{s.groupHeading(group === 'green' ? 'GREEN' : 'YELLOW', s.priorities[result.priority]?.label ?? result.priority)}</h3>
              {result[group].length === 0 ? <p className="text-xs text-muted">{s.emptyClass}</p> : (
                <div className="grid gap-3 md:grid-cols-2">
                  {result[group].map((r, i) => byId[r.id] ? <CandidateCard key={r.id} entry={byId[r.id]!} ranked={r} rank={i + 1} /> : null)}
                </div>
              )}
            </div>
          ))}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">{s.excluded}</h3>
            {result.excluded.length === 0 ? <p className="text-xs text-muted">{s.none}</p> : (
              <div className="grid gap-3 md:grid-cols-2">
                {result.excluded.map((x) => byId[x.id] ? <CandidateCard key={x.id} entry={byId[x.id]!} /> : null)}
              </div>
            )}
          </div>
          {result.green.length + result.yellow.length === 0 && (
            <p role="status" className="rounded-md border border-unknown/40 bg-unknown/5 p-3 text-sm text-ink">{s.noRanking}</p>
          )}
        </section>
      )}
    </div>
  );
}
