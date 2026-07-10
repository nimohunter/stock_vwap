/**
 * Relative Strength (RS) vs a benchmark — a port of the "BRMA" TradingView idea
 * (.resource/based-rsi-mfi-adx.pine) to this project's local daily data.
 *
 * Everything is computed on the *strength ratio* series (stock price ÷ benchmark
 * close × 100), not raw price: RSI on the ratio asks "is this stock's
 * outperformance stretched?", ADX asks "how strong is the relative trend?".
 * The benchmark is VOO (S&P 500 proxy) since it's already in app/data.
 *
 * Differences from the Pine script, per project conventions:
 *  - Overbought/oversold thresholds are adaptive (trailing percentiles of the
 *    ratio-RSI's own history, clamped to sane ranges) instead of fixed 60/70/40/30,
 *    matching the sentiment engine's philosophy. Fixed values are the fallback
 *    while the percentile window has too few samples.
 *  - The episode state machine is causal (bar i uses only data ≤ i), so a single
 *    full-series pass is already walk-forward — the backtest reuses it directly.
 */
import { DailyBar } from './bars';
import { Series, rsiSeries, mfiSeries, adxSeries, percentile } from './indicators';

export type RsEventType = 'obStart' | 'obEnd' | 'osStart' | 'osEnd' | 'obExtreme' | 'osExtreme';

export interface RsEvent {
  date: string;
  type: RsEventType;
}

export interface RsConfig {
  benchmark: string;
  minBars: number; // aligned bars required before producing a result
  rsiPeriod: number;
  mfiPeriod: number;
  adxPeriod: number;
  adxSmooth: number;
  /** OB/OS "start" also requires a fresh N-bar extreme of the ratio-RSI (Pine: 30). */
  breakoutLookback: number;
  /** Suppress episode starts while ADX < adxGate (Pine's "Filter Weak Signals"). */
  filterWeak: boolean;
  adxGate: number; // 20
  strongAdx: number; // 25 — "strong trend" label cutoff
  extreme: { adx: number; mfiOb: number; mfiOs: number };
  adaptive: {
    enabled: boolean;
    lookback: number; // trailing ratio-RSI samples for percentiles (252)
    minSamples: number; // fall back to fixed below this (60)
    obEnterPct: number; // 0.80
    obHardPct: number; // 0.95
    osEnterPct: number; // 0.20
    osHardPct: number; // 0.05
    clamps: { obEnter: [number, number]; obHard: [number, number]; osEnter: [number, number]; osHard: [number, number] };
  };
  fixed: { obEnter: number; obHard: number; osEnter: number; osHard: number };
  perfWindow: number; // bars for the relative-performance readout (63 ≈ 3M)
}

export const RS_DEFAULTS: RsConfig = {
  benchmark: 'VOO',
  minBars: 100,
  rsiPeriod: 14,
  mfiPeriod: 14,
  adxPeriod: 14,
  adxSmooth: 14,
  breakoutLookback: 30,
  filterWeak: true,
  adxGate: 20,
  strongAdx: 25,
  extreme: { adx: 25, mfiOb: 80, mfiOs: 20 },
  adaptive: {
    enabled: true,
    lookback: 252,
    minSamples: 60,
    obEnterPct: 0.8,
    obHardPct: 0.95,
    osEnterPct: 0.2,
    osHardPct: 0.05,
    clamps: { obEnter: [55, 68], obHard: [65, 80], osEnter: [32, 45], osHard: [20, 35] },
  },
  fixed: { obEnter: 60, obHard: 70, osEnter: 40, osHard: 30 },
  perfWindow: 63,
};

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

export interface RsThresholds {
  obEnter: number[];
  obHard: number[];
  osEnter: number[];
  osHard: number[];
}

/** Per-bar OB/OS thresholds from the ratio-RSI's own trailing percentiles (causal). */
export function adaptiveThresholds(rsi: Series, cfg: RsConfig): RsThresholds {
  const n = rsi.length;
  const t: RsThresholds = {
    obEnter: new Array(n).fill(cfg.fixed.obEnter),
    obHard: new Array(n).fill(cfg.fixed.obHard),
    osEnter: new Array(n).fill(cfg.fixed.osEnter),
    osHard: new Array(n).fill(cfg.fixed.osHard),
  };
  if (!cfg.adaptive.enabled) return t;
  const a = cfg.adaptive;
  for (let i = 0; i < n; i++) {
    const window: number[] = [];
    for (let j = Math.max(0, i - a.lookback + 1); j <= i; j++) {
      const v = rsi[j];
      if (v !== null) window.push(v);
    }
    if (window.length < a.minSamples) continue;
    t.obEnter[i] = clamp(percentile(window, a.obEnterPct), a.clamps.obEnter);
    t.obHard[i] = clamp(percentile(window, a.obHardPct), a.clamps.obHard);
    t.osEnter[i] = clamp(percentile(window, a.osEnterPct), a.clamps.osEnter);
    t.osHard[i] = clamp(percentile(window, a.osHardPct), a.clamps.osHard);
  }
  return t;
}

