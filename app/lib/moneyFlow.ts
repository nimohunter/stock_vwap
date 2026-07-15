/**
 * Money-flow / sector-rotation math for the `/money-flow` page.
 *
 * Three dashboards are driven from here, all off the same local daily bars:
 *   1. Sector performance — % change of each SPDR sector ETF over a chosen
 *      timeframe, versus the S&P 500 benchmark (VOO, already in app/data).
 *   2. Relative Strength (RS) — sector price ÷ benchmark price. The raw ratio
 *      series, rebased by the caller so a rising line = outperforming the market.
 *   3. Relative Rotation Graph (RRG) — the JdK RS-Ratio / RS-Momentum pair, two
 *      oscillators centred on 100 that place each sector in one of four rotation
 *      quadrants (Improving → Leading → Weakening → Lagging).
 *
 * The true StockCharts JdK formula is proprietary; the RS-Ratio / RS-Momentum
 * here are a documented, widely-used reproduction: normalize the relative-strength
 * ratio (and its rate of change) to a rolling z-score, recentre on 100, and
 * lightly smooth. Values and quadrant transitions track the published RRGs
 * closely enough for rotation reading; absolute levels are not identical.
 */
import { DailyBar } from './bars';
import sectorsJson from './sectors.json';

/** S&P 500 proxy used as the RS denominator and the table's benchmark row. */
export const SECTOR_BENCHMARK = 'VOO';

export interface Sector {
  ticker: string;
  name: string;
}
export const SECTORS: Sector[] = sectorsJson;

export type Timeframe = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y';
export const TIMEFRAMES: Timeframe[] = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y'];

// ---------------------------------------------------------------------------
// Performance (dashboard 1)
// ---------------------------------------------------------------------------

export interface Perf {
  timeframe: Timeframe;
  last: number;
  start: number | null;
  startDate: string | null;
  changeAbs: number | null;
  changePct: number | null;
}

function shiftDate(dateStr: string, unit: 'm' | 'y', n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (unit === 'm') d.setUTCMonth(d.getUTCMonth() - n);
  else d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/** Index of the last date on or before `targetDate` (ascending array); -1 if none. */
function dateOnOrBefore(dates: string[], targetDate: string): number {
  let idx = -1;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] <= targetDate) idx = i;
    else break;
  }
  return idx;
}

/**
 * Starting index for a timeframe within an ascending date array. 1D/5D count
 * trading days; 1M–1Y use the last date on or before the calendar lookback;
 * YTD baselines on the prior year's final close (so the % change is the true
 * year-to-date move). Returns null when there isn't enough history to anchor
 * the window. Exported so the client can window the RS series the same way the
 * server windows the performance table.
 */
export function startIndexForTimeframe(dates: string[], tf: Timeframe): number | null {
  const last = dates.length - 1;
  if (last < 1) return null;
  const lastDate = dates[last];

  switch (tf) {
    case '1D':
      return last - 1;
    case '5D':
      return last - 5 >= 0 ? last - 5 : null;
    case '1M':
    case '3M':
    case '6M': {
      const months = tf === '1M' ? 1 : tf === '3M' ? 3 : 6;
      const idx = dateOnOrBefore(dates, shiftDate(lastDate, 'm', months));
      return idx >= 0 ? idx : null;
    }
    case '1Y': {
      const idx = dateOnOrBefore(dates, shiftDate(lastDate, 'y', 1));
      return idx >= 0 ? idx : null;
    }
    case 'YTD': {
      const yearStart = `${lastDate.slice(0, 4)}-01-01`;
      // Prior year's last close is the standard YTD baseline.
      let priorYear = -1;
      for (let i = 0; i < dates.length; i++) {
        if (dates[i] < yearStart) priorYear = i;
        else break;
      }
      if (priorYear >= 0) return priorYear;
      // No prior-year data — fall back to the first date of the current year.
      for (let i = 0; i < dates.length; i++) if (dates[i] >= yearStart) return i;
      return null;
    }
  }
}

export function computePerf(bars: DailyBar[], tf: Timeframe, dates?: string[]): Perf {
  const last = bars[bars.length - 1].close;
  const si = startIndexForTimeframe(dates ?? bars.map((b) => b.date), tf);
  if (si === null || si >= bars.length - 1) {
    return { timeframe: tf, last, start: null, startDate: null, changeAbs: null, changePct: null };
  }
  const start = bars[si].close;
  return {
    timeframe: tf,
    last,
    start,
    startDate: bars[si].date,
    changeAbs: last - start,
    changePct: start > 0 ? last / start - 1 : null,
  };
}

