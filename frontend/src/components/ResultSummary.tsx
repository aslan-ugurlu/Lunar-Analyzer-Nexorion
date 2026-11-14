import { explainCode, VIOLATION_TEXT } from '../api/errors';
import type { Mission, Scenario } from '../api/types';
import { formatHours, formatLatLon, formatNumber, formatPercent, shortId } from '../lib/format';
import { baselineScenario, intervalUtc, validMetrics, violationInterval } from '../lib/result';
import { baselineKpis, scenarioViolationSummary, type Kpi } from '../lib/telemetry';
import { formatUtc } from '../lib/utc';
import { isActive, useApp, type AnalysisEntry } from '../state/AppState';
import { JobStatusLine } from './AnalysisList';
import { SiteLinks } from './SiteLinks';
import { CopySummary } from './CopySummary';
import { TelemetryPanel } from './TelemetryPanel';
import { DecisionBadge, EmptyState, Icon, Notice } from './ui';

/* ------------------------------------------------------------------ Halk / Eğitimci */

const KPI_TEXT: Record<Kpi['key'], { title: string; sub: string; icon: 'sun' | 'earth'; limitWord: string }> = {
  sun: { title: 'Güneş görünürlüğü', sub: 'Güneş diskinin arazi üzerinde kalan ortalama payı', icon: 'sun', limitWord: 'hedef ≥' },
  darkness: { title: 'En uzun karanlık', sub: 'Güneş’in arazi arkasında kaldığı en uzun kesintisiz süre', icon: 'sun', limitWord: 'sınır ≤' },
  dte: { title: 'Dünya görüşü', sub: 'Dünya merkezinin ufkun üstünde olduğu süre payı', icon: 'earth', limitWord: 'hedef ≥' },
  gap: { title: 'En uzun Dünya kesintisi', sub: 'Dünya ile doğrudan görüşün en uzun kesintisi', icon: 'earth', limitWord: 'sınır ≤' },
};

function kpiValue(k: Kpi): string {
  if (k.value === null) return 'bilinmiyor';
  return k.unit === 'fraction' ? formatPercent(k.value) : `${k.value.toFixed(1)} sa`;
}

