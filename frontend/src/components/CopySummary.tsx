import { useState } from 'react';
import { defineStrings, pick, useStrings } from '../i18n';
import { missionLabel } from '../lib/decisionText';
import { formatHours, formatLatLon, formatPercent, formatViolationValue } from '../lib/format';
import { quickMapUrl, moonTrekUrl } from '../lib/deeplinks';
import { baselineScenario, validMetrics } from '../lib/result';
import { formatUtc } from '../lib/utc';
import type { AnalysisEntry } from '../state/AppState';
import { Icon } from './ui';

const STR = defineStrings({
  en: {
    title: 'Lunar Mission Window Analyzer — screening summary (not a landing certification)',
    analysis: (id: string) => `Analysis: ${id}`,
    location: (place: string, lat: number, lon: number) => `Location (Moon ME, planetocentric, east-positive): ${place} [${lat}, ${lon}]`,
    landing: (utc: string, duration: number, buffer: number, step: number) =>
      `Landing: ${utc} · mission ${duration} h + buffer ${buffer} h · step ${step} min`,
    observer: (panel: number, antenna: number, radius: number, mode: string) =>
      `Observer: panel ${panel} m, DTE antenna ${antenna} m · horizon ${radius} km · uncertainty ${mode}`,
    decision: (status: string, label: string) => `Decision: ${status}${label ? ` — ${label}` : ''}`,
    none: 'none',
    scenario: (shift: number, sun: string, dark: string, dte: string, gap: string) =>
      `  +${shift} h (nominal): mean Sun disk ${sun}, max darkness ${dark}, DTE ${dte}, max DTE outage ${gap}`,
    scenarioInvalid: (shift: number) => `  +${shift} h: visibility could not be computed`,
    violation: (code: string, variant: string, observed: string, limit: string) =>
      `    VIOLATION ${code} (${variant}): observed ${observed} / limit ${limit}`,
    unresolved: (code: string) => `  UNRESOLVED: ${code}`,
    radius: (code: string, r: number, ref: number, before: string, after: string) =>
      `  WARNING ${code}: horizon ${r} km < ${ref} km reference; decision ${before} → ${after}`,
    radiusCapped: ' (GREEN cap; GREEN requires a 200 km analysis)',
    statusCode: (code: string) => `Status code: ${code}`,
    dem: (sources: string, status: string, cache: string) => `DEM: ${sources} · horizon status ${status} · cache ${cache}`,
    sources: 'Sources: NASA GSFC PGDA LOLA (Barker et al. 2023), NASA/JPL NAIF SPICE (DE440s, MOON_ME_DE440_ME421).',
    moonTrek: (url: string) => `NASA Moon Trek (centring not reliable): ${url}`,
    note: (d: string) => `Note: ${d}`,
    resolution: (minutes: number | string) =>
      `Time resolution: ${minutes} min (transition moments are uncertain within the sampling step).`,
    copy: 'Copy summary',
    copied: 'Copied to clipboard.',
    textareaLabel: 'Copyable summary',
  },
  tr: {
    title: 'Lunar Mission Window Analyzer — ön eleme özeti (iniş sertifikası değildir)',
    analysis: (id: string) => `Analiz: ${id}`,
    location: (place: string, lat: number, lon: number) => `Konum (Moon ME, planetosentrik, doğu-pozitif): ${place} [${lat}, ${lon}]`,
    landing: (utc: string, duration: number, buffer: number, step: number) =>
      `İniş: ${utc} · görev ${duration} sa + tampon ${buffer} sa · adım ${step} dk`,
    observer: (panel: number, antenna: number, radius: number, mode: string) =>
      `Gözlemci: panel ${panel} m, DTE anten ${antenna} m · ufuk ${radius} km · belirsizlik ${mode}`,
    decision: (status: string, label: string) => `Karar: ${status}${label ? ` — ${label}` : ''}`,
    none: 'yok',
    scenario: (shift: number, sun: string, dark: string, dte: string, gap: string) =>
      `  +${shift} sa (nominal): ort. Güneş diski ${sun}, maks. karanlık ${dark}, DTE ${dte}, maks. DTE kesintisi ${gap}`,
    scenarioInvalid: (shift: number) => `  +${shift} sa: görünürlük hesaplanamadı`,
    violation: (code: string, variant: string, observed: string, limit: string) =>
      `    İHLAL ${code} (${variant}): gözlenen ${observed} / sınır ${limit}`,
    unresolved: (code: string) => `  BELİRSİZ: ${code}`,
    radius: (code: string, r: number, ref: number, before: string, after: string) =>
      `  UYARI ${code}: ufuk ${r} km < ${ref} km referans; karar ${before} → ${after}`,
    radiusCapped: ' (GREEN tavanı; GREEN için 200 km analizi gerekli)',
    statusCode: (code: string) => `Durum kodu: ${code}`,
    dem: (sources: string, status: string, cache: string) => `DEM: ${sources} · ufuk durumu ${status} · cache ${cache}`,
    sources: 'Kaynaklar: NASA GSFC PGDA LOLA (Barker vd. 2023), NASA/JPL NAIF SPICE (DE440s, MOON_ME_DE440_ME421).',
    moonTrek: (url: string) => `NASA Moon Trek (odaklanma güvenilir değil): ${url}`,
    note: (d: string) => `Not: ${d}`,
    resolution: (minutes: number | string) =>
      `Zaman çözünürlüğü: ${minutes} dk (geçiş anları örnekleme adımı içinde belirsiz).`,
    copy: 'Özeti kopyala',
    copied: 'Panoya kopyalandı.',
    textareaLabel: 'Kopyalanabilir özet',
  },
});

