import { useState } from 'react';
import { formatHours, formatLatLon, formatPercent, formatViolationValue } from '../lib/format';
import { quickMapUrl, moonTrekUrl } from '../lib/deeplinks';
import { baselineScenario, validMetrics } from '../lib/result';
import { formatUtc } from '../lib/utc';
import type { AnalysisEntry } from '../state/AppState';
import { Icon } from './ui';

/** Plain-text, copy-pasteable report built ONLY from the server's result (no re-scoring). */
export function buildSummaryText(entry: AnalysisEntry): string {
  const i = entry.input;
  const mission = entry.job?.result?.mission;
  const horizon = entry.job?.result?.horizon;
  const lines = [
    'Lunar Mission Window Analyzer — ön eleme özeti (iniş sertifikası değildir)',
    `Analiz: ${entry.id}`,
    `Konum (Moon ME, planetosentrik, doğu-pozitif): ${formatLatLon(i.latitude, i.longitude)} [${i.latitude}, ${i.longitude}]`,
    `İniş: ${formatUtc(i.landing_utc)} · görev ${i.duration_hours} sa + tampon ${i.buffer_hours} sa · adım ${i.step_minutes} dk`,
    `Gözlemci: panel ${i.sun_observer_height_m} m, DTE anten ${i.earth_observer_height_m} m · ufuk ${i.horizon_radius_km} km · belirsizlik ${i.uncertainty_mode}`,
    `Karar: ${mission?.status ?? entry.job?.result?.status ?? 'yok'}${mission?.label ? ` — ${mission.label}` : ''}`,
  ];
  for (const s of mission?.scenarios ?? []) {
    const m = validMetrics(s.variants.nominal);
    lines.push(m
      ? `  +${s.shift_hours} sa (nominal): ort. Güneş diski ${formatPercent(m.mean_sun_visible_fraction, 1)}, maks. karanlık ${formatHours(m.max_continuous_darkness_s, 2)}, DTE ${formatPercent(m.dte_visible_fraction, 1)}, maks. DTE kesintisi ${formatHours(m.max_continuous_dte_gap_s, 2)}`
      : `  +${s.shift_hours} sa: görünürlük hesaplanamadı`);
    for (const [name, v] of Object.entries(s.variants)) {
      for (const viol of v?.violations ?? []) {
        lines.push(`    İHLAL ${viol.code} (${name}): gözlenen ${formatViolationValue(viol.observed, viol.unit)} / sınır ${formatViolationValue(viol.limit, viol.unit)}`);
      }
    }
  }
  for (const u of mission?.unresolved ?? []) lines.push(`  BELİRSİZ: ${u.code}`);
  const rp = mission?.radius_policy;
  if (rp?.below_reference) {
    lines.push(`  UYARI ${rp.code}: ufuk ${rp.radius_km} km < ${rp.reference_radius_km} km referans; karar ${rp.status_before_policy} → ${rp.status_after_policy}` +
      (rp.capped ? ' (GREEN tavanı; GREEN için 200 km analizi gerekli)' : ''));
  }
  if (entry.job?.result?.error_code) lines.push(`Durum kodu: ${entry.job.result.error_code}`);
  if (horizon) lines.push(`DEM: ${Object.values(horizon.sources).join(', ')} · ufuk durumu ${horizon.status} · cache ${horizon.cache_key.slice(0, 12)}`);
  lines.push('Kaynaklar: NASA GSFC PGDA LOLA (Barker vd. 2023), NASA/JPL NAIF SPICE (DE440s, MOON_ME_DE440_ME421).');
  const qm = quickMapUrl(i.latitude, i.longitude);
  const trek = moonTrekUrl(i.latitude, i.longitude);
  if (qm) lines.push(`LROC QuickMap: ${qm}`);
  if (trek) lines.push(`NASA Moon Trek (odaklanma güvenilir değil): ${trek}`);
  lines.push(...(mission?.disclaimers ?? []).map((d) => `Not: ${d}`));
  const baseline = baselineScenario(mission);
  if (baseline) lines.push(`Zaman çözünürlüğü: ${validMetrics(baseline.variants.nominal)?.time_resolution_minutes ?? '—'} dk (geçiş anları örnekleme adımı içinde belirsiz).`);
  return lines.join('\n');
}

export function CopySummary({ entry }: { entry: AnalysisEntry }) {
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
        <Icon name="copy" /> Özeti kopyala
      </button>
      <span role="status" className="ml-2 text-xs text-go">{state === 'copied' ? 'Panoya kopyalandı.' : ''}</span>
      {state === 'manual' && (
        <textarea readOnly aria-label="Kopyalanabilir özet" className="input mono h-48 text-xs" value={text} onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}
