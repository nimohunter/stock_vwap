/**
 * Pure technical-indicator primitives, each returning a full-length array
 * aligned to the input bars (with `null` for the warm-up region) so callers can
 * line them up by index — required for divergence detection. Kept dependency-free
 * and side-effect-free so they can be unit-tested in isolation.
 */
import { DailyBar } from './alphavantage';

export type Series = (number | null)[];

export const lastVal = (a: Series): number | null => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null) return a[i];
  return null;
};

/** Exponential moving average, seeded with the first value; full length. */
export function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[0] : values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

/** Wilder's RSI; null until `period` bars are available. Last element matches a scalar RSI. */
export function rsiSeries(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Stochastic %D = `smooth`-period SMA of %K(`period`). */
export function stochasticSeries(bars: DailyBar[], period = 14, smooth = 3): Series {
  const k: Series = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    k[i] = hi === lo ? 50 : (100 * (bars[i].close - lo)) / (hi - lo);
  }
  const out: Series = new Array(bars.length).fill(null);
  for (let i = period - 1 + (smooth - 1); i < bars.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = i - smooth + 1; j <= i; j++) {
      const v = k[j];
      if (v !== null) {
        s += v;
        n++;
      }
    }
    out[i] = n ? s / n : null;
  }
  return out;
}

/** Money Flow Index; null until `period`+1 bars. */
export function mfiSeries(bars: DailyBar[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  for (let i = period; i < bars.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * bars[j].volume;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

/** Chaikin Money Flow over the trailing `period` bars; latest value in [-1, 1]. */
export function cmf(bars: DailyBar[], period = 20): number | null {
  if (bars.length < period) return null;
  let mfv = 0;
  let vol = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const b = bars[i];
    const range = b.high - b.low || 1e-9;
    mfv += (((b.close - b.low) - (b.high - b.close)) / range) * b.volume;
    vol += b.volume;
  }
  return vol === 0 ? 0 : mfv / vol;
}

/** Wilder's Average True Range; null until `period` bars. */
export function atrSeries(bars: DailyBar[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return out;
  const tr: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * Bollinger %B: position of price within the bands.
 * 0.5 = at the mean, 1 = at the upper band, 0 = at the lower band, >1 / <0 = stretched beyond.
 */
export function bollingerPercentBSeries(closes: number[], period = 20, k = 2): Series {
  const out: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - mean;
      v += d * d;
    }
    const sd = Math.sqrt(v / period);
    const upper = mean + k * sd;
    const lower = mean - k * sd;
    out[i] = upper === lower ? 0.5 : (closes[i] - lower) / (upper - lower);
  }
  return out;
}

/** Linear-interpolated percentile of a set of numbers. `p` in [0, 1]. */
export function percentile(values: number[], p: number): number {
  const a = values.filter((v) => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** Confirmed swing pivots: index `i` is a pivot high/low if it's the strict extreme
 *  within ±`window` bars. Recent-most pivots are therefore at least `window` bars old. */
export function findPivots(values: Series, window: number): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = window; i < values.length - window; i++) {
    const v = values[i];
    if (v === null) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      const w = values[j];
      if (w === null) continue;
      if (w >= v) isHigh = false;
      if (w <= v) isLow = false;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

export interface DivergenceResult {
  direction: 'bullish' | 'bearish';
  detail: string;
}

/**
 * Regular price/oscillator divergence over the trailing `lookback` bars, using the
 * oscillator's value at price's two most recent swing pivots:
 *  - bearish: price higher-high while the oscillator makes a lower-high
 *  - bullish: price lower-low while the oscillator makes a higher-low
 */
export function detectDivergence(
  price: number[],
  osc: Series,
  oscName: string,
  lookback: number,
  pivotWindow: number,
): DivergenceResult | null {
  const start = Math.max(0, price.length - lookback);
  const window: Series = price.slice(start);
  const { highs, lows } = findPivots(window, pivotWindow);

  if (highs.length >= 2) {
    const a = highs[highs.length - 2] + start;
    const b = highs[highs.length - 1] + start;
    if (price[b] > price[a] && osc[a] !== null && osc[b] !== null && (osc[b] as number) < (osc[a] as number)) {
      return { direction: 'bearish', detail: `Price higher high, ${oscName} lower high` };
    }
  }
  if (lows.length >= 2) {
    const a = lows[lows.length - 2] + start;
    const b = lows[lows.length - 1] + start;
    if (price[b] < price[a] && osc[a] !== null && osc[b] !== null && (osc[b] as number) > (osc[a] as number)) {
      return { direction: 'bullish', detail: `Price lower low, ${oscName} higher low` };
    }
  }
  return null;
}
