import { useMemo, useState } from 'react';
import { formatDeg, formatLatLon, formatPercent } from '../lib/format';
import { horizonAt } from '../lib/sky';
import { buildSkyFigure, type SkyZoom } from '../lib/skyFigure';
import { formatUtc } from '../lib/utc';
import { useApp } from '../state/AppState';
import { AnalysisGate, AnalysisPicker, Scrubber, useAnalysisData, useCurrentPoint, type AnalysisData } from './AnalysisView';
import { Chart } from './Plot';
import { Icon, KeyValue } from './ui';
import { EarthMoonCard } from './EarthMoonCard';
import { bandWidth, profileDifference, profileExtremes } from '../lib/telemetry';
import type { Horizon } from '../api/types';

/** Engineer: descriptive statistics of the API horizon profiles (no re-computation). */
export function HorizonStats({ horizon }: { horizon: Horizon }) {
  const az = horizon.azimuth_deg;
  const hSun = horizon.geometry.observer_height_m.sun;
  const hEarth = horizon.geometry.observer_height_m.earth;
  const sun = profileExtremes(az, horizon.profiles.sun.nominal);
  const earth = profileExtremes(az, horizon.profiles.earth.nominal);
  const diff = hSun !== hEarth ? profileDifference(az, horizon.profiles.earth.nominal, horizon.profiles.sun.nominal) : null;
  const band = bandWidth(horizon.profiles.sun);
  const fmt = (e: ReturnType<typeof profileExtremes>) => e
    ? `min ${e.min.toFixed(3)}° @ ${e.minAz.toFixed(1)}° · maks ${e.max.toFixed(3)}° @ ${e.maxAz.toFixed(1)}°${e.missing ? ` · eksik ışın ${e.missing}` : ''}`
    : 'geçerli değer yok';
  return (
    <section className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm" aria-label="Ufuk özeti">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">Ufuk özeti (API profillerinden)</h3>
      <KeyValue items={[
        [`Panel ufku (h_obs ${hSun} m)`, fmt(sun)],
        [`Anten ufku (h_obs ${hEarth} m)`, hSun === hEarth ? 'panel ile aynı yükseklik → aynı profil' : fmt(earth)],
        ['Anten − panel farkı', diff ? `maks |Δ| ${diff.maxAbs.toFixed(3)}° @ ${diff.atAz.toFixed(1)}° · ort Δ ${diff.mean.toFixed(4)}° (${diff.n} azimut)` : 'yok (aynı yükseklik)'],
        ['ERR bandı (ihtiyatlı − iyimser)', band ? `min ${band.min.toFixed(4)}° · ort ${band.mean.toFixed(4)}° · maks ${band.max.toFixed(4)}°` : 'yok (nominal mod veya ERR katmanı yok)'],
        ['Kapsama', `${horizon.status} · ${horizon.reference_radius_km} km · ${az.length} azimut (0.1°)`],
      ]} />
    </section>
  );
}

function AzimuthNote({ lat }: { lat: number }) {
  return (
    <p className="text-xs text-muted">
      Azimut yerel kuzeyden (Ay’ın kuzey kutbu yönü) saat yönünde ölçülür: 0° = Kuzey, 90° = Doğu. Güney kutbu yakınında “kuzey”,
      bulunduğunuz boylamın meridyeni boyunca kutuptan uzağa bakan yöndür; bu nedenle azimutlar seçilen meridyene bağlıdır.
      {lat === -90 && <strong className="text-caution"> Tam −90°’de yön tanımsızdır: azimut, girilen boylam meridyenine göre tanımlanır.</strong>}
    </p>
  );
}

