import { describe, it, expect } from 'vitest';
import { DailyBar } from './bars';
import {
  atrSeries,
  bollingerPercentBSeries,
  cciSeries,
  cmf,
  detectDivergence,
  emaSeries,
  findPivots,
  lastVal,
  mfiSeries,
  momentumSeries,
  percentile,
  rsiSeries,
  stochasticKD,
} from './indicators';

// Build synthetic OHLCV bars from a close series; caller can override H/L/volume.
function bars(closes: number[], opts?: { spread?: number; volume?: number[] | number }): DailyBar[] {
  const spread = opts?.spread ?? 1;
  return closes.map((c, i) => ({
    date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: i === 0 ? c : closes[i - 1],
    high: c + spread,
    low: c - spread,
    close: c,
    volume: Array.isArray(opts?.volume) ? opts!.volume![i] : (opts?.volume ?? 1_000_000),
  }));
}

describe('emaSeries', () => {
  it('is full length and seeds with the first value', () => {
    const out = emaSeries([1, 2, 3, 4, 5], 2);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(1);
    // k = 2/3: ema[1] = 2*(2/3) + 1*(1/3)
    expect(out[1]).toBeCloseTo(2 * (2 / 3) + 1 * (1 / 3), 6);
  });
  it('tracks a constant series exactly', () => {
    expect(emaSeries([7, 7, 7, 7], 3)).toEqual([7, 7, 7, 7]);
  });
});

describe('rsiSeries', () => {
  it('is null during warm-up then defined', () => {
    const out = rsiSeries([1, 2, 3, 4, 5], 14);
    expect(out.every((v) => v === null)).toBe(true); // too few bars
  });
  it('returns 100 for a monotonic uptrend and 0 for a downtrend', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 200 - i);
    expect(lastVal(rsiSeries(up, 14))).toBe(100);
    expect(lastVal(rsiSeries(down, 14))).toBe(0);
  });
});

describe('atrSeries', () => {
  it('equals the constant true range when H-L is fixed and no gaps', () => {
    // close flat, high/low ±2 → TR = 4 every bar
    const b = bars(Array(30).fill(50), { spread: 2 });
    expect(lastVal(atrSeries(b, 14))).toBeCloseTo(4, 6);
  });
});

describe('bollingerPercentBSeries', () => {
  it('is 0.5 when price sits at the mean (flat series)', () => {
    // flat series → sd 0 → guarded to 0.5
    expect(lastVal(bollingerPercentBSeries(Array(25).fill(10), 20, 2))).toBe(0.5);
  });
  it('exceeds 1 when the last price spikes above the band', () => {
    const closes = [...Array(19).fill(10), 20];
    const b = lastVal(bollingerPercentBSeries(closes, 20, 2))!;
    expect(b).toBeGreaterThan(1);
  });
});

describe('mfiSeries', () => {
  it('is 100 when every bar rises and 0 when every bar falls', () => {
    const up = bars(Array.from({ length: 30 }, (_, i) => 100 + i));
    const down = bars(Array.from({ length: 30 }, (_, i) => 200 - i));
    expect(lastVal(mfiSeries(up, 14))).toBe(100);
    expect(lastVal(mfiSeries(down, 14))).toBe(0);
  });
});

describe('cmf', () => {
  it('is strongly positive when closes print at the high, negative at the low', () => {
    const closesAtHigh: DailyBar[] = Array.from({ length: 20 }, (_, i) => ({
      date: `d${i}`,
      open: 10,
      high: 11,
      low: 9,
      close: 11, // close == high → multiplier +1
      volume: 1000,
    }));
    const closesAtLow = closesAtHigh.map((b) => ({ ...b, close: 9 }));
    expect(cmf(closesAtHigh, 20)!).toBeCloseTo(1, 6);
    expect(cmf(closesAtLow, 20)!).toBeCloseTo(-1, 6);
  });
});

