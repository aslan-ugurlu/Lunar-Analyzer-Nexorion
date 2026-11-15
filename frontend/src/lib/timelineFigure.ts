import type { Data, Layout, Shape } from 'plotly.js';
import type { Horizon, Scenario, TimelinePoint, ValidMetrics } from '../api/types';
import { horizonAt, minMaxIndices } from './sky';

/** Plotly date axes are time-zone naive: pass UTC wall time without the Z so nothing is shifted to local time. */
export function plotlyUtc(iso: string): string {
  return iso.replace(/(\.\d+)?Z$/, '').replace('T', ' ');
}

export const MAX_TIMELINE_POINTS = 3000;

export interface TimelineFigureInput {
  timeline: TimelinePoint[];
  index: number;
  metrics: ValidMetrics | null;
  darkThreshold: number;
}

/** Indices drawn (visualisation-only decimation; the API data itself is untouched). */
export function displayIndices(timeline: TimelinePoint[]): number[] {
  return minMaxIndices(timeline.map((t) => t.sun_visible_fraction), MAX_TIMELINE_POINTS);
}

function span(timeline: TimelinePoint[], interval: [number, number] | null, yref: 'y' | 'y2', color: string): Partial<Shape>[] {
  if (!interval) return [];
  const a = timeline[interval[0]];
  const b = timeline[interval[1]];
  if (!a || !b) return [];
  return [{ type: 'rect', xref: 'x', yref: `${yref} domain` as never, x0: plotlyUtc(a.utc), x1: plotlyUtc(b.utc), y0: 0, y1: 1,
    fillcolor: color, line: { width: 0 }, layer: 'below' }];
}

export function buildTimelineFigure({ timeline, index, metrics, darkThreshold }: TimelineFigureInput): { data: Partial<Data>[]; layout: Partial<Layout>; decimated: boolean; indices: number[] } {
  const idx = displayIndices(timeline);
  const x = idx.map((i) => plotlyUtc(timeline[i]!.utc));
  const sun = idx.map((i) => timeline[i]!.sun_visible_fraction);
  const dte = idx.map((i) => { const v = timeline[i]!.dte_visible; return v === null ? null : v ? 1 : 0; });
  const unknownSun = idx.filter((i) => timeline[i]!.sun_visible_fraction === null);

  const data: Partial<Data>[] = [
    { type: 'scatter', mode: 'lines', x, y: sun, customdata: idx, line: { shape: 'hv', color: '#ffcc4d', width: 1.6 }, fill: 'tozeroy',
      fillcolor: 'rgba(255, 204, 77, 0.18)', name: 'Güneş diski görünür payı f_sun (0–1)', yaxis: 'y', connectgaps: false,
      hovertemplate: '%{x} UTC<br>f_sun %{y:.3f}<extra></extra>' },
    { type: 'scatter', mode: 'lines', x: [x[0] ?? '', x[x.length - 1] ?? ''], y: [darkThreshold, darkThreshold], yaxis: 'y',
      line: { color: '#aab5ca', dash: 'dot', width: 1 }, name: `Karanlık eşiği (${darkThreshold})`, hoverinfo: 'skip' },
    { type: 'scatter', mode: 'lines', x, y: dte, customdata: idx, line: { shape: 'hv', color: '#5aa9ff', width: 1.6 }, fill: 'tozeroy',
      fillcolor: 'rgba(90, 169, 255, 0.18)', name: 'Geometrik DTE (1 = Dünya merkezi ufkun üstünde)', yaxis: 'y2', connectgaps: false,
      hovertemplate: '%{x} UTC<br>DTE %{y}<extra></extra>' },
  ];
  if (unknownSun.length > 0) {
    data.push({ type: 'scatter', mode: 'markers', x: unknownSun.map((i) => plotlyUtc(timeline[i]!.utc)), y: unknownSun.map(() => 0.5), yaxis: 'y',
      marker: { symbol: 'x', color: '#ff7b7b', size: 6 }, name: 'Bilinmiyor (arazi verisi eksik)', hoverinfo: 'skip' });
  }

  const sel = timeline[index];
  const shapes: Partial<Shape>[] = [
    ...span(timeline, metrics?.darkness_interval ?? null, 'y', 'rgba(255, 123, 123, 0.16)'),
    ...span(timeline, metrics?.dte_gap_interval ?? null, 'y2', 'rgba(255, 123, 123, 0.16)'),
  ];
  if (sel) {
    shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: plotlyUtc(sel.utc), x1: plotlyUtc(sel.utc), y0: 0, y1: 1, line: { color: '#22e4ff', width: 2 } });
  }

  const layout: Partial<Layout> = {
    xaxis: { type: 'date', anchor: 'y2', title: { text: 'Zaman (UTC)' }, gridcolor: 'rgba(130,160,230,0.14)', linecolor: 'rgba(130,160,230,0.35)' },
    yaxis: { domain: [0.56, 1], range: [-0.05, 1.05], title: { text: 'f_sun' }, gridcolor: 'rgba(130,160,230,0.14)', zerolinecolor: 'rgba(130,160,230,0.35)' },
    yaxis2: { domain: [0, 0.4], range: [-0.1, 1.1], tickvals: [0, 1], ticktext: ['yok', 'var'], title: { text: 'DTE' }, gridcolor: 'rgba(130,160,230,0.14)' },
    shapes,
    uirevision: 'timeline',
  };
  return { data, layout, decimated: idx.length < timeline.length, indices: idx };
}

