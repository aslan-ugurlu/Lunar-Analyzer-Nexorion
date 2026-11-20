import { useMemo, useState } from 'react';
import { formatDeg, formatLatLon, formatPercent, unknownText } from '../lib/format';
import { horizonAt } from '../lib/sky';
import { buildSkyFigure, type SkyZoom } from '../lib/skyFigure';
import { formatUtc } from '../lib/utc';
import { useApp } from '../state/AppState';
import { AnalysisGate, AnalysisPicker, Scrubber, useAnalysisData, useCurrentPoint, type AnalysisData } from './AnalysisView';
import { Chart } from './Plot';
import { Icon, KeyValue } from './ui';
import { EarthMoonCard } from './EarthMoonCard';
import { HorizonStats } from './TelemetryPanel';
import { defineStrings, useLang, useStrings } from '../i18n';

const STR = defineStrings({
  en: {
    azimuthNote: 'Azimuth is measured clockwise from local north (the direction of the Moon’s north pole): 0° = North, 90° = East. ' +
      'Near the south pole, “north” is the direction along the meridian of your longitude, facing away from the pole; azimuths therefore depend on the selected meridian.',
    poleNote: ' At exactly −90° the direction is undefined: azimuth is defined relative to the meridian of the entered longitude.',
    viewGroup: 'View',
    zoom: { full: 'Full panorama (0–360°)', sun: 'Zoom to the Sun', earth: 'Zoom to Earth' } as Record<SkyZoom, string>,
    showPaths: 'Tracks over the scenario',
    chartLabel: (where: string, utc: string, sunEl: string, horizon: string) =>
      `360-degree horizon panorama, ${where}, ${utc}. Sun elevation ${sunEl} degrees, horizon in the Sun’s direction ${horizon} degrees.`,
    discs: (sunRadius: string, earthRadius: string) =>
      `Discs are drawn at their true angular size (Sun radius ≈ ${sunRadius}, Earth ≈ ${earthRadius}); ` +
      'the ring markers are enlarged so they can be found in the full panorama. The chart is display only; the calculation is done on the server.',
    noErrBand: ' This analysis has no ERR band (nominal mode or no ERR layer); no uncertainty band is invented.',
    missingRays: (n: number) => ` DEM data is missing for ${n} azimuth rays (red ×).`,
    momentLabel: 'Values at the selected moment',
    sunUnknown: 'Sun visibility at this moment is unknown (terrain data missing).',
    sunFull: 'The Sun disk is fully above the terrain.',
    sunHidden: 'The Sun is behind the terrain — this spot is in shadow right now.',
    sunPartial: (pct: string) => `Visible part of the Sun disk: ${pct} (partly behind a ridge).`,
    earthUnknown: 'Line of sight to Earth at this moment is unknown.',
    earthVisible: 'Earth’s centre is above the horizon: there is a direct geometric line of sight.',
    earthHidden: 'Earth is below the horizon or behind terrain: no direct line of sight.',
    noGuarantee: 'Sun visibility does not guarantee power generation, and Earth visibility does not guarantee a radio link.',
    sunAzEl: 'Sun az / el',
    sunRadius: 'Sun radius',
    horizonSun: 'Horizon @ Sun az*',
    earthAzEl: 'Earth az / el',
    horizonEarth: 'Horizon @ Earth az*',
    distance: 'Distance Sun / Earth',
    interpolationNote: '* The horizon value is a linear interpolation of the 0.1° profile for display (same rule as backend horizon_at); f_sun and DTE come directly from the API.',
    title: '360° Horizon Panorama — Sky View',
  },
  tr: {
    azimuthNote: 'Azimut yerel kuzeyden (Ay’ın kuzey kutbu yönü) saat yönünde ölçülür: 0° = Kuzey, 90° = Doğu. ' +
      'Güney kutbu yakınında “kuzey”, bulunduğunuz boylamın meridyeni boyunca kutuptan uzağa bakan yöndür; bu nedenle azimutlar seçilen meridyene bağlıdır.',
    poleNote: ' Tam −90°’de yön tanımsızdır: azimut, girilen boylam meridyenine göre tanımlanır.',
    viewGroup: 'Görünüm',
    zoom: { full: 'Tam panorama (0–360°)', sun: 'Güneş’e yakınlaştır', earth: 'Dünya’ya yakınlaştır' },
    showPaths: 'Senaryo boyunca izler',
    chartLabel: (where: string, utc: string, sunEl: string, horizon: string) =>
      `360 derece ufuk panoraması, ${where}, ${utc}. Güneş yüksekliği ${sunEl} derece, Güneş yönünde ufuk ${horizon} derece.`,
    discs: (sunRadius: string, earthRadius: string) =>
      `Diskler gerçek açısal boyutta çizilir (Güneş yarıçapı ≈ ${sunRadius}, Dünya ≈ ${earthRadius}); ` +
      'tam panoramada bulunabilsinler diye halka işaretçi büyütülmüştür. Grafik yalnızca görüntüdür; hesap sunucuda yapılır.',
    noErrBand: ' Bu analizde ERR bandı yok (nominal mod veya ERR katmanı yok); belirsizlik bandı uydurulmaz.',
    missingRays: (n: number) => ` ${n} azimut ışınında DEM verisi eksik (kırmızı ×).`,
    momentLabel: 'Seçili anın değerleri',
    sunUnknown: 'Bu an için Güneş görünürlüğü bilinmiyor (arazi verisi eksik).',
    sunFull: 'Güneş diski tamamen arazinin üzerinde.',
    sunHidden: 'Güneş arazinin arkasında — burası şu an gölgede.',
    sunPartial: (pct: string) => `Güneş diskinin görünen payı: ${pct} (kısmen bir sırtın arkasında).`,
    earthUnknown: 'Dünya görüşü bu an için bilinmiyor.',
    earthVisible: 'Dünya’nın merkezi ufkun üzerinde: doğrudan geometrik görüş var.',
    earthHidden: 'Dünya ufkun veya arazinin arkasında: doğrudan görüş yok.',
    noGuarantee: 'Güneş görünürlüğü elektrik üretimi, Dünya görüşü ise radyo bağlantısı garantisi değildir.',
    sunAzEl: 'Güneş az / el',
    sunRadius: 'Güneş yarıçapı',
    horizonSun: 'Ufuk @ Güneş az*',
    earthAzEl: 'Dünya az / el',
    horizonEarth: 'Ufuk @ Dünya az*',
    distance: 'Mesafe Güneş / Dünya',
    interpolationNote: '* Ufuk değeri görüntüleme için 0.1° profilden doğrusal enterpolasyondur (backend horizon_at ile aynı kural); f_sun ve DTE doğrudan API’den gelir.',
    title: '360° Panoramik Ufuk — Gökyüzü Görünümü',
  },
});

