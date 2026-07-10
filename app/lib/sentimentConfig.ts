/**
 * Single source of truth for the technical-rating engine — a TradingView-style
 * Technical Rating (two groups: Moving Averages and Oscillators, each averaging
 * +1/0/−1 votes into a −1..+1 rating, then blended). Two deliberate departures
 * from TradingView, kept from the previous engine:
 *  - Oscillator overbought/oversold levels are ADAPTIVE (percentiles of each
 *    instrument's own recent history) so high-beta names don't go mute at fixed
 *    30/70 lines. Fixed values are the fallback below `minSamples`.
 *  - Price/oscillator and group divergences are surfaced as a separate badge,
 *    never folded into the score.
 * Pass a partial override to `computeSentiment(bars, config)` to experiment.
 */
export type Group = 'Moving Averages' | 'Oscillators';

export interface SentimentConfig {
  /** Minimum bars required before a rating is produced. */
  minBars: number;

  ma: {
    emaLadder: number[]; // price-vs-EMA votes (10/20/50/100/200)
    stackPairs: [number, number][]; // EMA-stack ordering votes ([10,20],[20,50],[50,200])
    vwapWindow: number; // rolling VWAP window for the price-vs-VWAP vote (252 ≈ 1y)
  };

  osc: {
    rsiPeriod: number; // 14
    stochPeriod: number; // 14
    stochSmoothK: number; // 3
    stochSmoothD: number; // 3
    cciPeriod: number; // 20
    adxPeriod: number; // 14
    adxSmooth: number; // 14
    momentumPeriod: number; // 10
    macdFast: number; // 12
    macdSlow: number; // 26
    macdSignal: number; // 9
    mfiPeriod: number; // 14
    cmfPeriod: number; // 20
    // Fixed overbought/oversold fallbacks (used below adaptive.minSamples).
    rsiOb: number; // 70
    rsiOs: number; // 30
    stochOb: number; // 80
    stochOs: number; // 20
    cciOb: number; // 100
    cciOs: number; // -100
    mfiOb: number; // 80
    mfiOs: number; // 20
    adxGate: number; // 20 — min ADX for a directional vote (fixed, not adaptive)
    cmfDeadzone: number; // ± band around 0 that counts as neutral (0.05)
  };

  /** Adaptive oscillator thresholds from each instrument's own percentile distribution. */
  adaptive: {
    enabled: boolean;
    lookback: number; // trailing bars for the percentile (252)
    minSamples: number; // fall back to fixed thresholds below this many samples
    upperPct: number; // 0.85 → overbought = 85th percentile of own history
    lowerPct: number; // 0.15
  };

  /** Extension / volatility context — surfaced as a badge, NOT applied to the score. */
  extension: {
    bbPeriod: number; // Bollinger period (20)
    bbStd: number; // Bollinger std multiplier (2)
    atrPeriod: number; // 14
    stretchedAtr: number; // |price−EMA50| in ATRs at which "stretched" flags (3)
  };

  divergence: {
    lookback: number; // bars examined for divergence (60)
    pivotWindow: number; // bars on each side to confirm a swing pivot (5)
    minGroupGap: number; // MA-vs-Oscillator gap on the −1..1 scale to flag (0.5)
  };

  /** Relative weight of each group in the final blend (default equal). */
  weights: Record<Group, number>;

  /** Score→label cutoffs on the −1..+1 scale (TradingView bands). */
  labels: {
    strongBuy: number; // ≥ 0.5
    buy: number; // > 0.1
    sell: number; // < −0.1
    strongSell: number; // ≤ −0.5
  };
}

export const DEFAULT_CONFIG: SentimentConfig = {
  minBars: 35,
  ma: {
    emaLadder: [10, 20, 50, 100, 200],
    stackPairs: [
      [10, 20],
      [20, 50],
      [50, 200],
    ],
    vwapWindow: 252,
  },
  osc: {
    rsiPeriod: 14,
    stochPeriod: 14,
    stochSmoothK: 3,
    stochSmoothD: 3,
    cciPeriod: 20,
    adxPeriod: 14,
    adxSmooth: 14,
    momentumPeriod: 10,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    mfiPeriod: 14,
    cmfPeriod: 20,
    rsiOb: 70,
    rsiOs: 30,
    stochOb: 80,
    stochOs: 20,
    cciOb: 100,
    cciOs: -100,
    mfiOb: 80,
    mfiOs: 20,
    adxGate: 20,
    cmfDeadzone: 0.05,
  },
  adaptive: { enabled: true, lookback: 252, minSamples: 60, upperPct: 0.85, lowerPct: 0.15 },
  extension: { bbPeriod: 20, bbStd: 2, atrPeriod: 14, stretchedAtr: 3 },
  divergence: { lookback: 60, pivotWindow: 5, minGroupGap: 0.5 },
  weights: { 'Moving Averages': 1, Oscillators: 1 },
  labels: { strongBuy: 0.5, buy: 0.1, sell: -0.1, strongSell: -0.5 },
};

/** Deep-merge a partial override onto DEFAULT_CONFIG. */
export function resolveConfig(override?: DeepPartial<SentimentConfig>): SentimentConfig {
  if (!override) return DEFAULT_CONFIG;
  const d = DEFAULT_CONFIG;
  return {
    minBars: override.minBars ?? d.minBars,
    ma: { ...d.ma, ...override.ma },
    osc: { ...d.osc, ...override.osc },
    adaptive: { ...d.adaptive, ...override.adaptive },
    extension: { ...d.extension, ...override.extension },
    divergence: { ...d.divergence, ...override.divergence },
    weights: { ...d.weights, ...override.weights },
    labels: { ...d.labels, ...override.labels },
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
