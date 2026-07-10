'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  Time,
  IPriceLine,
} from 'lightweight-charts';
import { DailyBar } from '@/app/lib/alphavantage';
import { VwapBands, computeSMA, computeEMA } from '@/app/lib/vwap';
import { RsEvent, eventsToEpisodes } from '@/app/lib/relativeStrength';
import { EmaCloudPrimitive, CloudPoint } from './emaCloudPrimitive';
import { RsEpisodePrimitive } from './rsEpisodePrimitive';

interface Props {
  bars: DailyBar[];
  vwapBands: VwapBands[];
  anchoredBands?: VwapBands[];
  earningsDates?: string[];
  rsEvents?: RsEvent[];
  optionsLevels?: { callWall: number | null; putWall: number | null; gammaFlip: number | null } | null;
  onAnchorSelect?: (date: string) => void;
  showSma50?: boolean;
  showSma200?: boolean;
  showEma50?: boolean;
  showEma200?: boolean;
  showEmaCloud?: boolean;
}

type CandleSeries = ISeriesApi<'Candlestick'>;
type LineSer = ISeriesApi<'Line'>;
type HistSeries = ISeriesApi<'Histogram'>;

function toTime(date: string) {
  return date as `${number}-${number}-${number}`;
}

const BAND_OPTS = { lastValueVisible: false, priceLineVisible: false } as const;

// Relative-strength episodes render as shaded background zones (rsEpisodePrimitive);
// only the rare "extreme" days keep a point marker.
const RS_EXTREME_MARKER = {
  obExtreme: { position: 'aboveBar' as const, color: '#ef4444', shape: 'square' as const, text: '!' },
  osExtreme: { position: 'belowBar' as const, color: '#14b8a6', shape: 'square' as const, text: '!' },
};

