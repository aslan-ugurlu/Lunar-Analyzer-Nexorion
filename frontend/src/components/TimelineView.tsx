import { useId, useMemo, useState } from 'react';
import { api } from '../api/client';
import { explainError, violationText } from '../api/errors';
import { formatHours, formatPercent, formatViolationValue, shortId } from '../lib/format';
import { intervalUtc } from '../lib/result';
import { buildElevationFigure, buildTimelineFigure, scenarioMetrics } from '../lib/timelineFigure';
import { formatUtc } from '../lib/utc';
import { useCursor } from '../state/Cursor';
import { useApp } from '../state/AppState';
import { AnalysisGate, AnalysisPicker, Scrubber, useAnalysisData, useCurrentPoint, type AnalysisData } from './AnalysisView';
import { Chart } from './Plot';
import { Icon, Notice } from './ui';
import { exportMeta, timelineToCsv } from '../lib/telemetry';
import { defineStrings, useLang, useStrings } from '../i18n';

const STR = defineStrings({
  en: {
    exportLabel: 'Raw data export',
    rawData: (shift: number, n: number) => `Raw data (scenario +${shift} h, ${n} samples):`,
    downloadJson: 'Download JSON',
    downloadCsv: 'Download CSV',
    apiOnly: 'API values only; no derived/interpolated columns.',
    shiftTitle: 'Request other landing-slip scenarios (/scenarios/shift)',
    shiftHelp: 'The same horizon is reused; only the Sun/Earth time series is recomputed. The original analysis is kept; the new result is listed as a separate analysis.',
    shiftLegend: 'Slip hours (up to 5)',
    shiftChip: (hours: number) => `+${hours} h`,
    sending: 'Sending…',
    computeShifts: 'Compute slip scenarios',
    showNew: (id: string) => `Show the new analysis (${id})`,
    noHorizon: 'This analysis has no reusable horizon; slips cannot be computed.',
    variant: { nominal: 'nominal', cautious: 'conservative' },
    elevTitle: 'Sun / Earth elevation and the terrain horizon at each body’s azimuth',
    elevLabel: 'Sun and Earth elevation with the horizon elevation at that azimuth',
    elevNote: 'The dashed horizon curves are interpolated for display; the f_sun disk integration and the DTE decision are done on the server.',
    chartLabel: (shift: number) => `Timeline of Sun-disk visibility and geometric Earth line of sight for scenario +${shift} hours`,
    engineerNote: (step: number) =>
      `Click the chart to select a time. Red shading: longest continuous darkness / DTE outage (server intervals). Transitions are uncertain within Δt = ${step} min.`,
    publicNote: 'The yellow area shows how much of the Sun is visible; the blue area shows whether Earth is visible. ' +
      'Click the chart to jump to a moment; red shading marks the longest darkness and the longest Earth outage.',
    decimated: (n: number, total: number) => ` Thinned to ${n} points for display (extremes kept); the calculation used all ${total} samples.`,
    summary: (shift: number) => `Scenario +${shift} h summary`,
    meanSun: 'Mean Sun-disk visibility:',
    longestDark: 'Longest darkness:',
    dteShare: 'DTE share:',
    longestGap: 'Longest DTE outage:',
    noMetrics: 'No valid metrics for this scenario (unknown).',
    violations: 'Constraint violations',
    violationLine: (code: string, variant: string, observed: string, op: string, limit: string) => `${code} (${variant}): ${observed} ${op} limit ${limit}`,
    title: 'Illumination and DTE timeline',
  },
  tr: {
    exportLabel: 'Ham veri dışa aktarma',
    rawData: (shift: number, n: number) => `Ham veri (senaryo +${shift} sa, ${n} örnek):`,
    downloadJson: 'JSON indir',
    downloadCsv: 'CSV indir',
    apiOnly: 'Yalnız API değerleri; türetilmiş/enterpole sütun yok.',
    shiftTitle: 'Farklı iniş kayması senaryoları iste (/scenarios/shift)',
    shiftHelp: 'Aynı ufuk yeniden kullanılır, yalnız Güneş/Dünya zaman serisi yeniden hesaplanır. Orijinal analiz silinmez; yeni sonuç ayrı bir analiz olarak listelenir.',
    shiftLegend: 'Kayma saatleri (en fazla 5)',
    shiftChip: (hours: number) => `+${hours} sa`,
    sending: 'Gönderiliyor…',
    computeShifts: 'Kayma senaryolarını hesapla',
    showNew: (id: string) => `Yeni analizi göster (${id})`,
    noHorizon: 'Bu analizin yeniden kullanılabilir ufku yok; kayma hesaplanamaz.',
    variant: { nominal: 'nominal', cautious: 'ihtiyatlı' },
    elevTitle: 'Güneş / Dünya açısal yüksekliği ve gövde azimutundaki arazi ufku',
    elevLabel: 'Güneş ve Dünya yüksekliği ile o azimuttaki ufuk yüksekliği',
    elevNote: 'Kesikli ufuk eğrileri görüntüleme amaçlı enterpolasyondur; f_sun disk integrasyonu ve DTE kararı sunucuda yapılır.',
    chartLabel: (shift: number) => `Senaryo +${shift} saat için Güneş diski görünürlüğü ve geometrik Dünya görüşü zaman çizelgesi`,
    engineerNote: (step: number) =>
      `Grafiğe tıklayarak zaman seçilir. Kırmızı gölge: en uzun kesintisiz karanlık / DTE kesintisi (sunucu aralıkları). Geçişler Δt = ${step} dk içinde belirsizdir.`,
    publicNote: 'Sarı alan Güneş’in ne kadarının göründüğünü, mavi alan Dünya’nın görünüp görünmediğini gösterir. ' +
      'Grafiğe tıklayarak bir ana gidebilirsiniz; kırmızı gölge en uzun karanlık ve en uzun Dünya kesintisidir.',
    decimated: (n: number, total: number) => ` Görselleştirme için ${n} noktaya seyreltildi (uç değerler korunur); hesap tüm ${total} örnekle yapılmıştır.`,
    summary: (shift: number) => `Senaryo +${shift} sa özeti`,
    meanSun: 'Ortalama Güneş diski görünürlüğü:',
    longestDark: 'En uzun karanlık:',
    dteShare: 'DTE payı:',
    longestGap: 'En uzun DTE kesintisi:',
    noMetrics: 'Bu senaryo için geçerli metrik yok (bilinmiyor).',
    violations: 'Kısıt ihlalleri',
    violationLine: (code: string, variant: string, observed: string, op: string, limit: string) => `${code} (${variant}): ${observed} ${op} sınır ${limit}`,
    title: 'Aydınlanma ve DTE zaman çizelgesi',
  },
});

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Engineer: export the RAW API timeline of the shown scenario (no derived values). */
export function ExportBar({ data }: { data: AnalysisData }) {
  const t = useStrings(STR);
  const current = useCurrentPoint(data);
  if (!current) return null;
  const meta = exportMeta(data.entry.id, data.entry.input, current.scenario, data.horizon);
  const base = `lmwa_${data.entry.id.slice(0, 8)}_shift${current.scenario.shift_hours}h`;
  const json = () => JSON.stringify({
    meta: { ...meta, exported_utc: new Date().toISOString() },
    request: data.entry.input,
    scenario: { shift_hours: current.scenario.shift_hours, start_utc: current.scenario.start_utc, end_utc: current.scenario.end_utc },
    variants: current.missionScenario?.variants ?? null,
    timeline: current.scenario.timeline,
  }, null, 2);
  return (
    <div className="term flex flex-wrap items-center gap-2 rounded-xl p-2 text-xs" role="group" aria-label={t.exportLabel}>
      <span className="font-medium text-ink">{t.rawData(current.scenario.shift_hours, current.scenario.timeline.length)}</span>
      <button type="button" className="btn" onClick={() => download(`${base}.json`, json(), 'application/json')}>{t.downloadJson}</button>
      <button type="button" className="btn" onClick={() => download(`${base}.csv`, timelineToCsv(current.scenario.timeline, { ...meta, exported_utc: new Date().toISOString() }), 'text/csv')}>{t.downloadCsv}</button>
      <span className="text-xs text-muted">{t.apiOnly}</span>
    </div>
  );
}

