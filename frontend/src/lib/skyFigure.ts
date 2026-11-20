import type { Data, Layout, Shape } from 'plotly.js';
import type { BodyPosition, Horizon, TimelinePoint } from '../api/types';
import { countMissing, horizonAt, minMaxIndices, wrappedDisks } from './sky';
import { defineStrings, pick, type Lang } from '../i18n';

/** Trace names, hover templates and axis titles; Plotly placeholders (%{x:.1f}, <extra>) stay intact. */
const STR = defineStrings({
  en: {
    sun: 'Sun',
    earth: 'Earth',
    disk: (body: string) => `${body} disk (true angular size)`,
    terrainPanel: (heightM: number) => `Terrain horizon · panel ${heightM} m (nominal)`,
    hoverPanel: 'azimuth %{x:.1f}°<br>horizon %{y:.3f}°<extra>panel horizon</extra>',
    cloneBand: (n: number | string) => `DEM clone band p05–p95 (${n} PGDA clones; not a confidence interval)`,
    errBand: (k: number | string) => `ERR ±${k} sensitivity band (not a confidence interval)`,
    hoverClone: 'azimuth %{x:.1f}°<br>clone p95 horizon %{y:.3f}°<extra>clone p95</extra>',
    hoverErr: 'azimuth %{x:.1f}°<br>conservative horizon %{y:.3f}°<extra>ERR +k</extra>',
    terrainDte: (heightM: number) => `Terrain horizon · DTE antenna ${heightM} m`,
    hoverAntenna: 'azimuth %{x:.1f}°<br>horizon %{y:.3f}°<extra>antenna horizon</extra>',
    missingRay: 'Missing DEM ray (no value → GRAY)',
    hoverMissing: 'azimuth %{x:.1f}°: data missing<extra></extra>',
    sunTrack: 'Sun centre track (scenario)',
    earthTrack: 'Earth centre track (scenario)',
    marker: 'Position marker (enlarged)',
    hoverMarker: '%{text}<br>azimuth %{x:.3f}°<br>elevation %{y:.3f}°<extra></extra>',
    xTitle: 'Azimuth (°) — 0 = North, 90 = East, clockwise',
    ticks: ['0 N', '45', '90 E', '135', '180 S', '225', '270 W', '315', '360 N'],
    yTitle: 'Elevation (°)',
  },
  tr: {
    sun: 'Güneş',
    earth: 'Dünya',
    disk: (body: string) => `${body} diski (gerçek açısal boyut)`,
    terrainPanel: (heightM: number) => `Arazi ufku · panel ${heightM} m (nominal)`,
    hoverPanel: 'azimut %{x:.1f}°<br>ufuk %{y:.3f}°<extra>panel ufku</extra>',
    cloneBand: (n: number | string) => `DEM clone bandı p05–p95 (${n} PGDA clone; güven aralığı değil)`,
    errBand: (k: number | string) => `ERR ±${k} duyarlılık bandı (güven aralığı değil)`,
    hoverClone: 'azimut %{x:.1f}°<br>clone p95 ufuk %{y:.3f}°<extra>clone p95</extra>',
    hoverErr: 'azimut %{x:.1f}°<br>ihtiyatlı ufuk %{y:.3f}°<extra>ERR +k</extra>',
    terrainDte: (heightM: number) => `Arazi ufku · DTE anten ${heightM} m`,
    hoverAntenna: 'azimut %{x:.1f}°<br>ufuk %{y:.3f}°<extra>anten ufku</extra>',
    missingRay: 'Eksik DEM ışını (değer yok → GRAY)',
    hoverMissing: 'azimut %{x:.1f}°: veri eksik<extra></extra>',
    sunTrack: 'Güneş merkezi izi (senaryo)',
    earthTrack: 'Dünya merkezi izi (senaryo)',
    marker: 'Konum işaretçisi (büyütülmüş)',
    hoverMarker: '%{text}<br>azimut %{x:.3f}°<br>yükseklik %{y:.3f}°<extra></extra>',
    xTitle: 'Azimut (°) — 0 = Kuzey, 90 = Doğu, saat yönünde',
    ticks: ['0 K', '45', '90 D', '135', '180 G', '225', '270 B', '315', '360 K'],
    yTitle: 'Yükseklik (°)',
  },
});

export const COLORS = {
  terrain: '#8592b0',
  terrainFill: 'rgba(124, 137, 166, 0.5)',
  dteHorizon: '#5aa9ff',
  band: 'rgba(255, 209, 102, 0.28)',
  sun: '#ffcc4d',
  earth: '#5aa9ff',
  missing: '#ff7b7b',
};

