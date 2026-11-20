import { useId } from 'react';
import type { Mission } from '../api/types';
import { formatHours, formatPercent, unknownText } from '../lib/format';
import { durationScale, hourTicks, scenarioOutcomes, stripGeometry, type ScenarioOutcome, type Span } from '../lib/infographic';
import { baselineScenario, validMetrics } from '../lib/result';
import { formatUtc, parseUtc } from '../lib/utc';
import type { AnalysisEntry } from '../state/AppState';
import { Icon, type IconName } from './ui';
import { defineStrings, useStrings } from '../i18n';

const STR = defineStrings({
  en: {
    outcome: {
      violated: 'Constraint exceeded',
      cautious: 'Exceeded in the conservative calculation',
      pass: 'Constraints met',
      nominal_only: 'No exceedance (nominal calculation only)',
      unknown: 'Uncertain',
    } as Record<ScenarioOutcome, string>,
    hours: 'h',
    slipsLabel: 'Landing slip scenarios',
    slipsTitle: 'What if the landing is delayed?',
    slipsNote: 'Each box summarises the constraint exceedances the server found if the landing is delayed by that many hours.',
    windowDesc: (shift: number, start: string, end: string) => `Mission window, +${shift} hour scenario, from ${start} to ${end}. `,
    metricsDesc: (sun: string, dark: string, earth: string, gap: string) =>
      `On average ${sun} of the Sun disk is visible; the longest darkness is ${dark}. ` +
      `Earth is visible ${earth} of the time; the longest outage is ${gap}.`,
    noMetrics: 'No valid metrics.',
    stripLabel: 'Mission window time strip',
    stripTitle: 'Mission window: when are the Sun and Earth visible?',
    scenario: (shift: number) => `+${shift} h scenario`,
    sun: 'Sun',
    earth: 'Earth',
    legendSun: 'Visible share of the Sun disk (height = 0–100%)',
    legendEarth: 'Earth above the horizon',
    legendDark: 'Longest darkness',
    legendGap: 'Longest Earth outage',
    legendMissionEnd: 'Mission end (buffer after it)',
    legendUnknown: 'Unknown (terrain data missing)',
  },
  tr: {
    outcome: {
      violated: 'Kısıt aşıldı',
      cautious: 'İhtiyatlı hesapta aşıldı',
      pass: 'Kısıtlar sağlandı',
      nominal_only: 'Aşım yok (yalnız nominal hesap)',
      unknown: 'Belirsiz',
    },
    hours: 'sa',
    slipsLabel: 'İniş kayma senaryoları',
    slipsTitle: 'İniş gecikirse ne olur?',
    slipsNote: 'Her kutu, inişin o kadar saat gecikmesi hâlinde sunucunun bulduğu kısıt aşımlarını özetler.',
    windowDesc: (shift: number, start: string, end: string) => `Görev penceresi, +${shift} saat senaryosu, ${start} ile ${end} arası. `,
    metricsDesc: (sun: string, dark: string, earth: string, gap: string) =>
      `Güneş diski ortalama ${sun} görünür, en uzun karanlık ${dark}. ` +
      `Dünya zamanın ${earth} kadarında görünür, en uzun kesinti ${gap}.`,
    noMetrics: 'Geçerli metrik yok.',
    stripLabel: 'Görev penceresi zaman şeridi',
    stripTitle: 'Görev penceresi: Güneş ve Dünya ne zaman görünüyor?',
    scenario: (shift: number) => `+${shift} sa senaryosu`,
    sun: 'Güneş',
    earth: 'Dünya',
    legendSun: 'Güneş diskinin görünen payı (yükseklik = %0–100)',
    legendEarth: 'Dünya ufkun üstünde',
    legendDark: 'En uzun karanlık',
    legendGap: 'En uzun Dünya kesintisi',
    legendMissionEnd: 'Görev sonu (sonrası tampon)',
    legendUnknown: 'Bilinmiyor (arazi verisi eksik)',
  },
});

/* ------------------------------------------------------------------ gauges */