const SHIFT_CHOICES = [0, 6, 12, 24, 48, 72, 96, 120, 168];

function ShiftRequest({ data }: { data: AnalysisData }) {
  const { register, select } = useApp();
  const t = useStrings(STR);
  const uid = useId();
  const [shifts, setShifts] = useState<number[]>([0, 24, 48, 72]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const toggle = (s: number) => setShifts((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s].sort((a, b) => a - b)));
  const parent = data.entry;
  const canShift = Boolean(parent.job?.result?.horizon);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const q = await api.shift(parent.id, shifts);
      register(q.analysis_id, { ...parent.input, shifts_hours: shifts }, 'shift', parent.id);
      setQueued(q.analysis_id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-line bg-panel-2 p-3" aria-labelledby={`${uid}-t`}>
      <h3 id={`${uid}-t`} className="text-sm font-semibold text-ink">{t.shiftTitle}</h3>
      <p className="text-xs text-muted">{t.shiftHelp}</p>
      <fieldset>
        <legend className="sr-only">{t.shiftLegend}</legend>
        <div className="flex flex-wrap gap-2">
          {SHIFT_CHOICES.map((s) => (
            <label key={s} className={`chip cursor-pointer px-3 py-1.5 text-sm ${shifts.includes(s) ? 'border-accent bg-accent/15 text-accent' : 'border-line text-ink'}`}>
              <input type="checkbox" checked={shifts.includes(s)} onChange={() => toggle(s)} disabled={!shifts.includes(s) && shifts.length >= 5} />
              {t.shiftChip(s)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={busy || shifts.length === 0 || !canShift} onClick={() => void submit()}>
          {busy ? <><Icon name="spinner" /> {t.sending}</> : t.computeShifts}
        </button>
        {queued && (
          <button type="button" className="btn" onClick={() => select(queued)}>{t.showNew(shortId(queued))}</button>
        )}
      </div>
      {!canShift && <p className="text-xs text-caution">{t.noHorizon}</p>}
      {error !== null && <Notice explained={explainError(error)} />}
    </section>
  );
}

function TimelinePanel({ data }: { data: AnalysisData }) {
  const { mode } = useApp();
  const { lang } = useLang();
  const t = useStrings(STR);
  const cursor = useCursor();
  const current = useCurrentPoint(data);
  const metrics = scenarioMetrics(current?.missionScenario ?? null);
  const threshold = data.entry.input.dark_fraction_threshold;

  const fig = useMemo(() => current ? buildTimelineFigure({ timeline: current.scenario.timeline, index: current.index, metrics, darkThreshold: threshold, lang }) : null,
    [current, metrics, threshold, lang]);
  const elev = useMemo(() => (current && data.horizon && mode === 'engineer') ? buildElevationFigure(current.scenario.timeline, data.horizon, current.index, lang) : null,
    [current, data.horizon, mode, lang]);
  if (!current || !fig) return null;

  const onClick = (event: { points?: { customdata?: unknown }[] }) => {
    const original = event.points?.[0]?.customdata;
    if (typeof original === 'number') cursor.setIndex(data.entry.id, current.scenario.shift_hours, original);
  };
  const ms = current.missionScenario;
  const dark = ms && metrics ? intervalUtc(ms, metrics.darkness_interval) : null;
  const gap = ms && metrics ? intervalUtc(ms, metrics.dte_gap_interval) : null;
  const violations = [
    ...(ms?.variants.nominal?.violations ?? []).map((v) => ({ ...v, variant: t.variant.nominal })),
    ...(ms?.variants.cautious?.violations ?? []).map((v) => ({ ...v, variant: t.variant.cautious })),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        {mode === 'engineer' && <ExportBar data={data} />}
        {elev && (
          <section className="term space-y-1 rounded-xl p-2" aria-labelledby="elev-title">
            <h3 id="elev-title" className="module-title px-1 !mb-1">{t.elevTitle}</h3>
            <Chart data={elev.data} layout={elev.layout} height={320} ariaLabel={t.elevLabel} />
            <p className="px-1 text-xs text-muted">{t.elevNote}</p>
          </section>
        )}
        <Chart data={fig.data} layout={fig.layout} height={mode === 'engineer' ? 380 : 440} onClick={onClick}
          ariaLabel={t.chartLabel(current.scenario.shift_hours)} />
        <p className="text-xs text-muted">
          {mode === 'engineer' ? t.engineerNote(data.entry.input.step_minutes) : t.publicNote}
          {fig.decimated && t.decimated(fig.indices.length, current.scenario.timeline.length)}
        </p>
        <ShiftRequest data={data} />
      </div>
      <aside className="space-y-3">
        <Scrubber data={data} />
        <div className="space-y-2 rounded-lg border border-line bg-panel-2 p-3 text-sm">
          <h3 className="font-semibold text-ink">{t.summary(current.scenario.shift_hours)}</h3>
          {metrics ? (
            <ul className="space-y-1">
              <li>{t.meanSun} <strong>{formatPercent(metrics.mean_sun_visible_fraction, 1)}</strong></li>
              <li>{t.longestDark} <strong>{formatHours(metrics.max_continuous_darkness_s, 2)}</strong>{dark && mode === 'engineer' && <span className="mono block text-xs text-muted">{formatUtc(dark.start)} → {formatUtc(dark.end)}</span>}</li>
              <li>{t.dteShare} <strong>{formatPercent(metrics.dte_visible_fraction, 1)}</strong></li>
              <li>{t.longestGap} <strong>{formatHours(metrics.max_continuous_dte_gap_s, 2)}</strong>{gap && mode === 'engineer' && <span className="mono block text-xs text-muted">{formatUtc(gap.start)} → {formatUtc(gap.end)}</span>}</li>
            </ul>
          ) : (
            <p className="text-muted">{t.noMetrics}</p>
          )}
          {violations.length > 0 && (
            <div>
              <p className="mt-2 font-medium text-stop">{t.violations}</p>
              <ul className="space-y-1 text-xs">
                {violations.map((v, i) => (
                  <li key={i}>
                    <Icon name="stop" className="mr-1 inline h-3.5 w-3.5 text-stop" />
                    {mode === 'engineer'
                      ? t.violationLine(v.code, v.variant, formatViolationValue(v.observed, v.unit), v.code.startsWith('MIN_') ? '<' : '>', formatViolationValue(v.limit, v.unit))
                      : (violationText(v.code)?.publicLabel ?? v.code)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export function TimelineView() {
  const { selected } = useApp();
  const t = useStrings(STR);
  const data = useAnalysisData(selected);
  return (
    <div className="panel space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="panel-title">{t.title}</h2>
        <AnalysisPicker />
      </div>
      <AnalysisGate data={data} need="timeline">
        {data && <TimelinePanel data={data} />}
      </AnalysisGate>
    </div>
  );
}
