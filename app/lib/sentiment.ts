import { DailyBar } from './bars';
import { computeEMA, computeRollingVwap } from './vwap';
import {
  atrSeries,
  bollingerPercentBSeries,
  cciSeries,
  cmf,
  detectDivergence,
  dmiSeries,
  emaSeries,
  lastVal,
  mfiSeries,
  momentumSeries,
  percentile,
  rsiSeries,
  Series,
  stochasticKD,
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
  score: number; // -1..+1
  bullish: number;
  neutral: number;
  bearish: number;
}

export interface Divergence {
  kind: 'price-rsi' | 'price-mfi' | 'group';
  direction: 'bullish' | 'bearish';
  detail: string;
}

export interface Sentiment {
  score: number; // -1 (max bearish) .. +1 (max bullish)
  label: 'Strong Sell' | 'Sell' | 'Neutral' | 'Buy' | 'Strong Buy';
  bullish: number;
  neutral: number;
  bearish: number;
  groups: GroupScore[];
  signals: SentimentSignal[];
  regime: 'uptrend' | 'downtrend' | 'neutral';
  extension: { bbPercentB: number | null; atrDistance: number | null; stretched: boolean };
  divergences: Divergence[];
  divergenceFlag: string | null;
  weights: Record<Group, number>;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const verdictOf = (vote: number): Verdict => (vote > 0 ? 'bullish' : vote < 0 ? 'bearish' : 'neutral');

function labelFor(score: number, cfg: SentimentConfig): Sentiment['label'] {
  const { strongBuy, buy, sell, strongSell } = cfg.labels;
  if (score >= strongBuy) return 'Strong Buy';
  if (score > buy) return 'Buy';
  if (score >= sell) return 'Neutral';
  if (score > strongSell) return 'Sell';
  return 'Strong Sell';
}

/** Adaptive overbought/oversold levels from the oscillator's own recent percentiles,
 *  falling back to fixed values below `minSamples`. */
function obOsLevels(series: Series, cfg: SentimentConfig, fixedOb: number, fixedOs: number): { ob: number; os: number } {
  if (cfg.adaptive.enabled) {
    const recent = series.slice(-cfg.adaptive.lookback).filter((v): v is number => v !== null);
    if (recent.length >= cfg.adaptive.minSamples) {
      return { ob: percentile(recent, cfg.adaptive.upperPct), os: percentile(recent, cfg.adaptive.lowerPct) };
    }
  }
  return { ob: fixedOb, os: fixedOs };
}

const rising = (s: Series): boolean => {
  const n = s.length;
  return s[n - 1] !== null && s[n - 2] !== null && (s[n - 1] as number) > (s[n - 2] as number);
};
const falling = (s: Series): boolean => {
  const n = s.length;
  return s[n - 1] !== null && s[n - 2] !== null && (s[n - 1] as number) < (s[n - 2] as number);
};

/** TradingView-style oscillator vote: oversold AND turning up = buy, overbought AND
 *  turning down = sell, else neutral. */
function oscVote(series: Series, ob: number, os: number): number {
  const v = lastVal(series);
  if (v === null) return 0;
  if (v < os && rising(series)) return 1;
  if (v > ob && falling(series)) return -1;
  return 0;
}

/**
 * TradingView-style Technical Rating for a single stock, from its own price/volume.
 * Two groups (Moving Averages, Oscillators) each average +1/0/−1 votes into a −1..+1
 * rating; the overall score is their (weighted) mean. Oscillator OB/OS levels are
 * adaptive; extension and divergence are surfaced as badges, never folded into the score.
 */
export function computeSentiment(bars: DailyBar[], override?: DeepPartial<SentimentConfig>): Sentiment | null {
  const cfg = resolveConfig(override);
  if (bars.length < cfg.minBars) return null;

  const closes = bars.map((b) => b.close);
  const price = closes[closes.length - 1];
  const signals: SentimentSignal[] = [];
  const push = (name: string, group: Group, vote: number, detail: string) =>
    signals.push({ name, group, verdict: verdictOf(vote), detail });

  // ============ Moving Averages group ============
  const maVotes: number[] = [];
  const emaVals = new Map<number, number | null>();
  for (const w of new Set([...cfg.ma.emaLadder, ...cfg.ma.stackPairs.flat()])) {
    emaVals.set(w, lastVal(computeEMA(bars, w).map((p) => p.value)));
  }
  for (const w of cfg.ma.emaLadder) {
    const e = emaVals.get(w) ?? null;
    if (e === null) continue;
    const v = Math.sign(price - e);
    maVotes.push(v);
    push(`Price vs EMA ${w}`, 'Moving Averages', v, `Price ${price.toFixed(2)} vs EMA${w} ${e.toFixed(2)}`);
  }
  for (const [fast, slow] of cfg.ma.stackPairs) {
    const ef = emaVals.get(fast) ?? null;
    const es = emaVals.get(slow) ?? null;
    if (ef === null || es === null) continue;
    const v = Math.sign(ef - es);
    maVotes.push(v);
    push(`EMA ${fast} vs ${slow}`, 'Moving Averages', v, `EMA${fast} ${ef.toFixed(2)} vs EMA${slow} ${es.toFixed(2)}`);
  }
  const vwap = lastVal(computeRollingVwap(bars, cfg.ma.vwapWindow).map((p) => p.value));
  if (vwap !== null) {
    const v = Math.sign(price - vwap);
    maVotes.push(v);
    push('Price vs 1Y VWAP', 'Moving Averages', v, `Price ${price.toFixed(2)} vs VWAP ${vwap.toFixed(2)}`);
  }
  const maRating = maVotes.length ? mean(maVotes) : null;

  // ============ Oscillators group ============
  const oscVotes: number[] = [];

  const rsiS = rsiSeries(closes, cfg.osc.rsiPeriod);
  const rsiVal = lastVal(rsiS);
  if (rsiVal !== null) {
    const { ob, os } = obOsLevels(rsiS, cfg, cfg.osc.rsiOb, cfg.osc.rsiOs);
    const v = oscVote(rsiS, ob, os);
    oscVotes.push(v);
    push('RSI (14)', 'Oscillators', v, `RSI ${rsiVal.toFixed(1)} (OB ${ob.toFixed(0)}/OS ${os.toFixed(0)})`);
  }

  const { k: stochK, d: stochD } = stochasticKD(bars, cfg.osc.stochPeriod, cfg.osc.stochSmoothK, cfg.osc.stochSmoothD);
  const kv = lastVal(stochK);
  const dv = lastVal(stochD);
  if (kv !== null && dv !== null) {
    const { ob, os } = obOsLevels(stochK, cfg, cfg.osc.stochOb, cfg.osc.stochOs);
    const v = kv < os && dv < os && kv > dv ? 1 : kv > ob && dv > ob && kv < dv ? -1 : 0;
    oscVotes.push(v);
    push('Stochastic (14,3,3)', 'Oscillators', v, `%K ${kv.toFixed(1)} %D ${dv.toFixed(1)}`);
  }

  const cciS = cciSeries(bars, cfg.osc.cciPeriod);
  const cciVal = lastVal(cciS);
  if (cciVal !== null) {
    const { ob, os } = obOsLevels(cciS, cfg, cfg.osc.cciOb, cfg.osc.cciOs);
    const v = oscVote(cciS, ob, os);
    oscVotes.push(v);
    push('CCI (20)', 'Oscillators', v, `CCI ${cciVal.toFixed(0)}`);
  }

  const { adx, plusDi, minusDi } = dmiSeries(bars, cfg.osc.adxPeriod, cfg.osc.adxSmooth);
  const adxVal = lastVal(adx);
  const pdi = lastVal(plusDi);
  const mdi = lastVal(minusDi);
  if (adxVal !== null && pdi !== null && mdi !== null) {
    const strong = adxVal > cfg.osc.adxGate && rising(adx);
    const v = strong ? (pdi > mdi ? 1 : mdi > pdi ? -1 : 0) : 0;
    oscVotes.push(v);
    push('ADX (14) / DI', 'Oscillators', v, `ADX ${adxVal.toFixed(1)} +DI ${pdi.toFixed(1)} −DI ${mdi.toFixed(1)}`);
  }

  const momS = momentumSeries(closes, cfg.osc.momentumPeriod);
  const momVal = lastVal(momS);
  if (momVal !== null) {
    const v = rising(momS) ? 1 : falling(momS) ? -1 : 0;
    oscVotes.push(v);
    push('Momentum (10)', 'Oscillators', v, `Mom ${momVal.toFixed(2)}`);
  }

  {
    const ema12 = emaSeries(closes, cfg.osc.macdFast);
    const ema26 = emaSeries(closes, cfg.osc.macdSlow);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = emaSeries(macdLine, cfg.osc.macdSignal);
    const macd = macdLine[macdLine.length - 1];
    const sig = signalLine[signalLine.length - 1];
    const v = Math.sign(macd - sig);
    oscVotes.push(v);
    push('MACD (12/26/9)', 'Oscillators', v, `MACD ${macd.toFixed(2)} vs signal ${sig.toFixed(2)}`);
  }

  const mfiS = mfiSeries(bars, cfg.osc.mfiPeriod);
  const mfiVal = lastVal(mfiS);
  if (mfiVal !== null) {
    const { ob, os } = obOsLevels(mfiS, cfg, cfg.osc.mfiOb, cfg.osc.mfiOs);
    const v = oscVote(mfiS, ob, os);
    oscVotes.push(v);
    push('Money Flow Index (14)', 'Oscillators', v, `MFI ${mfiVal.toFixed(1)}`);
  }

  const cf = cmf(bars, cfg.osc.cmfPeriod);
  if (cf !== null) {
    const v = cf > cfg.osc.cmfDeadzone ? 1 : cf < -cfg.osc.cmfDeadzone ? -1 : 0;
    oscVotes.push(v);
    push('Chaikin Money Flow (20)', 'Oscillators', v, `CMF ${cf.toFixed(3)}`);
  }

  const oscRating = oscVotes.length ? mean(oscVotes) : null;

  // ============ Weighted blend ============
  const groupRatings: { name: Group; score: number }[] = [];
  if (maRating !== null) groupRatings.push({ name: 'Moving Averages', score: maRating });
  if (oscRating !== null) groupRatings.push({ name: 'Oscillators', score: oscRating });
  if (!groupRatings.length) return null;

  let wSum = 0;
  let acc = 0;
  for (const g of groupRatings) {
    const w = cfg.weights[g.name] ?? 0;
    wSum += w;
    acc += w * g.score;
  }
  const score = wSum > 0 ? acc / wSum : mean(groupRatings.map((g) => g.score));

  const groups: GroupScore[] = groupRatings.map((g) => {
    const gs = signals.filter((s) => s.group === g.name);
    return {
      name: g.name,
      score: g.score,
      bullish: gs.filter((s) => s.verdict === 'bullish').length,
      neutral: gs.filter((s) => s.verdict === 'neutral').length,
      bearish: gs.filter((s) => s.verdict === 'bearish').length,
    };
  });

  const regime = maRating === null ? 'neutral' : maRating > 0.1 ? 'uptrend' : maRating < -0.1 ? 'downtrend' : 'neutral';

  // ============ Extension context (badge only) ============
  const bbPercentB = lastVal(bollingerPercentBSeries(closes, cfg.extension.bbPeriod, cfg.extension.bbStd));
  const atr = lastVal(atrSeries(bars, cfg.extension.atrPeriod));
  const ema50 = emaVals.get(50) ?? lastVal(computeEMA(bars, 50).map((p) => p.value));
  const atrDistance = atr !== null && atr > 0 && ema50 !== null && ema50 !== undefined ? (price - ema50) / atr : null;
  const stretched = atrDistance !== null && Math.abs(atrDistance) >= cfg.extension.stretchedAtr;

  // ============ Divergences (badge only) ============
  const divergences: Divergence[] = [];
  const dRsi = detectDivergence(closes, rsiS, 'RSI', cfg.divergence.lookback, cfg.divergence.pivotWindow);
  if (dRsi) divergences.push({ kind: 'price-rsi', ...dRsi });
  const dMfi = detectDivergence(closes, mfiS, 'MFI', cfg.divergence.lookback, cfg.divergence.pivotWindow);
  if (dMfi) divergences.push({ kind: 'price-mfi', ...dMfi });

  if (maRating !== null && oscRating !== null) {
    const gap = maRating - oscRating;
    if (gap >= cfg.divergence.minGroupGap)
      divergences.push({ kind: 'group', direction: 'bearish', detail: 'Strong MA trend, weak oscillators' });
    else if (-gap >= cfg.divergence.minGroupGap)
      divergences.push({ kind: 'group', direction: 'bullish', detail: 'Improving oscillators vs weak MA trend' });
  }

  const priceOsc = divergences.find((d) => d.kind !== 'group');
  const groupDiv = divergences.find((d) => d.kind === 'group');
  const headline = priceOsc ?? groupDiv ?? null;
  const divergenceFlag = headline ? `${headline.direction === 'bullish' ? 'Bullish' : 'Bearish'} divergence` : null;

  return {
    score,
    label: labelFor(score, cfg),
    bullish: signals.filter((s) => s.verdict === 'bullish').length,
    neutral: signals.filter((s) => s.verdict === 'neutral').length,
    bearish: signals.filter((s) => s.verdict === 'bearish').length,
    groups,
    signals,
    regime,
    extension: { bbPercentB, atrDistance, stretched },
    divergences,
    divergenceFlag,
    weights: cfg.weights,
  };
}
