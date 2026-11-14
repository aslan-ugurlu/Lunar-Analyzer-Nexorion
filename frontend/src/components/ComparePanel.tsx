import { useId, useMemo, useState } from 'react';
import { api } from '../api/client';
import { explainCode, explainError, headingFor, VIOLATION_TEXT } from '../api/errors';
import type { CompareResponse, Decision, Priority, RankedCandidate } from '../api/types';
import { formatHours, formatLatLon, formatPercent, shortId } from '../lib/format';
import { missionProfileKey } from '../lib/mission';
import { baselineScenario, jobDecision, validMetrics } from '../lib/result';
import { formatUtc } from '../lib/utc';
import { useApp, type AnalysisEntry } from '../state/AppState';
import { SiteLinks } from './SiteLinks';
import { DecisionBadge, EmptyState, Icon, Notice } from './ui';

/** Describes the backend's own ordering keys (decision_engine.pareto_compare); no new scoring. */
const PRIORITIES: { value: Priority; label: string; text: string }[] = [
  { value: 'balanced', label: 'Dengeli', text: 'Önce Pareto-baskın olmayanlar; sonra daha kısa azami karanlık, sonra daha kısa azami DTE kesintisi.' },
  { value: 'sun', label: 'Güneş', text: 'Önce Pareto-baskın olmayanlar; sonra daha yüksek ortalama Güneş diski görünürlüğü.' },
  { value: 'comms', label: 'İletişim (geometrik DTE)', text: 'Önce Pareto-baskın olmayanlar; sonra daha kısa azami DTE kesintisi, sonra daha yüksek DTE payı.' },
  { value: 'resilience', label: 'Dayanıklılık', text: 'Önce Pareto-baskın olmayanlar; sonra daha kısa azami karanlık. Sunucu notu: gösterim amaçlıdır, bağımsız tolerans skoru değildir.' },
];

function comparable(entry: AnalysisEntry): boolean {
  return Boolean(entry.job?.result?.mission) && (entry.job?.status === 'completed' || entry.job?.status === 'partial') && !entry.lost;
}

function Reasons({ entry }: { entry: AnalysisEntry }) {
  const { mode } = useApp();
  const mission = entry.job?.result?.mission;
  if (!mission) return null;
  const violations = [...(mission.nominal_violations ?? []), ...(mission.cautious_violations ?? [])];
  const codes = [...new Set(violations.map((v) => v.code))];
  const unknown = [...new Set((mission.unresolved ?? []).map((u) => u.code))];
  return (
    <ul className="space-y-0.5 text-xs">
      {codes.map((c) => (
        <li key={c} className="text-stop"><Icon name="stop" className="mr-1 inline h-3.5 w-3.5" />{mode === 'public' ? VIOLATION_TEXT[c]?.publicLabel ?? c : `${c} · ${VIOLATION_TEXT[c]?.label ?? ''}`}</li>
      ))}
      {unknown.map((c) => (
        <li key={c} className="text-caution"><Icon name="question" className="mr-1 inline h-3.5 w-3.5" />{mode === 'public' ? headingFor(explainCode(c), 'public') : `${explainCode(c).title} (${c})`}</li>
      ))}
      {mission.radius_policy?.below_reference && (
        <li className="text-caution">
          <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />
          {mode === 'public'
            ? headingFor(explainCode('REDUCED_HORIZON_RADIUS'), 'public')
            : `REDUCED_HORIZON_RADIUS · ufuk ${mission.radius_policy.radius_km} km < ${mission.radius_policy.reference_radius_km} km${mission.radius_policy.capped ? ` (${mission.radius_policy.status_before_policy} → ${mission.status})` : ''}`}
        </li>
      )}
      {codes.length === 0 && unknown.length === 0 && mission.status === 'GRAY' && (
        <li className="text-muted">{mission.reason ?? (entry.input.uncertainty_mode === 'nominal' ? 'Nominal mod tek başına GREEN olamaz (ERR senaryosu gerekir).' : mission.label)}</li>
      )}
      {codes.length === 0 && unknown.length === 0 && mission.status !== 'GRAY' && <li className="text-muted">{mission.label}</li>}
    </ul>
  );
}

