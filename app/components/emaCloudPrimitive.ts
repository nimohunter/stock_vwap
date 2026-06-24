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

// CanvasRenderingTarget2D isn't re-exported by lightweight-charts; derive it from the interface.
type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface CloudPoint {
  time: Time;
  fast: number; // EMA 34
  slow: number; // EMA 50
}

// Ripster-style translucent fill: green when the fast EMA is above the slow one, red below.
const BULL_FILL = 'rgba(34, 197, 94, 0.18)';
const BEAR_FILL = 'rgba(239, 68, 68, 0.18)';

class EmaCloudRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly source: EmaCloudPrimitive) {}

  draw(target: RenderTarget): void {
    const { chart, series, data, visible } = this.source;
    if (!visible || !chart || !series || data.length < 2) return;

    const ts = chart.timeScale();
    const pts = data.map((p) => {
      const x = ts.timeToCoordinate(p.time);
      const yFast = series.priceToCoordinate(p.fast);
      const ySlow = series.priceToCoordinate(p.slow);
      if (x === null || yFast === null || ySlow === null) return null;
      return { x, yFast, ySlow, bull: p.fast >= p.slow };
    });

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x * hr, a.yFast * vr);
        ctx.lineTo(b.x * hr, b.yFast * vr);
        ctx.lineTo(b.x * hr, b.ySlow * vr);
        ctx.lineTo(a.x * hr, a.ySlow * vr);
        ctx.closePath();
        ctx.fillStyle = a.bull ? BULL_FILL : BEAR_FILL;
        ctx.fill();
      }
    });
  }
}

class EmaCloudPaneView implements IPrimitivePaneView {
  constructor(private readonly source: EmaCloudPrimitive) {}
  // Draw beneath the candles so price stays readable on top of the cloud.
  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }
  renderer(): IPrimitivePaneRenderer {
    return new EmaCloudRenderer(this.source);
  }
}

export class EmaCloudPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  data: CloudPoint[] = [];
  visible = false;

  private readonly views: EmaCloudPaneView[];
  private requestUpdate?: () => void;

  constructor() {
    this.views = [new EmaCloudPaneView(this)];
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

  setData(data: CloudPoint[]): void {
    this.data = data;
    this.requestUpdate?.();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.requestUpdate?.();
  }
}
