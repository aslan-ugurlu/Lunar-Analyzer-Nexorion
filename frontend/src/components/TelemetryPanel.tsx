import type { Horizon, Mission } from '../api/types';
import { VIOLATION_TEXT } from '../api/errors';
import { formatDeg, formatLatLon, formatNumber, formatViolationValue } from '../lib/format';
import { FRAME, MOON_RADIUS_KM, observerAltitudes, violationRows } from '../lib/telemetry';
import { formatUtc } from '../lib/utc';
import type { AnalysisEntry } from '../state/AppState';
import { KeyValue } from './ui';

/** Engineer-only telemetry: every value is copied from the request or the API result. */
export function TelemetryPanel({ entry, horizon, mission }: { entry: AnalysisEntry; horizon: Horizon | undefined; mission: Mission | undefined }) {
  const i = entry.input;
  const altitudes = horizon ? observerAltitudes(horizon) : [];
  const layers = horizon ? Object.keys(horizon.sources) : [];
  const slope = mission?.slope;
  return (
    <section className="space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-3" aria-labelledby={`tel-${entry.id}`}>
      <h4 id={`tel-${entry.id}`} className="text-sm font-semibold uppercase tracking-wider text-accent">Telemetri ve izlenebilirlik</h4>
      <KeyValue
        items={[
          ['Frame', `${FRAME} · referans küre R = ${MOON_RADIUS_KM} km · radyal yerel düşey · azimut 0° = K, 90° = D`],
          ['Konum', `${formatLatLon(i.latitude, i.longitude)} · (${i.latitude}, ${i.longitude}) ME planetosentrik, doğu-pozitif`],
          ['DEM katmanları', horizon ? layers.map((n) => `${n} · ${horizon.layer_resolution_m?.[n] ?? '?'} m · ${horizon.sources[n]}`).join('  |  ') : 'ufuk yok'],
          ['Seçili dataset', horizon?.selected_dataset_id ?? i.dataset_id],
          ...(horizon?.excluded_layers && Object.keys(horizon.excluded_layers).length > 0
            ? [['Kullanılmayan katmanlar', Object.entries(horizon.excluded_layers).map(([k, v]) => `${k}: ${v}`).join(' | ')] as [string, string]]
            : []),
          ['Ufuk', horizon ? `${horizon.reference_radius_km} km · ${horizon.azimuth_deg.length} azimut · durum ${horizon.status}` : '—'],
          ['Belirsizlik', horizon ? `${horizon.uncertainty_mode}${horizon.k !== null ? ` · k = ${horizon.k}` : ''}${horizon.geometry.observer_err_m !== null ? ` · gözlemci σ = ${formatNumber(horizon.geometry.observer_err_m, 3, 'm')}` : ''}` : i.uncertainty_mode],
          ['Zaman', `iniş ${formatUtc(i.landing_utc, true)} · ${i.duration_hours} + ${i.buffer_hours} sa · Δt ${i.step_minutes} dk · kaymalar ${i.shifts_hours.map((s) => `+${s}`).join('/')} sa`],
          ['Eğim', slope ? (slope.slope_max_deg === null ? `bilinmiyor (${slope.status})` :
            `maks ${formatDeg(slope.slope_max_deg, 2)} · ort ${formatDeg(slope.slope_mean_deg, 2)} · ${slope.source} · Δ ${slope.sampling_interval_m} m · r ${slope.footprint_radius_m} m · ${slope.status}`) : '—'],
          ['Önbellek anahtarı', horizon?.cache_key ?? '—'],
        ]}
      />
      {altitudes.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Gözlemci kotu tablosu">
          <table className="mono w-full min-w-[520px] text-left text-xs">
            <caption className="mb-1 text-left font-sans text-xs text-muted">Gözlemci kotu: r = {MOON_RADIUS_KM} km + (h_DEM + h_obs) / 1000</caption>
            <thead className="text-muted">
              <tr><th className="py-1 pr-3">Sensör</th><th className="pr-3">h_DEM (m)</th><th className="pr-3">h_obs (m)</th><th className="pr-3">h_DEM + h_obs (m)</th><th>r (km)</th></tr>
            </thead>
            <tbody>
              {altitudes.map((a) => (
                <tr key={a.body} className="border-t border-line">
                  <td className="py-1 pr-3 font-sans">{a.body === 'sun' ? 'Güneş paneli' : 'DTE anteni'}</td>
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
    return <p className="text-xs text-muted">Kısıt ihlali yok (tüm senaryo ve varyantlarda).</p>;
  }
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Kısıt ihlal UTC aralıkları tablosu">
      <table className="mono w-full min-w-[760px] text-left text-xs">
        <caption className="mb-1 text-left font-sans text-xs text-muted">
          Kısıt ihlalleri ve UTC aralıkları (aralık yalnız süre kısıtlarında izlenir; pay kısıtlarında “—”)
        </caption>
        <thead className="text-muted">
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