function CandidateCard({ entry, ranked, rank }: { entry: AnalysisEntry; ranked?: RankedCandidate; rank?: number }) {
  const decision = jobDecision(entry.job) ?? 'GRAY';
  const m = validMetrics(baselineScenario(entry.job?.result?.mission)?.variants.nominal);
  const metrics = ranked?.metrics ?? (m ? {
    mean_sun_visible_fraction: m.mean_sun_visible_fraction, max_continuous_darkness_s: m.max_continuous_darkness_s,
    dte_visible_fraction: m.dte_visible_fraction, max_continuous_dte_gap_s: m.max_continuous_dte_gap_s,
  } : null);
  return (
    <article className="space-y-2 rounded-lg border border-line bg-panel-2 p-3" aria-label={`Aday ${shortId(entry.id)}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{rank !== undefined && <span className="mr-2 text-accent">#{rank}</span>}<span className="mono">{shortId(entry.id)}</span></p>
          <p className="mono text-xs text-muted">{formatLatLon(entry.input.latitude, entry.input.longitude)} · {entry.input.dataset_id}</p>
        </div>
        <DecisionBadge status={decision as Decision} size="sm" />
      </header>
      {metrics ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Ort. Güneş diski</dt><dd className="mono">{formatPercent(metrics.mean_sun_visible_fraction, 1)}</dd>
          <dt className="text-muted">Azami karanlık</dt><dd className="mono">{formatHours(metrics.max_continuous_darkness_s, 2)}</dd>
          <dt className="text-muted">DTE payı</dt><dd className="mono">{formatPercent(metrics.dte_visible_fraction, 1)}</dd>
          <dt className="text-muted">Azami DTE kesintisi</dt><dd className="mono">{formatHours(metrics.max_continuous_dte_gap_s, 2)}</dd>
        </dl>
      ) : <p className="text-xs text-muted">+0 sa senaryosu için geçerli metrik yok.</p>}
      {ranked && ranked.dominated_by.length > 0 && (
        <p className="text-xs text-caution">Pareto’da şu aday(lar) tarafından baskılanıyor: <span className="mono">{ranked.dominated_by.map(shortId).join(', ')}</span></p>
      )}
      {ranked && ranked.dominated_by.length === 0 && <p className="text-xs text-go">Pareto-baskın değil (aynı karar sınıfında).</p>}
      <Reasons entry={entry} />
      <SiteLinks lat={entry.input.latitude} lon={entry.input.longitude} />
    </article>
  );
}

export function ComparePanel() {
  const { list } = useApp();
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
        <h2 className="panel-title">Aday karşılaştırma</h2>
        <EmptyState title="Karşılaştırılacak tamamlanmış analiz yok">
          En az iki tamamlanmış analiz gerekir. Mission Setup’ta aynı görev ayarlarıyla, yalnızca konumu değiştirerek iki analiz başlatın.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="panel space-y-4">
      <h2 className="panel-title">Aday karşılaştırma (/compare)</h2>
      <p className="text-sm text-muted">
        Yalnızca konum ve DEM katmanı farklı, diğer tüm görev ayarları aynı olan analizler karşılaştırılabilir. Sıralama sunucudaki Pareto
        baskınlık kuralıyla yapılır; bu arayüz yeni bir puan hesaplamaz. Pareto sıralamasına yalnızca GREEN/YELLOW adaylar girer.
      </p>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Analiz seçin (en az 2)</legend>
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
                    <span className="block text-xs text-muted">{formatUtc(e.input.landing_utc)} · {e.input.uncertainty_mode} · {jobDecision(e.job)}{e.kind === 'shift' ? ' · kayma' : ''}</span>
                    {mismatch && <span id={`${uid}-${e.id}-mm`} className="block text-xs text-caution">Farklı görev profili — karşılaştırılamaz</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Öncelik</legend>
        <div className="grid gap-2 md:grid-cols-4">
          {PRIORITIES.map((p) => (
            <label key={p.value} className={`cursor-pointer rounded-md border p-2 text-sm ${priority === p.value ? 'border-accent bg-accent/10' : 'border-line'}`}>
              <span className="flex items-center gap-2 font-medium"><input type="radio" name={`${uid}-prio`} checked={priority === p.value} onChange={() => { setPriority(p.value); setResult(null); }} />{p.label}</span>
              <span className="mt-1 block text-xs text-muted">{p.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="btn btn-primary" disabled={chosen.length < 2 || busy} onClick={() => void run()}>
        {busy ? <><Icon name="spinner" /> Karşılaştırılıyor…</> : `Karşılaştır (${chosen.length})`}
      </button>
      {error !== null && <Notice explained={explainError(error)} />}

      {result && (
        <section className="space-y-4" aria-live="polite" aria-label="Karşılaştırma sonucu">
          <p className="text-xs text-muted">Sunucu notu: {result.note}</p>
          {(['green', 'yellow'] as const).map((group) => (
            <div key={group} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">{group === 'green' ? 'GREEN adaylar' : 'YELLOW adaylar'} — öncelik: {PRIORITIES.find((p) => p.value === result.priority)?.label}</h3>
              {result[group].length === 0 ? <p className="text-xs text-muted">Bu sınıfta aday yok.</p> : (
                <div className="grid gap-3 md:grid-cols-2">
                  {result[group].map((r, i) => byId[r.id] ? <CandidateCard key={r.id} entry={byId[r.id]!} ranked={r} rank={i + 1} /> : null)}
                </div>
              )}
            </div>
          ))}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Sıralama dışı bırakılanlar (RED / GRAY)</h3>
            {result.excluded.length === 0 ? <p className="text-xs text-muted">Yok.</p> : (
              <div className="grid gap-3 md:grid-cols-2">
                {result.excluded.map((x) => byId[x.id] ? <CandidateCard key={x.id} entry={byId[x.id]!} /> : null)}
              </div>
            )}
          </div>
          {result.green.length + result.yellow.length === 0 && (
            <p role="status" className="rounded-md border border-unknown/40 bg-unknown/5 p-3 text-sm text-ink">
              Hiçbir aday GREEN/YELLOW değil; bu yüzden sunucu Pareto sıralaması üretmedi. Değerler yukarıdaki kartlarda sunucunun kendi
              metrikleridir; arayüz bunlardan bir sıralama uydurmaz.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
