import { DailyBar } from './alphavantage';

export interface VwapPoint {
  date: string;
  value: number;
}

export interface VwapBands {
  date: string;
  vwap: number;
  upper1: number;
  upper2: number;
  lower1: number;
  lower2: number;
}

const tp = (b: DailyBar) => (b.high + b.low + b.close) / 3;

export function computeRollingVwapBands(bars: DailyBar[], window = 252): VwapBands[] {
  const result: VwapBands[] = [];
  for (let i = 0; i < bars.length; i++) {
    const slice = bars.slice(Math.max(0, i - window + 1), i + 1);
    const cumV = slice.reduce((s, b) => s + b.volume, 0);
    const cumPV = slice.reduce((s, b) => s + tp(b) * b.volume, 0);
    const cumPV2 = slice.reduce((s, b) => s + tp(b) * tp(b) * b.volume, 0);
    if (cumV === 0) continue;
    const vwap = cumPV / cumV;
    const sd = Math.sqrt(Math.max(0, cumPV2 / cumV - vwap * vwap));
    result.push({
      date: bars[i].date,
      vwap,
      upper1: vwap + sd,
      upper2: vwap + 2 * sd,
      lower1: vwap - sd,
      lower2: vwap - 2 * sd,
    });
  }
  return result;
}

export function computeAnchoredVwapBands(bars: DailyBar[], anchorDate: string): VwapBands[] {
  const idx = bars.findIndex((b) => b.date > anchorDate);
  if (idx === -1) return [];

  const result: VwapBands[] = [];
  let cumPV = 0, cumPV2 = 0, cumV = 0;

  for (const bar of bars.slice(idx)) {
    const price = tp(bar);
    cumPV += price * bar.volume;
    cumPV2 += price * price * bar.volume;
    cumV += bar.volume;
    if (cumV === 0) continue;
    const vwap = cumPV / cumV;
    const sd = Math.sqrt(Math.max(0, cumPV2 / cumV - vwap * vwap));
    result.push({
      date: bar.date,
      vwap,
      upper1: vwap + sd,
      upper2: vwap + 2 * sd,
      lower1: vwap - sd,
      lower2: vwap - 2 * sd,
    });
  }
  return result;
}

// Convenience helpers for backward compatibility
export function computeRollingVwap(bars: DailyBar[], window = 252): VwapPoint[] {
  return computeRollingVwapBands(bars, window).map((b) => ({ date: b.date, value: b.vwap }));
}

export function computeAnchoredVwap(bars: DailyBar[], anchorDate: string): VwapPoint[] {
  return computeAnchoredVwapBands(bars, anchorDate).map((b) => ({ date: b.date, value: b.vwap }));
}
