import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { explainError } from '../api/errors';
import type { Health, SiteLayer, SitesResponse, UncertaintyMode } from '../api/types';
import { formatLatLon } from '../lib/format';
import { buildRequest, DEFAULT_FORM, fieldForApiPath, LIMITS, type FieldErrors, type MissionForm as Form } from '../lib/mission';
import { FRAME, latrecKm, MOON_RADIUS_KM } from '../lib/telemetry';
import { utcPartsToIso } from '../lib/utc';
import { useApp } from '../state/AppState';
import { Icon, Notice, type IconName } from './ui';
import { Stepper, type StepState } from './Wizard';

const SHIFT_OPTIONS = [0, 24, 48, 72];
const HEIGHT_PRESETS = [1, 4, 40];
/** Fields that live in the "Gelişmiş görev ayarları" accordion in Halk / Eğitimci mode. */
export const ADVANCED_FIELDS: (keyof Form)[] = [
  'buffer_hours', 'step_minutes', 'horizon_radius_km', 'err_k', 'dark_fraction_threshold', 'max_slope_deg', 'slope_footprint_radius_m',
];

type ErrorKey = keyof FieldErrors;
export type WizardStep = 'site' | 'time' | 'needs' | 'review';

/**
 * Halk wizard. Presentation only: every step edits the SAME form state that Mühendis mode shows, and
 * the request body is built by the same `buildRequest`, so the mode never changes a result.
 */
export const WIZARD_STEPS: { key: WizardStep; title: string; icon: IconName; question: string; intro: string; keys: ErrorKey[] }[] = [
  {
    key: 'site', title: 'Konum', icon: 'pin', question: 'Ay’ın güney kutbunda nereyi inceleyelim?',
    intro: 'Bir NASA LOLA arazi haritası seçin ve koordinatı girin. Koordinat Ay’ın güney kutbu bölgesinde (−80° … −90° enlem) olmalı.',
    keys: ['dataset_id', 'latitude', 'longitude'],
  },
  {
    key: 'time', title: 'Zaman', icon: 'clock', question: 'İniş ne zaman, görev ne kadar sürecek?',
    intro: 'Tüm zamanlar UTC’dir; tarayıcınızın saat dilimi kullanılmaz. İnişin birkaç gün gecikmesi durumunu da aynı anda deneyebiliriz.',
    keys: ['landing_date', 'landing_time', 'duration_hours', 'shifts'],
  },
  {
    key: 'needs', title: 'İhtiyaçlar', icon: 'target', question: 'Görevin Güneş’e ve Dünya’ya ne kadar ihtiyacı var?',
    intro: 'Aracın dayanabileceği karanlık süresini ve Dünya ile doğrudan görüş ihtiyacını yazın. Varsayılanlar yalnızca örnektir; NASA önerisi değildir.',
    keys: ['max_darkness_hours', 'min_sun_fraction_pct', 'min_dte_fraction_pct', 'max_dte_gap_hours', 'constraints', 'sun_observer_height_m', 'earth_observer_height_m'],
  },
  {
    key: 'review', title: 'Kontrol', icon: 'rocket', question: 'Belirsizliği seçin, özeti kontrol edin ve başlatın',
    intro: 'Arazi haritalarının da ölçüm hatası vardır. “Uygun” kararı yalnızca bu hata hesaba katıldığında da kısıtlar sağlanıyorsa verilir.',
    keys: ['uncertainty_mode', ...ADVANCED_FIELDS, 'budget'],
  },
];

function stepOf(key: ErrorKey): WizardStep {
  return WIZARD_STEPS.find((s) => s.keys.includes(key))?.key ?? 'review';
}

