import { DailyBar } from './bars';

/**
 * VWAP means volume weighted average price. Every bar is weighted by how much stock
 * traded that day, so a heavy day pulls the line toward its price more than a quiet day.
 *
 *     VWAP = sum(price * volume) / sum(volume)
 *
 * `price` here is the typical price of the bar, hlc3 = (high + low + close) / 3. That is
 * the same source TradingView uses by default, so the source is not a reason for the two
 * to disagree. The source barely matters at all. Measured on NVDA over a 60 bar anchor,
 * the four common sources land within 0.03% of each other:
 *
 *     hlc3  (high + low + close) / 3          209.9119   <- used here
 *     hl2   (high + low) / 2                  209.9312
 *     ohlc4 (open + high + low + close) / 4   209.9356
 *     close                                   209.8734
 *
 * The bands are the volume weighted standard deviation of the same price around the VWAP.
 * `cumPV2` accumulates price squared times volume, which gives the mean of the squares:
 *
 *     sd = sqrt( sum(price^2 * volume) / sum(volume) - VWAP^2 )
 *
 * The chart draws VWAP, VWAP +/- 1 sd and VWAP +/- 2 sd.
 *
 * There are two variants below. They answer different questions, and only the anchored one
 * has a TradingView equivalent. Read the comment on each before comparing to another chart.
 */

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

/**
 * Rolling VWAP. A sliding window of the last `window` bars: 63 = 3 months, 126 = 6 months,
 * 252 = 1 year. As each new bar arrives the oldest bar drops out of the sum.
 *
 * TradingView has no indicator that matches this, so do not expect the line to agree with
 * any TradingView VWAP. Every TradingView VWAP starts at an anchor or a session boundary
 * and accumulates forward without ever dropping a bar. This one never restarts and always
 * covers the same number of bars.
 *
 * The window changes the answer far more than the price source does. Same NVDA bars, same
 * day, three windows: 63 bars gives 209.58, 126 bars gives 204.10, 252 bars gives 193.48.
 * That is an 8% spread, against 0.03% for the source. If a VWAP looks wrong, check the
 * window first.
 *
 * The first `window - 1` points are computed from a partial window, because there are not
 * enough bars behind them yet. They are still drawn.
 */
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

/**
 * Anchored VWAP. Accumulate from a fixed start date and never drop a bar, so the line
 * answers "what is the average price everyone has paid since that date?". This is the
 * variant that corresponds to TradingView's "VWAP Anchored" and "VWAP Auto Anchored".
 *
 * To make the two agree, all four of these must match. The price source is not on the list,
 * because it is already the same:
 *
 *   1. The anchor date. "Auto Anchored" chooses its own anchor and moves it as the chart
 *      changes. Set TradingView to a fixed anchor on the same day. This is the usual cause
 *      of a large gap.
 *   2. The chart timeframe. These bars are daily. An intraday TradingView chart accumulates
 *      intraday bars and reaches a different number from the same anchor date.
 *   3. The volume feed. These bars come from Yahoo, which reports consolidated US volume.
 *      TradingView uses its own exchange feed. Different volume means different weights, so
 *      expect a small residual difference even when everything else matches.
 *   4. Whether the anchor bar is counted. It is counted here: the anchor day's own bar is
 *      the first bar of the accumulation.
 *
 * I have not compared these numbers against a live TradingView chart. Points 1 to 3 are
 * differences in the inputs, not in the formula above.
 */
export function computeAnchoredVwapBands(bars: DailyBar[], anchorDate: string): VwapBands[] {
  // Inclusive: the anchor day's own bar is the first bar of the accumulation.
  const idx = bars.findIndex((b) => b.date >= anchorDate);
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

export function computeEMA(bars: DailyBar[], window: number): VwapPoint[] {
  const result: VwapPoint[] = [];
  if (bars.length < window) return result;
  const k = 2 / (window + 1);
  // Seed with the SMA of the first `window` closes (matches TradingView/Ripster).
  let sum = 0;
  for (let i = 0; i < window; i++) sum += bars[i].close;
  let ema = sum / window;
  result.push({ date: bars[window - 1].date, value: ema });
  for (let i = window; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    result.push({ date: bars[i].date, value: ema });
  }
  return result;
}

export function computeSMA(bars: DailyBar[], window: number): VwapPoint[] {
  const result: VwapPoint[] = [];
  if (bars.length < window) return result;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += bars[i].close;
  result.push({ date: bars[window - 1].date, value: sum / window });
  for (let i = window; i < bars.length; i++) {
    sum += bars[i].close - bars[i - window].close;
    result.push({ date: bars[i].date, value: sum / window });
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
