import { explainCode, VIOLATION_TEXT } from '../api/errors';
import type { Horizon, Mission, Scenario, Violation } from '../api/types';
import { formatDeg, formatHours, formatLatLon, formatNumber, formatPercent, formatViolationValue, shortId } from '../lib/format';
import { baselineScenario, intervalUtc, validMetrics, violationInterval } from '../lib/result';
import { formatUtc } from '../lib/utc';
import { isActive, useApp, type AnalysisEntry } from '../state/AppState';
import { JobStatusLine } from './AnalysisList';
import { SiteLinks } from './SiteLinks';
import { CopySummary } from './CopySummary';
import { DecisionBadge, EmptyState, Icon, KeyValue, Notice } from './ui';

function ViolationRows({ scenario, mode, violations, variantName }: { scenario: Scenario; mode: 'public' | 'engineer'; violations: Violation[]; variantName: string }) {
  const metrics = validMetrics(scenario.variants[variantName as 'nominal' | 'cautious']);
  return (
    <>
      {violations.map((v, i) => {
        const span = metrics ? intervalUtc(scenario, violationInterval(v.code, metrics)) : null;
        const text = VIOLATION_TEXT[v.code];
        return (
          <li key={`${scenario.shift_hours}-${variantName}-${v.code}-${i}`} className="rounded-md border border-stop/40 bg-stop/5 p-2">
            <p className="font-medium text-ink">
              <Icon name="stop" className="mr-1 inline h-4 w-4 text-stop" />
              {mode === 'public' ? (text?.publicLabel ?? v.code) : `${v.code} · ${text?.label ?? ''}`}
              <span className="ml-2 text-xs text-muted">senaryo +{scenario.shift_hours} sa · {variantName === 'cautious' ? 'ihtiyatlı (ERR +k)' : 'nominal'}</span>
            </p>
            <p className="mono text-xs text-muted">
              gözlenen {formatViolationValue(v.observed, v.unit)} · sınır {formatViolationValue(v.limit, v.unit)} · fark {formatViolationValue(v.excess, v.unit)}
            </p>
            {span && <p className="mono text-xs text-muted">en uzun aralık: {formatUtc(span.start)} → {formatUtc(span.end)}</p>}
          </li>
        );
      })}
    </>
  );
}

function PublicAnswers({ scenario }: { scenario: Scenario }) {
  const m = validMetrics(scenario.variants.nominal);
  if (!m) return <p className="text-sm text-muted">Bu senaryoda Güneş/Dünya görünürlüğü hesaplanamadı (arazi verisi eksik). Değer gösterilmiyor.</p>;
  const dark = intervalUtc(scenario, m.darkness_interval);
  const gap = intervalUtc(scenario, m.dte_gap_interval);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-sun/40 bg-sun/5 p-3">
        <p className="flex items-center gap-2 font-semibold text-sun"><Icon name="sun" /> Bu bölgede Güneş ne kadar görünüyor?</p>
        <p className="mt-1 text-sm text-ink">
          Görev süresince Güneş diskinin ortalama <strong>{formatPercent(m.mean_sun_visible_fraction)}</strong>’i arazinin üzerinde görünüyor
          (%100 = disk tamamen açıkta).
        </p>
        <p className="mt-1 text-sm text-ink">
          En uzun kesintisiz karanlık: <strong>{formatHours(m.max_continuous_darkness_s)}</strong>
          {dark ? <> ({formatUtc(dark.start)} → {formatUtc(dark.end)})</> : ' (karanlık dönem yok)'}.
        </p>
        <p className="mt-1 text-xs text-muted">Bu, güneş panelinin ürettiği elektrik değildir; yalnızca geometrik görünürlüktür.</p>
      </div>
      <div className="rounded-lg border border-earth/40 bg-earth/5 p-3">
        <p className="flex items-center gap-2 font-semibold text-earth"><Icon name="earth" /> Dünya ile doğrudan görüş ne zaman kapanıyor?</p>
        <p className="mt-1 text-sm text-ink">Dünya’nın merkezi zamanın <strong>{formatPercent(m.dte_visible_fraction)}</strong>’inde arazi ufkunun üzerinde.</p>
        <p className="mt-1 text-sm text-ink">
          En uzun kesinti: <strong>{formatHours(m.max_continuous_dte_gap_s)}</strong>
          {gap ? <> ({formatUtc(gap.start)} → {formatUtc(gap.end)})</> : ' (kesinti yok)'}.
        </p>
        <p className="mt-1 text-xs text-muted">Bu geometrik görüş hattıdır; radyo bağlantısı veya veri hızı garantisi değildir.</p>
      </div>
    </div>
  );
}

