import type { EffresLayer, Horizon, Mission } from '../api/types';
import { VIOLATION_TEXT } from '../api/errors';
import { formatDeg, formatLatLon, formatNumber, formatViolationValue } from '../lib/format';
import { bandWidth, FRAME, latrecKm, MOON_RADIUS_KM, observerAltitudes, profileDifference, profileExtremes, violationRows } from '../lib/telemetry';
import { formatUtc } from '../lib/utc';
import type { AnalysisEntry } from '../state/AppState';
import { KeyValue } from './ui';

/** EFFRES per layer, copied from the API (metres): observer value and principal-band median/p90. */
export function effresText(layers: Record<string, EffresLayer>): string {
  return Object.entries(layers).map(([name, l]) => {
    const band = `${l.band_km[0]}–${l.band_km[1]} km`;
    if (l.status === 'OK') {
      return `${name} (${l.pixel_m} m piksel, ${band}): gözlemci ${l.at_observer_m != null ? formatNumber(l.at_observer_m, 0, 'm') : '—'} · medyan ${formatNumber(l.median_m ?? null, 0, 'm')} · p90 ${formatNumber(l.p90_m ?? null, 0, 'm')}`;
    }
    const why = { MISSING: 'indirilmedi', NOT_PUBLISHED: 'PGDA yayımlamıyor (_toterr kullanılır)' }[l.status] ?? l.status;
    return `${name}: ${why}`;
  }).join('  |  ');
}

/** Clone ensemble provenance and joint pass share of the baseline scenario (copied from the API). */
function cloneText(horizon: Horizon, mission: Mission | undefined): string {
  const c = horizon.clone_ensemble!;
  const base = mission?.scenarios.find((s) => s.shift_hours === 0)?.variants.cautious?.clone;
  return `${c.n_clones} clone · ${c.cloned_layer} (${c.site_tile}) · ihtiyatlı = clone p${c.percentile} · gözlemci DEM ${c.observer_dem_m_range[0].toFixed(2)}–${c.observer_dem_m_range[1].toFixed(2)} m` +
    (base?.pass_count != null ? ` · +0 sa: ${base.pass_count}/${base.n} clone tüm kısıtları sağlıyor` : '') + ` · profil ${c.profile_key.slice(0, 12)}`;
}

