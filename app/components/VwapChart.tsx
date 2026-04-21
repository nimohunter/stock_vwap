'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';
import { DailyBar } from '@/app/lib/alphavantage';
import { VwapBands } from '@/app/lib/vwap';

interface Props {
  bars: DailyBar[];
  vwapBands: VwapBands[];
}

type CandleSeries = ISeriesApi<'Candlestick'>;
type LineSer = ISeriesApi<'Line'>;
type HistSeries = ISeriesApi<'Histogram'>;

function toTime(date: string) {
  return date as `${number}-${number}-${number}`;
}

const BAND_OPTS = { lastValueVisible: false, priceLineVisible: false } as const;

export default function VwapChart({ bars, vwapBands }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<CandleSeries | null>(null);
  const volumeRef = useRef<HistSeries | null>(null);
  const b2uRef = useRef<LineSer | null>(null);
  const b1uRef = useRef<LineSer | null>(null);
  const b0Ref  = useRef<LineSer | null>(null);
  const b1lRef = useRef<LineSer | null>(null);
  const b2lRef = useRef<LineSer | null>(null);

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
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  useEffect(() => {
    if (!b0Ref.current || vwapBands.length === 0) return;
    b0Ref.current.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.vwap })));
    b1uRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.upper1 })));
    b2uRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.upper2 })));
    b1lRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.lower1 })));
    b2lRef.current?.setData(vwapBands.map((p) => ({ time: toTime(p.date), value: p.lower2 })));

  }, [vwapBands]);

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />;
}