export function computeAllPerf(bars: DailyBar[]): Perf[] {
  const dates = bars.map((b) => b.date); // built once, reused across all timeframes
  return TIMEFRAMES.map((tf) => computePerf(bars, tf, dates));
}

// ---------------------------------------------------------------------------
// Relative strength ratio (dashboard 2)
// ---------------------------------------------------------------------------

export interface RatioSeries {
  dates: string[];
  ratio: number[]; // 100 × sector close ÷ benchmark close, aligned by date
}

/** Align a sector to the benchmark by date and build the raw RS ratio series. */
export function computeRatioSeries(bars: DailyBar[], benchBars: DailyBar[]): RatioSeries {
  const bench = new Map(benchBars.map((b) => [b.date, b.close]));
  const dates: string[] = [];
  const ratio: number[] = [];
  for (const b of bars) {
    const bc = bench.get(b.date);
    if (bc !== undefined && bc > 0) {
      dates.push(b.date);
      ratio.push((b.close / bc) * 100);
    }
  }
  return { dates, ratio };
}

// ---------------------------------------------------------------------------
// Relative Rotation Graph (dashboard 3)
// ---------------------------------------------------------------------------

export type Quadrant = 'Leading' | 'Weakening' | 'Lagging' | 'Improving';

export function quadrantOf(rsRatio: number, rsMomentum: number): Quadrant {
  if (rsRatio >= 100) return rsMomentum >= 100 ? 'Leading' : 'Weakening';
  return rsMomentum >= 100 ? 'Improving' : 'Lagging';
}

export interface RrgConfig {
  window: number; // rolling window for the z-score normalization (trading days)
  smooth: number; // SMA smoothing applied to RS-Ratio and RS-Momentum
  momentumPeriod: number; // lookback for the RS-Ratio rate of change
  tailLength: number; // number of points drawn in the rotation tail
  tailStride: number; // spacing between tail points (bars) — 5 ≈ weekly
}

export const RRG_DEFAULTS: RrgConfig = {
  window: 50,
  smooth: 5,
  momentumPeriod: 10,
  tailLength: 12,
  tailStride: 5,
};

/**
 * Durations offered on the RRG dashboard. 1D/5D are omitted deliberately —
 * rotation needs enough history to normalize RS-Ratio/Momentum and draw a tail.
 */
export type RrgTimeframe = '1M' | '3M' | '6M' | '1Y';
export const RRG_TIMEFRAMES: RrgTimeframe[] = ['1M', '3M', '6M', '1Y'];

/**
 * Per-duration RRG parameters (daily bars). The normalization `window` sets the
 * horizon the RS-Ratio is measured against, and `tailLength × tailStride` makes
 * the rotation tail span roughly the chosen duration.
 */
// tail span = tailLength × tailStride, counted in *trading days* (the ratio axis
// is a consecutive-trading-day grid): ≈ 16 / 40 / 72 / 120 trading days.
export const RRG_CONFIGS: Record<RrgTimeframe, RrgConfig> = {
  '1M': { window: 20, smooth: 3, momentumPeriod: 5, tailLength: 8, tailStride: 2 },
  '3M': { window: 40, smooth: 5, momentumPeriod: 8, tailLength: 10, tailStride: 4 },
  '6M': { window: 60, smooth: 5, momentumPeriod: 10, tailLength: 12, tailStride: 6 },
  '1Y': { window: 75, smooth: 8, momentumPeriod: 12, tailLength: 12, tailStride: 10 },
};

/** Rolling sample z-score; null until the trailing window is full or if any input is null. */
function rollingZScore(v: (number | null)[], w: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  for (let i = w - 1; i < v.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - w + 1; j <= i; j++) {
      const x = v[j];
      if (x === null) { ok = false; break; }
      sum += x;
    }
    if (!ok) continue;
    const mean = sum / w;
    let sq = 0;
    for (let j = i - w + 1; j <= i; j++) {
      const d = (v[j] as number) - mean;
      sq += d * d;
    }
    const std = Math.sqrt(sq / (w - 1));
    const cur = v[i] as number;
    out[i] = std > 0 ? (cur - mean) / std : 0;
  }
  return out;
}

/** SMA over a nullable series; null unless the whole window is present. */
function smaNullable(v: (number | null)[], w: number): (number | null)[] {
  const out: (number | null)[] = new Array(v.length).fill(null);
  for (let i = w - 1; i < v.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - w + 1; j <= i; j++) {
      const x = v[j];
      if (x === null) { ok = false; break; }
      sum += x;
    }
    out[i] = ok ? sum / w : null;
  }
  return out;
}

