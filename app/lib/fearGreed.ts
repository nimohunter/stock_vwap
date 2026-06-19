/**
 * Market "Fear & Greed" sentiment index.
 *
 * Primary source: CNN's official index (production.cdn.cnn.com). CNN bot-blocks
 * data-center IPs, so when that fails we compute a CNN-style 0-100 proxy from
 * Yahoo Finance data (which our pipeline can reach reliably).
 */

import dns from 'node:dns';

// Some runtimes (e.g. WSL2) hang on IPv6 connections to these data hosts;
// prefer IPv4 so outbound fetches resolve promptly.
dns.setDefaultResultOrder('ipv4first');

export type Rating =
  | 'Extreme Fear'
  | 'Fear'
  | 'Neutral'
  | 'Greed'
  | 'Extreme Greed';

export interface FearGreedComponent {
  label: string;
  score: number; // 0-100, 100 = max greed
}

export interface FearGreed {
  score: number; // 0-100
  rating: Rating;
  source: 'cnn' | 'computed';
  asOf: string; // ISO date
  components?: FearGreedComponent[];
}

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Accept: 'application/json',
  Referer: 'https://finance.yahoo.com/',
};

// CNN's band thresholds (score -> rating).
export function ratingFor(score: number): Rating {
  if (score < 25) return 'Extreme Fear';
  if (score < 45) return 'Fear';
  if (score <= 55) return 'Neutral';
  if (score <= 75) return 'Greed';
  return 'Extreme Greed';
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Map a raw value within [lo, hi] to a 0-100 greed score. */
const norm = (x: number, lo: number, hi: number) => clamp01((x - lo) / (hi - lo)) * 100;

async function fetchYahooCloses(symbol: string): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
  const clean = closes.filter((c): c is number => typeof c === 'number' && c > 0);
  if (clean.length < 60) throw new Error(`Too little data for ${symbol}`);
  return clean;
}

const sma = (arr: number[], n: number) => {
  const slice = arr.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
};
/** Return over the last n bars. */
const ret = (arr: number[], n: number) => arr[arr.length - 1] / arr[arr.length - 1 - n] - 1;

async function computeFearGreed(): Promise<FearGreed> {
  // Pull each series independently; tolerate individual failures.
  const symbols = ['^GSPC', '^VIX', 'TLT', 'HYG', 'LQD'];
  const settled = await Promise.allSettled(symbols.map(fetchYahooCloses));
  const data: Record<string, number[] | undefined> = {};
  symbols.forEach((s, i) => {
    if (settled[i].status === 'fulfilled') data[s] = (settled[i] as PromiseFulfilledResult<number[]>).value;
  });

  const components: FearGreedComponent[] = [];
  const sp = data['^GSPC'];
  const vix = data['^VIX'];
  const tlt = data['TLT'];
  const hyg = data['HYG'];
  const lqd = data['LQD'];

  // 1. Market momentum — S&P 500 vs its 125-day average.
  if (sp) {
    const pct = sp[sp.length - 1] / sma(sp, 125) - 1;
    components.push({ label: 'Market Momentum', score: norm(pct, -0.1, 0.1) });
  }
  // 2. Price strength — where the S&P sits in its 52-week range.
  if (sp) {
    const lo = Math.min(...sp);
    const hi = Math.max(...sp);
    components.push({ label: 'Price Strength', score: norm(sp[sp.length - 1], lo, hi) });
  }
  // 3. Volatility — VIX vs its 50-day average (low = greed).
  if (vix) {
    const ratio = vix[vix.length - 1] / sma(vix, 50);
    // Inverted bounds: a low VIX-to-average ratio (0.85) is greed, a high one (1.15) is fear.
    components.push({ label: 'Volatility (VIX)', score: norm(ratio, 1.15, 0.85) });
  }
  // 4. Safe-haven demand — 20-day stocks vs bonds (risk-on = greed).
  if (sp && tlt) {
    const diff = ret(sp, 20) - ret(tlt, 20);
    components.push({ label: 'Safe Haven Demand', score: norm(diff, -0.05, 0.05) });
  }
  // 5. Junk-bond demand — 20-day junk vs investment-grade (yield chasing = greed).
  if (hyg && lqd) {
    const diff = ret(hyg, 20) - ret(lqd, 20);
    components.push({ label: 'Junk Bond Demand', score: norm(diff, -0.03, 0.03) });
  }

  if (!components.length) throw new Error('No market data available to compute index');

  const score = Math.round(components.reduce((s, c) => s + c.score, 0) / components.length);
  return {
    score,
    rating: ratingFor(score),
    source: 'computed',
    asOf: new Date().toISOString(),
    components: components.map((c) => ({ ...c, score: Math.round(c.score) })),
  };
}

async function fetchCnn(): Promise<FearGreed> {
  const res = await fetch('https://production.cdn.cnn.com/markets/fear-and-greed/graphdata', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json',
      Referer: 'https://edition.cnn.com/markets/fear-and-greed',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`CNN HTTP ${res.status}`);
  const json = await res.json();
  const fng = json?.fear_and_greed;
  const score = Number(fng?.score);
  if (!Number.isFinite(score)) throw new Error('CNN payload missing score');
  return {
    score: Math.round(score),
    rating: ratingFor(score),
    source: 'cnn',
    asOf: fng?.timestamp ? new Date(fng.timestamp).toISOString() : new Date().toISOString(),
  };
}

export async function getFearGreed(): Promise<FearGreed> {
  try {
    return await fetchCnn();
  } catch {
    return await computeFearGreed();
  }
}
