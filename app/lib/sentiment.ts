import { DailyBar } from './alphavantage';
import { computeEMA, computeSMA, computeRollingVwap } from './vwap';

export type Verdict = 'bullish' | 'neutral' | 'bearish';
export type Group = 'Trend' | 'Momentum' | 'Money Flow';

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

export interface Sentiment {
  score: number; // -1 (max bearish) .. +1 (max bullish)
  score100: number; // 0..100 for a gauge
  label: 'Strong Sell' | 'Sell' | 'Neutral' | 'Buy' | 'Strong Buy';
  bullish: number;
  neutral: number;
  bearish: number;
  groups: GroupScore[];
  signals: SentimentSignal[];
}

function labelFor(score: number): Sentiment['label'] {
  if (score >= 0.5) return 'Strong Buy';
  if (score >= 0.15) return 'Buy';
  if (score > -0.15) return 'Neutral';
  if (score > -0.5) return 'Sell';
  return 'Strong Sell';
}

const verdictOf = (vote: number): Verdict => (vote > 0 ? 'bullish' : vote < 0 ? 'bearish' : 'neutral');
const to100 = (score: number) => Math.round(((score + 1) / 2) * 100);

// Oscillator vote (0..100 input): rewards healthy momentum, but tempers BOTH extremes
// (overbought and oversold collapse to neutral rather than piling on).
function oscVote(x: number, ob: number, os: number): number {
  if (x > ob || x < os) return 0; // extreme → tempered
  if (x >= 55) return 1;
  if (x > 45) return 0;
  return -1;
}

// Full-length (index-aligned) EMA over a value series, seeded with the first value.
function emaArr(values: number[], window: number): number[] {
  const k = 2 / (window + 1);
  const out: number[] = [];
  let ema = values[0];
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[0] : values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

// Wilder's RSI over `period` bars; latest value.
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// Stochastic %D = 3-period SMA of %K(period). Latest value.
function stochastic(bars: DailyBar[], period = 14, smooth = 3): number | null {
  if (bars.length < period + smooth) return null;
  const kValues: number[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const win = bars.slice(i - period + 1, i + 1);
    const hi = Math.max(...win.map((b) => b.high));
    const lo = Math.min(...win.map((b) => b.low));
    kValues.push(hi === lo ? 50 : (100 * (bars[i].close - lo)) / (hi - lo));
  }
  const lastK = kValues.slice(-smooth);
  return lastK.reduce((s, v) => s + v, 0) / lastK.length;
}

// Money Flow Index over `period` bars; latest value.
function mfi(bars: DailyBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  let pos = 0;
  let neg = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const rawFlow = tp[i] * bars[i].volume;
    if (tp[i] > tp[i - 1]) pos += rawFlow;
    else if (tp[i] < tp[i - 1]) neg += rawFlow;
  }
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

// Chaikin Money Flow over `period` bars; latest value (-1..+1).
function cmf(bars: DailyBar[], period = 20): number | null {
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

/**
 * Technical sentiment rating for a single stock, derived from its own price/volume.
 * Signals are organized into three equally-weighted groups so trend can't dominate:
 *   Trend (moving-average alignment) · Momentum (oscillators) · Money Flow (volume).
 * A group is skipped only if none of its signals have enough data.
 */
export function computeSentiment(bars: DailyBar[]): Sentiment | null {
  if (bars.length < 35) return null;
  const closes = bars.map((b) => b.close);
  const price = closes[closes.length - 1];
  const last = <T>(a: T[]): T | undefined => a[a.length - 1];
  const signals: SentimentSignal[] = [];
  const push = (name: string, group: Group, vote: number, detail: string) =>
    signals.push({ name, group, verdict: verdictOf(vote), detail });

  // ---- Trend group (moving-average alignment) ----
  const ema34 = last(computeEMA(bars, 34))?.value;
  const ema50 = last(computeEMA(bars, 50))?.value;
  const ema200 = last(computeEMA(bars, 200))?.value;
  const sma200 = last(computeSMA(bars, 200))?.value;
  const vwap = last(computeRollingVwap(bars, 252))?.value;
  const trendVotes: number[] = [];
  const addTrend = (name: string, vote: number, detail: string) => {
    trendVotes.push(vote);
    push(name, 'Trend', vote, detail);
  };
  if (ema50 !== undefined && ema200 !== undefined)
    addTrend('Trend (EMA 50 vs 200)', Math.sign(ema50 - ema200), `EMA50 ${ema50.toFixed(2)} vs EMA200 ${ema200.toFixed(2)}`);
  if (ema34 !== undefined && ema50 !== undefined)
    addTrend('EMA Cloud 34/50', Math.sign(ema34 - ema50), `EMA34 ${ema34.toFixed(2)} vs EMA50 ${ema50.toFixed(2)}`);
  if (sma200 !== undefined)
    addTrend('Price vs SMA 200', Math.sign(price - sma200), `Price ${price.toFixed(2)} vs SMA200 ${sma200.toFixed(2)}`);
  if (vwap !== undefined)
    addTrend('Price vs 1Y VWAP', Math.sign(price - vwap), `Price ${price.toFixed(2)} vs VWAP ${vwap.toFixed(2)}`);

  // ---- Momentum group (oscillators) ----
  const momentumVotes: number[] = [];
  const addMom = (name: string, vote: number, detail: string) => {
    momentumVotes.push(vote);
    push(name, 'Momentum', vote, detail);
  };
  const r = rsi(closes, 14);
  if (r !== null) addMom('RSI (14)', oscVote(r, 70, 30), `RSI ${r.toFixed(1)}`);
  const st = stochastic(bars, 14, 3);
  if (st !== null) addMom('Stochastic (14,3)', oscVote(st, 80, 20), `%D ${st.toFixed(1)}`);
  {
    const ema12 = emaArr(closes, 12);
    const ema26 = emaArr(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = emaArr(macdLine, 9);
    const macd = macdLine[macdLine.length - 1];
    const sig = signalLine[signalLine.length - 1];
    addMom('MACD (12/26/9)', Math.sign(macd - sig), `MACD ${macd.toFixed(2)} vs signal ${sig.toFixed(2)}`);
  }

  // ---- Money-flow group (volume) ----
  const flowVotes: number[] = [];
  const addFlow = (name: string, vote: number, detail: string) => {
    flowVotes.push(vote);
    push(name, 'Money Flow', vote, detail);
  };
  const m = mfi(bars, 14);
  if (m !== null) addFlow('Money Flow Index (14)', oscVote(m, 80, 20), `MFI ${m.toFixed(1)}`);
  const cf = cmf(bars, 20);
  if (cf !== null) addFlow('Chaikin Money Flow (20)', cf > 0.05 ? 1 : cf < -0.05 ? -1 : 0, `CMF ${cf.toFixed(3)}`);

  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const groups: GroupScore[] = [];
  const groupScores: number[] = [];
  const record = (name: Group, votes: number[]) => {
    if (!votes.length) return;
    const s = mean(votes);
    groupScores.push(s);
    groups.push({ name, score100: to100(s) });
  };
  record('Trend', trendVotes);
  record('Momentum', momentumVotes);
  record('Money Flow', flowVotes);

  if (!groupScores.length) return null;
  const score = mean(groupScores); // equal weight across groups

  return {
    score,
    score100: to100(score),
    label: labelFor(score),
    bullish: signals.filter((s) => s.verdict === 'bullish').length,
    neutral: signals.filter((s) => s.verdict === 'neutral').length,
    bearish: signals.filter((s) => s.verdict === 'bearish').length,
    groups,
    signals,
  };
}
