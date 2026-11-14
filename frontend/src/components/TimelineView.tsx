import { useId, useMemo, useState } from 'react';
import { api } from '../api/client';
import { explainError, VIOLATION_TEXT } from '../api/errors';
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2 p-2 text-sm" role="group" aria-label="Ham veri dışa aktarma">
      <span className="font-medium text-ink">Ham veri (senaryo +{current.scenario.shift_hours} sa, {current.scenario.timeline.length} örnek):</span>
      <button type="button" className="btn" onClick={() => download(`${base}.json`, json(), 'application/json')}>JSON indir</button>
      <button type="button" className="btn" onClick={() => download(`${base}.csv`, timelineToCsv(current.scenario.timeline, { ...meta, exported_utc: new Date().toISOString() }), 'text/csv')}>CSV indir</button>
      <span className="text-xs text-muted">Yalnız API değerleri; türetilmiş/enterpole sütun yok.</span>
    </div>
  );
}

const SHIFT_CHOICES = [0, 6, 12, 24, 48, 72, 96, 120, 168];

function ShiftRequest({ data }: { data: AnalysisData }) {
  const { register, select } = useApp();
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
      <h3 id={`${uid}-t`} className="text-sm font-semibold text-ink">Farklı iniş kayması senaryoları iste (/scenarios/shift)</h3>
      <p className="text-xs text-muted">Aynı ufuk yeniden kullanılır, yalnız Güneş/Dünya zaman serisi yeniden hesaplanır. Orijinal analiz silinmez; yeni sonuç ayrı bir analiz olarak listelenir.</p>
      <fieldset>
        <legend className="sr-only">Kayma saatleri (en fazla 5)</legend>
        <div className="flex flex-wrap gap-2">
          {SHIFT_CHOICES.map((s) => (
            <label key={s} className={`chip cursor-pointer px-3 py-1.5 text-sm ${shifts.includes(s) ? 'border-accent bg-accent/15 text-accent' : 'border-line text-ink'}`}>
              <input type="checkbox" checked={shifts.includes(s)} onChange={() => toggle(s)} disabled={!shifts.includes(s) && shifts.length >= 5} />
              +{s} sa
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={busy || shifts.length === 0 || !canShift} onClick={() => void submit()}>
          {busy ? <><Icon name="spinner" /> Gönderiliyor…</> : 'Kayma senaryolarını hesapla'}
        </button>
        {queued && (
          <button type="button" className="btn" onClick={() => select(queued)}>Yeni analizi göster ({shortId(queued)})</button>
        )}
      </div>
      {!canShift && <p className="text-xs text-caution">Bu analizin yeniden kullanılabilir ufku yok; kayma hesaplanamaz.</p>}
      {error !== null && <Notice explained={explainError(error)} />}
    </section>
  );
}

function TimelinePanel({ data }: { data: AnalysisData }) {
  const { mode } = useApp();
  const cursor = useCursor();
  const current = useCurrentPoint(data);
  const metrics = scenarioMetrics(current?.missionScenario ?? null);
  const threshold = data.entry.input.dark_fraction_threshold;

  const fig = useMemo(() => current ? buildTimelineFigure({ timeline: current.scenario.timeline, index: current.index, metrics, darkThreshold: threshold }) : null,
    [current, metrics, threshold]);
  const elev = useMemo(() => (current && data.horizon && mode === 'engineer') ? buildElevationFigure(current.scenario.timeline, data.horizon, current.index) : null,
    [current, data.horizon, mode]);
  if (!current || !fig) return null;

  const onClick = (event: { points?: { customdata?: unknown }[] }) => {
    const original = event.points?.[0]?.customdata;
    if (typeof original === 'number') cursor.setIndex(data.entry.id, current.scenario.shift_hours, original);
  };
  const ms = current.missionScenario;
  const dark = ms && metrics ? intervalUtc(ms, metrics.darkness_interval) : null;
  const gap = ms && metrics ? intervalUtc(ms, metrics.dte_gap_interval) : null;
  const violations = [
    ...(ms?.variants.nominal?.violations ?? []).map((v) => ({ ...v, variant: 'nominal' })),
    ...(ms?.variants.cautious?.violations ?? []).map((v) => ({ ...v, variant: 'ihtiyatlı' })),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        {mode === 'engineer' && <ExportBar data={data} />}
        {elev && (
          <section className="space-y-1 rounded-lg border border-accent/40 bg-accent/5 p-2" aria-labelledby="elev-title">
            <h3 id="elev-title" className="px-1 text-sm font-semibold text-accent">Güneş / Dünya açısal yüksekliği ve gövde azimutundaki arazi ufku</h3>
            <Chart data={elev.data} layout={elev.layout} height={320} ariaLabel="Güneş ve Dünya yüksekliği ile o azimuttaki ufuk yüksekliği" />
            <p className="px-1 text-xs text-muted">Kesikli ufuk eğrileri görüntüleme amaçlı enterpolasyondur; f_sun disk integrasyonu ve DTE kararı sunucuda yapılır.</p>
          </section>
        )}
        <Chart data={fig.data} layout={fig.layout} height={mode === 'engineer' ? 380 : 440} onClick={onClick}
          ariaLabel={`Senaryo +${current.scenario.shift_hours} saat için Güneş diski görünürlüğü ve geometrik Dünya görüşü zaman çizelgesi`} />
        <p className="text-xs text-muted">
          {mode === 'engineer'
            ? <>Grafiğe tıklayarak zaman seçilir. Kırmızı gölge: en uzun kesintisiz karanlık / DTE kesintisi (sunucu aralıkları). Geçişler Δt = {data.entry.input.step_minutes} dk içinde belirsizdir.</>
            : <>Sarı alan Güneş’in ne kadarının göründüğünü, mavi alan Dünya’nın görünüp görünmediğini gösterir. Grafiğe tıklayarak bir ana gidebilirsiniz; kırmızı gölge en uzun karanlık ve en uzun Dünya kesintisidir.</>}
          {fig.decimated && ` Görselleştirme için ${fig.indices.length} noktaya seyreltildi (uç değerler korunur); hesap tüm ${current.scenario.timeline.length} örnekle yapılmıştır.`}
        </p>
        <ShiftRequest data={data} />
      </div>
      <aside className="space-y-3">
        <Scrubber data={data} />
        <div className="space-y-2 rounded-lg border border-line bg-panel-2 p-3 text-sm">
          <h3 className="font-semibold text-ink">Senaryo +{current.scenario.shift_hours} sa özeti</h3>
          {metrics ? (
            <ul className="space-y-1">
              <li>Ortalama Güneş diski görünürlüğü: <strong>{formatPercent(metrics.mean_sun_visible_fraction, 1)}</strong></li>
              <li>En uzun karanlık: <strong>{formatHours(metrics.max_continuous_darkness_s, 2)}</strong>{dark && mode === 'engineer' && <span className="mono block text-xs text-muted">{formatUtc(dark.start)} → {formatUtc(dark.end)}</span>}</li>
              <li>DTE payı: <strong>{formatPercent(metrics.dte_visible_fraction, 1)}</strong></li>
              <li>En uzun DTE kesintisi: <strong>{formatHours(metrics.max_continuous_dte_gap_s, 2)}</strong>{gap && mode === 'engineer' && <span className="mono block text-xs text-muted">{formatUtc(gap.start)} → {formatUtc(gap.end)}</span>}</li>
            </ul>
          ) : (
            <p className="text-muted">Bu senaryo için geçerli metrik yok (bilinmiyor).</p>
          )}
          {violations.length > 0 && (
            <div>
              <p className="mt-2 font-medium text-stop">Kısıt ihlalleri</p>
              <ul className="space-y-1 text-xs">
                {violations.map((v, i) => (
                  <li key={i}>
                    <Icon name="stop" className="mr-1 inline h-3.5 w-3.5 text-stop" />
                    {mode === 'engineer' ? `${v.code} (${v.variant}): ${formatViolationValue(v.observed, v.unit)} ${v.code.startsWith('MIN_') ? '<' : '>'} sınır ${formatViolationValue(v.limit, v.unit)}` : (VIOLATION_TEXT[v.code]?.publicLabel ?? v.code)}
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
  const data = useAnalysisData(selected);
  return (
    <div className="panel space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="panel-title">Aydınlanma ve DTE zaman çizelgesi</h2>
        <AnalysisPicker />
      </div>
      <AnalysisGate data={data} need="timeline">
        {data && <TimelinePanel data={data} />}
      </AnalysisGate>
    </div>
  );
}