export type SkyZoom = 'full' | 'sun' | 'earth';

/** Insert gaps where the azimuth wraps so paths do not draw a line across the chart. */
export function pathWithWrapGaps(points: { az: number; el: number }[]): { x: (number | null)[]; y: (number | null)[] } {
  const x: (number | null)[] = [];
  const y: (number | null)[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && Math.abs(p.az - prev.az) > 180) {
      x.push(null);
      y.push(null);
    }
    x.push(p.az);
    y.push(p.el);
  });
  return { x, y };
}

function diskTraces(body: BodyPosition, group: string, label: string, color: string): Partial<Data>[] {
  return wrappedDisks(body.az_deg, body.el_deg, body.angular_radius_deg).map((poly, i) => ({
    type: 'scatter',
    mode: 'lines',
    x: poly.x,
    y: poly.y,
    fill: 'toself',
    fillcolor: color,
    line: { color, width: 1 },
    name: label,
    legendgroup: group,
    showlegend: i === 0,
    hoverinfo: 'skip',
  }));
}

export interface SkyFigureInput {
  horizon: Horizon;
  timeline: TimelinePoint[];
  index: number;
  zoom: SkyZoom;
  showPaths: boolean;
  /** Language of names/titles (default: current interface language). Plotted values never depend on it. */
  lang?: Lang;
}

