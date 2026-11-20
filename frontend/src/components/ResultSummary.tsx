import type { ReactNode } from 'react';
import { explainCode, violationText, type Explained } from '../api/errors';
import type { Decision, Mission, RadiusPolicy, Scenario } from '../api/types';
import { defineStrings, pick, useStrings } from '../i18n';
import { missionLabel, missionPublicExplanation } from '../lib/decisionText';
import { formatHours, formatLatLon, formatNumber, formatPercent, shortId, unknownText } from '../lib/format';
import { baselineScenario, intervalUtc, validMetrics, violationInterval } from '../lib/result';
import { baselineKpis, scenarioViolationSummary, type Kpi } from '../lib/telemetry';
import { formatUtc } from '../lib/utc';
import { isActive, useApp, type AnalysisEntry } from '../state/AppState';
import { JobStatusLine } from './AnalysisList';
import { SiteLinks } from './SiteLinks';
import { CopySummary } from './CopySummary';
import { HorizonStats, TelemetryPanel } from './TelemetryPanel';
import { DurationBar, MissionWindowStrip, RingGauge, ScenarioStrip } from './Infographics';
import { DECISION_STYLE, decisionPublicWord, DecisionBadge, EmptyState, Icon, Notice } from './ui';

type KpiText = { title: string; sub: string; limitWord: string };