export default function VwapChart({
  bars,
  vwapBands,
  anchoredBands = [],
  earningsDates = [],
  rsEvents = [],
  optionsLevels = null,
  onAnchorSelect,
  showSma50 = false,
  showSma200 = false,
  showEma50 = false,
  showEma200 = false,
  showEmaCloud = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<CandleSeries | null>(null);
  const volumeRef = useRef<HistSeries | null>(null);
  const b2uRef = useRef<LineSer | null>(null);
  const b1uRef = useRef<LineSer | null>(null);
  const b0Ref  = useRef<LineSer | null>(null);
  const b1lRef = useRef<LineSer | null>(null);
  const b2lRef = useRef<LineSer | null>(null);
  const sma50Ref  = useRef<LineSer | null>(null);
  const sma200Ref = useRef<LineSer | null>(null);
  const ema34Ref  = useRef<LineSer | null>(null);
  const ema50Ref  = useRef<LineSer | null>(null);
  const cloudRef  = useRef<EmaCloudPrimitive | null>(null);
  const ema50LineRef  = useRef<LineSer | null>(null);
  const ema200LineRef = useRef<LineSer | null>(null);
  const avwapRef   = useRef<LineSer | null>(null);
  const avwap1uRef = useRef<LineSer | null>(null);
  const avwap1lRef = useRef<LineSer | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const rsZonesRef = useRef<RsEpisodePrimitive | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const onAnchorSelectRef = useRef(onAnchorSelect);
  useEffect(() => {
    onAnchorSelectRef.current = onAnchorSelect;
  }, [onAnchorSelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 520,
    });
    chartRef.current = chart;

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    b2uRef.current = chart.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, ...BAND_OPTS });
    b1uRef.current = chart.addSeries(LineSeries, { color: '#eab308', lineWidth: 1, ...BAND_OPTS });
    b0Ref.current  = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 2, lastValueVisible: true, priceLineVisible: false });
    b1lRef.current = chart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 1, ...BAND_OPTS });
    b2lRef.current = chart.addSeries(LineSeries, { color: '#ec4899', lineWidth: 1, ...BAND_OPTS });
    sma50Ref.current  = chart.addSeries(LineSeries, { color: '#fb923c', lineWidth: 2, visible: false, ...BAND_OPTS });
    sma200Ref.current = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 2, visible: false, ...BAND_OPTS });

    // Ripster EMA Cloud (34/50): two thin boundary lines + a trend-colored fill primitive.
    ema34Ref.current = chart.addSeries(LineSeries, { color: '#2dd4bf', lineWidth: 1, visible: false, ...BAND_OPTS });
    ema50Ref.current = chart.addSeries(LineSeries, { color: '#818cf8', lineWidth: 1, visible: false, ...BAND_OPTS });
    cloudRef.current = new EmaCloudPrimitive();
    candleRef.current.attachPrimitive(cloudRef.current);

    // Standalone EMA 50 / EMA 200 lines (exponential counterparts to the SMA lines).
    ema50LineRef.current  = chart.addSeries(LineSeries, { color: '#22d3ee', lineWidth: 2, visible: false, ...BAND_OPTS });
    ema200LineRef.current = chart.addSeries(LineSeries, { color: '#f43f5e', lineWidth: 2, visible: false, ...BAND_OPTS });

    // Anchored VWAP: solid amber line with dashed ±1σ.
    avwapRef.current   = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2, lastValueVisible: true, priceLineVisible: false });
    avwap1uRef.current = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, lineStyle: LineStyle.Dashed, ...BAND_OPTS });
    avwap1lRef.current = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, lineStyle: LineStyle.Dashed, ...BAND_OPTS });

    markersRef.current = createSeriesMarkers(candleRef.current, []);
    rsZonesRef.current = new RsEpisodePrimitive();
    candleRef.current.attachPrimitive(rsZonesRef.current);

    // Double-click a candle to (re)anchor the anchored VWAP there.
    chart.subscribeDblClick((param) => {
      if (typeof param.time === 'string') onAnchorSelectRef.current?.(param.time);
    });

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current) return;
    candleRef.current.setData(
      bars.map((b) => ({ time: toTime(b.date), open: b.open, high: b.high, low: b.low, close: b.close }))
    );
    volumeRef.current?.setData(
      bars.map((b) => ({
        time: toTime(b.date),
        value: b.volume,
        color: b.close >= b.open ? '#22c55e60' : '#ef444460',
      }))
    );
    sma50Ref.current?.setData(
      computeSMA(bars, 50).map((p) => ({ time: toTime(p.date), value: p.value }))
    );
    sma200Ref.current?.setData(
      computeSMA(bars, 200).map((p) => ({ time: toTime(p.date), value: p.value }))
    );

    const ema34 = computeEMA(bars, 34);
    const ema50 = computeEMA(bars, 50);
    const ema50Data = ema50.map((p) => ({ time: toTime(p.date), value: p.value }));
    ema34Ref.current?.setData(ema34.map((p) => ({ time: toTime(p.date), value: p.value })));
    ema50Ref.current?.setData(ema50Data);
    ema50LineRef.current?.setData(ema50Data);
    ema200LineRef.current?.setData(
      computeEMA(bars, 200).map((p) => ({ time: toTime(p.date), value: p.value }))
    );
    // Merge into cloud points on dates where both EMAs exist.
    const fastByDate = new Map(ema34.map((p) => [p.date, p.value]));
    const cloud: CloudPoint[] = [];
    for (const p of ema50) {
      const fast = fastByDate.get(p.date);
      if (fast !== undefined) cloud.push({ time: toTime(p.date), fast, slow: p.value });
    }
    cloudRef.current?.setData(cloud);

    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  useEffect(() => {
    sma50Ref.current?.applyOptions({ visible: showSma50 });
  }, [showSma50]);

  useEffect(() => {
    sma200Ref.current?.applyOptions({ visible: showSma200 });
  }, [showSma200]);

  useEffect(() => {
    ema34Ref.current?.applyOptions({ visible: showEmaCloud });
    ema50Ref.current?.applyOptions({ visible: showEmaCloud });
    cloudRef.current?.setVisible(showEmaCloud);
  }, [showEmaCloud]);

  useEffect(() => {
    ema50LineRef.current?.applyOptions({ visible: showEma50 });
  }, [showEma50]);

  useEffect(() => {
    ema200LineRef.current?.applyOptions({ visible: showEma200 });
  }, [showEma200]);

  useEffect(() => {
    if (!b0Ref.current || vwapBands.length === 0) return;
    b0Ref.current.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.vwap })));
    b1uRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.upper1 })));
    b2uRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.upper2 })));
    b1lRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.lower1 })));
    b2lRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.lower2 })));

  }, [vwapBands]);

  useEffect(() => {
    avwapRef.current?.setData(anchoredBands.map((p) => ({ time: toTime(p.date), value: p.vwap })));
    avwap1uRef.current?.setData(anchoredBands.map((p) => ({ time: toTime(p.date), value: p.upper1 })));
    avwap1lRef.current?.setData(anchoredBands.map((p) => ({ time: toTime(p.date), value: p.lower1 })));
  }, [anchoredBands]);

  useEffect(() => {
    const dates = new Set(bars.map((b) => b.date));
    const markers = [
      ...earningsDates
        .filter((d) => dates.has(d))
        .map((d) => ({
          time: toTime(d),
          position: 'belowBar' as const,
          color: '#fbbf24',
          shape: 'arrowUp' as const,
          text: 'E',
        })),
      ...rsEvents
        .filter((e) => (e.type === 'obExtreme' || e.type === 'osExtreme') && dates.has(e.date))
        .map((e) => ({ time: toTime(e.date), ...RS_EXTREME_MARKER[e.type as keyof typeof RS_EXTREME_MARKER] })),
    ].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    markersRef.current?.setMarkers(markers);

    const lastDate = bars.length ? bars[bars.length - 1].date : null;
    rsZonesRef.current?.setData(
      lastDate
        ? eventsToEpisodes(rsEvents, lastDate)
            .filter((s) => dates.has(s.from))
            .map((s) => ({ from: toTime(s.from), to: toTime(s.to), kind: s.kind }))
        : []
    );
  }, [earningsDates, rsEvents, bars]);

  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    for (const line of priceLinesRef.current) candle.removePriceLine(line);
    priceLinesRef.current = [];
    if (!optionsLevels) return;
    const specs = [
      { price: optionsLevels.callWall, color: '#ef4444', title: 'Call wall' },
      { price: optionsLevels.putWall, color: '#22c55e', title: 'Put wall' },
      { price: optionsLevels.gammaFlip, color: '#38bdf8', title: 'γ flip' },
    ];
    for (const s of specs) {
      if (s.price === null) continue;
      priceLinesRef.current.push(
        candle.createPriceLine({
          price: s.price,
          color: s.color,
          lineWidth: 1,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: s.title,
        })
      );
    }
  }, [optionsLevels]);

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />;
}
