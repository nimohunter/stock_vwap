import {
  IChartApi,
  ISeriesApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface EpisodeBand {
  from: Time;
  to: Time;
  kind: 'ob' | 'os';
}

// Full-height translucent zones: red = relative-strength overbought episode,
// teal = oversold. Kept faint so candles and lines stay readable on top.
const FILLS: Record<EpisodeBand['kind'], string> = {
  ob: 'rgba(239, 68, 68, 0.09)',
  os: 'rgba(45, 212, 191, 0.09)',
};

/** Normalize a Time to a comparable YYYY-MM-DD string (this chart only uses date strings). */
function timeKey(t: Time): string {
  if (typeof t === 'string') return t;
  if (typeof t === 'object') {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${t.year}-${p(t.month)}-${p(t.day)}`;
  }
  return String(t);
}

class RsEpisodeRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly source: RsEpisodePrimitive) {}

  draw(target: RenderTarget): void {
    const { chart, data } = this.source;
    if (!chart || data.length === 0) return;

    const ts = chart.timeScale();
    const visible = ts.getVisibleRange();
    if (!visible) return;
    const vFrom = timeKey(visible.from);
    const vTo = timeKey(visible.to);
    const halfBar = ts.options().barSpacing / 2;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const width = scope.bitmapSize.width;
      const height = scope.bitmapSize.height;

      for (const band of data) {
        const bFrom = timeKey(band.from);
        const bTo = timeKey(band.to);
        if (bTo < vFrom || bFrom > vTo) continue; // fully off-screen

        // Clamp off-screen edges to the pane borders; pad on-screen edges by half
        // a bar so the zone covers the start/end candles fully.
        const cFrom = ts.timeToCoordinate(band.from);
        const cTo = ts.timeToCoordinate(band.to);
        const x1 = cFrom === null ? 0 : (cFrom - halfBar) * hr;
        const x2 = cTo === null ? width : (cTo + halfBar) * hr;

        ctx.fillStyle = FILLS[band.kind];
        ctx.fillRect(Math.max(0, x1), 0, Math.min(width, x2) - Math.max(0, x1), height);
      }
    });
  }
}

class RsEpisodePaneView implements IPrimitivePaneView {
  constructor(private readonly source: RsEpisodePrimitive) {}
  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }
  renderer(): IPrimitivePaneRenderer {
    return new RsEpisodeRenderer(this.source);
  }
}

export class RsEpisodePrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  data: EpisodeBand[] = [];

  private readonly views: RsEpisodePaneView[];
  private requestUpdate?: () => void;

  constructor() {
    this.views = [new RsEpisodePaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  setData(data: EpisodeBand[]): void {
    this.data = data;
    this.requestUpdate?.();
  }
}