export interface RrgPoint {
  date: string;
  rsRatio: number;
  rsMomentum: number;
}

export interface RrgSeries {
  rsRatio: (number | null)[];
  rsMomentum: (number | null)[];
}

/** RS-Ratio / RS-Momentum series from an aligned RS ratio (see file header). */
export function rrgSeriesFromRatio(ratio: (number | null)[], cfg: RrgConfig = RRG_DEFAULTS): RrgSeries {
  const rsRatioRaw = rollingZScore(ratio, cfg.window).map((z) => (z === null ? null : 100 + z));
  const rsRatio = smaNullable(rsRatioRaw, cfg.smooth);

  const mom: (number | null)[] = rsRatio.map((x, i) => {
    const p = i - cfg.momentumPeriod;
    if (x === null || p < 0 || rsRatio[p] === null) return null;
    return x - (rsRatio[p] as number);
  });
  const rsMomentum = smaNullable(
    rollingZScore(mom, cfg.window).map((z) => (z === null ? null : 100 + z)),
    cfg.smooth,
  );
  return { rsRatio, rsMomentum };
}

export interface RrgResult {
  rsRatio: number;
  rsMomentum: number;
  quadrant: Quadrant;
  tail: RrgPoint[]; // oldest → newest, last point is the current reading
}

/**
 * Full RRG reading from an aligned RS ratio series (dates + ratio, nullable).
 * Pure and client-reusable: the dashboard feeds it the shared ratio series it
 * already has, so RRG can be recomputed per duration without another request.
 * Null with too little history.
 */
export function rrgFromRatioSeries(
  dates: string[],
  ratio: (number | null)[],
  cfg: RrgConfig = RRG_DEFAULTS,
): RrgResult | null {
  // A non-null final RS-Momentum needs the ratio z-score (window) + smoothing,
  // then the momentum diff, then a second z-score (window) + smoothing again.
  if (dates.length < 2 * cfg.window + 2 * cfg.smooth + cfg.momentumPeriod) return null;

  const { rsRatio, rsMomentum } = rrgSeriesFromRatio(ratio, cfg);

  const tail: RrgPoint[] = [];
  const last = dates.length - 1;
  for (let k = cfg.tailLength - 1; k >= 0; k--) {
    const i = last - k * cfg.tailStride;
    if (i < 0) continue;
    const r = rsRatio[i];
    const m = rsMomentum[i];
    if (r === null || m === null) continue;
    tail.push({ date: dates[i], rsRatio: r, rsMomentum: m });
  }
  if (!tail.length) return null;

  const cur = tail[tail.length - 1];
  return {
    rsRatio: cur.rsRatio,
    rsMomentum: cur.rsMomentum,
    quadrant: quadrantOf(cur.rsRatio, cur.rsMomentum),
    tail,
  };
}

/** Full RRG reading for one sector vs the benchmark; null with too little history. */
export function computeRrg(
  bars: DailyBar[],
  benchBars: DailyBar[],
  cfg: RrgConfig = RRG_DEFAULTS,
): RrgResult | null {
  const { dates, ratio } = computeRatioSeries(bars, benchBars);
  return rrgFromRatioSeries(dates, ratio, cfg);
}

// ---------------------------------------------------------------------------
// API DTOs — shared by the /api/money-flow route and the client dashboards.
// (Defined here because this module is client-safe: no fs / server imports.)
// ---------------------------------------------------------------------------

export interface SectorPayload {
  ticker: string;
  name: string;
  perf: Perf[];
  /**
   * RS ratio (100 × sector ÷ benchmark) aligned to MoneyFlowPayload.ratioDates;
   * null on dates the sector has no bar for (so a short-history ETF doesn't
   * truncate the axis for others). The client windows/rebases it per timeframe
   * (RS chart) and computes the RRG from it per duration (rrgFromRatioSeries).
   */
  ratio: (number | null)[];
}

export interface MoneyFlowPayload {
  benchmark: { ticker: string; perf: Perf[] };
  asOf: string;
  /** Shared date axis: the benchmark's most recent trading days. */
  ratioDates: string[];
  sectors: SectorPayload[];
}

/** Quadrant → conventional RRG color, validated for CVD on a dark surface. */
export const QUADRANT_COLORS: Record<Quadrant, string> = {
  Leading: '#37a85c',
  Weakening: '#b5820f',
  Lagging: '#cc3b3b',
  Improving: '#4f8ff0',
};
