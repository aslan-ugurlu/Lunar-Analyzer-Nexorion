import type { EffresLayer, Horizon, Mission } from '../api/types';
import { violationText } from '../api/errors';
import { formatDeg, formatLatLon, formatNumber, formatViolationValue } from '../lib/format';
import { bandWidth, FRAME, latrecKm, MOON_RADIUS_KM, observerAltitudes, profileDifference, profileExtremes, violationRows } from '../lib/telemetry';
import { formatUtc } from '../lib/utc';
import type { AnalysisEntry } from '../state/AppState';
import { KeyValue } from './ui';
import { defineStrings, pick, useStrings } from '../i18n';

const STR = defineStrings({
  en: {
    effresOk: (name: string, pixel: number, band: string, observer: string, median: string, p90: string) =>
      `${name} (${pixel} m pixel, ${band}): observer ${observer} · median ${median} · p90 ${p90}`,
    effresWhy: { MISSING: 'not downloaded', NOT_PUBLISHED: 'not published by PGDA (_toterr is used)' } as Record<string, string>,
    clone: (n: number, layer: string, tile: string, p: number, demLo: string, demHi: string) =>
      `${n} clones · ${layer} (${tile}) · conservative = clone p${p} · observer DEM ${demLo}–${demHi} m`,
    clonePass: (pass: number, n: number) => ` · +0 h: ${pass}/${n} clones meet all constraints`,
    cloneProfile: (key: string) => ` · profile ${key}`,
    title: 'Telemetry and traceability',
    frameKey: 'Frame',
    frame: (frame: string, r: number) => `${frame} · reference sphere R = ${r} km · radial local vertical · azimuth 0° = N, 90° = E`,
    locationKey: 'Location',
    location: (place: string, lat: number, lon: number) => `${place} · (${lat}, ${lon}) ME planetocentric, east-positive`,
    panel: 'panel',
    antenna: 'antenna',
    layersKey: 'DEM layers',
    noHorizon: 'no horizon',
    datasetKey: 'Selected dataset',
    effresKey: 'Effective resolution (EFFRES)',
    fieldAbsent: '— (field not in this result)',
    unusedKey: 'Unused layers',
    horizonKey: 'Horizon',
    horizon: (r: number, n: number, status: string) => `${r} km · ${n} azimuths · status ${status}`,
    radiusKey: 'Radius rule',
    radius: (code: string, r: number, ref: number, before: string, after: string) => `${code} · r ${r} km / reference ${ref} km · ${before} → ${after}`,
    greenCap: ' (GREEN cap)',
    uncertaintyKey: 'Uncertainty',
    observerSigma: (v: string) => ` · observer σ = ${v}`,
    cloneKey: 'DEM clone ensemble',
    timeKey: 'Time',
    time: (utc: string, duration: number, buffer: number, step: number, shifts: string) =>
      `landing ${utc} · ${duration} + ${buffer} h · Δt ${step} min · slips ${shifts} h`,
    slopeKey: 'Slope',
    slopeUnknown: (status: string) => `unknown (${status})`,
    slope: (max: string, mean: string, source: string | undefined, dx: number | undefined, r: number | undefined, status: string) =>
      `max ${max} · mean ${mean} · ${source} · Δ ${dx} m · r ${r} m · ${status}`,
    cacheKey: 'Cache key',
    altitudeTable: 'Observer altitude table',
    altitudeCaption: (r: number) => `Observer altitude: r = ${r} km + (h_DEM + h_obs) / 1000`,
    sensor: 'Sensor',
    solarPanel: 'Solar panel',
    dteAntenna: 'DTE antenna',
    noViolations: 'No constraint violations (in every scenario and variant).',
    violationTable: 'Constraint violation UTC intervals table',
    violationCaption: 'Constraint violations and UTC intervals (intervals are tracked only for duration constraints; “—” for share constraints)',
    th: { code: 'Code', scenario: 'Scenario', variant: 'Variant', observed: 'Observed', limit: 'Limit', excess: 'Difference', start: 'Start (UTC)', end: 'End (UTC)' },
    hours: 'h',
    extremes: (min: string, minAz: string, max: string, maxAz: string) => `min ${min}° @ ${minAz}° · max ${max}° @ ${maxAz}°`,
    missingRays: (n: number) => ` · missing rays ${n}`,
    noValid: 'no valid value',
    statsLabel: 'Horizon summary',
    statsTitle: 'Horizon summary (from the API profiles)',
    panelHorizon: (h: number) => `Panel horizon (h_obs ${h} m)`,
    antennaHorizon: (h: number) => `Antenna horizon (h_obs ${h} m)`,
    sameHeight: 'same height as the panel → same profile',
    diffKey: 'Antenna − panel difference',
    diff: (maxAbs: string, atAz: string, mean: string, n: number) => `max |Δ| ${maxAbs}° @ ${atAz}° · mean Δ ${mean}° (${n} azimuths)`,
    noDiff: 'none (same height)',
    cloneBand: 'Clone band (p95 − p05)',
    errBand: 'ERR band (conservative − optimistic)',
    band: (min: string, mean: string, max: string) => `min ${min}° · mean ${mean}° · max ${max}°`,
    noBand: 'none (nominal mode or no ERR layer)',
    coverageKey: 'Coverage',
    coverage: (status: string, r: number, n: number) => `${status} · ${r} km · ${n} azimuths (0.1°)`,
    rayCoverage: (min: string, covered: number, total: number) => ` · ray DEM coverage min ${min}, ${covered}/${total} at ≥ 0.999`,
  },
  tr: {
    effresOk: (name: string, pixel: number, band: string, observer: string, median: string, p90: string) =>
      `${name} (${pixel} m piksel, ${band}): gözlemci ${observer} · medyan ${median} · p90 ${p90}`,
    effresWhy: { MISSING: 'indirilmedi', NOT_PUBLISHED: 'PGDA yayımlamıyor (_toterr kullanılır)' },
    clone: (n: number, layer: string, tile: string, p: number, demLo: string, demHi: string) =>
      `${n} clone · ${layer} (${tile}) · ihtiyatlı = clone p${p} · gözlemci DEM ${demLo}–${demHi} m`,
    clonePass: (pass: number, n: number) => ` · +0 sa: ${pass}/${n} clone tüm kısıtları sağlıyor`,
    cloneProfile: (key: string) => ` · profil ${key}`,
    title: 'Telemetri ve izlenebilirlik',
    frameKey: 'Frame',
    frame: (frame: string, r: number) => `${frame} · referans küre R = ${r} km · radyal yerel düşey · azimut 0° = K, 90° = D`,
    locationKey: 'Konum',
    location: (place: string, lat: number, lon: number) => `${place} · (${lat}, ${lon}) ME planetosentrik, doğu-pozitif`,
    panel: 'panel',
    antenna: 'anten',
    layersKey: 'DEM katmanları',
    noHorizon: 'ufuk yok',
    datasetKey: 'Seçili dataset',
    effresKey: 'Etkin çözünürlük (EFFRES)',
    fieldAbsent: '— (bu sonuçta alan yok)',
    unusedKey: 'Kullanılmayan katmanlar',
    horizonKey: 'Ufuk',
    horizon: (r: number, n: number, status: string) => `${r} km · ${n} azimut · durum ${status}`,
    radiusKey: 'Yarıçap kuralı',
    radius: (code: string, r: number, ref: number, before: string, after: string) => `${code} · r ${r} km / referans ${ref} km · ${before} → ${after}`,
    greenCap: ' (GREEN tavanı)',
    uncertaintyKey: 'Belirsizlik',
    observerSigma: (v: string) => ` · gözlemci σ = ${v}`,
    cloneKey: 'DEM clone topluluğu',
    timeKey: 'Zaman',
    time: (utc: string, duration: number, buffer: number, step: number, shifts: string) =>
      `iniş ${utc} · ${duration} + ${buffer} sa · Δt ${step} dk · kaymalar ${shifts} sa`,
    slopeKey: 'Eğim',
    slopeUnknown: (status: string) => `bilinmiyor (${status})`,
    slope: (max: string, mean: string, source: string | undefined, dx: number | undefined, r: number | undefined, status: string) =>
      `maks ${max} · ort ${mean} · ${source} · Δ ${dx} m · r ${r} m · ${status}`,
    cacheKey: 'Önbellek anahtarı',
    altitudeTable: 'Gözlemci kotu tablosu',
    altitudeCaption: (r: number) => `Gözlemci kotu: r = ${r} km + (h_DEM + h_obs) / 1000`,
    sensor: 'Sensör',
    solarPanel: 'Güneş paneli',
    dteAntenna: 'DTE anteni',
    noViolations: 'Kısıt ihlali yok (tüm senaryo ve varyantlarda).',
    violationTable: 'Kısıt ihlal UTC aralıkları tablosu',
    violationCaption: 'Kısıt ihlalleri ve UTC aralıkları (aralık yalnız süre kısıtlarında izlenir; pay kısıtlarında “—”)',
    th: { code: 'Kod', scenario: 'Senaryo', variant: 'Varyant', observed: 'Gözlenen', limit: 'Sınır', excess: 'Fark', start: 'Başlangıç (UTC)', end: 'Bitiş (UTC)' },
    hours: 'sa',
    extremes: (min: string, minAz: string, max: string, maxAz: string) => `min ${min}° @ ${minAz}° · maks ${max}° @ ${maxAz}°`,
    missingRays: (n: number) => ` · eksik ışın ${n}`,
    noValid: 'geçerli değer yok',
    statsLabel: 'Ufuk özeti',
    statsTitle: 'Ufuk özeti (API profillerinden)',
    panelHorizon: (h: number) => `Panel ufku (h_obs ${h} m)`,
    antennaHorizon: (h: number) => `Anten ufku (h_obs ${h} m)`,
    sameHeight: 'panel ile aynı yükseklik → aynı profil',
    diffKey: 'Anten − panel farkı',
    diff: (maxAbs: string, atAz: string, mean: string, n: number) => `maks |Δ| ${maxAbs}° @ ${atAz}° · ort Δ ${mean}° (${n} azimut)`,
    noDiff: 'yok (aynı yükseklik)',
    cloneBand: 'Clone bandı (p95 − p05)',
    errBand: 'ERR bandı (ihtiyatlı − iyimser)',
    band: (min: string, mean: string, max: string) => `min ${min}° · ort ${mean}° · maks ${max}°`,
    noBand: 'yok (nominal mod veya ERR katmanı yok)',
    coverageKey: 'Kapsama',
    coverage: (status: string, r: number, n: number) => `${status} · ${r} km · ${n} azimut (0.1°)`,
    rayCoverage: (min: string, covered: number, total: number) => ` · ışın DEM kapsaması min ${min}, ≥ 0.999 olan ${covered}/${total}`,
  },
});