/** Azimuth convention and the south-pole meridian dependence (0° = North, 90° = East). */
function AzimuthNote({ lat }: { lat: number }) {
  const s = useStrings(STR);
  return (
    <p className="text-xs text-muted">
      {s.azimuthNote}
      {lat === -90 && <strong className="text-caution">{s.poleNote}</strong>}
    </p>
  );
}

function SkyPanel({ data }: { data: AnalysisData }) {
  const { mode } = useApp();
  const { lang } = useLang();
  const s = useStrings(STR);
  const [zoom, setZoom] = useState<SkyZoom>('full');
  const [showPaths, setShowPaths] = useState(true);
  const current = useCurrentPoint(data);
  const horizon = data.horizon;

  const figure = useMemo(() => {
    if (!horizon || !current) return null;
    return buildSkyFigure({ horizon, timeline: current.scenario.timeline, index: current.index, zoom, showPaths, lang });
  }, [horizon, current, zoom, showPaths, lang]);

  if (!horizon || !current || !figure) return null;
  const p = current.point;
  const sunH = p ? horizonAt(horizon.profiles.sun.nominal, p.sun.az_deg) : null;
  const earthH = p ? horizonAt(horizon.profiles.earth.nominal, p.earth.az_deg) : null;
  const input = data.entry.input;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={s.viewGroup}>
          {(['full', 'sun', 'earth'] as SkyZoom[]).map((z) => (
            <button key={z} type="button" className={`btn ${zoom === z ? 'border-accent text-accent' : ''}`} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{s.zoom[z]}</button>
          ))}
          <label className="ml-1 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} /> {s.showPaths}
          </label>
        </div>
        <Chart
          data={figure.data}
          layout={figure.layout}
          height={420}
          ariaLabel={s.chartLabel(formatLatLon(input.latitude, input.longitude), p ? formatUtc(p.utc) : '', p ? p.sun.el_deg.toFixed(2) : '?', sunH?.toFixed(2) ?? unknownText())}
        />
        <AzimuthNote lat={input.latitude} />
        <p className="text-xs text-muted">
          {s.discs(p ? formatDeg(p.sun.angular_radius_deg, 3) : '—', p ? formatDeg(p.earth.angular_radius_deg, 3) : '—')}
          {!figure.hasErrBand && s.noErrBand}
          {figure.missing.sun > 0 && s.missingRays(figure.missing.sun)}
        </p>
        {mode === 'engineer' && <HorizonStats horizon={horizon} />}
      </div>

      <aside className="space-y-3" aria-label={s.momentLabel}>
        <Scrubber data={data} />
        {p && (
          <div className={`space-y-3 rounded-xl p-3 text-sm ${mode === 'public' ? 'border border-line bg-panel-2' : 'term'}`}>
            {mode === 'public' ? (
              <>
                <p className="flex items-start gap-2">
                  <Icon name="sun" className="mt-0.5 h-5 w-5 shrink-0 text-sun" />
                  <span>
                    {p.sun_visible_fraction === null ? s.sunUnknown :
                      p.sun_visible_fraction >= 0.999 ? s.sunFull :
                      p.sun_visible_fraction <= 0.001 ? s.sunHidden :
                      s.sunPartial(formatPercent(p.sun_visible_fraction))}
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <Icon name="earth" className="mt-0.5 h-5 w-5 shrink-0 text-earth" />
                  <span>
                    {p.dte_visible === null ? s.earthUnknown : p.dte_visible ? s.earthVisible : s.earthHidden}
                  </span>
                </p>
                <p className="text-xs text-muted">{s.noGuarantee}</p>
              </>
            ) : (
              <KeyValue dense items={[
                ['UTC', formatUtc(p.utc, true)],
                [s.sunAzEl, `${p.sun.az_deg.toFixed(3)}° / ${p.sun.el_deg.toFixed(3)}°`],
                [s.sunRadius, formatDeg(p.sun.angular_radius_deg, 4)],
                [s.horizonSun, formatDeg(sunH, 3)],
                ['f_sun (API)', p.sun_visible_fraction === null ? 'null' : p.sun_visible_fraction.toFixed(4)],
                [s.earthAzEl, `${p.earth.az_deg.toFixed(3)}° / ${p.earth.el_deg.toFixed(3)}°`],
                [s.horizonEarth, formatDeg(earthH, 3)],
                ['DTE (API)', p.dte_visible === null ? 'null' : String(p.dte_visible)],
                [s.distance, `${(p.sun.distance_km / 1e6).toFixed(3)} Mkm / ${p.earth.distance_km.toFixed(0)} km`],
              ]} />
            )}
            {mode === 'engineer' && <p className="text-xs text-muted">{s.interpolationNote}</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

export function SkyView() {
  const { selected, mode } = useApp();
  const s = useStrings(STR);
  const data = useAnalysisData(selected);
  return (
    <div className="panel space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="panel-title">{s.title}</h2>
        <AnalysisPicker />
      </div>
      <AnalysisGate data={data} need="both">
        {data && <SkyPanel data={data} />}
      </AnalysisGate>
      {mode === 'public' && (
        <div className="rounded-[1.1rem] bg-[linear-gradient(135deg,rgb(76_201_255/0.45),rgb(179_157_255/0.3),rgb(255_204_77/0.35))] p-px">
          <EarthMoonCard />
        </div>
      )}
    </div>
  );
}