export function buildSkyFigure({ horizon, timeline, index, zoom, showPaths, lang }: SkyFigureInput): { data: Partial<Data>[]; layout: Partial<Layout>; missing: { sun: number; earth: number }; hasErrBand: boolean } {
  const s = pick(STR, lang);
  const az = horizon.azimuth_deg;
  const sunProfile = horizon.profiles.sun;
  const earthProfile = horizon.profiles.earth;
  const separateDte = horizon.geometry.observer_height_m.sun !== horizon.geometry.observer_height_m.earth;
  const point = timeline[index] ?? null;

  const finite = (arr: (number | null)[] | undefined) => (arr ?? []).filter((v): v is number => v !== null && Number.isFinite(v));
  const allHorizon = [...finite(sunProfile.nominal), ...finite(sunProfile.cautious), ...finite(earthProfile.nominal)];
  const bodyEls = point ? [point.sun.el_deg, point.earth.el_deg] : [];
  const yMin = Math.floor(Math.min(-2, ...allHorizon, ...bodyEls) - 1);
  const yMax = Math.ceil(Math.max(3, ...allHorizon, ...bodyEls) + 1);

  // Close the 0..360 panorama: append the 0° sample at 360° for display only.
  const xs = [...az, 360];
  const close = (arr: (number | null)[]) => [...arr, arr[0] ?? null];

  const data: Partial<Data>[] = [
    { type: 'scatter', mode: 'lines', x: [0, 360], y: [yMin, yMin], line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
    {
      type: 'scatter', mode: 'lines', x: xs, y: close(sunProfile.nominal), name: s.terrainPanel(horizon.geometry.observer_height_m.sun),
      line: { color: COLORS.terrain, width: 1.5 }, fill: 'tonexty', fillcolor: COLORS.terrainFill, connectgaps: false,
      hovertemplate: s.hoverPanel,
    },
  ];

  const hasErrBand = Array.isArray(sunProfile.cautious) && Array.isArray(sunProfile.optimistic);
  if (hasErrBand) {
    data.push(
      { type: 'scatter', mode: 'lines', x: xs, y: close(sunProfile.optimistic ?? []), line: { width: 0.5, color: COLORS.band }, showlegend: false, hoverinfo: 'skip', connectgaps: false },
      {
        type: 'scatter', mode: 'lines', x: xs, y: close(sunProfile.cautious ?? []), fill: 'tonexty', fillcolor: COLORS.band,
        line: { width: 0.5, color: COLORS.band }, connectgaps: false,
        name: horizon.uncertainty_mode === 'clone'
          ? s.cloneBand(horizon.clone_ensemble?.n_clones ?? '?')
          : s.errBand(horizon.k ?? 'k'),
        hovertemplate: horizon.uncertainty_mode === 'clone' ? s.hoverClone : s.hoverErr,
      },
    );
  }

  if (separateDte) {
    data.push({
      type: 'scatter', mode: 'lines', x: xs, y: close(earthProfile.nominal), connectgaps: false,
      name: s.terrainDte(horizon.geometry.observer_height_m.earth), line: { color: COLORS.dteHorizon, width: 1.2, dash: 'dash' },
      hovertemplate: s.hoverAntenna,
    });
  }

  const missingIdx = sunProfile.nominal.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  if (missingIdx.length > 0) {
    data.push({
      type: 'scatter', mode: 'markers', x: missingIdx.map((i) => az[i] ?? 0), y: missingIdx.map(() => yMin + 0.3),
      marker: { color: COLORS.missing, symbol: 'x', size: 6 }, name: s.missingRay,
      hovertemplate: s.hoverMissing,
    });
  }

  if (showPaths && timeline.length > 1) {
    const idx = minMaxIndices(timeline.map((t) => t.sun.el_deg), 1500);
    const sunPath = pathWithWrapGaps(idx.map((i) => ({ az: timeline[i]!.sun.az_deg, el: timeline[i]!.sun.el_deg })));
    const earthPath = pathWithWrapGaps(idx.map((i) => ({ az: timeline[i]!.earth.az_deg, el: timeline[i]!.earth.el_deg })));
    data.push(
      { type: 'scatter', mode: 'lines', ...sunPath, name: s.sunTrack, line: { color: COLORS.sun, width: 1, dash: 'dot' }, hoverinfo: 'skip' },
      { type: 'scatter', mode: 'lines', ...earthPath, name: s.earthTrack, line: { color: COLORS.earth, width: 1, dash: 'dot' }, hoverinfo: 'skip' },
    );
  }

  if (point) {
    data.push(...diskTraces(point.sun, 'sun', s.disk(s.sun), COLORS.sun), ...diskTraces(point.earth, 'earth', s.disk(s.earth), COLORS.earth));
    // Enlarged locator rings so the true-size discs remain findable in the 360° view.
    data.push({
      type: 'scatter', mode: 'markers', x: [point.sun.az_deg, point.earth.az_deg], y: [point.sun.el_deg, point.earth.el_deg],
      marker: { size: 16, symbol: 'circle-open', color: [COLORS.sun, COLORS.earth], line: { width: 2 } },
      text: [s.sun, s.earth], name: s.marker,
      hovertemplate: s.hoverMarker,
    });
  }

  const shapes: Partial<Shape>[] = [
    { type: 'line', x0: 0, x1: 360, y0: 0, y1: 0, line: { color: '#8a97b4', width: 1, dash: 'dot' } },
  ];

  let xRange: [number, number] = [0, 360];
  let yRange: [number, number] = [yMin, yMax];
  const zoomed = Boolean(point) && zoom !== 'full';
  if (point && zoom !== 'full') {
    const body = zoom === 'sun' ? point.sun : point.earth;
    const profile = zoom === 'sun' ? sunProfile.nominal : earthProfile.nominal;
    const local = horizonAt(profile, body.az_deg);
    const halfEl = Math.max(2, body.angular_radius_deg * 6);
    const halfAz = (halfEl * 2) / Math.max(0.2, Math.cos((body.el_deg * Math.PI) / 180));
    xRange = [body.az_deg - halfAz, body.az_deg + halfAz];
    // Keep the terrain horizon under the body in view for context.
    yRange = [Math.min(body.el_deg - halfEl, (local ?? body.el_deg) - 0.5), Math.max(body.el_deg + halfEl, (local ?? body.el_deg) + 0.5)];
  }

  const layout: Partial<Layout> = {
    xaxis: {
      title: { text: s.xTitle },
      range: xRange,
      // Cardinal labels in the panorama; automatic ticks when zoomed on a body.
      ...(zoomed ? {} : { tickvals: [0, 45, 90, 135, 180, 225, 270, 315, 360],
        ticktext: s.ticks }),
      gridcolor: 'rgba(130,160,230,0.14)', zerolinecolor: 'rgba(130,160,230,0.35)', linecolor: 'rgba(130,160,230,0.35)',
    },
    yaxis: {
      title: { text: s.yTitle }, range: yRange, gridcolor: 'rgba(130,160,230,0.14)', zerolinecolor: 'rgba(130,160,230,0.35)', linecolor: 'rgba(130,160,230,0.35)',
      // Equal degrees-per-pixel when zoomed so a disc is drawn round (near the horizon cos(el) ≈ 1).
      ...(zoomed ? { scaleanchor: 'x' as const, scaleratio: 1 } : {}),
    },
    shapes,
    // Full view keeps the user's pan/zoom; body zoom follows the body as time changes.
    uirevision: zoom === 'full' ? `${horizon.cache_key}:full` : `${horizon.cache_key}:${zoom}:${index}`,
  };
  return { data, layout, missing: { sun: countMissing(sunProfile.nominal), earth: countMissing(earthProfile.nominal) }, hasErrBand };
}
