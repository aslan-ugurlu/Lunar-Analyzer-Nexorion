import type { Data, Layout, Shape } from 'plotly.js';
import type { BodyPosition, Horizon, TimelinePoint } from '../api/types';
import { countMissing, horizonAt, minMaxIndices, wrappedDisks } from './sky';

export const COLORS = {
  terrain: '#56627f',
  terrainFill: 'rgba(86, 98, 127, 0.55)',
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

function diskTraces(body: BodyPosition, name: string, color: string): Partial<Data>[] {
  return wrappedDisks(body.az_deg, body.el_deg, body.angular_radius_deg).map((poly, i) => ({
    type: 'scatter',
    mode: 'lines',
    x: poly.x,
    y: poly.y,
    fill: 'toself',
    fillcolor: color,
    line: { color, width: 1 },
    name: `${name} diski (gerçek açısal boyut)`,
    legendgroup: name,
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
}

export function buildSkyFigure({ horizon, timeline, index, zoom, showPaths }: SkyFigureInput): { data: Partial<Data>[]; layout: Partial<Layout>; missing: { sun: number; earth: number }; hasErrBand: boolean } {
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
      type: 'scatter', mode: 'lines', x: xs, y: close(sunProfile.nominal), name: `Arazi ufku · panel ${horizon.geometry.observer_height_m.sun} m (nominal)`,
      line: { color: COLORS.terrain, width: 1.5 }, fill: 'tonexty', fillcolor: COLORS.terrainFill, connectgaps: false,
      hovertemplate: 'azimut %{x:.1f}°<br>ufuk %{y:.3f}°<extra>panel ufku</extra>',
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
          ? `DEM clone bandı p05–p95 (${horizon.clone_ensemble?.n_clones ?? '?'} PGDA clone; güven aralığı değil)`
          : `ERR ±${horizon.k ?? 'k'} duyarlılık bandı (güven aralığı değil)`,
        hovertemplate: horizon.uncertainty_mode === 'clone'
          ? 'azimut %{x:.1f}°<br>clone p95 ufuk %{y:.3f}°<extra>clone p95</extra>'
          : 'azimut %{x:.1f}°<br>ihtiyatlı ufuk %{y:.3f}°<extra>ERR +k</extra>',
      },
    );
  }

  if (separateDte) {
    data.push({
      type: 'scatter', mode: 'lines', x: xs, y: close(earthProfile.nominal), connectgaps: false,
      name: `Arazi ufku · DTE anten ${horizon.geometry.observer_height_m.earth} m`, line: { color: COLORS.dteHorizon, width: 1.2, dash: 'dash' },
      hovertemplate: 'azimut %{x:.1f}°<br>ufuk %{y:.3f}°<extra>anten ufku</extra>',
    });
  }

  const missingIdx = sunProfile.nominal.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  if (missingIdx.length > 0) {
    data.push({
      type: 'scatter', mode: 'markers', x: missingIdx.map((i) => az[i] ?? 0), y: missingIdx.map(() => yMin + 0.3),
      marker: { color: COLORS.missing, symbol: 'x', size: 6 }, name: 'Eksik DEM ışını (değer yok → GRAY)',
      hovertemplate: 'azimut %{x:.1f}°: veri eksik<extra></extra>',
    });
  }

  if (showPaths && timeline.length > 1) {
    const idx = minMaxIndices(timeline.map((t) => t.sun.el_deg), 1500);
    const sunPath = pathWithWrapGaps(idx.map((i) => ({ az: timeline[i]!.sun.az_deg, el: timeline[i]!.sun.el_deg })));
    const earthPath = pathWithWrapGaps(idx.map((i) => ({ az: timeline[i]!.earth.az_deg, el: timeline[i]!.earth.el_deg })));
    data.push(
      { type: 'scatter', mode: 'lines', ...sunPath, name: 'Güneş merkezi izi (senaryo)', line: { color: COLORS.sun, width: 1, dash: 'dot' }, hoverinfo: 'skip' },
      { type: 'scatter', mode: 'lines', ...earthPath, name: 'Dünya merkezi izi (senaryo)', line: { color: COLORS.earth, width: 1, dash: 'dot' }, hoverinfo: 'skip' },
    );
  }

  if (point) {
    data.push(...diskTraces(point.sun, 'Güneş', COLORS.sun), ...diskTraces(point.earth, 'Dünya', COLORS.earth));
    // Enlarged locator rings so the true-size discs remain findable in the 360° view.
    data.push({
      type: 'scatter', mode: 'markers', x: [point.sun.az_deg, point.earth.az_deg], y: [point.sun.el_deg, point.earth.el_deg],
      marker: { size: 16, symbol: 'circle-open', color: [COLORS.sun, COLORS.earth], line: { width: 2 } },
      text: ['Güneş', 'Dünya'], name: 'Konum işaretçisi (büyütülmüş)',
      hovertemplate: '%{text}<br>azimut %{x:.3f}°<br>yükseklik %{y:.3f}°<extra></extra>',
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
      title: { text: 'Azimut (°) — 0 = Kuzey, 90 = Doğu, saat yönünde' },
      range: xRange,
      // Cardinal labels in the panorama; automatic ticks when zoomed on a body.
      ...(zoomed ? {} : { tickvals: [0, 45, 90, 135, 180, 225, 270, 315, 360],
        ticktext: ['0 K', '45', '90 D', '135', '180 G', '225', '270 B', '315', '360 K'] }),
      gridcolor: '#24304f', zerolinecolor: '#45557d', linecolor: '#45557d',
    },
    yaxis: {
      title: { text: 'Yükseklik (°)' }, range: yRange, gridcolor: '#24304f', zerolinecolor: '#45557d', linecolor: '#45557d',
      // Equal degrees-per-pixel when zoomed so a disc is drawn round (near the horizon cos(el) ≈ 1).
      ...(zoomed ? { scaleanchor: 'x' as const, scaleratio: 1 } : {}),
    },
    shapes,
    // Full view keeps the user's pan/zoom; body zoom follows the body as time changes.
    uirevision: zoom === 'full' ? `${horizon.cache_key}:full` : `${horizon.cache_key}:${zoom}:${index}`,
  };
  return { data, layout, missing: { sun: countMissing(sunProfile.nominal), earth: countMissing(earthProfile.nominal) }, hasErrBand };
}
