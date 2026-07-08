/**
 * Walk-forward backtest for the Technical Sentiment score.
 *
 * For every day with enough history, we recompute the score using ONLY the bars up
 * to that day (no look-ahead), then measure realized forward returns at several
 * horizons. We report:
 *   - Spearman rank IC (score vs forward return) — does a higher score precede higher returns?
 *   - Mean forward return per label bucket (Strong Sell → Strong Buy) — is the mapping monotonic?
 *   - Divergence-flag outcomes vs the base rate — does the flag carry information?
 *
 * Run: `npm run backtest`  (executed via vite-node so it uses the real TS engine).
 *
 * CAVEATS printed at the end: small sample (~2y × 11 names), overlapping/autocorrelated
 * forward windows, and indicator params chosen a priori — treat as a sanity check, not proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DailyBar } from '../app/lib/alphavantage';
import { computeSentiment } from '../app/lib/sentiment';

const HORIZONS = [5, 10, 20];
const MIN_HISTORY = 210; // need EMA200/SMA200 to be meaningful
const STEP = 1;

const DATA_DIR = path.join(process.cwd(), 'app', 'data');
const tickers = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

interface Sample {
  ticker: string;
  score: number;
  label: string;
  flag: string | null;
  fwd: Record<number, number | null>;
}

const samples: Sample[] = [];

for (const ticker of tickers) {
  const bars: DailyBar[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${ticker}.json`), 'utf-8'));
  const maxH = Math.max(...HORIZONS);
  for (let t = MIN_HISTORY; t < bars.length - maxH; t += STEP) {
    const s = computeSentiment(bars.slice(0, t + 1));
    if (!s) continue;
    const fwd: Record<number, number | null> = {};
    for (const h of HORIZONS) fwd[h] = bars[t + h].close / bars[t].close - 1;
    samples.push({ ticker, score: s.score, label: s.label, flag: s.divergenceFlag ?? null, fwd });
  }
}

// ---- Spearman rank correlation (average ranks for ties) ----
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

console.log(`\nWalk-forward backtest — ${tickers.length} tickers, ${samples.length} samples\n`);

// ---- Spearman IC per horizon ----
console.log('Spearman rank IC (score vs forward return):');
for (const h of HORIZONS) {
  const pairs = samples.filter((s) => s.fwd[h] !== null);
  const ic = spearman(pairs.map((s) => s.score), pairs.map((s) => s.fwd[h] as number));
  console.log(`  ${h}d: IC = ${ic.toFixed(4)}   (n=${pairs.length})`);
}

// ---- Mean forward return by label bucket ----
const LABELS = ['Strong Sell', 'Sell', 'Neutral', 'Buy', 'Strong Buy'];
for (const h of HORIZONS) {
  console.log(`\nMean ${h}d forward return by label:`);
  for (const label of LABELS) {
    const rs = samples.filter((s) => s.label === label && s.fwd[h] !== null).map((s) => s.fwd[h] as number);
    if (!rs.length) {
      console.log(`  ${label.padEnd(12)} —`);
      continue;
    }
    const winRate = rs.filter((r) => r > 0).length / rs.length;
    console.log(`  ${label.padEnd(12)} ${pct(mean(rs)).padStart(8)}   win ${pct(winRate).padStart(7)}   (n=${rs.length})`);
  }
}

// ---- Divergence flag vs base rate (10d) ----
const H = 10;
const withFwd = samples.filter((s) => s.fwd[H] !== null);
const base = withFwd.map((s) => s.fwd[H] as number);
console.log(`\nDivergence flag outcomes (${H}d forward):`);
console.log(`  Base rate:        mean ${pct(mean(base)).padStart(8)}   win ${pct(base.filter((r) => r > 0).length / base.length)}   (n=${base.length})`);
for (const flag of ['Bullish divergence', 'Bearish divergence']) {
  const rs = withFwd.filter((s) => s.flag === flag).map((s) => s.fwd[H] as number);
  if (!rs.length) {
    console.log(`  ${flag.padEnd(18)} — (no occurrences)`);
    continue;
  }
  console.log(`  ${flag.padEnd(18)} mean ${pct(mean(rs)).padStart(8)}   win ${pct(rs.filter((r) => r > 0).length / rs.length)}   (n=${rs.length})`);
}

console.log(`
CAVEATS: ~2y history × ${tickers.length} names is a small, mostly-bull sample; forward windows
overlap (autocorrelated, so effective n is much smaller than shown); indicator
params were fixed a priori (in-sample). Read directionally, not as proof of edge.
`);