/**
 * Plain-text, copy-pasteable report built ONLY from the server's result (no re-scoring), in the
 * current interface language. The decision label is rebuilt from the structured result fields.
 */
export function buildSummaryText(entry: AnalysisEntry): string {
  const s = pick(STR);
  const i = entry.input;
  const mission = entry.job?.result?.mission;
  const horizon = entry.job?.result?.horizon;
  const lines = [
    s.title,
    s.analysis(entry.id),
    s.location(formatLatLon(i.latitude, i.longitude), i.latitude, i.longitude),
    s.landing(formatUtc(i.landing_utc), i.duration_hours, i.buffer_hours, i.step_minutes),
    s.observer(i.sun_observer_height_m, i.earth_observer_height_m, i.horizon_radius_km, i.uncertainty_mode),
    s.decision(mission?.status ?? entry.job?.result?.status ?? s.none, mission?.label ? missionLabel(mission, i.uncertainty_mode) : ''),
  ];
  for (const sc of mission?.scenarios ?? []) {
    const m = validMetrics(sc.variants.nominal);
    lines.push(m
      ? s.scenario(sc.shift_hours, formatPercent(m.mean_sun_visible_fraction, 1), formatHours(m.max_continuous_darkness_s, 2),
        formatPercent(m.dte_visible_fraction, 1), formatHours(m.max_continuous_dte_gap_s, 2))
      : s.scenarioInvalid(sc.shift_hours));
    for (const [name, v] of Object.entries(sc.variants)) {
      for (const viol of v?.violations ?? []) {
        lines.push(s.violation(viol.code, name, formatViolationValue(viol.observed, viol.unit), formatViolationValue(viol.limit, viol.unit)));
      }
    }
  }
  for (const u of mission?.unresolved ?? []) lines.push(s.unresolved(u.code));
  const rp = mission?.radius_policy;
  if (rp?.below_reference) {
    lines.push(s.radius(rp.code, rp.radius_km, rp.reference_radius_km, rp.status_before_policy, rp.status_after_policy) +
      (rp.capped ? s.radiusCapped : ''));
  }
  if (entry.job?.result?.error_code) lines.push(s.statusCode(entry.job.result.error_code));
  if (horizon) lines.push(s.dem(Object.values(horizon.sources).join(', '), horizon.status, horizon.cache_key.slice(0, 12)));
  lines.push(s.sources);
  const qm = quickMapUrl(i.latitude, i.longitude);
  const trek = moonTrekUrl(i.latitude, i.longitude);
  if (qm) lines.push(`LROC QuickMap: ${qm}`);
  if (trek) lines.push(s.moonTrek(trek));
  lines.push(...(mission?.disclaimers ?? []).map((d) => s.note(d)));
  const baseline = baselineScenario(mission);
  if (baseline) lines.push(s.resolution(validMetrics(baseline.variants.nominal)?.time_resolution_minutes ?? '—'));
  return lines.join('\n');
}

export function CopySummary({ entry }: { entry: AnalysisEntry }) {
  const s = useStrings(STR);
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const text = buildSummaryText(entry);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('manual');
    }
  };
  return (
    <div className="space-y-2">
      <button type="button" className="btn" onClick={() => void copy()}>
        <Icon name="copy" /> {s.copy}
      </button>
      <span role="status" className="ml-2 text-xs text-go">{state === 'copied' ? s.copied : ''}</span>
      {state === 'manual' && (
        <textarea readOnly aria-label={s.textareaLabel} className="input mono h-48 text-xs" value={text} onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}