const STR = defineStrings({
  en: {
    hours: 'h',
    kpi: {
      sun: { title: 'Sun visibility', sub: 'Mean share of the Sun disk that stays above the terrain', limitWord: 'target ≥' },
      darkness: { title: 'Longest darkness', sub: 'Longest continuous time the Sun stays behind the terrain', limitWord: 'limit ≤' },
      dte: { title: 'Earth view', sub: 'Share of time the Earth centre is above the horizon', limitWord: 'target ≥' },
      gap: { title: 'Longest Earth outage', sub: 'Longest break in the direct line of sight to Earth', limitWord: 'limit ≤' },
    } as Record<Kpi['key'], KpiText>,
    kpiState: { met: 'met', violated: 'not met', not_set: 'no constraint', unknown: 'unknown' } as Record<Kpi['state'], string>,
    kpiList: 'Summary indicators (+0 h scenario)',
    radiusFacts: (r: number, ref: number, before: string) => `r = ${r} km < ${ref} km reference; decision ${before}`,
    radiusCapped: (status: string) => ` → ${status} (GREEN cap).`,
    radiusUnchanged: ' (unchanged).',
    radiusRedTitle: 'Quick scan used (the result still holds)',
    radiusRedPublic: (r: number, ref: number) =>
      `The horizon was scanned only to ${r} km. Because a constraint is exceeded even in this quick scan, the result also holds for the full (${ref} km) scan: more distant terrain can only raise the horizon.`,
    radiusRedEngineer: 'RED stays valid: a longer scan can only raise the horizon.',
    radiusBelowPublic: (r: number, ref: number) =>
      `The horizon was scanned only to ${r} km (quick mode). The result could be worse in the full (${ref} km) scan.`,
    verdict: {
      GREEN: 'The constraints you defined are met both in the normal calculation and in the conservative calculation that adds terrain uncertainty.',
      YELLOW: 'The constraints are met in the normal calculation, but at least one is exceeded once terrain uncertainty is added; caution is needed.',
      RED: 'At least one of the constraints you defined is not met even in the normal calculation.',
      GRAY: 'The available data or validation is not enough to say “suitable / not suitable” reliably.',
    } as Record<Decision, string>,
    verdictCapped: (r: number, ref: number) =>
      `The constraints are met in both the normal and the conservative calculation, but the horizon was scanned only to ${r} km (quick mode). More distant mountains could block the Sun or Earth, so it is not called “suitable”; run again with ${ref} km.`,
    result: 'Result',
    storyIntro: (place: ReactNode, start: ReactNode, hours: number): ReactNode => (
      <>In the {hours}-hour window starting <strong>{start}</strong> at <strong>{place}</strong>:</>
    ),
    sunQuestion: 'How much is the Sun visible here?',
    sunAnswer: (pct: string) => `On average ${pct} of the Sun disk is in view.`,
    longestDark: (h: string, a: string, b: string) => ` The longest darkness is ${h} (${a} → ${b}).`,
    noDark: ' There is no dark period.',
    earthQuestion: 'When is the direct line of sight to Earth lost?',
    earthAnswer: (pct: string) => `Earth is above the horizon ${pct} of the time.`,
    longestGap: (h: string, a: string, b: string) => ` The longest outage is ${h} (${a} → ${b}).`,
    noGap: ' The line of sight is never lost.',
    noMetrics: 'Sun and Earth visibility could not be computed for this window (terrain data missing); no value is shown.',
    slipTried: (shifts: string) => `We also tried delaying the landing by ${shifts} hours: `,
    slipNone: 'no constraint was exceeded in any of them.',
    slipSome: (n: number, which: string) => `constraints were exceeded in ${n} scenario${n === 1 ? '' : 's'} (+${which} h).`,
    storyNote: 'Sun visibility is not electrical power generation, and Earth visibility is not a guarantee of a radio link. This result is not a landing certification.',
    reasonFallback: 'A mission constraint is exceeded',
    reasonWhen: (a: string, b: string) => `longest interval: ${a} → ${b}`,
    reasonsSummary: (n: number) => `Why this result? (${n} constraint violation${n === 1 ? '' : 's'})`,
    reasonLanding: (shift: number) => `· landing +${shift} h`,
    reasonCautious: ' · conservative calculation',
    cells: {
      decision: 'decision', nominal: 'nominal violations', cautious: 'conservative violations', unresolved: 'unresolved checks',
      scenario: 'scenarios', horizon: 'horizon', uncertainty: 'uncertainty', quality: 'quality',
    },
    cockpitLabel: 'Decision summary (server result)',
    tableLabel: 'Scenario metrics table (scrolls horizontally)',
    tableCaption: 'Scenario and variant metrics',
    th: {
      scenario: 'Scenario', variant: 'Variant', fSun: 'mean f_sun', dark: 'max darkness', dte: 'DTE share', gap: 'max DTE outage',
      quad: 'disk quad. diff.', dt: 'Δt', counts: 'violations / unknown',
    },
    clonesPassed: (pass: number, n: number) => ` · ${pass}/${n} clones passed`,
    invalid: 'invalid',
    minutes: 'min',
    publicDisclaimers: [
      'Earth visibility is only a geometric line of sight; it is not a guarantee of a radio link.',
      'Sun visibility does not mean electrical power generation.',
      'Times are sampled; transition moments are not exact.',
      'Landing safety and hazards smaller than the map resolution are not evaluated.',
      'The terrain-uncertainty scenario (ERR) is not a statistical confidence interval.',
    ],
    noSelectionTitle: 'No analysis selected',
    noSelection: 'Select an analysis from the list.',
    analysis: (id: string) => `Analysis ${id}`,
    running: 'Computing the horizon on the NASA DEM and the Sun/Earth positions with SPICE…',
    queued: 'Waiting in the queue…',
    noValueYet: 'No value is shown until the result arrives.',
    grayTitle: 'Result uncertain',
    grayPublicTitle: 'No definite result could be produced',
    grayPublicText: 'No reliable “suitable / not suitable” decision could be made for this location; the reason is in the technical details below.',
    unclassified: 'Could not be classified',
    unresolvedLabel: 'Unresolved conditions',
    unresolvedTitle: 'Checks that remain uncertain',
    whyGray: 'Why GRAY? The “Nominal” mode alone cannot say “suitable”; the terrain-uncertainty (ERR) scenario must also pass. This is a deliberate rule.',
    linksLabel: 'Location links',
    linksTitle: 'Inspect the location in NASA/LROC tools',
    limitations: 'Limitations',
    notCertificate: 'This result is not a landing certification.',
  },
  tr: {
    hours: 'sa',
    kpi: {
      sun: { title: 'Güneş görünürlüğü', sub: 'Güneş diskinin arazi üzerinde kalan ortalama payı', limitWord: 'hedef ≥' },
      darkness: { title: 'En uzun karanlık', sub: 'Güneş’in arazi arkasında kaldığı en uzun kesintisiz süre', limitWord: 'sınır ≤' },
      dte: { title: 'Dünya görüşü', sub: 'Dünya merkezinin ufkun üstünde olduğu süre payı', limitWord: 'hedef ≥' },
      gap: { title: 'En uzun Dünya kesintisi', sub: 'Dünya ile doğrudan görüşün en uzun kesintisi', limitWord: 'sınır ≤' },
    },
    kpiState: { met: 'sağlanıyor', violated: 'sağlanmıyor', not_set: 'kısıt yok', unknown: 'bilinmiyor' },
    kpiList: 'Özet göstergeler (+0 sa senaryosu)',
    radiusFacts: (r: number, ref: number, before: string) => `r = ${r} km < ${ref} km referans; karar ${before}`,
    radiusCapped: (status: string) => ` → ${status} (GREEN tavanı).`,
    radiusUnchanged: ' (değişmedi).',
    radiusRedTitle: 'Hızlı tarama yapıldı (sonuç yine de geçerli)',
    radiusRedPublic: (r: number, ref: number) =>
      `Ufuk yalnızca ${r} km’ye kadar tarandı. Kısıt bu hızlı taramada bile aşıldığı için sonuç tam (${ref} km) taramada da geçerlidir: daha uzak arazi ufku yalnızca yükseltebilir.`,
    radiusRedEngineer: 'RED geçerli kalır: daha uzun tarama ufku yalnız yükseltebilir.',
    radiusBelowPublic: (r: number, ref: number) =>
      `Ufuk yalnızca ${r} km’ye kadar tarandı (hızlı mod). Tam (${ref} km) taramada sonuç daha kötü olabilir.`,
    verdict: {
      GREEN: 'Tanımladığınız kısıtlar hem normal hesapta hem de arazi belirsizliği eklenmiş ihtiyatlı hesapta sağlanıyor.',
      YELLOW: 'Normal hesapta kısıtlar sağlanıyor, ama arazi belirsizliği eklenince en az bir kısıt aşılıyor; dikkatli olunmalı.',
      RED: 'Tanımladığınız kısıtlardan en az biri normal hesapta bile sağlanmıyor.',
      GRAY: 'Eldeki veri veya doğrulama, güvenilir bir “uygun / uygun değil” demeye yetmiyor.',
    },
    verdictCapped: (r: number, ref: number) =>
      `Kısıtlar hem normal hem ihtiyatlı hesapta sağlanıyor; ancak ufuk yalnızca ${r} km’ye kadar tarandı (hızlı mod). Daha uzaktaki dağlar Güneş’i veya Dünya’yı kapatabileceği için “uygun” denmiyor; ${ref} km ile yeniden çalıştırın.`,
    result: 'Sonuç',
    storyIntro: (place: ReactNode, start: ReactNode, hours: number): ReactNode => (
      <><strong>{place}</strong> konumunda, <strong>{start}</strong> başlayan {hours} saatlik pencerede:</>
    ),
    sunQuestion: 'Bu bölgede Güneş ne kadar görünüyor?',
    sunAnswer: (pct: string) => `Güneş diskinin ortalama ${pct} kadarı açıkta.`,
    longestDark: (h: string, a: string, b: string) => ` En uzun karanlık ${h} (${a} → ${b}).`,
    noDark: ' Hiç karanlık dönem yok.',
    earthQuestion: 'Dünya ile doğrudan görüş ne zaman kapanıyor?',
    earthAnswer: (pct: string) => `Dünya zamanın ${pct} kadarında ufkun üstünde.`,
    longestGap: (h: string, a: string, b: string) => ` En uzun kesinti ${h} (${a} → ${b}).`,
    noGap: ' Görüş hiç kesilmiyor.',
    noMetrics: 'Bu pencere için Güneş ve Dünya görünürlüğü hesaplanamadı (arazi verisi eksik); değer gösterilmiyor.',
    slipTried: (shifts: string) => `İnişi ${shifts} saat kaydırarak denedik: `,
    slipNone: 'hiçbirinde kısıt aşılmadı.',
    slipSome: (n: number, which: string) => `${n} senaryoda kısıt aşıldı (+${which} sa).`,
    storyNote: 'Güneş görünürlüğü elektrik üretimi, Dünya görüşü radyo bağlantısı garantisi değildir. Bu sonuç bir iniş sertifikası değildir.',
    reasonFallback: 'Bir görev kısıtı aşılıyor',
    reasonWhen: (a: string, b: string) => `en uzun aralık: ${a} → ${b}`,
    reasonsSummary: (n: number) => `Neden bu sonuç? (${n} kısıt aşımı)`,
    reasonLanding: (shift: number) => `· iniş +${shift} sa`,
    reasonCautious: ' · ihtiyatlı hesap',
    cells: {
      decision: 'karar', nominal: 'nominal ihlal', cautious: 'ihtiyatlı ihlal', unresolved: 'belirsiz kontrol',
      scenario: 'senaryo', horizon: 'ufuk', uncertainty: 'belirsizlik', quality: 'kalite',
    },
    cockpitLabel: 'Karar özeti (sunucu sonucu)',
    tableLabel: 'Senaryo metrik tablosu (yatay kaydırılabilir)',
    tableCaption: 'Senaryo ve varyant metrikleri',
    th: {
      scenario: 'Senaryo', variant: 'Varyant', fSun: 'ort. f_sun', dark: 'maks. karanlık', dte: 'DTE payı', gap: 'maks. DTE kesinti',
      quad: 'disk quad. farkı', dt: 'Δt', counts: 'ihlal / bilinmeyen',
    },
    clonesPassed: (pass: number, n: number) => ` · ${pass}/${n} clone geçti`,
    invalid: 'geçersiz',
    minutes: 'dk',
    publicDisclaimers: [
      'Dünya görüşü yalnızca geometrik bir görüş hattıdır; radyo bağlantısı garantisi değildir.',
      'Güneş görünürlüğü elektrik üretimi demek değildir.',
      'Zamanlar örneklenmiştir; geçiş anları kesin değildir.',
      'İniş güvenliği ve haritanın çözünürlüğünden küçük tehlikeler değerlendirilmez.',
      'Arazi belirsizliği senaryosu (ERR) istatistiksel bir güven aralığı değildir.',
    ],
    noSelectionTitle: 'Analiz seçilmedi',
    noSelection: 'Listeden bir analiz seçin.',
    analysis: (id: string) => `Analiz ${id}`,
    running: 'NASA DEM üzerinde ufuk ve SPICE ile Güneş/Dünya konumları hesaplanıyor…',
    queued: 'Kuyrukta bekliyor…',
    noValueYet: 'Sonuç gelene kadar değer gösterilmez.',
    grayTitle: 'Sonuç belirsiz',
    grayPublicTitle: 'Kesin bir sonuç üretilemedi',
    grayPublicText: 'Bu konum için güvenilir bir “uygun / uygun değil” kararı verilemedi; sebebi aşağıdaki teknik detaylarda.',
    unclassified: 'Sınıflandırılamadı',
    unresolvedLabel: 'Çözülemeyen durumlar',
    unresolvedTitle: 'Belirsiz kalan kontroller',
    whyGray: 'Neden GRAY? “Nominal” mod tek başına “uygun” diyemez; arazi belirsizliği (ERR) senaryosu da sağlanmalı. Bu bilinçli bir kuraldır.',
    linksLabel: 'Konum bağlantıları',
    linksTitle: 'Konumu NASA/LROC araçlarında incele',
    limitations: 'Sınırlamalar',
    notCertificate: 'Bu sonuç bir iniş sertifikası değildir.',
  },
});