describe('percentile', () => {
  it('interpolates linearly', () => {
    const a = [1, 2, 3, 4, 5];
    expect(percentile(a, 0)).toBe(1);
    expect(percentile(a, 1)).toBe(5);
    expect(percentile(a, 0.5)).toBe(3);
    expect(percentile(a, 0.25)).toBe(2);
  });
});

describe('findPivots', () => {
  it('finds the confirmed swing high and low', () => {
    const v = [1, 3, 5, 3, 1, 3, 6, 8, 6, 3];
    const { highs, lows } = findPivots(v, 2);
    expect(highs).toContain(2); // value 5
    expect(highs).toContain(7); // value 8
    expect(lows).toContain(4); // value 1 (min within ±2)
  });
});

describe('detectDivergence', () => {
  it('flags bearish divergence: price higher-high, oscillator lower-high', () => {
    const price = [1, 3, 5, 3, 1, 3, 6, 8, 6, 3]; // pivot highs at idx 2 (5) and 7 (8)
    const osc = Array(10).fill(50);
    osc[2] = 70;
    osc[7] = 60; // lower high on the oscillator
    const d = detectDivergence(price, osc, 'RSI', 60, 2);
    expect(d?.direction).toBe('bearish');
  });
  it('flags bullish divergence: price lower-low, oscillator higher-low', () => {
    const price = [10, 8, 6, 8, 10, 8, 5, 3, 5, 8]; // pivot lows at idx 2 (6) and 7 (3)
    const osc = Array(10).fill(50);
    osc[2] = 30;
    osc[7] = 40; // higher low on the oscillator
    const d = detectDivergence(price, osc, 'MFI', 60, 2);
    expect(d?.direction).toBe('bullish');
  });
  it('returns null when price and oscillator agree', () => {
    const price = [1, 3, 5, 3, 1, 3, 6, 8, 6, 3];
    const osc = Array(10).fill(50);
    osc[2] = 60;
    osc[7] = 70; // higher high, confirms price → no divergence
    expect(detectDivergence(price, osc, 'RSI', 60, 2)).toBeNull();
  });
});

describe('stochasticKD', () => {
  it('%K ~100 at the top of the range; %D lags %K by its smoothing', () => {
    const b = bars(Array.from({ length: 40 }, () => 10), { spread: 2 }).map((x) => ({ ...x, close: x.high }));
    const { k, d } = stochasticKD(b, 14, 3, 3);
    expect(lastVal(k)!).toBeCloseTo(100, 4);
    expect(lastVal(d)!).toBeCloseTo(100, 4);
    // %D warms up 2 bars after %K (3-period SMA of %K).
    const firstK = k.findIndex((v) => v !== null);
    const firstD = d.findIndex((v) => v !== null);
    expect(firstD - firstK).toBe(2);
  });
});

describe('cciSeries', () => {
  it('is strongly positive on a persistent uptrend, negative on a downtrend', () => {
    const up = bars(Array.from({ length: 40 }, (_, i) => 100 + i));
    const down = bars(Array.from({ length: 40 }, (_, i) => 200 - i));
    expect(lastVal(cciSeries(up, 20))!).toBeGreaterThan(100);
    expect(lastVal(cciSeries(down, 20))!).toBeLessThan(-100);
  });
  it('is null until `period` bars are available', () => {
    const b = bars(Array.from({ length: 10 }, (_, i) => 100 + i));
    expect(cciSeries(b, 20).every((v) => v === null)).toBe(true);
  });
});

describe('momentumSeries', () => {
  it('equals close minus close `period` bars ago', () => {
    const closes = Array.from({ length: 20 }, (_, i) => i * i); // 0,1,4,9,...
    const m = momentumSeries(closes, 10);
    expect(m[9]).toBeNull();
    expect(m[10]).toBe(closes[10] - closes[0]);
    expect(lastVal(m)!).toBe(closes[19] - closes[9]);
  });
});