/** EFFRES per layer, copied from the API (metres): observer value and principal-band median/p90. Current language. */
export function effresText(layers: Record<string, EffresLayer>): string {
  const s = pick(STR);
  return Object.entries(layers).map(([name, l]) => {
    const band = `${l.band_km[0]}–${l.band_km[1]} km`;
    if (l.status === 'OK') {
      return s.effresOk(name, l.pixel_m, band, l.at_observer_m != null ? formatNumber(l.at_observer_m, 0, 'm') : '—',
        formatNumber(l.median_m ?? null, 0, 'm'), formatNumber(l.p90_m ?? null, 0, 'm'));
    }
    const why = s.effresWhy[l.status] ?? l.status;
    return `${name}: ${why}`;
  }).join('  |  ');
}

/** Clone ensemble provenance and joint pass share of the baseline scenario (copied from the API). */
function cloneText(horizon: Horizon, mission: Mission | undefined): string {
  const t = pick(STR);
  const c = horizon.clone_ensemble!;
  const base = mission?.scenarios.find((s) => s.shift_hours === 0)?.variants.cautious?.clone;
  return t.clone(c.n_clones, c.cloned_layer, c.site_tile, c.percentile, c.observer_dem_m_range[0].toFixed(2), c.observer_dem_m_range[1].toFixed(2)) +
    (base?.pass_count != null ? t.clonePass(base.pass_count, base.n) : '') + t.cloneProfile(c.profile_key.slice(0, 12));
}