export interface EpisodeResult {
  events: RsEvent[];
  state: 'overbought' | 'oversold' | 'neutral';
  extreme: boolean;
}

/**
 * The Pine script's stateful OB/OS episode machine, generalized to per-bar
 * thresholds. Pure function of aligned arrays so it can be unit-tested with
 * synthetic inputs. Bar i only reads indices ≤ i (causal).
 */
export function runEpisodeMachine(
  dates: string[],
  rsi: Series,
  adx: Series,
  mfi: Series,
  thresholds: RsThresholds,
  cfg: RsConfig,
): EpisodeResult {
  const events: RsEvent[] = [];
  let inOB = false;
  let inOS = false;
  let extObActive = false;
  let extOsActive = false;

  for (let i = 0; i < dates.length; i++) {
    const r = rsi[i];
    if (r === null) continue;
    const a = adx[i];
    const aPrev = i > 0 ? adx[i - 1] : null;
    const adxFalling = a !== null && aPrev !== null && a < aPrev;
    const gateOk = !cfg.filterWeak || (a !== null && a >= cfg.adxGate);

    // Fresh N-bar RSI extreme (Pine: highest/lowest of the previous 30 bars).
    let hi = -Infinity;
    let lo = Infinity;
    let count = 0;
    for (let j = Math.max(0, i - cfg.breakoutLookback); j < i; j++) {
      const v = rsi[j];
      if (v === null) continue;
      count++;
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    const windowFull = count >= cfg.breakoutLookback;
    const newHigh = windowFull && r > hi;
    const newLow = windowFull && r < lo;

    const obStartCond = (r > thresholds.obEnter[i] && newHigh) || r > thresholds.obHard[i];
    const obEndCond = r < thresholds.obEnter[i] || (r < thresholds.obHard[i] && adxFalling);
    const osStartCond = (r < thresholds.osEnter[i] && newLow) || r < thresholds.osHard[i];
    const osEndCond = r > thresholds.osEnter[i] || (r > thresholds.osHard[i] && adxFalling);

    if (!inOB && obStartCond) {
      if (gateOk) {
        inOB = true;
        events.push({ date: dates[i], type: 'obStart' });
        if (inOS) {
          inOS = false;
          events.push({ date: dates[i], type: 'osEnd' });
        }
      }
    } else if (inOB && obEndCond) {
      inOB = false;
      events.push({ date: dates[i], type: 'obEnd' });
    }

    if (!inOS && osStartCond) {
      if (gateOk) {
        inOS = true;
        events.push({ date: dates[i], type: 'osStart' });
        if (inOB) {
          inOB = false;
          events.push({ date: dates[i], type: 'obEnd' });
        }
      }
    } else if (inOS && osEndCond) {
      inOS = false;
      events.push({ date: dates[i], type: 'osEnd' });
    }

    // Extreme flags only fire on the rising edge, while inside an episode.
    const m = mfi[i];
    const obExtCond =
      inOB && r > thresholds.obHard[i] && m !== null && m > cfg.extreme.mfiOb && a !== null && a > cfg.extreme.adx;
    if (obExtCond && !extObActive) events.push({ date: dates[i], type: 'obExtreme' });
    extObActive = obExtCond;

    const osExtCond =
      inOS && r < thresholds.osHard[i] && m !== null && m < cfg.extreme.mfiOs && a !== null && a > cfg.extreme.adx;
    if (osExtCond && !extOsActive) events.push({ date: dates[i], type: 'osExtreme' });
    extOsActive = osExtCond;
  }

  return {
    events,
    state: inOB ? 'overbought' : inOS ? 'oversold' : 'neutral',
    extreme: extObActive || extOsActive,
  };
}

export interface RsSeriesResult {
  dates: string[];
  ratioCloses: number[];
  stockCloses: number[];
  benchCloses: number[];
  rsi: Series;
  adx: Series;
  mfi: Series;
  thresholds: RsThresholds;
  episode: EpisodeResult;
}

/**
 * Align stock and benchmark bars by date, build the strength-ratio series, and
 * run all RS indicators plus the episode machine. Returns null with too little
 * overlapping history.
 */
export function computeRsSeries(
  stockBars: DailyBar[],
  benchBars: DailyBar[],
  cfg: RsConfig = RS_DEFAULTS,
): RsSeriesResult | null {
  const benchByDate = new Map(benchBars.map((b) => [b.date, b.close]));
  const aligned = stockBars.filter((b) => {
    const bc = benchByDate.get(b.date);
    return bc !== undefined && bc > 0;
  });
  if (aligned.length < cfg.minBars) return null;

  // Pine convention: high/low/close all divided by the benchmark *close* of the same bar.
  const ratioBars = aligned.map((b) => {
    const bc = benchByDate.get(b.date)!;
    return {
      date: b.date,
      open: (b.open / bc) * 100,
      high: (b.high / bc) * 100,
      low: (b.low / bc) * 100,
      close: (b.close / bc) * 100,
      volume: b.volume,
    };
  });

  const dates = ratioBars.map((b) => b.date);
  const ratioCloses = ratioBars.map((b) => b.close);
  const rsi = rsiSeries(ratioCloses, cfg.rsiPeriod);
  const adx = adxSeries(ratioBars, cfg.adxPeriod, cfg.adxSmooth);
  const mfi = mfiSeries(ratioBars, cfg.mfiPeriod);
  const thresholds = adaptiveThresholds(rsi, cfg);
  const episode = runEpisodeMachine(dates, rsi, adx, mfi, thresholds, cfg);

  return {
    dates,
    ratioCloses,
    stockCloses: aligned.map((b) => b.close),
    benchCloses: aligned.map((b) => benchByDate.get(b.date)!),
    rsi,
    adx,
    mfi,
    thresholds,
    episode,
  };
}

export interface RsEpisodeSpan {
  from: string;
  to: string;
  kind: 'ob' | 'os';
  /** Still open at the end of the data (no end event yet). */
  ongoing: boolean;
}

/** Pair start/end events into date spans for rendering episodes as shaded chart zones. */
export function eventsToEpisodes(events: RsEvent[], lastDate: string): RsEpisodeSpan[] {
  const spans: RsEpisodeSpan[] = [];
  let obFrom: string | null = null;
  let osFrom: string | null = null;
  for (const e of events) {
    if (e.type === 'obStart') obFrom = e.date;
    else if (e.type === 'obEnd' && obFrom !== null) {
      spans.push({ from: obFrom, to: e.date, kind: 'ob', ongoing: false });
      obFrom = null;
    } else if (e.type === 'osStart') osFrom = e.date;
    else if (e.type === 'osEnd' && osFrom !== null) {
      spans.push({ from: osFrom, to: e.date, kind: 'os', ongoing: false });
      osFrom = null;
    }
  }
  if (obFrom !== null) spans.push({ from: obFrom, to: lastDate, kind: 'ob', ongoing: true });
  if (osFrom !== null) spans.push({ from: osFrom, to: lastDate, kind: 'os', ongoing: true });
  return spans.sort((a, b) => a.from.localeCompare(b.from));
}

export interface RsResult {
  benchmark: string;
  asOf: string;
  rsi: number;
  adx: number;
  trendStrength: 'strong' | 'weak';
  state: 'overbought' | 'oversold' | 'neutral';
  extreme: boolean;
  /** Relative performance vs the benchmark over `perfWindow` bars (≈3M). */
  relPerf: number | null;
  thresholds: { obEnter: number; obHard: number; osEnter: number; osHard: number; adaptive: boolean };
  events: RsEvent[];
}

/** Latest-bar snapshot for the UI badge + chart markers. */
export function computeRelativeStrength(
  stockBars: DailyBar[],
  benchBars: DailyBar[],
  cfg: RsConfig = RS_DEFAULTS,
): RsResult | null {
  const s = computeRsSeries(stockBars, benchBars, cfg);
  if (!s) return null;
  const last = s.dates.length - 1;
  const rsi = s.rsi[last];
  const adx = s.adx[last];
  if (rsi === null || adx === null) return null;

  const past = last - cfg.perfWindow;
  const relPerf = past >= 0 ? s.ratioCloses[last] / s.ratioCloses[past] - 1 : null;

  return {
    benchmark: cfg.benchmark,
    asOf: s.dates[last],
    rsi,
    adx,
    trendStrength: adx >= cfg.strongAdx ? 'strong' : 'weak',
    state: s.episode.state,
    extreme: s.episode.extreme,
    relPerf,
    thresholds: {
      obEnter: s.thresholds.obEnter[last],
      obHard: s.thresholds.obHard[last],
      osEnter: s.thresholds.osEnter[last],
      osHard: s.thresholds.osHard[last],
      adaptive: cfg.adaptive.enabled,
    },
    events: s.episode.events,
  };
}
