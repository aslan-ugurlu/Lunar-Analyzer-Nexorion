import { useId, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { explainError } from '../api/errors';
import type { Health, SitesResponse, UncertaintyMode } from '../api/types';
import { buildRequest, DEFAULT_FORM, fieldForApiPath, LIMITS, type FieldErrors, type MissionForm as Form } from '../lib/mission';
import { utcPartsToIso } from '../lib/utc';
import { useApp } from '../state/AppState';
import { Icon, Notice } from './ui';

const SHIFT_OPTIONS = [0, 24, 48, 72];
const HEIGHT_PRESETS = [1, 4, 40];
/** Fields that live in the "Gelişmiş görev ayarları" accordion in Halk / Eğitimci mode. */
export const ADVANCED_FIELDS: (keyof Form)[] = [
  'buffer_hours', 'step_minutes', 'horizon_radius_km', 'err_k', 'dark_fraction_threshold', 'max_slope_deg', 'slope_footprint_radius_m',
];

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
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

function Legend({ children }: { children: ReactNode }) {
  return <legend className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">{children}</legend>;
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

  const built = useMemo(() => buildRequest(form), [form]);
  const errors: FieldErrors = touched ? { ...built.errors, ...serverFieldErrors } : serverFieldErrors;
  const advancedHasError = ADVANCED_FIELDS.some((k) => Boolean(errors[k]));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerFieldErrors((e) => ({ ...e, [key]: undefined }));
  };
  const id = (name: string) => `${uid}-${name}`;

  const site = sites?.sites.find((s) => s.id === form.dataset_id) ?? null;
  const layer = health?.layers?.[form.dataset_id];
  const errAvailable = site?.uncertainty_err_available ?? layer?.err ?? false;
  const isoPreview = utcPartsToIso(form.landing_date, form.landing_time);
  const sameHeights = form.sun_observer_height_m.trim() === form.earth_observer_height_m.trim();
  const profileCount = (sameHeights ? 1 : 2) * (form.uncertainty_mode === 'err' ? 3 : 1);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setServerError(null);
    setServerFieldErrors({});
    if (!built.input) {
      const first = Object.keys(built.errors)[0];
      if (first && ADVANCED_FIELDS.includes(first as keyof Form)) setAdvancedOpen(true);
      if (first) setTimeout(() => document.getElementById(id(first))?.focus(), 0);
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

  const numberInput = (name: keyof Form, props: { min?: number; max?: number; step?: number | 'any'; required?: boolean; hint?: boolean } = {}) => (
    <input
      id={id(name)}
      className="input mono"
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

  /* ---------- technical fields (accordion in Halk mode, inline in Mühendis mode) ---------- */
  const fBuffer = (
    <Field id={id('buffer_hours')} label="Tampon (saat)" hint={engineer ? '0 … 168' : 'Görev sonrasına eklenen emniyet süresi (0 … 168 sa)'} error={errors.buffer_hours}>
      {numberInput('buffer_hours', { min: 0, max: 168 })}
    </Field>
  );
  const fStep = (
    <Field id={id('step_minutes')} label="Zaman adımı (dakika)" hint={engineer ? '10 … 120, tam sayı' : 'Hesabın kaç dakikada bir yapılacağı (10 … 120)'} error={errors.step_minutes}>
      {numberInput('step_minutes', { min: 10, max: 120, step: 1 })}
    </Field>
  );
  const fRadius = (
    <Field id={id('horizon_radius_km')} label="Ufuk tarama yarıçapı (km)" hint={engineer
      ? '10 … 200. 200 km referans; < 200 km (ör. 135 km hızlı mod) ufku yalnız alçaltabilir → sonuç en fazla YELLOW (REDUCED_HORIZON_RADIUS; V-05: 0.76°’ye kadar fark). Tarama mesafesi eksiksizlik kanıtı değildir.'
      : '10 … 200. 200 km tam tarama; 135 km hızlıdır ama uzaktaki dağları kaçırabilir, bu yüzden “uygun” (GREEN) kararı yalnız 200 km ile verilir.'} error={errors.horizon_radius_km}>
      <div className="flex gap-2">
        {numberInput('horizon_radius_km', { min: 10, max: 200 })}
        {[135, 200].map((r) => (
          <button key={r} type="button" className="btn shrink-0" onClick={() => set('horizon_radius_km', String(r))} aria-label={`Yarıçapı ${r} km yap`}>{r}</button>
        ))}
      </div>
    </Field>
  );
  const fErrK = form.uncertainty_mode === 'err' ? (
    <Field id={id('err_k')} label="ERR çarpanı k" hint="0 … 3 (engel +kσ, gözlemci −kσ)" error={errors.err_k}>
      {numberInput('err_k', { min: 0, max: 3 })}
    </Field>
  ) : null;
  const fDark = (
    <Field id={id('dark_fraction_threshold')} label="Karanlık eşiği (Güneş diski görünür payı ≤)" hint="0 … 0.1; örn. 0.01 = diskin %1’i" error={errors.dark_fraction_threshold}>
      {numberInput('dark_fraction_threshold', { min: 0, max: 0.1 })}
    </Field>
  );
  const fSlope = (
    <Field id={id('max_slope_deg')} label="Azami eğim (°, isteğe bağlı)" hint="≤ 20 m DEM gerekir (5 m site DEM’leri uygundur); yoksa SLOPE_UNKNOWN → GRAY. Eğim iniş güvenliği değildir." error={errors.max_slope_deg}>
      {numberInput('max_slope_deg', { min: 0, max: 90 })}
    </Field>
  );
  const fFootprint = (
    <Field id={id('slope_footprint_radius_m')} label="Eğim ayak izi yarıçapı (m)" hint="5 … 200" error={errors.slope_footprint_radius_m}>
      {numberInput('slope_footprint_radius_m', { min: 5, max: 200 })}
    </Field>
  );

  const advancedSummary = [
    `tampon ${form.buffer_hours || '—'} sa`, `adım ${form.step_minutes || '—'} dk`, `${form.horizon_radius_km || '—'} km`,
    form.uncertainty_mode === 'err' ? `k ${form.err_k}` : null, `eğim ${form.max_slope_deg ? `≤ ${form.max_slope_deg}°` : 'değerlendirilmiyor'}`,
  ].filter(Boolean).join(' · ');

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-labelledby={id('title')}>
      <h2 id={id('title')} className="panel-title">{engineer ? 'Görev tanımı — tüm parametreler' : 'Görev tanımı'}</h2>

      <fieldset className="space-y-3">
        <Legend>1 · Konum ve arazi verisi</Legend>
        <Field id={id('dataset_id')} label="NASA LOLA arazi katmanı (dataset)" hint={site ? `${site.resolution_m} m/piksel${site.region_name ? ` · PGDA bölge adı: ${site.region_name}` : ''} · ${site.note}` : 'Katman listesi /sites uç noktasından gelir.'}>
          <select id={id('dataset_id')} className="input" value={form.dataset_id} onChange={(e) => set('dataset_id', e.target.value)} aria-describedby={`${id('dataset_id')}-hint`}>
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
        {site && !site.available && (
          engineer ? (
            <p role="status" className="rounded-md border border-caution/50 bg-caution/10 p-2 text-xs text-caution">
              Bu katmanın dosyası sunucuda yok ({site.expected_folder}/{site.expected_file}). Analiz isteği <span className="mono">DEM_MISSING</span> ile reddedilir; sonuç uydurulmaz.
            </p>
          ) : (
            <div role="status" className="rounded-md border border-caution/50 bg-caution/10 p-2 text-xs text-caution">
              <p>Bu katman için arazi verisi henüz mevcut değil; bu katmanla analiz başlatılamaz (sonuç uydurulmaz). Arazi verisi mevcut olan bir katman seçin.</p>
              <details className="mt-1 text-muted">
                <summary className="cursor-pointer select-none rounded font-medium text-ink/80">Teknik detaylar</summary>
                <p className="mt-1">Kod: <span className="mono text-ink">DEM_MISSING</span> · beklenen dosya: <span className="mono break-all">{site.expected_folder}/{site.expected_file}</span></p>
              </details>
            </div>
          )
        )}
        {site?.available && site.footprint && !site.footprint.contains_pole && (
          <div className="rounded-md border border-line bg-panel-2 p-2 text-xs text-muted">
            <p>
              Bu DEM karosu {site.footprint.width_km.toFixed(1)} × {site.footprint.height_km.toFixed(1)} km; enlem {site.footprint.lat_range[0].toFixed(3)}° … {site.footprint.lat_range[1].toFixed(3)}°.
              Koordinat bu karonun içinde olmalı; dışındaysa {engineer ? <>analiz <span className="mono">DEM_MISSING</span> döner</> : 'bu katmanda arazi verisi olmadığı için analiz yapılamaz'}.
            </p>
            <button type="button" className="link mt-1" onClick={() => { set('latitude', String(site.footprint!.center.lat)); set('longitude', String(site.footprint!.center.lon)); }}>
              Karonun merkezini doldur ({site.footprint.center.lat.toFixed(4)}°, {site.footprint.center.lon.toFixed(4)}°)
            </button>{' '}— raster kapsamının merkezidir; resmi iniş noktası değildir.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={id('latitude')} label="Enlem (°, planetosentrik)" hint="−90 … −80 (güney kutbu bölgesi)" error={errors.latitude}>
            {numberInput('latitude', { min: LIMITS.latitude.min, max: LIMITS.latitude.max, required: true })}
          </Field>
          <Field id={id('longitude')} label="Boylam (°, doğu-pozitif)" hint="−180 … 180" error={errors.longitude}>
            {numberInput('longitude', { min: LIMITS.longitude.min, max: LIMITS.longitude.max, required: true })}
          </Field>
        </div>
        <p className="text-xs text-muted">
          Hazır “resmi aday” koordinatı sunulmaz: kaynağı doğrulanmamış Shackleton / Connecting Ridge / NASA aday koordinatları uydurulmaz.
          Koordinatınızı Moon Mean-Earth (ME) çerçevesinde girin.{' '}
          <button type="button" className="link" onClick={() => { set('latitude', '-89.54'); set('longitude', '0'); }}>
            Belgelerdeki örnek koordinatı doldur (−89.54°, 0°)
          </button>{' '}
          — yalnızca örnektir, resmi aday değildir.
        </p>
      </fieldset>

      <fieldset className="space-y-3">
        <Legend>2 · Zaman (UTC)</Legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={id('landing_date')} label="İniş tarihi (UTC)" error={errors.landing_date}>
            <input id={id('landing_date')} type="date" className="input mono" min="2026-01-01" max="2035-12-31" value={form.landing_date}
              onChange={(e) => set('landing_date', e.target.value)} aria-invalid={Boolean(errors.landing_date)} aria-describedby={describedBy(id('landing_date'), false, errors.landing_date)} />
          </Field>
          <Field id={id('landing_time')} label="İniş saati (UTC, 24 saat)" hint="Tarayıcı saat dilimi kullanılmaz; girilen değer UTC kabul edilir.">
            <input id={id('landing_time')} type="time" step={60} className="input mono" value={form.landing_time}
              onChange={(e) => set('landing_time', e.target.value)} aria-describedby={`${id('landing_time')}-hint`} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Gönderilecek zaman: <span className="mono text-ink">{isoPreview ?? 'geçersiz'}</span>
        </p>
        <div className={`grid gap-3 ${engineer ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <Field id={id('duration_hours')} label="Görev süresi (saat)" hint="0 < süre ≤ 720" error={errors.duration_hours}>
            {numberInput('duration_hours', { min: 0, max: 720 })}
          </Field>
          {engineer && fBuffer}
          {engineer && fStep}
        </div>
        <fieldset>
          <legend className="label">İniş kayma senaryoları (saat)</legend>
          <div className="flex flex-wrap gap-2">
            {SHIFT_OPTIONS.map((s) => {
              const checked = form.shifts.includes(s);
              return (
                <label key={s} className={`chip cursor-pointer border-line px-3 py-1.5 text-sm ${checked ? 'bg-accent/15 text-accent' : 'text-ink'}`}>
                  <input type="checkbox" className="accent-[var(--color-accent)]" checked={checked} disabled={s === 0}
                    onChange={(e) => set('shifts', e.target.checked ? [...form.shifts, s] : form.shifts.filter((x) => x !== s))} />
                  +{s} sa
                </label>
              );
            })}
          </div>
          <p className="hint">+0 her zaman hesaplanır. Ek kaymalar sonradan Timeline’dan da istenebilir.</p>
          {errors.shifts && <p className="mt-1 text-xs font-medium text-stop">{errors.shifts}</p>}
        </fieldset>
      </fieldset>

      <fieldset className="space-y-3">
        <Legend>3 · Gözlemci{engineer ? ' ve ufuk' : ''}</Legend>
        {engineer && fRadius}
        <div className="grid gap-3 sm:grid-cols-2">
          {(['sun_observer_height_m', 'earth_observer_height_m'] as const).map((key) => (
            <Field key={key} id={id(key)} label={key === 'sun_observer_height_m' ? 'Güneş paneli yüksekliği (m, yüzey üstü)' : 'DTE anten yüksekliği (m, yüzey üstü)'} hint="0 … 100 m; öneriler 1 / 4 / 40 m" error={errors[key]}>
              <div className="flex gap-2">
                {numberInput(key, { min: 0, max: 100 })}
                {HEIGHT_PRESETS.map((h) => (
                  <button key={h} type="button" className="btn shrink-0 px-2" onClick={() => set(key, String(h))} aria-label={`${h} metre`}>{h}</button>
                ))}
              </div>
            </Field>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <Legend>4 · Belirsizlik</Legend>
        <div role="radiogroup" aria-label="Belirsizlik modu" className="grid gap-2 sm:grid-cols-3">
          {([
            ['nominal', 'Nominal', 'Yalnız DEM. Tek başına GREEN üretemez (en iyi durumda GRAY).'],
            ['err', 'ERR ±k', errAvailable ? 'ERR katmanı mevcut. ±k duyarlılık senaryosu; istatistiksel güven aralığı değildir.' : 'Bu katman için ERR dosyası yok → sonuç GRAY olur.'],
            ['clone', 'DEM clone', engineer ? 'Önceden hesaplanmış clone verisi yok → CLONE_NOT_PRECOMPUTED / GRAY.' : 'Bu yöntem için NASA klon verisi henüz hazır değil; seçilirse sonuç “belirsiz” olur.'],
          ] as [UncertaintyMode, string, string][]).map(([value, label, help]) => (
            <label key={value} className={`cursor-pointer rounded-lg border p-3 text-sm ${form.uncertainty_mode === value ? 'border-accent bg-accent/10' : 'border-line bg-panel-2'}`}>
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name={id('mode')} value={value} checked={form.uncertainty_mode === value} onChange={() => set('uncertainty_mode', value)} />
                {label}
              </span>
              <span className="mt-1 block text-xs text-muted">{help}</span>
            </label>
          ))}
        </div>
        {engineer && (
          <div className="grid gap-3 sm:grid-cols-2">
            {fErrK}
            {fDark}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <Legend>5 · Görev kısıtları</Legend>
        <p className="text-xs text-muted">Varsayılanlar belgelerdeki örnek değerlerdir; NASA tarafından önerilmiş görev sınırları değildir. Boş bırakılan kısıt değerlendirilmez.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={id('max_darkness_hours')} label={engineer ? 'Azami kesintisiz karanlık (saat)' : 'En fazla kaç saat karanlıkta kalınabilir?'} hint="0 … 720 saat" error={errors.max_darkness_hours}>{numberInput('max_darkness_hours', { min: 0, max: 720 })}</Field>
          <Field id={id('min_sun_fraction_pct')} label={engineer ? 'Asgari ort. Güneş diski görünürlüğü (%)' : 'Güneş en az yüzde kaç görünmeli?'} hint="0 … 100 % (elektrik üretimi değildir)" error={errors.min_sun_fraction_pct}>{numberInput('min_sun_fraction_pct', { min: 0, max: 100 })}</Field>
          <Field id={id('min_dte_fraction_pct')} label={engineer ? 'Asgari DTE görüş payı (%)' : 'Dünya en az yüzde kaç görünmeli?'} hint="Dünya merkezi geometrik görüşü; RF bağlantısı değildir" error={errors.min_dte_fraction_pct}>{numberInput('min_dte_fraction_pct', { min: 0, max: 100 })}</Field>
          <Field id={id('max_dte_gap_hours')} label={engineer ? 'Azami kesintisiz DTE kesintisi (saat)' : 'Dünya en fazla kaç saat görünmeyebilir?'} hint="0 … 720 saat" error={errors.max_dte_gap_hours}>{numberInput('max_dte_gap_hours', { min: 0, max: 720 })}</Field>
          {engineer && fSlope}
          {engineer && fFootprint}
        </div>
        {errors.constraints && <p className="text-xs font-medium text-stop">{errors.constraints}</p>}
      </fieldset>

      {!engineer && (
        <details
          className="rounded-lg border border-line bg-panel-2 p-3"
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
      )}

      <div className="rounded-lg border border-line bg-panel-2 p-3 text-xs text-muted" aria-live="polite">
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
        <p role="status" className="text-sm text-go">
          Analiz kuyruğa alındı (HTTP 202): <span className="mono">{lastQueued.slice(0, 8)}</span>. Durum sağdaki listede izleniyor.
          Karşılaştırma için yalnızca konumu değiştirip tekrar gönderin.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <><Icon name="spinner" /> Gönderiliyor…</> : 'Analizi başlat'}
        </button>
        <button type="button" className="btn" onClick={() => { setForm(DEFAULT_FORM); setTouched(false); setServerError(null); setServerFieldErrors({}); }}>
          Formu sıfırla
        </button>
      </div>
    </form>
  );
}
