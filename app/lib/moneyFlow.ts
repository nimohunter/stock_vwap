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

/** Index of the last bar on or before `targetDate` (bars ascending); -1 if none. */
function barOnOrBefore(bars: DailyBar[], targetDate: string): number {
  let idx = -1;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].date <= targetDate) idx = i;
    else break;
  }
  return idx;
}

/**
 * Starting-bar index for a timeframe. 1D/5D count trading days; 1M–1Y use the
 * last bar on or before the calendar lookback date; YTD baselines on the prior
 * year's final close (so the % change is the true year-to-date move). Returns
 * null when there isn't enough history to anchor the window.
 */
function startIndexForTimeframe(bars: DailyBar[], tf: Timeframe): number | null {
  const last = bars.length - 1;
  if (last < 1) return null;
  const lastDate = bars[last].date;

  switch (tf) {
    case '1D':
      return last - 1;
    case '5D':
      return last - 5 >= 0 ? last - 5 : null;
    case '1M':
    case '3M':
    case '6M': {
      const months = tf === '1M' ? 1 : tf === '3M' ? 3 : 6;
      const idx = barOnOrBefore(bars, shiftDate(lastDate, 'm', months));
      return idx >= 0 ? idx : null;
    }
    case '1Y': {
      const idx = barOnOrBefore(bars, shiftDate(lastDate, 'y', 1));
      return idx >= 0 ? idx : null;
    }
    case 'YTD': {
      const yearStart = `${lastDate.slice(0, 4)}-01-01`;
      // Prior year's last close is the standard YTD baseline.
      let priorYear = -1;
      for (let i = 0; i < bars.length; i++) {
        if (bars[i].date < yearStart) priorYear = i;
        else break;
      }
      if (priorYear >= 0) return priorYear;
      // No prior-year data — fall back to the first bar of the current year.
      for (let i = 0; i < bars.length; i++) if (bars[i].date >= yearStart) return i;
      return null;
    }
  }
}

export function computePerf(bars: DailyBar[], tf: Timeframe): Perf {
  const last = bars[bars.length - 1].close;
  const si = startIndexForTimeframe(bars, tf);
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
  return TIMEFRAMES.map((tf) => computePerf(bars, tf));
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
export function rrgSeriesFromRatio(ratio: number[], cfg: RrgConfig = RRG_DEFAULTS): RrgSeries {
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

/** Full RRG reading for one sector vs the benchmark; null with too little history. */
export function computeRrg(
  bars: DailyBar[],
  benchBars: DailyBar[],
  cfg: RrgConfig = RRG_DEFAULTS,
): RrgResult | null {
  const { dates, ratio } = computeRatioSeries(bars, benchBars);
  if (dates.length < cfg.window + cfg.smooth + cfg.momentumPeriod) return null;

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

// ---------------------------------------------------------------------------
// API DTOs — shared by the /api/money-flow route and the client dashboards.
// (Defined here because this module is client-safe: no fs / server imports.)
// ---------------------------------------------------------------------------

export interface SectorPayload {
  ticker: string;
  name: string;
  perf: Perf[];
  rrg: RrgResult | null;
  /** RS ratio rebased to 100 at the window start; null where a date is missing. */
  ratio: (number | null)[];
}

export interface MoneyFlowPayload {
  benchmark: { ticker: string; perf: Perf[] };
  asOf: string;
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