function SkyPanel({ data }: { data: AnalysisData }) {
  const { mode } = useApp();
  const [zoom, setZoom] = useState<SkyZoom>('full');
  const [showPaths, setShowPaths] = useState(true);
  const current = useCurrentPoint(data);
  const horizon = data.horizon;

  const figure = useMemo(() => {
    if (!horizon || !current) return null;
    return buildSkyFigure({ horizon, timeline: current.scenario.timeline, index: current.index, zoom, showPaths });
  }, [horizon, current, zoom, showPaths]);

  if (!horizon || !current || !figure) return null;
  const p = current.point;
  const sunH = p ? horizonAt(horizon.profiles.sun.nominal, p.sun.az_deg) : null;
  const earthH = p ? horizonAt(horizon.profiles.earth.nominal, p.earth.az_deg) : null;
  const input = data.entry.input;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Görünüm">
          {([['full', 'Tam panorama (0–360°)'], ['sun', 'Güneş’e yakınlaştır'], ['earth', 'Dünya’ya yakınlaştır']] as [SkyZoom, string][]).map(([z, label]) => (
            <button key={z} type="button" className={`btn ${zoom === z ? 'border-accent text-accent' : ''}`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{label}</button>
          ))}
          <label className="ml-1 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} /> Senaryo boyunca izler
          </label>
        </div>
        <Chart
          data={figure.data}
          layout={figure.layout}
          height={420}
          ariaLabel={`360 derece ufuk panoraması, ${formatLatLon(input.latitude, input.longitude)}, ${p ? formatUtc(p.utc) : ''}. Güneş yüksekliği ${p ? p.sun.el_deg.toFixed(2) : '?'} derece, Güneş yönünde ufuk ${sunH?.toFixed(2) ?? 'bilinmiyor'} derece.`}
        />
        <AzimuthNote lat={input.latitude} />
        <p className="text-xs text-muted">
          Diskler gerçek açısal boyutta çizilir (Güneş yarıçapı ≈ {p ? formatDeg(p.sun.angular_radius_deg, 3) : '—'}, Dünya ≈ {p ? formatDeg(p.earth.angular_radius_deg, 3) : '—'});
          tam panoramada bulunabilsinler diye halka işaretçi büyütülmüştür. Grafik yalnızca görüntüdür; hesap sunucuda yapılır.
          {!figure.hasErrBand && ' Bu analizde ERR bandı yok (nominal mod veya ERR katmanı yok); belirsizlik bandı uydurulmaz.'}
          {figure.missing.sun > 0 && ` ${figure.missing.sun} azimut ışınında DEM verisi eksik (kırmızı ×).`}
        </p>
        {mode === 'engineer' && <HorizonStats horizon={horizon} />}
      </div>

      <aside className="space-y-3" aria-label="Seçili anın değerleri">
        <Scrubber data={data} />
        {p && (
          <div className="space-y-3 rounded-lg border border-line bg-panel-2 p-3 text-sm">
            {mode === 'public' ? (
              <>
                <p className="flex items-start gap-2">
                  <Icon name="sun" className="mt-0.5 h-5 w-5 shrink-0 text-sun" />
                  <span>
                    {p.sun_visible_fraction === null ? 'Bu an için Güneş görünürlüğü bilinmiyor (arazi verisi eksik).' :
                      p.sun_visible_fraction >= 0.999 ? 'Güneş diski tamamen arazinin üzerinde.' :
                      p.sun_visible_fraction <= 0.001 ? 'Güneş arazinin arkasında — burası şu an gölgede.' :
                      `Güneş diskinin görünen payı: ${formatPercent(p.sun_visible_fraction)} (kısmen bir sırtın arkasında).`}
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <Icon name="earth" className="mt-0.5 h-5 w-5 shrink-0 text-earth" />
                  <span>
                    {p.dte_visible === null ? 'Dünya görüşü bu an için bilinmiyor.' :
                      p.dte_visible ? 'Dünya’nın merkezi ufkun üzerinde: doğrudan geometrik görüş var.' :
                      'Dünya ufkun veya arazinin arkasında: doğrudan görüş yok.'}
                  </span>
                </p>
                <p className="text-xs text-muted">Güneş görünürlüğü elektrik üretimi, Dünya görüşü ise radyo bağlantısı garantisi değildir.</p>
              </>
            ) : (
              <KeyValue items={[
                ['UTC', formatUtc(p.utc, true)],
                ['Güneş az / el', `${p.sun.az_deg.toFixed(3)}° / ${p.sun.el_deg.toFixed(3)}°`],
                ['Güneş yarıçapı', formatDeg(p.sun.angular_radius_deg, 4)],
                ['Ufuk @ Güneş az*', formatDeg(sunH, 3)],
                ['f_sun (API)', p.sun_visible_fraction === null ? 'null' : p.sun_visible_fraction.toFixed(4)],
                ['Dünya az / el', `${p.earth.az_deg.toFixed(3)}° / ${p.earth.el_deg.toFixed(3)}°`],
                ['Ufuk @ Dünya az*', formatDeg(earthH, 3)],
                ['DTE (API)', p.dte_visible === null ? 'null' : String(p.dte_visible)],
                ['Mesafe Güneş / Dünya', `${(p.sun.distance_km / 1e6).toFixed(3)} Mkm / ${p.earth.distance_km.toFixed(0)} km`],
              ]} />
            )}
            {mode === 'engineer' && <p className="text-xs text-muted">* Ufuk değeri görüntüleme için 0.1° profilden doğrusal enterpolasyondur (backend horizon_at ile aynı kural); f_sun ve DTE doğrudan API’den gelir.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

export function SkyView() {
  const { selected, mode } = useApp();
  const data = useAnalysisData(selected);
  return (
    <div className="panel space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="panel-title">360° Panoramik Ufuk — Sky View</h2>
        <AnalysisPicker />
      </div>
      <AnalysisGate data={data} need="both">
        {data && <SkyPanel data={data} />}
      </AnalysisGate>
      {mode === 'public' && (
        <div className="rounded-xl border border-accent/30 p-1">
          <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-accent">Öğren</p>
          <EarthMoonCard />
        </div>
      )}
    </div>
  );
}
