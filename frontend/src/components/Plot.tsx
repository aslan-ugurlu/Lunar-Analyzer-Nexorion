import { lazy, Suspense, type ComponentProps } from 'react';
import type { Data, Layout, Config } from 'plotly.js';

/** plotly.js (~4.6 MB) is code-split and loaded only when a chart is shown. */
const LazyPlot = lazy(async () => {
  const [plotly, factory] = await Promise.all([import('plotly.js-dist-min'), import('react-plotly.js/factory')]);
  return { default: factory.default(plotly.default) };
});

export interface ChartProps {
  data: Partial<Data>[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
  ariaLabel: string;
  height?: number;
  onClick?: ComponentProps<typeof LazyPlot>['onClick'];
}

export const BASE_LAYOUT: Partial<Layout> = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: '#0b1224',
  font: { color: '#e8edf7', family: 'Segoe UI, system-ui, sans-serif', size: 12 },
  margin: { l: 56, r: 16, t: 24, b: 48 },
  legend: { orientation: 'h', y: -0.22, x: 0, font: { size: 11 } },
  hoverlabel: { bgcolor: '#141d36', bordercolor: '#6cd0ff', font: { color: '#e8edf7' } },
};

export const AXIS = { gridcolor: '#24304f', zerolinecolor: '#45557d', linecolor: '#45557d', tickcolor: '#45557d' };

export function Chart({ data, layout, config, ariaLabel, height = 360, onClick }: ChartProps) {
  return (
    <figure role="figure" aria-label={ariaLabel} className="w-full">
      <Suspense fallback={<div className="flex items-center justify-center rounded-lg border border-line bg-panel-2 text-sm text-muted" style={{ height }}>Grafik kütüphanesi yükleniyor…</div>}>
        <LazyPlot
          data={data}
          layout={{ ...BASE_LAYOUT, ...layout, autosize: true, height }}
          config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ['select2d', 'lasso2d'], ...config }}
          useResizeHandler
          style={{ width: '100%', height }}
          onClick={onClick}
        />
      </Suspense>
    </figure>
  );
}
