import { DailyBar } from './alphavantage';
import { computeEMA, computeSMA, computeRollingVwap } from './vwap';
import {
  atrSeries,
  bollingerPercentBSeries,
  cmf,
  detectDivergence,
  emaSeries,
  lastVal,
  mfiSeries,
  percentile,
  rsiSeries,
  Series,
  stochasticSeries,
} from './indicators';
import { DeepPartial, Group, resolveConfig, SentimentConfig } from './sentimentConfig';

export type { Group } from './sentimentConfig';
export type Verdict = 'bullish' | 'neutral' | 'bearish';

export interface SentimentSignal {
  name: string;
  group: Group;
  verdict: Verdict;
  detail: string;
}

export interface GroupScore {
  name: Group;
  score100: number; // 0..100
}

export interface Divergence {
  kind: 'price-rsi' | 'price-mfi' | 'bucket';
  direction: 'bullish' | 'bearish';
  detail: string;
}

export interface Sentiment {
  // ---- existing contract (unchanged meaning) ----
  score: number; // -1 (max bearish) .. +1 (max bullish)
  score100: number; // 0..100 for a gauge
  label: 'Strong Sell' | 'Sell' | 'Neutral' | 'Buy' | 'Strong Buy';
  bullish: number;
  neutral: number;
  bearish: number;
  groups: GroupScore[];
  signals: SentimentSignal[];
  // ---- new, additive (all optional so old consumers keep working) ----
  regime?: 'uptrend' | 'downtrend' | 'neutral';
  extension?: { bbPercentB: number | null; atrDistance: number | null; dampener: number };
  divergences?: Divergence[];
  divergenceFlag?: string | null;
  weights?: Record<Group, number>;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const verdictOf = (vote: number): Verdict => (vote > 0 ? 'bullish' : vote < 0 ? 'bearish' : 'neutral');
const to100 = (score: number) => Math.round(((score + 1) / 2) * 100);

function labelFor(score: number, cfg: SentimentConfig): Sentiment['label'] {
  const { strongBuy, buy, sell, strongSell } = cfg.labels;
  if (score >= strongBuy) return 'Strong Buy';
  if (score >= buy) return 'Buy';
  if (score > sell) return 'Neutral';
  if (score > strongSell) return 'Sell';
  return 'Strong Sell';
}

/**
 * Oscillator vote that (a) adapts its overbought/oversold levels to the instrument's
 * own recent percentile distribution and (b) reads extremes conditional on the trend
 * regime — oversold in an uptrend is a bullish dip, oversold in a downtrend is just
 * tempered (not a buy). Returns +1 / 0 / −1.
 */
function adaptiveOscVote(
  value: number,
  series: Series,
  regime: number,
  cfg: SentimentConfig,
  fixedOb: number,
  fixedOs: number,
): { vote: number; ob: number; os: number } {
  let ob = fixedOb;
  let os = fixedOs;
  if (cfg.adaptive.enabled) {
    const recent = series.slice(-cfg.adaptive.lookback).filter((v): v is number => v !== null);
    if (recent.length >= cfg.adaptive.minSamples) {
      ob = percentile(recent, cfg.adaptive.upperPct);
      os = percentile(recent, cfg.adaptive.lowerPct);
    }
  }
  let vote: number;
  if (value >= ob) vote = regime < 0 ? -1 : 0; // overbought: bearish only in a downtrend, else tempered
  else if (value <= os) vote = regime > 0 ? 1 : 0; // oversold: bullish dip only in an uptrend, else tempered
  else if (value >= cfg.adaptive.midUpper) vote = 1;
  else if (value <= cfg.adaptive.midLower) vote = -1;
  else vote = 0;
  return { vote, ob, os };
}

/** Trend dampener in [minDampen, 1]: shrinks toward the floor as price stretches
 *  (in ATR units) beyond `atrStretchStart`, so a parabolic move reads with less conviction. */
function extensionDampener(atrDistance: number | null, cfg: SentimentConfig): number {
  if (atrDistance === null) return 1;
  const s = Math.abs(atrDistance);
  const { atrStretchStart, atrStretchFull, minDampen } = cfg.extension;
  if (s <= atrStretchStart) return 1;
  const t = Math.min(1, (s - atrStretchStart) / (atrStretchFull - atrStretchStart));
  return Math.max(minDampen, 1 - t * (1 - minDampen));
}

/**
 * Technical sentiment rating for a single stock, from its own price/volume.
 *
 * Design (see sentimentConfig.ts for all tunables):
 *  - Trend bucket de-duplicates collinear signals: the three trend-following signals
 *    (EMA50v200, Price vs SMA200, Price vs VWAP) are averaged into ONE component so
 *    they can't triple-count, with the faster EMA-cloud as a second component. The
 *    bucket magnitude is then dampened by how extended price is (ATR units from EMA50).
 *  - Momentum & Money-Flow oscillators use adaptive (percentile) thresholds and are
 *    read conditional on the trend regime.
 *  - Buckets are combined with configurable weights.
 *  - Divergence (bucket-level and price/oscillator) is detected and surfaced as a
 *    distinct flag rather than folded into the number.
 */
export function computeSentiment(bars: DailyBar[], override?: DeepPartial<SentimentConfig>): Sentiment | null {
  const cfg = resolveConfig(override);
  if (bars.length < cfg.minBars) return null;

  const closes = bars.map((b) => b.close);
  const price = closes[closes.length - 1];
  const signals: SentimentSignal[] = [];
  const pushSignal = (name: string, group: Group, vote: number, detail: string) =>
    signals.push({ name, group, verdict: verdictOf(vote), detail });

  // ============ Trend bucket (de-redundant) ============
  const ema34 = lastVal(toSeries(computeEMA(bars, cfg.trend.emaFast)));
  const ema50 = lastVal(toSeries(computeEMA(bars, cfg.trend.emaMid)));
  const ema200 = lastVal(toSeries(computeEMA(bars, cfg.trend.emaSlow)));
  const sma200 = lastVal(toSeries(computeSMA(bars, cfg.trend.smaSlow)));
  const vwap = lastVal(toSeries(computeRollingVwap(bars, cfg.trend.vwapWindow)));

  // Three collinear trend-followers → collapsed into ONE averaged component.
  const longVotes: number[] = [];
  if (ema50 !== null && ema200 !== null) {
    const v = Math.sign(ema50 - ema200);
    longVotes.push(v);
    pushSignal('Trend (EMA 50 vs 200)', 'Trend', v, `EMA50 ${ema50.toFixed(2)} vs EMA200 ${ema200.toFixed(2)}`);
  }
  if (sma200 !== null) {
    const v = Math.sign(price - sma200);
    longVotes.push(v);
    pushSignal('Price vs SMA 200', 'Trend', v, `Price ${price.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`);
  }
  if (vwap !== null) {
    const v = Math.sign(price - vwap);
    longVotes.push(v);
    pushSignal('Price vs 1Y VWAP', 'Trend', v, `Price ${price.toFixed(2)} vs VWAP ${vwap.toFixed(2)}`);
  }
  const longTrend = longVotes.length ? mean(longVotes) : null; // collapsed collinear block

  let shortTrend: number | null = null;
  if (ema34 !== null && ema50 !== null) {
    shortTrend = Math.sign(ema34 - ema50);
    pushSignal('EMA Cloud 34/50', 'Trend', shortTrend, `EMA34 ${ema34.toFixed(2)} vs EMA50 ${ema50.toFixed(2)}`);
  }

  const trendComponents = [longTrend, shortTrend].filter((v): v is number => v !== null);
  const regimeScore = longTrend ?? (shortTrend ?? 0);
  const regime = regimeScore > 0.1 ? 1 : regimeScore < -0.1 ? -1 : 0;

  // Extension context → dampener on trend conviction.
  const bbPercentB = lastVal(bollingerPercentBSeries(closes, cfg.extension.bbPeriod, cfg.extension.bbStd));
  const atr = lastVal(atrSeries(bars, cfg.extension.atrPeriod));
  const atrDistance = atr !== null && atr > 0 && ema50 !== null ? (price - ema50) / atr : null;
  const dampener = extensionDampener(atrDistance, cfg);

  let trendScore: number | null = trendComponents.length ? mean(trendComponents) : null;
  if (trendScore !== null) trendScore *= dampener;

  // ============ Momentum bucket (adaptive + regime-aware) ============
  const rsiS = rsiSeries(closes, cfg.momentum.rsiPeriod);
  const stochS = stochasticSeries(bars, cfg.momentum.stochPeriod, cfg.momentum.stochSmooth);
  const momentumVotes: number[] = [];
  const rsiVal = lastVal(rsiS);
  if (rsiVal !== null) {
    const { vote } = adaptiveOscVote(rsiVal, rsiS, regime, cfg, cfg.momentum.rsiOb, cfg.momentum.rsiOs);
    momentumVotes.push(vote);
    pushSignal('RSI (14)', 'Momentum', vote, `RSI ${rsiVal.toFixed(1)}`);
  }
  const stochVal = lastVal(stochS);
  if (stochVal !== null) {
    const { vote } = adaptiveOscVote(stochVal, stochS, regime, cfg, cfg.momentum.stochOb, cfg.momentum.stochOs);
    momentumVotes.push(vote);
    pushSignal('Stochastic (14,3)', 'Momentum', vote, `%D ${stochVal.toFixed(1)}`);
  }
  {
    const ema12 = emaSeries(closes, cfg.momentum.macdFast);
    const ema26 = emaSeries(closes, cfg.momentum.macdSlow);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = emaSeries(macdLine, cfg.momentum.macdSignal);
    const macd = macdLine[macdLine.length - 1];
    const sig = signalLine[signalLine.length - 1];
    const v = Math.sign(macd - sig);
    momentumVotes.push(v);
    pushSignal('MACD (12/26/9)', 'Momentum', v, `MACD ${macd.toFixed(2)} vs signal ${sig.toFixed(2)}`);
  }
  const momentumScore = momentumVotes.length ? mean(momentumVotes) : null;

  // ============ Money-Flow bucket (adaptive + regime-aware) ============
  const mfiS = mfiSeries(bars, cfg.moneyFlow.mfiPeriod);
  const flowVotes: number[] = [];
  const mfiVal = lastVal(mfiS);
  if (mfiVal !== null) {
    const { vote } = adaptiveOscVote(mfiVal, mfiS, regime, cfg, cfg.moneyFlow.mfiOb, cfg.moneyFlow.mfiOs);
    flowVotes.push(vote);
    pushSignal('Money Flow Index (14)', 'Money Flow', vote, `MFI ${mfiVal.toFixed(1)}`);
  }
  const cf = cmf(bars, cfg.moneyFlow.cmfPeriod);
  if (cf !== null) {
    const v = cf > cfg.moneyFlow.cmfDeadzone ? 1 : cf < -cfg.moneyFlow.cmfDeadzone ? -1 : 0;
    flowVotes.push(v);
    pushSignal('Chaikin Money Flow (20)', 'Money Flow', v, `CMF ${cf.toFixed(3)}`);
  }
  const flowScore = flowVotes.length ? mean(flowVotes) : null;

  // ============ Weighted blend across buckets ============
  const bucketScores: { name: Group; score: number }[] = [];
  if (trendScore !== null) bucketScores.push({ name: 'Trend', score: trendScore });
  if (momentumScore !== null) bucketScores.push({ name: 'Momentum', score: momentumScore });
  if (flowScore !== null) bucketScores.push({ name: 'Money Flow', score: flowScore });
  if (!bucketScores.length) return null;

  let wSum = 0;
  let acc = 0;
  for (const b of bucketScores) {
    const w = cfg.weights[b.name] ?? 0;
    wSum += w;
    acc += w * b.score;
  }
  const score = wSum > 0 ? acc / wSum : mean(bucketScores.map((b) => b.score));
  const groups: GroupScore[] = bucketScores.map((b) => ({ name: b.name, score100: to100(b.score) }));

  // ============ Divergence (surfaced separately, not folded into the score) ============
  const divergences: Divergence[] = [];
  const dRsi = detectDivergence(closes, rsiS, 'RSI', cfg.divergence.lookback, cfg.divergence.pivotWindow);
  if (dRsi) divergences.push({ kind: 'price-rsi', ...dRsi });
  const dMfi = detectDivergence(closes, mfiS, 'MFI', cfg.divergence.lookback, cfg.divergence.pivotWindow);
  if (dMfi) divergences.push({ kind: 'price-mfi', ...dMfi });

  // Bucket divergence: trend running ahead of (or behind) the internals.
  const internalScores = [momentumScore, flowScore].filter((v): v is number => v !== null);
  if (trendScore !== null && internalScores.length) {
    const internals = mean(internalScores);
    const gap = trendScore - internals;
    if (gap >= cfg.divergence.minBucketGap)
      divergences.push({ kind: 'bucket', direction: 'bearish', detail: 'Strong trend, weak momentum/flow' });
    else if (-gap >= cfg.divergence.minBucketGap)
      divergences.push({ kind: 'bucket', direction: 'bullish', detail: 'Improving momentum/flow vs weak trend' });
  }

  // Headline flag: prioritise a price/oscillator divergence, then bucket divergence.
  const priceOsc = divergences.find((d) => d.kind !== 'bucket');
  const bucketDiv = divergences.find((d) => d.kind === 'bucket');
  const headline = priceOsc ?? bucketDiv ?? null;
  const divergenceFlag = headline
    ? `${headline.direction === 'bullish' ? 'Bullish' : 'Bearish'} divergence`
    : null;

  return {
    score,
    score100: to100(score),
    label: labelFor(score, cfg),
    bullish: signals.filter((s) => s.verdict === 'bullish').length,
    neutral: signals.filter((s) => s.verdict === 'neutral').length,
    bearish: signals.filter((s) => s.verdict === 'bearish').length,
    groups,
    signals,
    regime: regime > 0 ? 'uptrend' : regime < 0 ? 'downtrend' : 'neutral',
    extension: { bbPercentB, atrDistance, dampener },
    divergences,
    divergenceFlag,
    weights: cfg.weights,
  };
}

// computeEMA/SMA/VWAP return {date,value}[]; adapt to the Series shape lastVal expects.
function toSeries(points: { value: number }[]): Series {
  return points.map((p) => p.value);
}