/* ------------------------------------------------------------------ Public */

const KPI_ICON: Record<Kpi['key'], 'sun' | 'earth'> = { sun: 'sun', darkness: 'sun', dte: 'earth', gap: 'earth' };

function kpiValue(k: Kpi, hours: string): string {
  if (k.value === null) return unknownText();
  return k.unit === 'fraction' ? formatPercent(k.value) : `${k.value.toFixed(1)} ${hours}`;
}

function KpiCards({ mission, entry }: { mission: Mission; entry: AnalysisEntry }) {
  const s = useStrings(STR);
  const kpis = baselineKpis(mission, entry.input);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="list" aria-label={s.kpiList}>
      {kpis.map((k) => {
        const t = s.kpi[k.key];
        const icon = KPI_ICON[k.key];
        const state = {
          met: { cls: 'border-go/50 text-go', icon: 'check' as const },
          violated: { cls: 'border-stop/55 text-stop', icon: 'stop' as const },
          not_set: { cls: 'border-line text-muted', icon: 'info' as const },
          unknown: { cls: 'border-unknown/50 text-unknown', icon: 'question' as const },
        }[k.state];
        const limit = k.limit === null ? null : k.unit === 'fraction' ? formatPercent(k.limit) : `${k.limit} ${s.hours}`;
        const color = icon === 'sun' ? (k.key === 'darkness' ? '#b39dff' : '#ffcc4d') : '#5aa9ff';
        return (
          <div key={k.key} role="listitem" data-kpi={k.key}
            className={`glass-inner rounded-2xl p-4 ${icon === 'sun' ? 'border-sun/25' : 'border-earth/25'}`}>
            <p className={`flex items-center gap-2 text-sm font-semibold ${icon === 'sun' ? 'text-sun' : 'text-earth'}`}>
              <Icon name={icon} className="h-5 w-5" /> {t.title}
            </p>
            {k.unit === 'fraction' ? (
              <div className="mt-2 flex items-center gap-3">
                <RingGauge value={k.value} target={k.limit} color={color} />
                <p className="mono font-display text-3xl font-bold text-ink sm:text-4xl">{kpiValue(k, s.hours)}</p>
              </div>
            ) : (
              <>
                <p className="mono mt-2 font-display text-3xl font-bold text-ink sm:text-4xl">{kpiValue(k, s.hours)}</p>
                <DurationBar valueH={k.value} limitH={k.limit} color={color} />
              </>
            )}
            <p className="mt-2 text-xs text-muted">{t.sub}</p>
            <p className={`chip mt-2 ${state.cls}`}>
              <Icon name={state.icon} className="h-3.5 w-3.5" />
              {limit ? `${t.limitWord} ${limit} · ` : ''}{s.kpiState[k.state]}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Notice for a horizon scanned below the 200-km reference (values copied from `radius_policy`). */
function radiusExplained(p: RadiusPolicy, status: Decision): Explained {
  const s = pick(STR);
  const base = explainCode('REDUCED_HORIZON_RADIUS');
  const facts = s.radiusFacts(p.radius_km, p.reference_radius_km, p.status_before_policy) +
    (p.capped ? s.radiusCapped(status) : s.radiusUnchanged);
  if (status === 'RED') {
    return {
      ...base, tone: 'info', publicTitle: s.radiusRedTitle,
      publicText: s.radiusRedPublic(p.radius_km, p.reference_radius_km),
      engineerText: `${facts} ${s.radiusRedEngineer}`,
      publicAction: undefined,
    };
  }
  return {
    ...base,
    publicText: p.capped ? base.publicText : s.radiusBelowPublic(p.radius_km, p.reference_radius_km),
    engineerText: `${facts} ${base.engineerText}`,
  };
}

/** One plain-language sentence per decision class (the class itself always comes from the server). */
function verdictText(mission: Mission): string {
  const s = pick(STR);
  const rp = mission.radius_policy;
  if (mission.status === 'YELLOW' && rp?.capped) return s.verdictCapped(rp.radius_km, rp.reference_radius_km);
  return s.verdict[mission.status];
}

function VerdictBanner({ mission }: { mission: Mission }) {
  const s = useStrings(STR);
  const style = DECISION_STYLE[mission.status] ?? DECISION_STYLE.GRAY;
  return (
    <div className={`flex items-start gap-4 rounded-2xl border p-4 ${style.cls} ${style.glow}`}>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-current bg-[rgb(3_8_24/0.55)]">
        <Icon name={style.icon} className="h-7 w-7" />
      </span>
      <div className="min-w-0">
        <p className="eyebrow !text-current">{s.result} · {decisionPublicWord(mission.status)}</p>
        <p className="mt-1 font-display text-base leading-snug font-medium text-ink sm:text-lg">{verdictText(mission)}</p>
      </div>
    </div>
  );
}

function Story({ mission, entry }: { mission: Mission; entry: AnalysisEntry }) {
  const t = useStrings(STR);
  const s = baselineScenario(mission);
  const m = validMetrics(s?.variants.nominal);
  const i = entry.input;
  const hours = i.duration_hours + i.buffer_hours;
  const summary = scenarioViolationSummary(mission);
  const dark = s && m ? intervalUtc(s, m.darkness_interval) : null;
  const gap = s && m ? intervalUtc(s, m.dte_gap_interval) : null;
  return (
    <div className="glass-inner space-y-2 rounded-2xl p-4 text-sm leading-relaxed text-ink">
      <p>{t.storyIntro(formatLatLon(i.latitude, i.longitude), formatUtc(i.landing_utc), hours)}</p>
      {m ? (
        <>
          <p>
            <Icon name="sun" className="mr-1 inline h-4 w-4 text-sun" />
            <strong>{t.sunQuestion}</strong> {t.sunAnswer(formatPercent(m.mean_sun_visible_fraction))}
            {m.max_continuous_darkness_s > 0 && dark ? t.longestDark(formatHours(m.max_continuous_darkness_s), formatUtc(dark.start), formatUtc(dark.end)) : t.noDark}
          </p>
          <p>
            <Icon name="earth" className="mr-1 inline h-4 w-4 text-earth" />
            <strong>{t.earthQuestion}</strong> {t.earthAnswer(formatPercent(m.dte_visible_fraction))}
            {m.max_continuous_dte_gap_s > 0 && gap ? t.longestGap(formatHours(m.max_continuous_dte_gap_s), formatUtc(gap.start), formatUtc(gap.end)) : t.noGap}
          </p>
        </>
      ) : (
        <p>{t.noMetrics}</p>
      )}
      {summary.total > 1 && (
        <p className="text-muted">
          {t.slipTried(mission.scenarios.map((x) => `+${x.shift_hours}`).join(', '))}{summary.withViolations.length === 0
            ? t.slipNone
            : t.slipSome(summary.withViolations.length, summary.withViolations.join(', +'))}
        </p>
      )}
      <p className="text-xs text-muted">{t.storyNote}</p>
    </div>
  );
}

function PublicReasons({ mission }: { mission: Mission }) {
  const t = useStrings(STR);
  const items: { key: string; text: string; when?: string; scenario: number; cautious: boolean }[] = [];
  for (const s of mission.scenarios) {
    for (const variant of ['nominal', 'cautious'] as const) {
      const v = s.variants[variant];
      const m = validMetrics(v);
      for (const viol of v?.violations ?? []) {
        const span = m ? intervalUtc(s, violationInterval(viol.code, m)) : null;
        items.push({
          key: `${s.shift_hours}-${variant}-${viol.code}`,
          text: violationText(viol.code)?.publicLabel ?? t.reasonFallback,
          when: span ? t.reasonWhen(formatUtc(span.start), formatUtc(span.end)) : undefined,
          scenario: s.shift_hours,
          cautious: variant === 'cautious',
        });
      }
    }
  }
  if (items.length === 0) return null;
  return (
    <details className="rounded-lg border border-stop/30 bg-stop/5 p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-ink">{t.reasonsSummary(items.length)}</summary>
      <ul className="mt-2 space-y-1">
        {items.map((it) => (
          <li key={it.key}>
            <Icon name="stop" className="mr-1 inline h-4 w-4 text-stop" />
            {it.text} <span className="text-xs text-muted">{t.reasonLanding(it.scenario)}{it.cautious ? t.reasonCautious : ''}</span>
            {it.when && <span className="block pl-5 text-xs text-muted">{it.when}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ Engineer */

/** Dense decision read-out; every cell is a count or field copied from the server result. */
function CockpitStrip({ mission, entry, horizonStatus, radiusKm }: { mission: Mission; entry: AnalysisEntry; horizonStatus?: string; radiusKm?: number }) {
  const t = useStrings(STR);
  const n = mission.nominal_violations?.length ?? 0;
  const cv = mission.cautious_violations?.length ?? 0;
  const u = mission.unresolved?.length ?? 0;
  const decisionCls = { GREEN: 'text-go', YELLOW: 'text-caution', RED: 'text-stop', GRAY: 'text-unknown' }[mission.status] ?? 'text-ink';
  const cells: [string, string, string][] = [
    [t.cells.decision, mission.status, decisionCls],
    [t.cells.nominal, String(n), n > 0 ? 'text-stop' : 'text-go'],
    [t.cells.cautious, String(cv), cv > 0 ? 'text-caution' : 'text-go'],
    [t.cells.unresolved, String(u), u > 0 ? 'text-caution' : 'text-ink'],
    [t.cells.scenario, mission.scenarios.map((s) => `+${s.shift_hours}`).join('/') || '—', 'text-ink'],
    [t.cells.horizon, `${horizonStatus ?? '—'} · ${radiusKm ?? entry.input.horizon_radius_km} km`, horizonStatus === 'complete' ? 'text-ink' : 'text-caution'],
    [t.cells.uncertainty, `${entry.input.uncertainty_mode}${entry.input.uncertainty_mode === 'err' ? ` k=${entry.input.err_k}` : ''}`, 'text-ink'],
    [t.cells.quality, mission.quality ?? '—', 'text-ink'],
  ];
  return (
    <section aria-label={t.cockpitLabel}>
      <dl className="term grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-[rgb(76_201_255/0.18)] sm:grid-cols-4">
        {cells.map(([k, v, cls]) => (
          <div key={k} className="bg-[rgb(2_7_20/0.92)] px-2.5 py-1.5">
            <dt className="text-[10px] tracking-[0.12em] text-muted uppercase">{k}</dt>
            <dd className={`text-sm leading-tight font-semibold [overflow-wrap:anywhere] ${cls}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EngineerTable({ mission }: { mission: Mission }) {
  const t = useStrings(STR);
  return (
    <div className="term overflow-x-auto rounded-xl p-2" tabIndex={0} role="region" aria-label={t.tableLabel}>
      <table className="w-full min-w-[640px] text-left text-xs">
        <caption className="sr-only">{t.tableCaption}</caption>
        <thead className="text-term/90">
          <tr>
            <th scope="col" className="py-1 pr-2">{t.th.scenario}</th><th scope="col" className="pr-2">{t.th.variant}</th>
            <th scope="col" className="pr-2">{t.th.fSun}</th><th scope="col" className="pr-2">{t.th.dark}</th>
            <th scope="col" className="pr-2">{t.th.dte}</th><th scope="col" className="pr-2">{t.th.gap}</th>
            <th scope="col" className="pr-2">{t.th.quad}</th><th scope="col" className="pr-2">{t.th.dt}</th><th scope="col">{t.th.counts}</th>
          </tr>
        </thead>
        <tbody className="mono">
          {mission.scenarios.flatMap((s: Scenario) =>
            Object.entries(s.variants).map(([name, v]) => {
              const m = validMetrics(v);
              return (
                <tr key={`${s.shift_hours}-${name}`} className="border-t border-line">
                  <td className="py-1 pr-2">+{s.shift_hours} {t.hours}</td>
                  <td className="pr-2">{name}{m?.method ? <span className="block text-muted">{m.method}{v && 'clone' in v && v.clone?.pass_count != null ? t.clonesPassed(v.clone.pass_count, v.clone.n) : ''}</span> : null}</td>
                  <td className="pr-2">{m ? formatNumber(m.mean_sun_visible_fraction, 4) : t.invalid}</td>
                  <td className="pr-2">{m ? formatHours(m.max_continuous_darkness_s, 2) : '—'}</td>
                  <td className="pr-2">{m ? formatNumber(m.dte_visible_fraction, 4) : '—'}</td>
                  <td className="pr-2">{m ? formatHours(m.max_continuous_dte_gap_s, 2) : '—'}</td>
                  <td className="pr-2">{typeof m?.max_disk_integration_difference === 'number' ? m.max_disk_integration_difference.toExponential(2) : '—'}</td>
                  <td className="pr-2">{typeof m?.time_resolution_minutes === 'number' ? `${m.time_resolution_minutes} ${t.minutes}` : '—'}</td>
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

/** Public-mode text when no scenario was computed: backend explanation/label rebuilt in the interface language. */
function noScenarioText(mission: Mission, uncertaintyMode: string): string | undefined {
  if (mission.explanations?.public !== undefined) return missionPublicExplanation(mission, uncertaintyMode);
  if (mission.label !== undefined) return missionLabel(mission, uncertaintyMode);
  return mission.reason;
}

/* ------------------------------------------------------------------ shared */

export function ResultSummary({ entry }: { entry: AnalysisEntry | null }) {
  const { mode } = useApp();
  const t = useStrings(STR);
  const engineer = mode === 'engineer';
  if (!entry) return <EmptyState title={t.noSelectionTitle}>{t.noSelection}</EmptyState>;
  const job = entry.job;
  const result = job?.result ?? null;
  const mission = result?.mission;
  const horizon = result?.horizon;

  return (
    <article className="space-y-4" aria-labelledby={`res-${entry.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`res-${entry.id}`} className="panel-title">{t.analysis(shortId(entry.id))}</h3>
          <p className="text-sm text-muted"><JobStatusLine entry={entry} /></p>
        </div>
        {mission && <DecisionBadge status={mission.status} size="lg" />}
        {!mission && result && <DecisionBadge status={result.status} size="lg" />}
      </header>

      {isActive(entry) && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
          <Icon name="spinner" className="h-4 w-4 text-accent" />
          {job?.status === 'running' ? t.running : t.queued} {t.noValueYet}
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
        <Notice explained={{ code: 'GRAY', title: t.grayTitle, publicTitle: t.grayPublicTitle,
          publicText: t.grayPublicText,
          engineerText: result.reason, tone: 'warning' }} />
      )}
      {mission?.radius_policy?.below_reference && <Notice explained={radiusExplained(mission.radius_policy, mission.status)} />}

      {mission && engineer && (
        <>
          <CockpitStrip mission={mission} entry={entry} horizonStatus={horizon?.status} radiusKm={horizon?.reference_radius_km} />
          <TelemetryPanel entry={entry} horizon={horizon} mission={mission} />
          <p className="term rounded-xl p-2.5 text-xs leading-relaxed text-ink"><span className="text-term" aria-hidden>&gt; </span>{mission.explanations?.engineer ?? mission.reason}</p>
          {horizon && <HorizonStats horizon={horizon} />}
          {mission.status === 'GRAY' && mission.reason && (
            <Notice explained={{ code: mission.quality ? `HORIZON_${mission.quality.toUpperCase()}` : 'GRAY', title: t.unclassified, publicText: mission.reason, engineerText: `${mission.reason} (quality=${mission.quality ?? '—'})`, tone: 'warning' }} />
          )}
          {mission.scenarios.length > 0 && <EngineerTable mission={mission} />}
          {(mission.unresolved?.length ?? 0) > 0 && (
            <section aria-label={t.unresolvedLabel} className="space-y-1.5">
              <h4 className="text-sm font-semibold text-ink">{t.unresolvedTitle}</h4>
              {[...new Map((mission.unresolved ?? []).map((u) => [u.code, u])).values()].map((u) => <Notice key={u.code} explained={explainCode(u.code)} />)}
            </section>
          )}
        </>
      )}

      {mission && !engineer && (
        <>
          <VerdictBanner mission={mission} />
          {mission.scenarios.length > 0 && <KpiCards mission={mission} entry={entry} />}
          {mission.scenarios.length > 0 && <MissionWindowStrip mission={mission} entry={entry} />}
          {mission.scenarios.length > 1 && <ScenarioStrip mission={mission} />}
          {mission.scenarios.length > 0 ? <Story mission={mission} entry={entry} /> : (
            <p className="text-sm text-ink">{noScenarioText(mission, entry.input.uncertainty_mode)}</p>
          )}
          {mission.status === 'GRAY' && entry.input.uncertainty_mode === 'nominal' && (mission.nominal_violations?.length ?? 0) === 0 && !mission.reason && (
            <p className="rounded-md border border-unknown/40 bg-unknown/5 p-2 text-xs text-muted">{t.whyGray}</p>
          )}
          <PublicReasons mission={mission} />
          {(mission.unresolved?.length ?? 0) > 0 && (
            <section aria-label={t.unresolvedLabel} className="space-y-1.5">
              {[...new Map((mission.unresolved ?? []).map((u) => [u.code, u])).values()].map((u) => <Notice key={u.code} explained={explainCode(u.code)} compact />)}
            </section>
          )}
        </>
      )}

      <section aria-label={t.linksLabel} className="space-y-1">
        <h4 className="text-sm font-semibold text-ink">{t.linksTitle}</h4>
        <SiteLinks lat={entry.input.latitude} lon={entry.input.longitude} />
      </section>

      {mission?.disclaimers && (
        <ul className="list-inside list-disc space-y-0.5 text-xs text-muted" aria-label={t.limitations}>
          {(engineer ? mission.disclaimers : t.publicDisclaimers).map((d) => <li key={d}>{d}</li>)}
          <li>{t.notCertificate}</li>
        </ul>
      )}
      {mission && <CopySummary entry={entry} />}
    </article>
  );
}
