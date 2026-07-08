/**
 * Single source of truth for every tunable in the technical-sentiment engine —
 * indicator periods, thresholds, extension/volatility context, divergence
 * detection, bucket weights, and the score→label cutoffs. Pass a partial
 * override to `computeSentiment(bars, config)` to experiment without touching code.
 */
export type Group = 'Trend' | 'Momentum' | 'Money Flow';

export interface SentimentConfig {
  /** Minimum bars required before a rating is produced. */
  minBars: number;

  trend: {
    emaFast: number; // EMA cloud fast leg (34)
    emaMid: number; // EMA cloud slow leg / mid MA (50)
    emaSlow: number; // long EMA (200)
    smaSlow: number; // long SMA (200)
    vwapWindow: number; // rolling VWAP window (252 ≈ 1y)
  };

  momentum: {
    rsiPeriod: number; // 14
    stochPeriod: number; // 14
    stochSmooth: number; // 3
    macdFast: number; // 12
    macdSlow: number; // 26
    macdSignal: number; // 9
    rsiOb: number; // fixed overbought fallback (70)
    rsiOs: number; // fixed oversold fallback (30)
    stochOb: number; // 80
    stochOs: number; // 20
  };

  moneyFlow: {
    mfiPeriod: number; // 14
    cmfPeriod: number; // 20
    mfiOb: number; // 80
    mfiOs: number; // 20
    cmfDeadzone: number; // ± band around 0 that counts as neutral (0.05)
  };

  /** Adaptive oscillator thresholds: overbought/oversold from the instrument's OWN
   *  recent percentile distribution instead of fixed constants. */
  adaptive: {
    enabled: boolean;
    lookback: number; // trailing bars for the percentile (252)
    minSamples: number; // fall back to fixed thresholds below this many samples
    upperPct: number; // 0.85 → overbought = 85th percentile of own history
    lowerPct: number; // 0.15
    midUpper: number; // mid-zone bullish line (55)
    midLower: number; // mid-zone bearish line (45)
  };

  /** Extension / volatility context: how stretched price is from its mean. */
  extension: {
    bbPeriod: number; // Bollinger period (20)
    bbStd: number; // Bollinger std multiplier (2)
    atrPeriod: number; // 14
    atrStretchStart: number; // |price−EMA50| in ATRs before dampening starts (3)
    atrStretchFull: number; // ATRs at which dampener hits its floor (8)
    minDampen: number; // floor on the trend dampener (0.4)
  };

  divergence: {
    lookback: number; // bars examined for divergence (60)
    pivotWindow: number; // bars on each side to confirm a swing pivot (5)
    minBucketGap: number; // trend−internals gap on the −1..1 scale to flag (0.5)
  };

  /** Relative weight of each bucket in the final blend (default equal). */
  weights: Record<Group, number>;

  /** Score→label cutoffs on the −1..+1 scale. */
  labels: {
    strongBuy: number; // ≥ 0.5
    buy: number; // ≥ 0.15
    sell: number; // ≤ −0.15
    strongSell: number; // ≤ −0.5
  };
}

export const DEFAULT_CONFIG: SentimentConfig = {
  minBars: 35,
  trend: { emaFast: 34, emaMid: 50, emaSlow: 200, smaSlow: 200, vwapWindow: 252 },
  momentum: {
    rsiPeriod: 14,
    stochPeriod: 14,
    stochSmooth: 3,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    rsiOb: 70,
    rsiOs: 30,
    stochOb: 80,
    stochOs: 20,
  },
  moneyFlow: { mfiPeriod: 14, cmfPeriod: 20, mfiOb: 80, mfiOs: 20, cmfDeadzone: 0.05 },
  adaptive: { enabled: true, lookback: 252, minSamples: 60, upperPct: 0.85, lowerPct: 0.15, midUpper: 55, midLower: 45 },
  extension: { bbPeriod: 20, bbStd: 2, atrPeriod: 14, atrStretchStart: 3, atrStretchFull: 8, minDampen: 0.4 },
  divergence: { lookback: 60, pivotWindow: 5, minBucketGap: 0.5 },
  weights: { Trend: 1, Momentum: 1, 'Money Flow': 1 },
  labels: { strongBuy: 0.5, buy: 0.15, sell: -0.15, strongSell: -0.5 },
};

/** Deep-merge a partial override onto DEFAULT_CONFIG. */
export function resolveConfig(override?: DeepPartial<SentimentConfig>): SentimentConfig {
  if (!override) return DEFAULT_CONFIG;
  const d = DEFAULT_CONFIG;
  return {
    minBars: override.minBars ?? d.minBars,
    trend: { ...d.trend, ...override.trend },
    momentum: { ...d.momentum, ...override.momentum },
    moneyFlow: { ...d.moneyFlow, ...override.moneyFlow },
    adaptive: { ...d.adaptive, ...override.adaptive },
    extension: { ...d.extension, ...override.extension },
    divergence: { ...d.divergence, ...override.divergence },
    weights: { ...d.weights, ...override.weights },
    labels: { ...d.labels, ...override.labels },
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