/** Engineer-only telemetry: every value is copied from the request or the API result. */
export function TelemetryPanel({ entry, horizon, mission }: { entry: AnalysisEntry; horizon: Horizon | undefined; mission: Mission | undefined }) {
  const i = entry.input;
  const altitudes = horizon ? observerAltitudes(horizon) : [];
  const layers = horizon ? Object.keys(horizon.sources) : [];
  const slope = mission?.slope;
  return (
    <section className="term space-y-3 rounded-xl p-3" aria-labelledby={`tel-${entry.id}`}>
      <h4 id={`tel-${entry.id}`} className="module-title !mb-0">Telemetri ve izlenebilirlik</h4>
      <KeyValue
        dense
        items={[
          ['Frame', `${FRAME} · referans küre R = ${MOON_RADIUS_KM} km · radyal yerel düşey · azimut 0° = K, 90° = D`],
          ['Konum', `${formatLatLon(i.latitude, i.longitude)} · (${i.latitude}, ${i.longitude}) ME planetosentrik, doğu-pozitif`],
          ...(altitudes.length > 0 ? [['MOON_ME x, y, z (km)', altitudes.map((a) => `${a.body === 'sun' ? 'panel' : 'anten'} (${latrecKm(a.radiusKm, i.latitude, i.longitude).map((v) => v.toFixed(4)).join(', ')})`).join('  |  ') + ' · latrec(r, λ, φ)'] as [string, string]] : []),
          ['DEM katmanları', horizon ? layers.map((n) => `${n} · ${horizon.layer_resolution_m?.[n] ?? '?'} m · ${horizon.sources[n]}`).join('  |  ') : 'ufuk yok'],
          ['Seçili dataset', horizon?.selected_dataset_id ?? i.dataset_id],
          ['Etkin çözünürlük (EFFRES)', horizon?.effective_resolution ? effresText(horizon.effective_resolution.layers) : '— (bu sonuçta alan yok)'],
          ...(horizon?.excluded_layers && Object.keys(horizon.excluded_layers).length > 0
            ? [['Kullanılmayan katmanlar', Object.entries(horizon.excluded_layers).map(([k, v]) => `${k}: ${v}`).join(' | ')] as [string, string]]
            : []),
          ['Ufuk', horizon ? `${horizon.reference_radius_km} km · ${horizon.azimuth_deg.length} azimut · durum ${horizon.status}` : '—'],
          ['Yarıçap kuralı', mission?.radius_policy
            ? `${mission.radius_policy.code} · r ${mission.radius_policy.radius_km} km / referans ${mission.radius_policy.reference_radius_km} km · ${mission.radius_policy.status_before_policy} → ${mission.radius_policy.status_after_policy}${mission.radius_policy.capped ? ' (GREEN tavanı)' : ''}`
            : '— (bu sonuçta alan yok)'],
          ['Belirsizlik', horizon ? `${horizon.uncertainty_mode}${horizon.k !== null ? ` · k = ${horizon.k}` : ''}${horizon.geometry.observer_err_m !== null ? ` · gözlemci σ = ${formatNumber(horizon.geometry.observer_err_m, 3, 'm')}` : ''}` : i.uncertainty_mode],
          ...(horizon?.clone_ensemble ? [['DEM clone topluluğu', cloneText(horizon, mission)] as [string, string]] : []),
          ['Zaman', `iniş ${formatUtc(i.landing_utc, true)} · ${i.duration_hours} + ${i.buffer_hours} sa · Δt ${i.step_minutes} dk · kaymalar ${i.shifts_hours.map((s) => `+${s}`).join('/')} sa`],
          ['Eğim', slope ? (slope.slope_max_deg === null ? `bilinmiyor (${slope.status})` :
            `maks ${formatDeg(slope.slope_max_deg, 2)} · ort ${formatDeg(slope.slope_mean_deg, 2)} · ${slope.source} · Δ ${slope.sampling_interval_m} m · r ${slope.footprint_radius_m} m · ${slope.status}`) : '—'],
          ['Önbellek anahtarı', horizon?.cache_key ?? '—'],
        ]}
      />
      {altitudes.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Gözlemci kotu tablosu">
          <table className="mono w-full min-w-[520px] text-left text-xs">
            <caption className="mb-1 text-left text-[11px] text-muted">Gözlemci kotu: r = {MOON_RADIUS_KM} km + (h_DEM + h_obs) / 1000</caption>
            <thead className="text-term/90">
              <tr><th className="py-1 pr-3">Sensör</th><th className="pr-3">h_DEM (m)</th><th className="pr-3">h_obs (m)</th><th className="pr-3">h_DEM + h_obs (m)</th><th>r (km)</th></tr>
            </thead>
            <tbody>
              {altitudes.map((a) => (
                <tr key={a.body} className="border-t border-line">
                  <td className="py-1 pr-3">{a.body === 'sun' ? 'Güneş paneli' : 'DTE anteni'}</td>
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
  const rows = violationRows(mission);
  if (rows.length === 0) {
    return <p className="font-mono text-xs text-go">Kısıt ihlali yok (tüm senaryo ve varyantlarda).</p>;
  }
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Kısıt ihlal UTC aralıkları tablosu">
      <table className="mono w-full min-w-[760px] text-left text-xs">
        <caption className="mb-1 text-left text-[11px] text-muted">
          Kısıt ihlalleri ve UTC aralıkları (aralık yalnız süre kısıtlarında izlenir; pay kısıtlarında “—”)
        </caption>
        <thead className="text-term/90">
          <tr>
            <th className="py-1 pr-2">Kod</th><th className="pr-2">Senaryo</th><th className="pr-2">Varyant</th><th className="pr-2">Gözlenen</th>
            <th className="pr-2">Sınır</th><th className="pr-2">Fark</th><th className="pr-2">Başlangıç (UTC)</th><th>Bitiş (UTC)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx} className="border-t border-line align-top">
              <td className="py-1 pr-2 text-stop" title={VIOLATION_TEXT[r.code]?.label}>{r.code}</td>
              <td className="pr-2">+{r.shift} sa</td>
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
    ? `min ${e.min.toFixed(3)}° @ ${e.minAz.toFixed(1)}° · maks ${e.max.toFixed(3)}° @ ${e.maxAz.toFixed(1)}°${e.missing ? ` · eksik ışın ${e.missing}` : ''}`
    : 'geçerli değer yok';
  return (
    <section className="term space-y-2 rounded-xl p-3" aria-label="Ufuk özeti">
      <h3 className="module-title !mb-0">Ufuk özeti (API profillerinden)</h3>
      <KeyValue dense items={[
        [`Panel ufku (h_obs ${hSun} m)`, fmt(sun)],
        [`Anten ufku (h_obs ${hEarth} m)`, hSun === hEarth ? 'panel ile aynı yükseklik → aynı profil' : fmt(earth)],
        ['Anten − panel farkı', diff ? `maks |Δ| ${diff.maxAbs.toFixed(3)}° @ ${diff.atAz.toFixed(1)}° · ort Δ ${diff.mean.toFixed(4)}° (${diff.n} azimut)` : 'yok (aynı yükseklik)'],
        [horizon.uncertainty_mode === 'clone' ? 'Clone bandı (p95 − p05)' : 'ERR bandı (ihtiyatlı − iyimser)', band ? `min ${band.min.toFixed(4)}° · ort ${band.mean.toFixed(4)}° · maks ${band.max.toFixed(4)}°` : 'yok (nominal mod veya ERR katmanı yok)'],
        ['Kapsama', `${horizon.status} · ${horizon.reference_radius_km} km · ${az.length} azimut (0.1°)${covered !== null && minCoverage !== null ? ` · ışın DEM kapsaması min ${minCoverage.toFixed(4)}, ≥ 0.999 olan ${covered}/${coverage.length}` : ''}`],
      ]} />
    </section>
  );
}