function EngineerTable({ mission }: { mission: Mission }) {
  return (
    <div className="overflow-x-auto">
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
          {mission.scenarios.flatMap((s) =>
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

export function Provenance({ entry, horizon }: { entry: AnalysisEntry; horizon: Horizon | undefined }) {
  const i = entry.input;
  return (
    <KeyValue
      items={[
        ['Analiz kimliği', entry.id],
        ['Konum (ME, planetosentrik)', `${formatLatLon(i.latitude, i.longitude)} (${i.latitude}, ${i.longitude})`],
        ['Frame', 'MOON_ME_DE440_ME421 · R = 1737.4 km · radyal yerel düşey · azimut 0° = kuzey, 90° = doğu'],
        ['İniş (UTC)', formatUtc(i.landing_utc, true)],
        ['Görev / tampon / adım', `${i.duration_hours} sa / ${i.buffer_hours} sa / ${i.step_minutes} dk`],
        ['Gözlemci yükseklikleri', `panel ${i.sun_observer_height_m} m · DTE anten ${i.earth_observer_height_m} m (DEM üstü)`],
        ['Dataset (seçili)', horizon ? `${horizon.selected_dataset_id}` : i.dataset_id],
        ['DEM kaynakları', horizon ? Object.entries(horizon.sources).map(([k, v]) => `${k}: ${v}`).join(' · ') : 'ufuk yok'],
        ['Gözlemci DEM yüksekliği', horizon ? `${formatNumber(horizon.geometry.observer_dem_m, 1, 'm')}${horizon.geometry.observer_err_m !== null ? ` · ERR σ ${formatNumber(horizon.geometry.observer_err_m, 2, 'm')}` : ''}` : '—'],
        ['Ufuk', horizon ? `${horizon.reference_radius_km} km · ${horizon.azimuth_deg.length} azimut (0.1°) · durum ${horizon.status}` : '—'],
        ['Belirsizlik', horizon ? `${horizon.uncertainty_mode}${horizon.k !== null ? ` · k = ${horizon.k}` : ''} (ERR ±k duyarlılık senaryosu; güven aralığı değil)` : i.uncertainty_mode],
        ['Önbellek anahtarı', horizon?.cache_key ?? '—'],
        ['Efemeris', 'NAIF SPICE spkcpo · LT+S · DE440s · UTC→ET (naif0012.tls)'],
      ]}
    />
  );
}

export function ResultSummary({ entry }: { entry: AnalysisEntry | null }) {
  const { mode } = useApp();
  if (!entry) return <EmptyState title="Analiz seçilmedi">Listeden bir analiz seçin.</EmptyState>;
  const job = entry.job;
  const result = job?.result ?? null;
  const mission = result?.mission;
  const baseline = baselineScenario(mission);

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
          {mode === 'engineer' && result.reason && <p className="mono text-xs text-muted">reason: {result.reason}</p>}
        </Notice>
      )}
      {result && !result.error_code && !mission && result.reason && (
        <Notice explained={{ code: 'GRAY', title: 'Sonuç belirsiz', publicText: result.reason, engineerText: result.reason, tone: 'warning' }} />
      )}

      {mission && (
        <>
          <p className="text-sm text-ink">{mode === 'public' ? (mission.explanations?.public ?? mission.label ?? mission.reason) : (mission.explanations?.engineer ?? mission.reason)}</p>
          {mission.status === 'GRAY' && mission.reason && <Notice explained={{ code: mission.quality ? `HORIZON_${mission.quality.toUpperCase()}` : 'GRAY', title: 'Sınıflandırılamadı', publicText: mission.reason, engineerText: `${mission.reason} (quality=${mission.quality ?? '—'})`, tone: 'warning' }} />}
          {mission.status === 'GRAY' && entry.input.uncertainty_mode === 'nominal' && (mission.nominal_violations?.length ?? 0) === 0 && !mission.reason && (
            <p className="rounded-md border border-unknown/40 bg-unknown/5 p-2 text-xs text-muted">
              Nominal mod tek başına GREEN üretemez: arazi belirsizliği (ERR) senaryosu olmadan “uygun” denmez. Bu bilinçli bir kuraldır.
            </p>
          )}
          {baseline && mode === 'public' && <PublicAnswers scenario={baseline} />}
          {mode === 'engineer' && mission.scenarios.length > 0 && <EngineerTable mission={mission} />}

          {(mission.nominal_violations?.length ?? 0) + (mission.cautious_violations?.length ?? 0) > 0 && (
            <section aria-label="Kısıt ihlalleri">
              <h4 className="mb-1 text-sm font-semibold text-ink">Kısıt ihlalleri</h4>
              <ul className="space-y-1.5 text-sm">
                {mission.scenarios.map((s) => (
                  <ViolationRows key={`n${s.shift_hours}`} scenario={s} mode={mode} variantName="nominal" violations={s.variants.nominal?.violations ?? []} />
                ))}
                {mission.scenarios.map((s) => (
                  <ViolationRows key={`c${s.shift_hours}`} scenario={s} mode={mode} variantName="cautious" violations={s.variants.cautious?.violations ?? []} />
                ))}
              </ul>
            </section>
          )}
          {(mission.unresolved?.length ?? 0) > 0 && (
            <section aria-label="Çözülemeyen durumlar" className="space-y-1.5">
              <h4 className="text-sm font-semibold text-ink">Belirsiz kalan kontroller</h4>
              {[...new Map((mission.unresolved ?? []).map((u) => [u.code, u])).values()].map((u) => (
                <Notice key={u.code} explained={explainCode(u.code)} compact={mode === 'public'} />
              ))}
            </section>
          )}
          {mission.slope && mode === 'engineer' && (
            <p className="mono text-xs text-muted">
              Eğim: {mission.slope.slope_max_deg === null ? `bilinmiyor (${mission.slope.status})` : `maks ${formatDeg(mission.slope.slope_max_deg, 1)} · ort ${formatDeg(mission.slope.slope_mean_deg, 1)} · ${mission.slope.source} · ${mission.slope.status}`}
            </p>
          )}
        </>
      )}

      <section aria-label="Konum bağlantıları" className="space-y-1">
        <h4 className="text-sm font-semibold text-ink">Konumu NASA/LROC araçlarında incele</h4>
        <SiteLinks lat={entry.input.latitude} lon={entry.input.longitude} />
      </section>

      {mode === 'engineer' && (
        <details className="rounded-lg border border-line bg-panel-2 p-3" open>
          <summary className="cursor-pointer text-sm font-semibold">Veri kaynağı ve izlenebilirlik</summary>
          <div className="mt-2"><Provenance entry={entry} horizon={result?.horizon} /></div>
        </details>
      )}

      {mission?.disclaimers && (
        <ul className="list-inside list-disc space-y-0.5 text-xs text-muted" aria-label="Sınırlamalar">
          {mission.disclaimers.map((d) => <li key={d}>{d}</li>)}
          <li>Bu sonuç bir iniş sertifikası değildir.</li>
        </ul>
      )}
      {mission && <CopySummary entry={entry} />}
    </article>
  );
}