/** Engineer view: body elevation vs. the terrain horizon at the body's azimuth (display interpolation). */
export function buildElevationFigure(timeline: TimelinePoint[], horizon: Horizon, index: number): { data: Partial<Data>[]; layout: Partial<Layout> } {
  const idx = displayIndices(timeline);
  const x = idx.map((i) => plotlyUtc(timeline[i]!.utc));
  const data: Partial<Data>[] = [
    { type: 'scatter', mode: 'lines', x, y: idx.map((i) => timeline[i]!.sun.el_deg), name: 'Güneş merkezi yüksekliği', line: { color: '#ffcc4d', width: 1.5 } },
    { type: 'scatter', mode: 'lines', x, y: idx.map((i) => horizonAt(horizon.profiles.sun.nominal, timeline[i]!.sun.az_deg)), name: 'Ufuk @ Güneş azimutu (panel)', line: { color: '#ffcc4d', width: 1, dash: 'dash' }, connectgaps: false },
    { type: 'scatter', mode: 'lines', x, y: idx.map((i) => timeline[i]!.earth.el_deg), name: 'Dünya merkezi yüksekliği', line: { color: '#5aa9ff', width: 1.5 } },
    { type: 'scatter', mode: 'lines', x, y: idx.map((i) => horizonAt(horizon.profiles.earth.nominal, timeline[i]!.earth.az_deg)), name: 'Ufuk @ Dünya azimutu (anten)', line: { color: '#5aa9ff', width: 1, dash: 'dash' }, connectgaps: false },
  ];
  const sel = timeline[index];
  return {
    data,
    layout: {
      xaxis: { type: 'date', title: { text: 'Zaman (UTC)' }, gridcolor: 'rgba(130,160,230,0.14)' },
      yaxis: { title: { text: 'Yükseklik (°)' }, gridcolor: 'rgba(130,160,230,0.14)', zerolinecolor: 'rgba(130,160,230,0.35)' },
      shapes: sel ? [{ type: 'line', xref: 'x', yref: 'paper', x0: plotlyUtc(sel.utc), x1: plotlyUtc(sel.utc), y0: 0, y1: 1, line: { color: '#22e4ff', width: 2 } }] : [],
      legend: { orientation: 'h', y: -0.42, x: 0, font: { size: 11 } },
      margin: { l: 56, r: 16, t: 16, b: 96 },
      uirevision: 'elevation',
    },
  };
}

export function scenarioMetrics(missionScenario: Scenario | null): ValidMetrics | null {
  const m = missionScenario?.variants.nominal?.metrics;
  return m && m.valid ? m : null;
}
