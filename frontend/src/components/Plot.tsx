import { lazy, Suspense, type ComponentProps } from 'react';
import type { Data, Layout, Config } from 'plotly.js';
import { defineStrings, useStrings } from '../i18n';

const STR = defineStrings({
  en: { loading: 'Loading the chart library…' },
  tr: { loading: 'Grafik kütüphanesi yükleniyor…' },
});

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
  plot_bgcolor: 'rgba(3,8,24,0.62)',
  font: { color: '#eaf0ff', family: 'Inter Variable, Segoe UI, system-ui, sans-serif', size: 12 },
  margin: { l: 56, r: 16, t: 24, b: 48 },
  legend: { orientation: 'h', y: -0.22, x: 0, font: { size: 11 } },
  hoverlabel: { bgcolor: '#0a1430', bordercolor: '#22e4ff', font: { color: '#eaf0ff', family: 'JetBrains Mono Variable, Consolas, monospace' } },
};

export const AXIS = { gridcolor: 'rgba(130,160,230,0.14)', zerolinecolor: 'rgba(130,160,230,0.35)', linecolor: 'rgba(130,160,230,0.35)', tickcolor: 'rgba(130,160,230,0.35)' };

export function Chart({ data, layout, config, ariaLabel, height = 360, onClick }: ChartProps) {
  const s = useStrings(STR);
  return (
    <figure role="figure" aria-label={ariaLabel} className="w-full overflow-hidden rounded-xl border border-line bg-[rgb(3_8_24/0.35)]">
      <Suspense fallback={<div className="flex items-center justify-center rounded-xl border border-line bg-panel-2 font-mono text-sm text-muted" style={{ height }}>{s.loading}</div>}>
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