/** Circular gauge for a 0…1 fraction with an optional target tick. Decorative: the value is printed next to it. */
export function RingGauge({ value, target, color, size = 92 }: { value: number | null; target: number | null; color: string; size?: number }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  const t = target === null ? null : Math.max(0, Math.min(1, target));
  const tickAngle = t === null ? 0 : t * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0" aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(130 160 230 / 0.18)" strokeWidth="9" />
      {value === null ? (
        <circle cx="50" cy="50" r={r} fill="none" stroke="#b3bccd" strokeOpacity="0.5" strokeWidth="9" strokeDasharray="3 5" />
      ) : (
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${v * circ} ${circ}`} transform="rotate(-90 50 50)" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      )}
      {t !== null && (
        <line x1={50 + Math.cos(tickAngle) * 30} y1={50 + Math.sin(tickAngle) * 30} x2={50 + Math.cos(tickAngle) * 50} y2={50 + Math.sin(tickAngle) * 50}
          stroke="#eaf0ff" strokeWidth="2.5" />
      )}
    </svg>
  );
}

/** Horizontal duration bar with a limit marker; the part above the limit is drawn in the "stop" colour. */
export function DurationBar({ valueH, limitH, color }: { valueH: number | null; limitH: number | null; color: string }) {
  const s = durationScale(valueH, limitH);
  const within = s.value === null ? 0 : s.limit === null ? s.value : Math.min(s.value, s.limit);
  const over = s.value !== null && s.limit !== null && s.value > s.limit ? s.value - s.limit : 0;
  return (
    <div className="relative mt-3 h-3 rounded-full bg-[rgb(130_160_230/0.16)]" aria-hidden>
      {s.value === null ? (
        <div className="absolute inset-0 rounded-full border border-dashed border-unknown/50" />
      ) : (
        <>
          <div className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: `${within * 100}%`, background: color, boxShadow: `0 0 10px -2px ${color}` }} />
          {over > 0 && (
            <div className="absolute inset-y-0 rounded-r-full bg-[repeating-linear-gradient(135deg,var(--color-stop)_0_6px,rgb(255_123_123/0.55)_6px_10px)]"
              style={{ left: `${(s.limit ?? 0) * 100}%`, width: `${over * 100}%` }} />
          )}
        </>
      )}
      {s.limit !== null && (
        <div className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded bg-ink" style={{ left: `calc(${s.limit * 100}% - 1px)` }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ scenario strip */

const OUTCOME: Record<ScenarioOutcome, { icon: IconName; cls: string }> = {
  violated: { icon: 'stop', cls: 'border-stop/55 bg-stop/10 text-stop' },
  cautious: { icon: 'alert', cls: 'border-caution/55 bg-caution/10 text-caution' },
  pass: { icon: 'check', cls: 'border-go/50 bg-go/10 text-go' },
  nominal_only: { icon: 'info', cls: 'border-line-strong bg-panel-2 text-muted' },
  unknown: { icon: 'question', cls: 'border-unknown/50 bg-unknown/10 text-unknown' },
};

/** +0/+24/+48/+72 h landing-slip scenarios, each with icon + words (never colour alone). */
export function ScenarioStrip({ mission }: { mission: Mission }) {
  const s = useStrings(STR);
  const outcomes = scenarioOutcomes(mission);
  if (outcomes.length === 0) return null;
  return (
    <section aria-label={s.slipsLabel} className="space-y-2">
      <h4 className="text-sm font-semibold text-ink">{s.slipsTitle}</h4>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {outcomes.map(({ shift, outcome }) => {
          const o = OUTCOME[outcome];
          return (
            <li key={shift} className={`rounded-xl border p-2.5 ${o.cls}`}>
              <p className="font-mono text-lg font-semibold text-ink">+{shift} {s.hours}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium"><Icon name={o.icon} className="h-4 w-4 shrink-0" />{s.outcome[outcome]}</p>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">{s.slipsNote}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ mission window strip */

const W = 1000;
const pct = (s: Span) => ({ x: s[0] * W, w: Math.max(1, (s[1] - s[0]) * W) });

/**
 * "When are the Sun and the Earth visible?" for the +0 h scenario, drawn straight from the API
 * timeline: f_sun area (gold), geometric DTE bands (blue), unknown samples hatched, and the
 * server's longest darkness / DTE-gap intervals.
 */
export function MissionWindowStrip({ mission, entry }: { mission: Mission; entry: AnalysisEntry }) {
  const uid = `mw${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const t = useStrings(STR);
  const scenario = baselineScenario(mission);
  if (!scenario || scenario.timeline.length < 2) return null;
  const m = validMetrics(scenario.variants.nominal);
  const g = stripGeometry(scenario.timeline, { darkness: m?.darkness_interval ?? null, gap: m?.dte_gap_interval ?? null }, W, 40);
  const totalH = (parseUtc(scenario.end_utc) - parseUtc(scenario.start_utc)) / 3_600_000;
  const ticks = totalH > 0 ? hourTicks(totalH) : [];
  const missionEnd = entry.input.buffer_hours > 0 && totalH > 0 ? entry.input.duration_hours / totalH : null;
  const earthSeen = m ? formatPercent(m.dte_visible_fraction) : unknownText();
  const description = t.windowDesc(scenario.shift_hours, formatUtc(scenario.start_utc), formatUtc(scenario.end_utc)) +
    (m ? t.metricsDesc(formatPercent(m.mean_sun_visible_fraction), formatHours(m.max_continuous_darkness_s), earthSeen,
      formatHours(m.max_continuous_dte_gap_s)) : t.noMetrics);

  return (
    <section aria-label={t.stripLabel} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{t.stripTitle}</h4>
        <span className="font-mono text-xs text-muted">{t.scenario(scenario.shift_hours)}</span>
      </div>
      <div className="rounded-xl border border-line bg-[rgb(3_8_24/0.55)] p-3">
        <p className="sr-only">{description}</p>
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5" aria-hidden>
          <span className="flex items-center gap-1 text-xs text-sun"><Icon name="sun" className="h-3.5 w-3.5" />{t.sun}</span>
          <svg viewBox={`0 0 ${W} 40`} preserveAspectRatio="none" className="h-10 w-full overflow-visible">
            <defs>
              <pattern id={`${uid}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="rgb(179 188 205 / 0.12)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="#b3bccd" strokeOpacity="0.6" strokeWidth="3" />
              </pattern>
              <linearGradient id={`${uid}-sun`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#ffcc4d" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#ffcc4d" stopOpacity="0.25" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width={W} height="40" fill="rgb(130 160 230 / 0.08)" />
            {g.sunAreas.map((d, i) => <path key={i} d={d} fill={`url(#${uid}-sun)`} stroke="#ffcc4d" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />)}
            {g.unknownSun.map((s, i) => <rect key={i} y="0" height="40" x={pct(s).x} width={pct(s).w} fill={`url(#${uid}-hatch)`} />)}
            {g.darkness && <rect y="0" height="40" x={pct(g.darkness).x} width={pct(g.darkness).w} fill="none" stroke="#b39dff" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
            {missionEnd !== null && <line x1={missionEnd * W} x2={missionEnd * W} y1="-4" y2="44" stroke="#eaf0ff" strokeOpacity="0.8" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
          </svg>
          <span className="flex items-center gap-1 text-xs text-earth"><Icon name="earth" className="h-3.5 w-3.5" />{t.earth}</span>
          <svg viewBox={`0 0 ${W} 18`} preserveAspectRatio="none" className="h-5 w-full overflow-visible">
            <rect x="0" y="0" width={W} height="18" fill="rgb(130 160 230 / 0.08)" />
            {g.earth.map((r, i) => r.value === true
              ? <rect key={i} y="1" height="16" x={pct(r.span).x} width={pct(r.span).w} fill="#5aa9ff" fillOpacity="0.85" />
              : r.value === null
                ? <rect key={i} y="0" height="18" x={pct(r.span).x} width={pct(r.span).w} fill={`url(#${uid}-hatch)`} />
                : null)}
            {g.gap && <rect y="0" height="18" x={pct(g.gap).x} width={pct(g.gap).w} fill="none" stroke="#ff7b7b" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
            {missionEnd !== null && <line x1={missionEnd * W} x2={missionEnd * W} y1="-4" y2="22" stroke="#eaf0ff" strokeOpacity="0.8" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
          </svg>
          <span />
          <div className="relative h-5 font-mono text-[10px] text-muted">
            {ticks.map((h) => (
              <span key={h} className="absolute top-0 -translate-x-1/2" style={{ left: `${(h / totalH) * 100}%` }}>+{h}</span>
            ))}
          </div>
        </div>
        <div className="mt-1 flex flex-wrap justify-between gap-2 font-mono text-[11px] text-muted">
          <span>{formatUtc(scenario.start_utc)}</span>
          <span>{formatUtc(scenario.end_utc)}</span>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-sun/80" aria-hidden />{t.legendSun}</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-earth/85" aria-hidden />{t.legendEarth}</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-dashed border-violet" aria-hidden />{t.legendDark}</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-dashed border-stop" aria-hidden />{t.legendGap}</li>
          {missionEnd !== null && <li className="flex items-center gap-1.5"><span className="h-3 w-px bg-ink" aria-hidden />{t.legendMissionEnd}</li>}
          {(g.unknownSun.length > 0 || g.earth.some((r) => r.value === null)) && (
            <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(45deg,#b3bccd_0_2px,transparent_2px_5px)]" aria-hidden />{t.legendUnknown}</li>
          )}
        </ul>
      </div>
    </section>
  );
}
