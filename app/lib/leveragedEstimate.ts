/**
 * Math for the MUU (2x daily leveraged ETF) estimator.
 *
 * A daily-rebalanced leveraged fund tracks L× the underlying's DAILY % move and
 * resets every day. So intraday it is ~exactly L× the underlying's move from the
 * prior close, but over multiple days the daily resets compound and the fund
 * drifts below a naïve L× of the underlying's cumulative move ("volatility decay").
 *
 * Standard lognormal approximation for the leveraged value ratio over N days,
 * given the underlying moves from `underlyingNow` to `target` with realized daily
 * volatility σ (see Cheng & Madhavan, "The Dynamics of Leveraged and Inverse ETFs"):
 *
 *   levRatio ≈ (target/now)^L · exp( −½·(L²−L)·σ²·N ) · (1−c)^N
 *
 * For L=2 the drag term simplifies to exp(−σ²·N). `c` is the daily cost drag
 * (expense ratio, and optionally financing) applied over the holding period.
 */
import { DailyBar } from './bars';
import config from './leveraged.json';

export interface LeveragedSpec {
  ticker: string;
  leverage: number;
  name: string;
  expenseRatio: number;
}

export type LeveragedConfig = Record<string, LeveragedSpec>;

export const LEVERAGED: LeveragedConfig = config as LeveragedConfig;

/** The leveraged companion for an underlying symbol, or null if none is configured. */
export function leveragedSpecFor(underlying: string): LeveragedSpec | null {
  return LEVERAGED[underlying.toUpperCase()] ?? null;
}

/** Sample standard deviation of the last `window` daily log returns of `closes`. */
export function realizedDailyVol(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance);
}

export interface LeverageFit {
  slope: number; // realized leverage (expect ~ configured leverage)
  r2: number; // goodness of fit of the daily-return regression
  days: number; // number of aligned daily-return observations
}

/**
 * Empirical leverage: OLS slope of the leveraged fund's daily returns regressed on
 * the underlying's daily returns, over the dates the two series share. A slope near
 * the configured leverage with high R² confirms the fund tracks as expected.
 */
export function fitLeverage(underlying: DailyBar[], leveraged: DailyBar[]): LeverageFit | null {
  const closeByDate = new Map(underlying.map((b) => [b.date, b.close]));
  const xs: number[] = [];
  const ys: number[] = [];
  let prevU: number | null = null;
  let prevL: number | null = null;
  for (const b of leveraged) {
    const u = closeByDate.get(b.date);
    if (u == null) {
      prevU = null;
      prevL = null;
      continue;
    }
    if (prevU != null && prevL != null) {
      xs.push(u / prevU - 1);
      ys.push(b.close / prevL - 1);
    }
    prevU = u;
    prevL = b.close;
  }
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i];
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, r2, days: n };
}

export interface EstimateInput {
  underlyingNow: number; // underlying last close (reference)
  levNow: number; // leveraged fund last close (reference / dollar anchor)
  target: number; // target underlying price
  leverage: number; // configured leverage (e.g. 2)
  dailyVol: number; // underlying realized daily volatility (stdev of log returns)
  days: number; // holding horizon in trading days (1 = same day)
  expenseRatio: number; // annual expense ratio, e.g. 0.0115
}

export interface EstimateResult {
  underlyingMovePct: number; // target vs now, %
  naivePrice: number; // no-decay reference: levNow × (1 + L·move)
  naivePct: number; // implied leveraged move, no decay, %
  decayPrice: number; // decay-adjusted estimate
  decayPct: number; // implied leveraged move, decay-adjusted, %
  decayDragPct: number; // how much the decay/cost drag subtracts vs naive, %
}

/**
 * Estimate the leveraged fund's price for a target underlying price.
 * `naivePrice` is the same-day / no-decay reference; `decayPrice` folds in the
 * volatility-decay and cost drag over `days` (equals naive when days ≤ 1 and
 * vol/cost are negligible).
 */
export function estimateLeveragedPrice(inp: EstimateInput): EstimateResult {
  const { underlyingNow, levNow, target, leverage: L, dailyVol, days, expenseRatio } = inp;
  const grossRatio = target / underlyingNow; // underlying cumulative ratio
  const move = grossRatio - 1;

  // Naive same-day / no-decay reference.
  const naivePrice = levNow * (1 + L * move);

  // Decay-adjusted: (ratio)^L · exp(−½(L²−L)σ²N) · (1−c)^N
  const dailyCost = expenseRatio / 252;
  const n = Math.max(days, 0);
  const decayTerm = Math.exp(-0.5 * (L * L - L) * dailyVol * dailyVol * n);
  const costTerm = Math.pow(1 - dailyCost, n);
  const decayRatio = Math.pow(grossRatio, L) * decayTerm * costTerm;
  const decayPrice = levNow * decayRatio;

  return {
    underlyingMovePct: move * 100,
    naivePrice,
    naivePct: L * move * 100,
    decayPrice,
    decayPct: (decayRatio - 1) * 100,
    decayDragPct: naivePrice > 0 ? ((decayPrice - naivePrice) / levNow) * 100 : 0,
  };
}