/** Engineer-only telemetry: every value is copied from the request or the API result. */
export function TelemetryPanel({ entry, horizon, mission }: { entry: AnalysisEntry; horizon: Horizon | undefined; mission: Mission | undefined }) {
  const i = entry.input;
  const altitudes = horizon ? observerAltitudes(horizon) : [];
  const layers = horizon ? Object.keys(horizon.sources) : [];
  const slope = mission?.slope;
  const t = useStrings(STR);
  const rp = mission?.radius_policy;
  return (
    <section className="term space-y-3 rounded-xl p-3" aria-labelledby={`tel-${entry.id}`}>
      <h4 id={`tel-${entry.id}`} className="module-title !mb-0">{t.title}</h4>
      <KeyValue
        dense
        items={[
          [t.frameKey, t.frame(FRAME, MOON_RADIUS_KM)],
          [t.locationKey, t.location(formatLatLon(i.latitude, i.longitude), i.latitude, i.longitude)],
          ...(altitudes.length > 0 ? [['MOON_ME x, y, z (km)', altitudes.map((a) => `${a.body === 'sun' ? t.panel : t.antenna} (${latrecKm(a.radiusKm, i.latitude, i.longitude).map((v) => v.toFixed(4)).join(', ')})`).join('  |  ') + ' · latrec(r, λ, φ)'] as [string, string]] : []),
          [t.layersKey, horizon ? layers.map((n) => `${n} · ${horizon.layer_resolution_m?.[n] ?? '?'} m · ${horizon.sources[n]}`).join('  |  ') : t.noHorizon],
          [t.datasetKey, horizon?.selected_dataset_id ?? i.dataset_id],
          [t.effresKey, horizon?.effective_resolution ? effresText(horizon.effective_resolution.layers) : t.fieldAbsent],
          ...(horizon?.excluded_layers && Object.keys(horizon.excluded_layers).length > 0
            ? [[t.unusedKey, Object.entries(horizon.excluded_layers).map(([k, v]) => `${k}: ${v}`).join(' | ')] as [string, string]]
            : []),
          [t.horizonKey, horizon ? t.horizon(horizon.reference_radius_km, horizon.azimuth_deg.length, horizon.status) : '—'],
          [t.radiusKey, rp
            ? `${t.radius(rp.code, rp.radius_km, rp.reference_radius_km, rp.status_before_policy, rp.status_after_policy)}${rp.capped ? t.greenCap : ''}`
            : t.fieldAbsent],
          [t.uncertaintyKey, horizon ? `${horizon.uncertainty_mode}${horizon.k !== null ? ` · k = ${horizon.k}` : ''}${horizon.geometry.observer_err_m !== null ? t.observerSigma(formatNumber(horizon.geometry.observer_err_m, 3, 'm')) : ''}` : i.uncertainty_mode],
          ...(horizon?.clone_ensemble ? [[t.cloneKey, cloneText(horizon, mission)] as [string, string]] : []),
          [t.timeKey, t.time(formatUtc(i.landing_utc, true), i.duration_hours, i.buffer_hours, i.step_minutes, i.shifts_hours.map((s) => `+${s}`).join('/'))],
          [t.slopeKey, slope ? (slope.slope_max_deg === null ? t.slopeUnknown(slope.status) :
            t.slope(formatDeg(slope.slope_max_deg, 2), formatDeg(slope.slope_mean_deg, 2), slope.source, slope.sampling_interval_m, slope.footprint_radius_m, slope.status)) : '—'],
          [t.cacheKey, horizon?.cache_key ?? '—'],
        ]}
      />
      {altitudes.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t.altitudeTable}>
          <table className="mono w-full min-w-[520px] text-left text-xs">
            <caption className="mb-1 text-left text-[11px] text-muted">{t.altitudeCaption(MOON_RADIUS_KM)}</caption>
            <thead className="text-term/90">
              <tr><th className="py-1 pr-3">{t.sensor}</th><th className="pr-3">h_DEM (m)</th><th className="pr-3">h_obs (m)</th><th className="pr-3">h_DEM + h_obs (m)</th><th>r (km)</th></tr>
            </thead>
            <tbody>
              {altitudes.map((a) => (
                <tr key={a.body} className="border-t border-line">
                  <td className="py-1 pr-3">{a.body === 'sun' ? t.solarPanel : t.dteAntenna}</td>
                  <td className="pr-3">{a.demM.toFixed(2)}</td>
                  <td className="pr-3">{a.sensorM.toFixed(2)}</td>
                  <td className="pr-3">{a.totalM.toFixed(2)}</td>
                  <td>{a.radiusKm.toFixed(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ViolationTable mission={mission} />
    </section>
  );
}

export function ViolationTable({ mission }: { mission: Mission | undefined }) {
  const t = useStrings(STR);
  const rows = violationRows(mission);
  if (rows.length === 0) {
    return <p className="font-mono text-xs text-go">{t.noViolations}</p>;
  }
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t.violationTable}>
      <table className="mono w-full min-w-[760px] text-left text-xs">
        <caption className="mb-1 text-left text-[11px] text-muted">
          {t.violationCaption}
        </caption>
        <thead className="text-term/90">
          <tr>
            <th className="py-1 pr-2">{t.th.code}</th><th className="pr-2">{t.th.scenario}</th><th className="pr-2">{t.th.variant}</th><th className="pr-2">{t.th.observed}</th>
            <th className="pr-2">{t.th.limit}</th><th className="pr-2">{t.th.excess}</th><th className="pr-2">{t.th.start}</th><th>{t.th.end}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="border-t border-line align-top">
              <td className="py-1 pr-2 text-stop" title={violationText(r.code)?.label}>{r.code}</td>
              <td className="pr-2">+{r.shift} {t.hours}</td>
              <td className="pr-2">{r.variant}</td>
              <td className="pr-2">{formatViolationValue(r.observed, r.unit)}</td>
              <td className="pr-2">{formatViolationValue(r.limit, r.unit)}</td>
              <td className="pr-2">{formatViolationValue(r.excess, r.unit)}</td>
              <td className="pr-2">{r.start ? formatUtc(r.start, true) : '—'}</td>
              <td>{r.end ? formatUtc(r.end, true) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Engineer: descriptive statistics of the API horizon profiles (no re-computation). */
export function HorizonStats({ horizon }: { horizon: Horizon }) {
  const t = useStrings(STR);
  const az = horizon.azimuth_deg;
  const hSun = horizon.geometry.observer_height_m.sun;
  const hEarth = horizon.geometry.observer_height_m.earth;
  const sun = profileExtremes(az, horizon.profiles.sun.nominal);
  const earth = profileExtremes(az, horizon.profiles.earth.nominal);
  const diff = hSun !== hEarth ? profileDifference(az, horizon.profiles.earth.nominal, horizon.profiles.sun.nominal) : null;
  const band = bandWidth(horizon.profiles.sun);
  const coverage = horizon.profiles.sun.coverage ?? [];
  // coverage[i] = valid / inspected DEM samples along ray i (terrain_engine); copied, not recomputed.
  const covered = coverage.length ? coverage.filter((v) => v >= 0.999).length : null;
  const minCoverage = coverage.length ? Math.min(...coverage) : null;
  const fmt = (e: ReturnType<typeof profileExtremes>) => e
    ? `${t.extremes(e.min.toFixed(3), e.minAz.toFixed(1), e.max.toFixed(3), e.maxAz.toFixed(1))}${e.missing ? t.missingRays(e.missing) : ''}`
    : t.noValid;
  return (
    <section className="term space-y-2 rounded-xl p-3" aria-label={t.statsLabel}>
      <h3 className="module-title !mb-0">{t.statsTitle}</h3>
      <KeyValue dense items={[
        [t.panelHorizon(hSun), fmt(sun)],
        [t.antennaHorizon(hEarth), hSun === hEarth ? t.sameHeight : fmt(earth)],
        [t.diffKey, diff ? t.diff(diff.maxAbs.toFixed(3), diff.atAz.toFixed(1), diff.mean.toFixed(4), diff.n) : t.noDiff],
        [horizon.uncertainty_mode === 'clone' ? t.cloneBand : t.errBand, band ? t.band(band.min.toFixed(4), band.mean.toFixed(4), band.max.toFixed(4)) : t.noBand],
        [t.coverageKey, `${t.coverage(horizon.status, horizon.reference_radius_km, az.length)}${covered !== null && minCoverage !== null ? t.rayCoverage(minCoverage.toFixed(4), covered, coverage.length) : ''}`],
      ]} />
    </section>
  );
}