function Field({ id, label, hint, error, compact = false, children }: {
  id: string; label: string; hint?: ReactNode; error?: string; compact?: boolean; children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={compact ? 'label-term' : 'label'}>{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className={compact ? 'hint-term' : 'hint'}>{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1 text-xs font-medium text-stop">
          <Icon name="alert" className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: boolean, error?: string) {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

/** Clone option help: real clone-file counts from /health; never claims availability it does not report. */
function cloneHelp(health: Health | null, engineer: boolean): string {
  const c = health?.clones;
  const complete = c ? Object.values(c.sites).filter((s) => s.complete).map((s) => s.site_tile) : [];
  if (!c || complete.length === 0 || c.precomputed_profile_sets === 0) {
    return engineer
      ? `Ön hesaplanmış clone profili yok${c ? ` (tam clone seti: ${complete.join(', ') || 'yok'}; profil seti: ${c.precomputed_profile_sets})` : ''} → CLONE_NOT_PRECOMPUTED / GRAY.`
      : 'Bu yöntem için NASA klon verisi henüz hazır değil; seçilirse sonuç “belirsiz” olur.';
  }
  const where = (c.profile_sets ?? []).map((p) => `(${p.latitude}, ${p.longitude})`).join(', ');
  return engineer
    ? `Kapsam yalnız ${complete.join(', ')} · ön hesaplanmış ${c.precomputed_profile_sets} koordinat: ${where || '—'} (panel/anten 4 m, 200 km). PGDA 100 DEM clone; ihtiyatlı = clone p95. Diğer konumlarda CLONE_NOT_PRECOMPUTED / GRAY.`
    : `NASA’nın 100 farklı arazi haritası örneğiyle sınama. Şu an yalnız ${complete.join(', ')} karosunda, önceden hazırlanmış ${c.precomputed_profile_sets} koordinatta çalışır: ${where || '—'}. Diğer konumlarda sonuç “belirsiz” olur.`;
}

function parsed(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function MissionForm({ sites, health, onQueued }: { sites: SitesResponse | null; health: Health | null; onQueued?: (id: string) => void }) {
  const { register, mode } = useApp();
  const engineer = mode === 'engineer';
  const uid = useId();
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<unknown>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<FieldErrors>({});
  const [lastQueued, setLastQueued] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>('site');
  const [visited, setVisited] = useState<Set<WizardStep>>(() => new Set<WizardStep>(['site']));
  const focusStepHeading = useRef(false);
  const stepHeadings = useRef<Partial<Record<WizardStep, HTMLHeadingElement | null>>>({});

  const built = useMemo(() => buildRequest(form), [form]);
  const errors: FieldErrors = touched ? { ...built.errors, ...serverFieldErrors } : serverFieldErrors;
  const advancedHasError = ADVANCED_FIELDS.some((k) => Boolean(errors[k]));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerFieldErrors((e) => ({ ...e, [key]: undefined }));
  };
  const id = (name: string) => `${uid}-${name}`;

  // Move focus to the new step's heading after a user-initiated step change (not on first render).
  useEffect(() => {
    if (!focusStepHeading.current) return;
    focusStepHeading.current = false;
    stepHeadings.current[step]?.focus();
  }, [step]);

  const goTo = (next: WizardStep, focusHeading = true) => {
    focusStepHeading.current = focusHeading;
    setStep(next);
    setVisited((v) => new Set(v).add(next));
  };

  const site = sites?.sites.find((s) => s.id === form.dataset_id) ?? null;
  const layer = health?.layers?.[form.dataset_id];
  const errAvailable = site?.uncertainty_err_available ?? layer?.err ?? false;
  const isoPreview = utcPartsToIso(form.landing_date, form.landing_time);
  const sameHeights = form.sun_observer_height_m.trim() === form.earth_observer_height_m.trim();
  const profileCount = (sameHeights ? 1 : 2) * (form.uncertainty_mode === 'err' ? 3 : 1);

  const focusField = (key: ErrorKey) => setTimeout(() => document.getElementById(id(key))?.focus(), 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setServerError(null);
    setServerFieldErrors({});
    if (!built.input) {
      const first = Object.keys(built.errors)[0] as ErrorKey | undefined;
      if (first && ADVANCED_FIELDS.includes(first as keyof Form)) setAdvancedOpen(true);
      if (first && !engineer) goTo(stepOf(first), false);
      if (first) focusField(first);
      return;
    }
    setSubmitting(true);
    try {
      const queued = await api.createAnalysis(built.input);
      register(queued.analysis_id, built.input);
      setLastQueued(queued.analysis_id);
      onQueued?.(queued.analysis_id);
    } catch (error) {
      setServerError(error);
      if (error instanceof ApiError && error.code === 'INVALID_INPUT') {
        const mapped: FieldErrors = {};
        for (const d of error.details) {
          const key = fieldForApiPath(d.field);
          if (key) mapped[key] = `Sunucu: ${d.message}`;
        }
        setServerFieldErrors(mapped);
        if (Object.keys(mapped).some((k) => ADVANCED_FIELDS.includes(k as keyof Form))) setAdvancedOpen(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setForm(DEFAULT_FORM);
    setTouched(false);
    setServerError(null);
    setServerFieldErrors({});
    setStep('site');
    setVisited(new Set<WizardStep>(['site']));
  };

  /* ---------- wizard step navigation (Halk) ---------- */
  const stepIndex = WIZARD_STEPS.findIndex((s) => s.key === step);
  const stepKeys = (k: WizardStep) => WIZARD_STEPS.find((s) => s.key === k)?.keys ?? [];
  const stepHasRawError = (k: WizardStep) => stepKeys(k).some((key) => Boolean(built.errors[key] || serverFieldErrors[key]));
  const stepStates = Object.fromEntries(WIZARD_STEPS.map((s) => {
    const state: StepState = s.key === step ? 'current'
      : stepKeys(s.key).some((key) => Boolean(errors[key])) ? 'error'
        : visited.has(s.key) && !stepHasRawError(s.key) ? 'done' : 'todo';
    return [s.key, state];
  })) as Record<WizardStep, StepState>;

  const nextStep = () => {
    const bad = stepKeys(step).filter((key) => Boolean(built.errors[key]));
    if (bad.length > 0) {
      setTouched(true);
      const focusable = bad.find((key) => document.getElementById(id(key)));
      if (focusable) focusField(focusable);
      return;
    }
    const next = WIZARD_STEPS[stepIndex + 1];
    if (next) goTo(next.key);
  };
  const prevStep = () => {
    const prev = WIZARD_STEPS[stepIndex - 1];
    if (prev) goTo(prev.key);
  };

  const numberInput = (name: keyof Form, props: { min?: number; max?: number; step?: number | 'any'; required?: boolean; hint?: boolean } = {}) => (
    <input
      id={id(name)}
      className={`input mono ${engineer ? 'input-term' : ''}`}
      inputMode="decimal"
      type="number"
      min={props.min}
      max={props.max}
      step={props.step ?? 'any'}
      required={props.required}
      value={form[name] as string}
      onChange={(e) => set(name, e.target.value as never)}
      aria-invalid={Boolean(errors[name])}
      aria-describedby={describedBy(id(name), props.hint ?? true, errors[name])}
    />
  );
  const c = engineer; // compact field styling in the cockpit

  /* ---------- shared field elements (rendered once, placed by layout) ---------- */
  const fDataset = (
    <Field compact={c} id={id('dataset_id')} label="NASA LOLA arazi katmanı (dataset)" hint={site ? `${site.resolution_m} m/piksel${site.region_name ? ` · PGDA bölge adı: ${site.region_name}` : ''} · ${site.note}` : 'Katman listesi /sites uç noktasından gelir.'}>
      <select id={id('dataset_id')} className={`input ${c ? 'input-term' : ''}`} value={form.dataset_id} onChange={(e) => set('dataset_id', e.target.value)} aria-describedby={`${id('dataset_id')}-hint`}>
        {sites && sites.sites.length > 0 ? (
          sites.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} · {s.resolution_m} m{s.region_name ? ` · ${s.region_name}` : ''} {s.available ? '· mevcut' : '· indirilmeli'}
            </option>
          ))
        ) : (
          <option value={form.dataset_id}>{form.dataset_id} (katman listesi alınamadı)</option>
        )}
      </select>
    </Field>
  );
  const datasetNotes = (
    <>
      {site && !site.available && (
        engineer ? (
          <p role="status" className="rounded-md border border-caution/50 bg-caution/10 p-2 font-mono text-[11px] text-caution">
            Bu katmanın dosyası sunucuda yok ({site.expected_folder}/{site.expected_file}). Analiz isteği <span className="mono">DEM_MISSING</span> ile reddedilir; sonuç uydurulmaz.
          </p>
        ) : (
          <div role="status" className="rounded-xl border border-caution/50 bg-caution/10 p-3 text-xs text-caution">
            <p>Bu katman için arazi verisi henüz mevcut değil; bu katmanla analiz başlatılamaz (sonuç uydurulmaz). Arazi verisi mevcut olan bir katman seçin.</p>
            <details className="mt-1 text-muted">
              <summary className="cursor-pointer select-none rounded font-medium text-ink/80">Teknik detaylar</summary>
              <p className="mt-1">Kod: <span className="mono text-ink">DEM_MISSING</span> · beklenen dosya: <span className="mono break-all">{site.expected_folder}/{site.expected_file}</span></p>
            </details>
          </div>
        )
      )}
      {site?.available && site.footprint && !site.footprint.contains_pole && (
        <div className={`rounded-lg border border-line bg-panel-2 p-2 text-xs text-muted ${c ? 'font-mono text-[11px]' : ''}`}>
          <p>
            Bu DEM karosu {site.footprint.width_km.toFixed(1)} × {site.footprint.height_km.toFixed(1)} km; enlem {site.footprint.lat_range[0].toFixed(3)}° … {site.footprint.lat_range[1].toFixed(3)}°.
            Koordinat bu karonun içinde olmalı; dışındaysa {engineer ? <>analiz <span className="mono">DEM_MISSING</span> döner</> : 'bu katmanda arazi verisi olmadığı için analiz yapılamaz'}.
          </p>
          <button type="button" className="link mt-1" onClick={() => { set('latitude', String(site.footprint!.center.lat)); set('longitude', String(site.footprint!.center.lon)); }}>
            Karonun merkezini doldur ({site.footprint.center.lat.toFixed(4)}°, {site.footprint.center.lon.toFixed(4)}°)
          </button>{' '}— raster kapsamının merkezidir; resmi iniş noktası değildir.
        </div>
      )}
    </>
  );
  const fLat = (
    <Field compact={c} id={id('latitude')} label="Enlem (°, planetosentrik)" hint="−90 … −80 (güney kutbu bölgesi)" error={errors.latitude}>
      {numberInput('latitude', { min: LIMITS.latitude.min, max: LIMITS.latitude.max, required: true })}
    </Field>
  );
  const fLon = (
    <Field compact={c} id={id('longitude')} label="Boylam (°, doğu-pozitif)" hint="−180 … 180" error={errors.longitude}>
      {numberInput('longitude', { min: LIMITS.longitude.min, max: LIMITS.longitude.max, required: true })}
    </Field>
  );
  const exampleCoordinate = (
    <p className={`text-xs text-muted ${c ? 'font-mono text-[11px]' : ''}`}>
      Hazır “resmi aday” koordinatı sunulmaz: kaynağı doğrulanmamış Shackleton / Connecting Ridge / NASA aday koordinatları uydurulmaz.
      Koordinatınızı Moon Mean-Earth (ME) çerçevesinde girin.{' '}
      <button type="button" className="link" onClick={() => { set('latitude', '-89.54'); set('longitude', '0'); }}>
        Belgelerdeki örnek koordinatı doldur (−89.54°, 0°)
      </button>{' '}
      — yalnızca örnektir, resmi aday değildir.
    </p>
  );
  const fDate = (
    <Field compact={c} id={id('landing_date')} label="İniş tarihi (UTC)" error={errors.landing_date}>
      <input id={id('landing_date')} type="date" className={`input mono ${c ? 'input-term' : ''}`} min="2026-01-01" max="2035-12-31" value={form.landing_date}
        onChange={(e) => set('landing_date', e.target.value)} aria-invalid={Boolean(errors.landing_date)} aria-describedby={describedBy(id('landing_date'), false, errors.landing_date)} />
    </Field>
  );
  const fTime = (
    <Field compact={c} id={id('landing_time')} label="İniş saati (UTC, 24 saat)" hint="Tarayıcı saat dilimi kullanılmaz; girilen değer UTC kabul edilir.">
      <input id={id('landing_time')} type="time" step={60} className={`input mono ${c ? 'input-term' : ''}`} value={form.landing_time}
        onChange={(e) => set('landing_time', e.target.value)} aria-describedby={`${id('landing_time')}-hint`} />
    </Field>
  );
  const isoLine = (
    <p className={`text-xs text-muted ${c ? 'font-mono text-[11px]' : ''}`}>
      Gönderilecek zaman: <span className="mono text-ink">{isoPreview ?? 'geçersiz'}</span>
    </p>
  );
  const fDuration = (
    <Field compact={c} id={id('duration_hours')} label="Görev süresi (saat)" hint="0 < süre ≤ 720" error={errors.duration_hours}>
      {numberInput('duration_hours', { min: 0, max: 720 })}
    </Field>
  );
  const fShifts = (
    <fieldset>
      <legend className={c ? 'label-term' : 'label'}>İniş kayma senaryoları (saat)</legend>
      <div className="flex flex-wrap gap-2">
        {SHIFT_OPTIONS.map((s) => {
          const checked = form.shifts.includes(s);
          return (
            <label key={s} className={`chip cursor-pointer border-line ${c ? 'px-2.5 py-1 font-mono text-xs' : 'px-3 py-1.5 text-sm'} ${checked ? 'border-accent/60 bg-accent/15 text-accent' : 'text-ink'}`}>
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={checked} disabled={s === 0}
                onChange={(e) => set('shifts', e.target.checked ? [...form.shifts, s] : form.shifts.filter((x) => x !== s))} />
              +{s} sa
            </label>
          );
        })}
      </div>
      <p className={c ? 'hint-term' : 'hint'}>+0 her zaman hesaplanır. Ek kaymalar sonradan Timeline’dan da istenebilir.</p>
      {errors.shifts && <p className="mt-1 text-xs font-medium text-stop">{errors.shifts}</p>}
    </fieldset>
  );
  const fBuffer = (
    <Field compact={c} id={id('buffer_hours')} label="Tampon (saat)" hint={engineer ? '0 … 168' : 'Görev sonrasına eklenen emniyet süresi (0 … 168 sa)'} error={errors.buffer_hours}>
      {numberInput('buffer_hours', { min: 0, max: 168 })}
    </Field>
  );
  const fStep = (
    <Field compact={c} id={id('step_minutes')} label="Zaman adımı (dakika)" hint={engineer ? '10 … 120, tam sayı' : 'Hesabın kaç dakikada bir yapılacağı (10 … 120)'} error={errors.step_minutes}>
      {numberInput('step_minutes', { min: 10, max: 120, step: 1 })}
    </Field>
  );
  const fRadius = (
    <Field compact={c} id={id('horizon_radius_km')} label="Ufuk tarama yarıçapı (km)" hint={engineer
      ? '10 … 200. 200 km referans; < 200 km (ör. 135 km hızlı mod) ufku yalnız alçaltabilir → sonuç en fazla YELLOW (REDUCED_HORIZON_RADIUS; V-05: 0.76°’ye kadar fark). Tarama mesafesi eksiksizlik kanıtı değildir.'
      : '10 … 200. 200 km tam tarama; 135 km hızlıdır ama uzaktaki dağları kaçırabilir, bu yüzden “uygun” (GREEN) kararı yalnız 200 km ile verilir.'} error={errors.horizon_radius_km}>
      <div className="flex gap-2">
        {numberInput('horizon_radius_km', { min: 10, max: 200 })}
        {[135, 200].map((r) => (
          <button key={r} type="button" className={`btn shrink-0 ${c ? 'min-h-8 px-2 py-1 font-mono text-xs' : ''}`} onClick={() => set('horizon_radius_km', String(r))} aria-label={`Yarıçapı ${r} km yap`}>{r}</button>
        ))}
      </div>
    </Field>
  );
  const fErrK = form.uncertainty_mode === 'err' ? (
    <Field compact={c} id={id('err_k')} label="ERR çarpanı k" hint="0 … 3 (engel +kσ, gözlemci −kσ)" error={errors.err_k}>
      {numberInput('err_k', { min: 0, max: 3 })}
    </Field>
  ) : null;
  const fDark = (
    <Field compact={c} id={id('dark_fraction_threshold')} label="Karanlık eşiği (Güneş diski görünür payı ≤)" hint="0 … 0.1; örn. 0.01 = diskin %1’i" error={errors.dark_fraction_threshold}>
      {numberInput('dark_fraction_threshold', { min: 0, max: 0.1 })}
    </Field>
  );
  const fSlope = (
    <Field compact={c} id={id('max_slope_deg')} label="Azami eğim (°, isteğe bağlı)" hint="≤ 20 m DEM gerekir (5 m site DEM’leri uygundur); yoksa SLOPE_UNKNOWN → GRAY. Eğim iniş güvenliği değildir." error={errors.max_slope_deg}>
      {numberInput('max_slope_deg', { min: 0, max: 90 })}
    </Field>
  );
  const fFootprint = (
    <Field compact={c} id={id('slope_footprint_radius_m')} label="Eğim ayak izi yarıçapı (m)" hint="5 … 200" error={errors.slope_footprint_radius_m}>
      {numberInput('slope_footprint_radius_m', { min: 5, max: 200 })}
    </Field>
  );
  const fHeights = (['sun_observer_height_m', 'earth_observer_height_m'] as const).map((key) => (
    <Field compact={c} key={key} id={id(key)} label={key === 'sun_observer_height_m' ? 'Güneş paneli yüksekliği (m, yüzey üstü)' : 'DTE anten yüksekliği (m, yüzey üstü)'} hint="0 … 100 m; öneriler 1 / 4 / 40 m" error={errors[key]}>
      <div className="flex gap-2">
        {numberInput(key, { min: 0, max: 100 })}
        {HEIGHT_PRESETS.map((h) => (
          <button key={h} type="button" className={`btn shrink-0 px-2 ${c ? 'min-h-8 py-1 font-mono text-xs' : ''}`} onClick={() => set(key, String(h))} aria-label={`${h} metre`}>{h}</button>
        ))}
      </div>
    </Field>
  ));
  const constraintFields: { key: 'max_darkness_hours' | 'min_sun_fraction_pct' | 'min_dte_fraction_pct' | 'max_dte_gap_hours'; eng: string; pub: string; hint: string; icon: IconName; tone: string; max: number }[] = [
    { key: 'max_darkness_hours', eng: 'Azami kesintisiz karanlık (saat)', pub: 'En fazla kaç saat karanlıkta kalınabilir?', hint: '0 … 720 saat', icon: 'moon', tone: 'text-violet', max: 720 },
    { key: 'min_sun_fraction_pct', eng: 'Asgari ort. Güneş diski görünürlüğü (%)', pub: 'Güneş en az yüzde kaç görünmeli?', hint: '0 … 100 % (elektrik üretimi değildir)', icon: 'sun', tone: 'text-sun', max: 100 },
    { key: 'min_dte_fraction_pct', eng: 'Asgari DTE görüş payı (%)', pub: 'Dünya en az yüzde kaç görünmeli?', hint: 'Dünya merkezi geometrik görüşü; RF bağlantısı değildir', icon: 'earth', tone: 'text-earth', max: 100 },
    { key: 'max_dte_gap_hours', eng: 'Azami kesintisiz DTE kesintisi (saat)', pub: 'Dünya en fazla kaç saat görünmeyebilir?', hint: '0 … 720 saat', icon: 'satellite', tone: 'text-earth', max: 720 },
  ];
  const fConstraint = (f: (typeof constraintFields)[number]) => (
    <Field compact={c} id={id(f.key)} label={engineer ? f.eng : f.pub} hint={f.hint} error={errors[f.key]}>
      {numberInput(f.key, { min: 0, max: f.max })}
    </Field>
  );
  const uncertaintyOptions: [UncertaintyMode, string, string, string | null][] = [
    ['nominal', 'Nominal', engineer ? 'Yalnız DEM. Tek başına GREEN üretemez (en iyi durumda GRAY).'
      : 'Hızlı ön bakış: yalnız arazi haritasının kendisi. Tek başına “uygun” diyemez; sonuç en iyi durumda “belirsiz” olur.', null],
    ['err', 'ERR ±k', engineer
      ? (errAvailable ? 'ERR katmanı mevcut. ±k duyarlılık senaryosu; istatistiksel güven aralığı değildir.' : 'Bu katman için ERR dosyası yok → sonuç GRAY olur.')
      : (errAvailable ? 'NASA’nın arazi hata haritasıyla dağlar biraz yükseltilip alçaltılarak denenir. “Uygun” kararı için gereklidir; istatistiksel güven aralığı değildir.' : 'Bu arazi katmanı için hata haritası yok; seçilirse sonuç “belirsiz” olur.'),
      errAvailable && !engineer ? 'Önerilen' : null],
    ['clone', 'DEM clone', cloneHelp(health, engineer), null],
  ];
  const fUncertainty = (
    <div role="radiogroup" aria-label="Belirsizlik modu" className={`grid gap-2 ${engineer ? 'sm:grid-cols-3' : ''}`}>
      {uncertaintyOptions.map(([value, label, help, badge]) => {
        const checked = form.uncertainty_mode === value;
        return (
          <label key={value} className={`cursor-pointer rounded-xl border transition ${c ? 'p-2 text-xs' : 'p-3 text-sm'} ${checked ? 'border-accent/70 bg-accent/10 shadow-[0_0_18px_-10px_var(--color-neon)]' : 'border-line bg-panel-2 hover:border-line-strong'}`}>
            <span className={`flex items-center gap-2 font-medium ${c ? 'font-mono' : ''}`}>
              <input type="radio" name={id('mode')} value={value} checked={checked} onChange={() => set('uncertainty_mode', value)} />
              {label}
              {badge && <span className="chip border-go/50 text-go">{badge}</span>}
            </span>
            <span className={`mt-1 block text-muted ${c ? 'font-mono text-[10.5px] leading-snug' : 'text-xs'}`}>{help}</span>
          </label>
        );
      })}
    </div>
  );

  const loadBox = (
    <div className={`rounded-xl border border-line p-3 text-xs text-muted ${c ? 'term font-mono text-[11px]' : 'bg-panel-2'}`} aria-live="polite">
      <p className="font-semibold text-ink">Tahmini hesap yükü (süre vaadi değildir)</p>
      <p>
        Zaman serisi: <span className="mono text-ink">{built.points ?? '—'}</span> örnek × <span className="mono text-ink">{built.scenarioCount}</span> senaryo
        {built.points !== null && <> = <span className="mono text-ink">{built.points * built.scenarioCount}</span> Güneş/Dünya konumu (sınır 12000)</>}.
      </p>
      {engineer && (
        <p>
          Ufuk: 3600 azimut × <span className="mono text-ink">{profileCount}</span> profil{sameHeights ? ' (panel ve anten aynı yükseklikte → tek profil)' : ''}; 200 km’de ışın başına ~1270 DEM örneği.
          İlk hesap DEM ve diske bağlı olarak dakikalar sürebilir; aynı parametreler önbellekten gelir.
        </p>
      )}
      {errors.budget && <p className="mt-1 font-medium text-stop">{errors.budget}</p>}
    </div>
  );

  const feedback = (
    <>
      {serverError !== null && (
        <Notice explained={explainError(serverError)} focusOnMount>
          {engineer && serverError instanceof ApiError && serverError.details.length > 0 && (
            <ul className="mono list-inside list-disc text-xs">
              {serverError.details.map((d, i) => <li key={i}>{d.field ?? '(gövde)'}: {d.message}</li>)}
            </ul>
          )}
        </Notice>
      )}
      {lastQueued && serverError === null && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-go/40 bg-go/10 p-3 text-sm text-go">
          <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Analiz kuyruğa alındı (HTTP 202): <span className="mono">{lastQueued.slice(0, 8)}</span>. Durum sağdaki listede izleniyor.
            Karşılaştırma için yalnızca konumu değiştirip tekrar gönderin.
          </span>
        </p>
      )}
    </>
  );

  const submitLabel = submitting ? <><Icon name="spinner" /> Gönderiliyor…</> : <><Icon name="rocket" /> Analizi başlat</>;

  /* =================================================================== Mühendis: cockpit */
  if (engineer) {
    const lat = parsed(form.latitude);
    const lon = parsed(form.longitude);
    const unit = lat !== null && lon !== null && !built.errors.latitude && !built.errors.longitude ? latrecKm(1, lat, lon) : null;
    const invalidCount = Object.keys(built.errors).length;
    return (
      <form onSubmit={submit} noValidate className="space-y-3" aria-labelledby={id('title')}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">POST /analyses · görev girdisi</p>
            <h2 id={id('title')} className="panel-title">Görev tanımı — tüm parametreler</h2>
          </div>
          <p className={`chip font-mono ${built.input ? 'border-go/50 text-go' : 'border-caution/50 text-caution'}`}>
            <span className="led" aria-hidden />
            {built.input ? 'gövde geçerli' : `${invalidCount} alan bekliyor`}
          </p>
        </div>

        <fieldset className="module space-y-2">
          <legend className="sr-only">1 · Konum ve arazi verisi</legend>
          <p className="module-title" aria-hidden><Icon name="pin" className="h-3.5 w-3.5" /> 01 · Konum / DEM</p>
          {fDataset}
          {datasetNotes}
          <div className="grid gap-2 sm:grid-cols-2">{fLat}{fLon}</div>
          <p className="font-mono text-[10.5px] leading-snug text-muted">
            {FRAME} · planetosentrik, doğu-pozitif · R_ref {MOON_RADIUS_KM} km · û = {unit ? `(${unit.map((v) => v.toFixed(5)).join(', ')})` : '—'}
            <span className="block">r = R_ref + (h_DEM + h_obs)/1000; h_DEM sonuçla birlikte API’den gelir.</span>
          </p>
          {exampleCoordinate}
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">2 · Zaman (UTC)</legend>
          <p className="module-title" aria-hidden><Icon name="clock" className="h-3.5 w-3.5" /> 02 · Zaman (UTC)</p>
          <div className="grid gap-2 sm:grid-cols-2">{fDate}{fTime}</div>
          {isoLine}
          <div className="grid gap-2 sm:grid-cols-3">{fDuration}{fBuffer}{fStep}</div>
          {fShifts}
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">3 · Gözlemci ve ufuk</legend>
          <p className="module-title" aria-hidden><Icon name="radar" className="h-3.5 w-3.5" /> 03 · Gözlemci / ufuk</p>
          {fRadius}
          <div className="grid gap-2 sm:grid-cols-2">{fHeights}</div>
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">4 · Belirsizlik</legend>
          <p className="module-title" aria-hidden><Icon name="layers" className="h-3.5 w-3.5" /> 04 · Belirsizlik</p>
          {fUncertainty}
          <div className="grid gap-2 sm:grid-cols-2">{fErrK}{fDark}</div>
        </fieldset>

        <fieldset className="module space-y-2">
          <legend className="sr-only">5 · Görev kısıtları</legend>
          <p className="module-title" aria-hidden><Icon name="target" className="h-3.5 w-3.5" /> 05 · Görev kısıtları</p>
          <p className="font-mono text-[10.5px] text-muted">Varsayılanlar belgelerdeki örnek değerlerdir; NASA tarafından önerilmiş görev sınırları değildir. Boş bırakılan kısıt değerlendirilmez.</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {constraintFields.map((f) => <div key={f.key}>{fConstraint(f)}</div>)}
            {fSlope}
            {fFootprint}
          </div>
          {errors.constraints && <p className="text-xs font-medium text-stop">{errors.constraints}</p>}
        </fieldset>

        {loadBox}
        <details className="module text-[11px]">
          <summary className="cursor-pointer font-mono text-term">İstek gövdesi önizlemesi (POST /analyses, JSON)</summary>
          {built.input
            ? <pre className="mono mt-2 max-h-56 overflow-auto text-[11px] leading-snug text-ink">{JSON.stringify(built.input, null, 2)}</pre>
            : <p className="mt-2 font-mono text-caution">Gövde henüz oluşturulamadı: {Object.keys(built.errors).join(', ')}</p>}
        </details>
        {feedback}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitLabel}</button>
          <button type="button" className="btn" onClick={reset}>Formu sıfırla</button>
        </div>
      </form>
    );
  }

  /* =================================================================== Halk: wizard */
  const sitePicks = (sites?.sites ?? []).filter((s): s is SiteLayer & { footprint: NonNullable<SiteLayer['footprint']> } =>
    s.kind === 'site' && s.available && Boolean(s.footprint));
  const lat = parsed(form.latitude);
  const lon = parsed(form.longitude);
  const modeLabel = uncertaintyOptions.find(([v]) => v === form.uncertainty_mode)?.[1] ?? form.uncertainty_mode;
  const summary: { step: WizardStep; icon: IconName; label: string; value: string }[] = [
    { step: 'site', icon: 'pin', label: 'Konum', value: `${lat !== null && lon !== null && !built.errors.latitude && !built.errors.longitude ? formatLatLon(lat, lon) : 'koordinat girilmedi'} · ${form.dataset_id}${site ? ` (${site.resolution_m} m)` : ''}` },
    { step: 'time', icon: 'clock', label: 'Zaman', value: `${isoPreview ? isoPreview.replace('T', ' ').replace('Z', ' UTC') : 'geçersiz'} · ${form.duration_hours || '—'} sa görev · kaymalar ${[...form.shifts].sort((a, b) => a - b).map((s) => `+${s}`).join(', ')} sa` },
    { step: 'needs', icon: 'target', label: 'İhtiyaçlar', value: [
      form.max_darkness_hours && `karanlık ≤ ${form.max_darkness_hours} sa`, form.min_sun_fraction_pct && `Güneş ≥ %${form.min_sun_fraction_pct}`,
      form.min_dte_fraction_pct && `Dünya ≥ %${form.min_dte_fraction_pct}`, form.max_dte_gap_hours && `Dünya kesintisi ≤ ${form.max_dte_gap_hours} sa`,
    ].filter(Boolean).join(' · ') || 'kısıt yok' },
    { step: 'needs', icon: 'satellite', label: 'Ekipman', value: `panel ${form.sun_observer_height_m || '—'} m · anten ${form.earth_observer_height_m || '—'} m yükseklikte` },
    { step: 'review', icon: 'layers', label: 'Belirsizlik', value: modeLabel },
  ];
  const advancedSummary = [
    `tampon ${form.buffer_hours || '—'} sa`, `adım ${form.step_minutes || '—'} dk`, `${form.horizon_radius_km || '—'} km`,
    form.uncertainty_mode === 'err' ? `k ${form.err_k}` : null, `eğim ${form.max_slope_deg ? `≤ ${form.max_slope_deg}°` : 'değerlendirilmiyor'}`,
  ].filter(Boolean).join(' · ');

  const panelFor = (k: WizardStep, body: ReactNode) => {
    const def = WIZARD_STEPS.find((s) => s.key === k)!;
    const n = WIZARD_STEPS.indexOf(def) + 1;
    return (
      <section key={k} hidden={step !== k} aria-labelledby={id(`step-${k}`)} className="space-y-4" data-step={k}>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/40 bg-[rgb(31_98_224/0.25)] text-neon shadow-[0_0_24px_-10px_var(--color-neon)]">
            <Icon name={def.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">Adım {n} / {WIZARD_STEPS.length} · {def.title}</p>
            <h3 id={id(`step-${k}`)} tabIndex={-1} ref={(el) => { stepHeadings.current[k] = el; }}
              className="font-display text-lg font-semibold leading-snug text-ink focus:outline-none sm:text-xl">{def.question}</h3>
            <p className="mt-1 text-sm text-muted">{def.intro}</p>
          </div>
        </div>
        {body}
      </section>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-labelledby={id('title')}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="eyebrow">Keşif modu</p>
          <h2 id={id('title')} className="panel-title">Görev Sihirbazı</h2>
          <p className="text-sm text-muted">4 adımda gerçek NASA verisiyle bir iniş penceresi analizi.</p>
        </div>
      </div>
      <Stepper steps={WIZARD_STEPS} active={step} states={stepStates} onSelect={(k) => goTo(k)} />

      {panelFor('site', (
        <>
          {sitePicks.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Keşfet: NASA’nın 5 m çözünürlüklü arazi karoları</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {sitePicks.map((s) => {
                  const chosen = form.dataset_id === s.id && lat === s.footprint.center.lat && lon === s.footprint.center.lon;
                  return (
                    <li key={s.id}>
                      <button type="button" aria-pressed={chosen}
                        onClick={() => { set('dataset_id', s.id); set('latitude', String(s.footprint.center.lat)); set('longitude', String(s.footprint.center.lon)); }}
                        className={`flex w-full items-start gap-2 rounded-xl border p-2.5 text-left text-sm transition ${chosen ? 'border-accent/70 bg-accent/10' : 'border-line bg-panel-2 hover:border-line-strong'}`}>
                        <Icon name="moon" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{s.region_name ?? s.id}</span>
                          <span className="mono block text-xs text-muted">{s.id} · {s.footprint.width_km.toFixed(1)} × {s.footprint.height_km.toFixed(1)} km karo merkezi</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="hint">Karo merkezi, PGDA raster kapsamının merkezidir; NASA’nın resmi iniş adayı değildir. Bölge adları PGDA LOLA 5 m README’sinden gelir.</p>
            </div>
          )}
          {fDataset}
          {datasetNotes}
          <div className="grid gap-3 sm:grid-cols-2">{fLat}{fLon}</div>
          {exampleCoordinate}
        </>
      ))}

      {panelFor('time', (
        <>
          <div className="grid gap-3 sm:grid-cols-2">{fDate}{fTime}</div>
          {isoLine}
          {fDuration}
          {fShifts}
        </>
      ))}

      {panelFor('needs', (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {constraintFields.map((f) => (
              <div key={f.key} className="rounded-xl border border-line bg-panel-2 p-3">
                <span className={`mb-1 flex ${f.tone}`} aria-hidden><Icon name={f.icon} className="h-5 w-5" /></span>
                {fConstraint(f)}
              </div>
            ))}
          </div>
          {errors.constraints && <p className="text-xs font-medium text-stop">{errors.constraints}</p>}
          <fieldset className="space-y-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-ink">Ekipman yüksekliği</legend>
            <p className="text-xs text-muted">Güneş paneli ve Dünya’ya bakan anten yerden ne kadar yüksekte? Yükseldikçe yakındaki tepeler daha az engel olur.</p>
            <div className="grid gap-3 sm:grid-cols-2">{fHeights}</div>
          </fieldset>
        </>
      ))}

      {panelFor('review', (
        <>
          <fieldset className="space-y-2">
            <legend className="label">Arazi belirsizliği nasıl hesaba katılsın?</legend>
            {fUncertainty}
          </fieldset>
          <div className="rounded-xl border border-line bg-panel-2 p-3">
            <p className="mb-2 text-sm font-semibold text-ink">Görev özeti</p>
            <dl className="space-y-1.5 text-sm">
              {summary.map((row) => (
                <div key={row.label} className="flex items-start gap-2">
                  <Icon name={row.icon} className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <dt className="w-24 shrink-0 text-muted">{row.label}</dt>
                  <dd className="min-w-0 flex-1 text-ink">{row.value}</dd>
                  {row.step !== 'review' && (
                    <button type="button" className="link shrink-0 text-xs" onClick={() => goTo(row.step)}>
                      Düzenle<span className="sr-only">: {row.label}</span>
                    </button>
                  )}
                </div>
              ))}
            </dl>
          </div>
          {loadBox}
          <details
            className="rounded-xl border border-line bg-panel-2 p-3"
            open={advancedOpen || advancedHasError}
            onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
            data-testid="advanced-settings"
          >
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              Gelişmiş görev ayarları
              <span className="mt-0.5 block text-xs font-normal text-muted">{advancedSummary}{advancedHasError ? ' · düzeltilmesi gereken alan var' : ''}</span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {fBuffer}
              {fStep}
              <div className="sm:col-span-2">{fRadius}</div>
              {fErrK}
              {fDark}
              {fSlope}
              {fFootprint}
            </div>
          </details>
        </>
      ))}

      {feedback}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button type="button" className="btn" onClick={prevStep} disabled={stepIndex === 0}>
          <Icon name="chevron-left" /> Geri
        </button>
        {stepIndex < WIZARD_STEPS.length - 1 && (
          <button type="button" className="btn btn-primary" onClick={nextStep}>
            İleri: {WIZARD_STEPS[stepIndex + 1]?.title} <Icon name="chevron-right" />
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className="btn" onClick={reset}>Formu sıfırla</button>
        <button type="submit" className={`btn ${stepIndex === WIZARD_STEPS.length - 1 ? 'btn-primary' : 'border-accent/60 text-accent'}`} disabled={submitting}>
          {submitLabel}
        </button>
      </div>
      <p className="hint -mt-2">Sonraki adımlar örnek değerlerle hazırdır; konumu girdikten sonra dilediğiniz adımda “Analizi başlat” diyebilirsiniz.</p>
    </form>
  );
}