function KpiCards({ mission, entry }: { mission: Mission; entry: AnalysisEntry }) {
  const kpis = baselineKpis(mission, entry.input);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="list" aria-label="Özet göstergeler (+0 sa senaryosu)">
      {kpis.map((k) => {
        const t = KPI_TEXT[k.key];
        const state = {
          met: { cls: 'border-go/50 text-go', icon: 'check' as const, word: 'sağlanıyor' },
          violated: { cls: 'border-stop/50 text-stop', icon: 'stop' as const, word: 'sağlanmıyor' },
          not_set: { cls: 'border-line text-muted', icon: 'info' as const, word: 'kısıt yok' },
          unknown: { cls: 'border-unknown/50 text-unknown', icon: 'question' as const, word: 'bilinmiyor' },
        }[k.state];
        const limit = k.limit === null ? null : k.unit === 'fraction' ? formatPercent(k.limit) : `${k.limit} sa`;
        return (
          <div key={k.key} role="listitem" className={`rounded-xl border bg-panel-2 p-4 ${t.icon === 'sun' ? 'border-sun/30' : 'border-earth/30'}`} data-kpi={k.key}>
            <p className={`flex items-center gap-2 text-sm font-semibold ${t.icon === 'sun' ? 'text-sun' : 'text-earth'}`}>
              <Icon name={t.icon} className="h-5 w-5" /> {t.title}
            </p>
            <p className="mono mt-1 text-3xl font-bold text-ink sm:text-4xl">{kpiValue(k)}</p>
            <p className="mt-1 text-xs text-muted">{t.sub}</p>
            <p className={`chip mt-2 ${state.cls}`}>
              <Icon name={state.icon} className="h-3.5 w-3.5" />
              {limit ? `${t.limitWord} ${limit} · ` : ''}{state.word}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Story({ mission, entry }: { mission: Mission; entry: AnalysisEntry }) {
  const s = baselineScenario(mission);
  const m = validMetrics(s?.variants.nominal);
  const i = entry.input;
  const hours = i.duration_hours + i.buffer_hours;
  const summary = scenarioViolationSummary(mission);
  const dark = s && m ? intervalUtc(s, m.darkness_interval) : null;
  const gap = s && m ? intervalUtc(s, m.dte_gap_interval) : null;
  const verdict = {
    GREEN: 'Tanımladığınız kısıtlar hem normal hesapta hem de arazi belirsizliği eklenmiş ihtiyatlı hesapta sağlanıyor.',
    YELLOW: 'Normal hesapta kısıtlar sağlanıyor, ama arazi belirsizliği eklenince en az bir kısıt aşılıyor; dikkatli olunmalı.',
    RED: 'Tanımladığınız kısıtlardan en az biri normal hesapta bile sağlanmıyor.',
    GRAY: 'Eldeki veri veya doğrulama, güvenilir bir “uygun / uygun değil” demeye yetmiyor.',
  }[mission.status];
  return (
    <div className="space-y-2 rounded-xl border border-line bg-panel-2 p-4 text-sm leading-relaxed text-ink">
      <p>
        <strong>{formatLatLon(i.latitude, i.longitude)}</strong> konumunda, <strong>{formatUtc(i.landing_utc)}</strong> başlayan {hours} saatlik pencerede:
      </p>
      {m ? (
        <>
          <p>
            <Icon name="sun" className="mr-1 inline h-4 w-4 text-sun" />
            <strong>Bu bölgede Güneş ne kadar görünüyor?</strong> Güneş diskinin ortalama {formatPercent(m.mean_sun_visible_fraction)} kadarı açıkta.
            {m.max_continuous_darkness_s > 0 && dark ? ` En uzun karanlık ${formatHours(m.max_continuous_darkness_s)} (${formatUtc(dark.start)} → ${formatUtc(dark.end)}).` : ' Hiç karanlık dönem yok.'}
          </p>
          <p>
            <Icon name="earth" className="mr-1 inline h-4 w-4 text-earth" />
            <strong>Dünya ile doğrudan görüş ne zaman kapanıyor?</strong> Dünya zamanın {formatPercent(m.dte_visible_fraction)} kadarında ufkun üstünde.
            {m.max_continuous_dte_gap_s > 0 && gap ? ` En uzun kesinti ${formatHours(m.max_continuous_dte_gap_s)} (${formatUtc(gap.start)} → ${formatUtc(gap.end)}).` : ' Görüş hiç kesilmiyor.'}
          </p>
        </>
      ) : (
        <p>Bu pencere için Güneş ve Dünya görünürlüğü hesaplanamadı (arazi verisi eksik); değer gösterilmiyor.</p>
      )}
      {summary.total > 1 && (
        <p className="text-muted">
          İnişi {mission.scenarios.map((x) => `+${x.shift_hours}`).join(', ')} saat kaydırarak denedik: {summary.withViolations.length === 0
            ? 'hiçbirinde kısıt aşılmadı.'
            : `${summary.withViolations.length} senaryoda kısıt aşıldı (+${summary.withViolations.join(', +')} sa).`}
        </p>
      )}
      <p className="font-medium">Sonuç: {verdict}</p>
      <p className="text-xs text-muted">Güneş görünürlüğü elektrik üretimi, Dünya görüşü radyo bağlantısı garantisi değildir. Bu sonuç bir iniş sertifikası değildir.</p>
    </div>
  );
}

function PublicReasons({ mission }: { mission: Mission }) {
  const items: { key: string; text: string; when?: string; scenario: number; cautious: boolean }[] = [];
  for (const s of mission.scenarios) {
    for (const variant of ['nominal', 'cautious'] as const) {
      const v = s.variants[variant];
      const m = validMetrics(v);
      for (const viol of v?.violations ?? []) {
        const span = m ? intervalUtc(s, violationInterval(viol.code, m)) : null;
        items.push({
          key: `${s.shift_hours}-${variant}-${viol.code}`,
          text: VIOLATION_TEXT[viol.code]?.publicLabel ?? 'Bir görev kısıtı aşılıyor',
          when: span ? `en uzun aralık: ${formatUtc(span.start)} → ${formatUtc(span.end)}` : undefined,
          scenario: s.shift_hours,
          cautious: variant === 'cautious',
        });
      }
    }
  }
  if (items.length === 0) return null;
  return (
    <details className="rounded-lg border border-stop/30 bg-stop/5 p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-ink">Neden bu sonuç? ({items.length} kısıt aşımı)</summary>
      <ul className="mt-2 space-y-1">
        {items.map((it) => (
          <li key={it.key}>
            <Icon name="stop" className="mr-1 inline h-4 w-4 text-stop" />
            {it.text} <span className="text-xs text-muted">· iniş +{it.scenario} sa{it.cautious ? ' · ihtiyatlı hesap' : ''}</span>
            {it.when && <span className="block pl-5 text-xs text-muted">{it.when}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ Mühendis */

function EngineerTable({ mission }: { mission: Mission }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Senaryo metrik tablosu (yatay kaydırılabilir)">
      <table className="w-full min-w-[640px] text-left text-xs">
        <caption className="sr-only">Senaryo ve varyant metrikleri</caption>
        <thead className="text-muted">
          <tr>
            <th scope="col" className="py-1 pr-2">Senaryo</th><th scope="col" className="pr-2">Varyant</th>
            <th scope="col" className="pr-2">ort. f_sun</th><th scope="col" className="pr-2">maks. karanlık</th>
            <th scope="col" className="pr-2">DTE payı</th><th scope="col" className="pr-2">maks. DTE kesinti</th>
            <th scope="col" className="pr-2">disk quad. farkı</th><th scope="col" className="pr-2">Δt</th><th scope="col">ihlal / bilinmeyen</th>
          </tr>
        </thead>
        <tbody className="mono">
          {mission.scenarios.flatMap((s: Scenario) =>
            Object.entries(s.variants).map(([name, v]) => {
              const m = validMetrics(v);
              return (
                <tr key={`${s.shift_hours}-${name}`} className="border-t border-line">
                  <td className="py-1 pr-2">+{s.shift_hours} sa</td>
                  <td className="pr-2">{name}</td>
                  <td className="pr-2">{m ? formatNumber(m.mean_sun_visible_fraction, 4) : 'geçersiz'}</td>
                  <td className="pr-2">{m ? formatHours(m.max_continuous_darkness_s, 2) : '—'}</td>
                  <td className="pr-2">{m ? formatNumber(m.dte_visible_fraction, 4) : '—'}</td>
                  <td className="pr-2">{m ? formatHours(m.max_continuous_dte_gap_s, 2) : '—'}</td>
                  <td className="pr-2">{m ? m.max_disk_integration_difference.toExponential(2) : '—'}</td>
                  <td className="pr-2">{m ? `${m.time_resolution_minutes} dk` : '—'}</td>
                  <td>{v?.violations.length ?? 0} / {v?.unknown.length ?? 0}{!m && v?.metrics && 'reason' in v.metrics && v.metrics.reason ? ` · ${v.metrics.reason}` : ''}</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

const PUBLIC_DISCLAIMERS = [
  'Dünya görüşü yalnızca geometrik bir görüş hattıdır; radyo bağlantısı garantisi değildir.',
  'Güneş görünürlüğü elektrik üretimi demek değildir.',
  'Zamanlar örneklenmiştir; geçiş anları kesin değildir.',
  'İniş güvenliği ve haritanın çözünürlüğünden küçük tehlikeler değerlendirilmez.',
  'Arazi belirsizliği senaryosu (ERR) istatistiksel bir güven aralığı değildir.',
];

/* ------------------------------------------------------------------ shared */

export function ResultSummary({ entry }: { entry: AnalysisEntry | null }) {
  const { mode } = useApp();
  const engineer = mode === 'engineer';
  if (!entry) return <EmptyState title="Analiz seçilmedi">Listeden bir analiz seçin.</EmptyState>;
  const job = entry.job;
  const result = job?.result ?? null;
  const mission = result?.mission;
  const horizon = result?.horizon;

  return (
    <article className="space-y-4" aria-labelledby={`res-${entry.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`res-${entry.id}`} className="panel-title">Analiz {shortId(entry.id)}</h3>
          <p className="text-sm text-muted"><JobStatusLine entry={entry} /></p>
        </div>
        {mission && <DecisionBadge status={mission.status} size="lg" />}
        {!mission && result && <DecisionBadge status={result.status} size="lg" />}
      </header>

      {isActive(entry) && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
          <Icon name="spinner" className="h-4 w-4 text-accent" />
          {job?.status === 'running' ? 'NASA DEM üzerinde ufuk ve SPICE ile Güneş/Dünya konumları hesaplanıyor…' : 'Kuyrukta bekliyor…'} Sonuç gelene kadar değer gösterilmez.
        </p>
      )}
      {job?.status === 'failed' && job.error && <Notice explained={explainCode(job.error)} />}
      {entry.lost && <Notice explained={explainCode('ANALYSIS_NOT_FOUND')} />}
      {result?.error_code && (
        <Notice explained={explainCode(result.error_code)}>
          {engineer && result.reason && <p className="mono text-xs text-muted">reason: {result.reason}</p>}
        </Notice>
      )}
      {result && !result.error_code && !mission && result.reason && (
        <Notice explained={{ code: 'GRAY', title: 'Sonuç belirsiz', publicText: result.reason, engineerText: result.reason, tone: 'warning' }} />
      )}

      {mission && engineer && (
        <>
          <TelemetryPanel entry={entry} horizon={horizon} mission={mission} />
          <p className="mono text-xs text-ink">{mission.explanations?.engineer ?? mission.reason}</p>
          {mission.status === 'GRAY' && mission.reason && (
            <Notice explained={{ code: mission.quality ? `HORIZON_${mission.quality.toUpperCase()}` : 'GRAY', title: 'Sınıflandırılamadı', publicText: mission.reason, engineerText: `${mission.reason} (quality=${mission.quality ?? '—'})`, tone: 'warning' }} />
          )}
          {mission.scenarios.length > 0 && <EngineerTable mission={mission} />}
          {(mission.unresolved?.length ?? 0) > 0 && (
            <section aria-label="Çözülemeyen durumlar" className="space-y-1.5">
              <h4 className="text-sm font-semibold text-ink">Belirsiz kalan kontroller</h4>
              {[...new Map((mission.unresolved ?? []).map((u) => [u.code, u])).values()].map((u) => <Notice key={u.code} explained={explainCode(u.code)} />)}
            </section>
          )}
        </>
      )}

      {mission && !engineer && (
        <>
          {mission.scenarios.length > 0 && <KpiCards mission={mission} entry={entry} />}
          {mission.scenarios.length > 0 ? <Story mission={mission} entry={entry} /> : (
            <p className="text-sm text-ink">{mission.explanations?.public ?? mission.label ?? mission.reason}</p>
          )}
          {mission.status === 'GRAY' && entry.input.uncertainty_mode === 'nominal' && (mission.nominal_violations?.length ?? 0) === 0 && !mission.reason && (
            <p className="rounded-md border border-unknown/40 bg-unknown/5 p-2 text-xs text-muted">
              Neden GRAY? “Nominal” mod tek başına “uygun” diyemez; arazi belirsizliği (ERR) senaryosu da sağlanmalı. Bu bilinçli bir kuraldır.
            </p>
          )}
          <PublicReasons mission={mission} />
          {(mission.unresolved?.length ?? 0) > 0 && (
            <section aria-label="Çözülemeyen durumlar" className="space-y-1.5">
              {[...new Map((mission.unresolved ?? []).map((u) => [u.code, u])).values()].map((u) => <Notice key={u.code} explained={explainCode(u.code)} compact />)}
            </section>
          )}
        </>
      )}

      <section aria-label="Konum bağlantıları" className="space-y-1">
        <h4 className="text-sm font-semibold text-ink">Konumu NASA/LROC araçlarında incele</h4>
        <SiteLinks lat={entry.input.latitude} lon={entry.input.longitude} />
      </section>

      {mission?.disclaimers && (
        <ul className="list-inside list-disc space-y-0.5 text-xs text-muted" aria-label="Sınırlamalar">
          {(engineer ? mission.disclaimers : PUBLIC_DISCLAIMERS).map((d) => <li key={d}>{d}</li>)}
          <li>Bu sonuç bir iniş sertifikası değildir.</li>
        </ul>
      )}
      {mission && <CopySummary entry={entry} />}
    </article>
  );
}
