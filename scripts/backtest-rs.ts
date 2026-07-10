/**
 * Walk-forward backtest for the Relative Strength (vs VOO) module.
 *
 * The RS engine is causal (bar i uses only data ≤ i), so one full-series pass per
 * ticker IS the walk-forward — no per-day recomputation needed. We evaluate, at
 * horizons of 5/10/20 bars:
 *   - Spearman rank IC of the ratio-RSI level vs forward returns, both absolute
 *     (stock) and relative (stock − VOO) — the honest target for an RS signal.
 *   - IC of plain 63-day relative momentum vs forward relative return (the classic
 *     cross-sectional momentum check, as a baseline the fancy machinery must beat).
 *   - Mean forward returns after each episode event type vs the base rate.
 *
 * Run: `npm run backtest:rs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { DailyBar } from '../app/lib/alphavantage';
import { computeRsSeries, RS_DEFAULTS, RsEventType } from '../app/lib/relativeStrength';

const HORIZONS = [5, 10, 20];
const MOM_WINDOW = 63;

const DATA_DIR = path.join(process.cwd(), 'app', 'data');
const BENCH = RS_DEFAULTS.benchmark;
const loadBars = (t: string): DailyBar[] => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${t}.json`), 'utf-8'));

const tickers = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .filter((t) => t !== BENCH);

const benchBars = loadBars(BENCH);

interface Sample {
  ticker: string;
  rsi: number;
  mom: number | null; // 63d relative momentum
  fwdAbs: Record<number, number>;
  fwdRel: Record<number, number>;
}
interface EventSample {
  type: RsEventType;
  fwdAbs: Record<number, number>;
  fwdRel: Record<number, number>;
}

const samples: Sample[] = [];
const eventSamples: EventSample[] = [];
const maxH = Math.max(...HORIZONS);

for (const ticker of tickers) {
  const s = computeRsSeries(loadBars(ticker), benchBars);
  if (!s) {
    console.log(`${ticker}: not enough overlapping history, skipped`);
    continue;
  }
  const idxByDate = new Map(s.dates.map((d, i) => [d, i]));
  const fwd = (i: number) => {
    const abs: Record<number, number> = {};
    const rel: Record<number, number> = {};
    for (const h of HORIZONS) {
      abs[h] = s.stockCloses[i + h] / s.stockCloses[i] - 1;
      rel[h] = abs[h] - (s.benchCloses[i + h] / s.benchCloses[i] - 1);
    }
    return { abs, rel };
  };

  for (let i = 0; i < s.dates.length - maxH; i++) {
    const rsi = s.rsi[i];
    if (rsi === null) continue;
    const { abs, rel } = fwd(i);
    samples.push({
      ticker,
      rsi,
      mom: i >= MOM_WINDOW ? s.ratioCloses[i] / s.ratioCloses[i - MOM_WINDOW] - 1 : null,
      fwdAbs: abs,
      fwdRel: rel,
    });
  }
  for (const e of s.episode.events) {
    const i = idxByDate.get(e.date)!;
    if (i >= s.dates.length - maxH) continue;
    const { abs, rel } = fwd(i);
    eventSamples.push({ type: e.type, fwdAbs: abs, fwdRel: rel });
  }
}

// ---- Spearman rank correlation ----
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
  for (let k = 0; k < n; k++) {
    num += (a[k] - ma) * (b[k] - mb);
    da += (a[k] - ma) ** 2;
    db += (b[k] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

console.log(`\nRS backtest — ${tickers.length} tickers vs ${BENCH}, ${samples.length} samples\n`);

console.log('Spearman rank IC of ratio-RSI level:');
for (const h of HORIZONS) {
  const icAbs = spearman(samples.map((s) => s.rsi), samples.map((s) => s.fwdAbs[h]));
  const icRel = spearman(samples.map((s) => s.rsi), samples.map((s) => s.fwdRel[h]));
  console.log(`  ${String(h).padStart(2)}d:  vs absolute return ${icAbs.toFixed(4).padStart(8)}   vs relative return ${icRel.toFixed(4).padStart(8)}`);
}

console.log(`\nBaseline — ${MOM_WINDOW}d relative momentum (plain ratio change) IC:`);
const withMom = samples.filter((s) => s.mom !== null);
for (const h of HORIZONS) {
  const icRel = spearman(withMom.map((s) => s.mom as number), withMom.map((s) => s.fwdRel[h]));
  console.log(`  ${String(h).padStart(2)}d:  vs relative return ${icRel.toFixed(4).padStart(8)}   (n=${withMom.length})`);
}

const H = 10;
console.log(`\nEpisode events (${H}d forward, relative to ${BENCH} / absolute):`);
const baseRel = samples.map((s) => s.fwdRel[H]);
const baseAbs = samples.map((s) => s.fwdAbs[H]);
console.log(
  `  base rate          rel ${pct(mean(baseRel)).padStart(8)}   abs ${pct(mean(baseAbs)).padStart(8)}   (n=${samples.length})`
);
const TYPES: RsEventType[] = ['obStart', 'obEnd', 'osStart', 'osEnd', 'obExtreme', 'osExtreme'];
for (const type of TYPES) {
  const es = eventSamples.filter((e) => e.type === type);
  if (!es.length) {
    console.log(`  ${type.padEnd(18)} — (no occurrences)`);
    continue;
  }
  const rel = es.map((e) => e.fwdRel[H]);
  const abs = es.map((e) => e.fwdAbs[H]);
  const win = rel.filter((r) => r > 0).length / rel.length;
  console.log(
    `  ${type.padEnd(18)} rel ${pct(mean(rel)).padStart(8)}   abs ${pct(mean(abs)).padStart(8)}   rel-win ${pct(win).padStart(7)}   (n=${es.length})`
  );
}

console.log(`
CAVEATS: same as the sentiment backtest — ~2y mostly-bull sample, overlapping
forward windows (effective n far below shown), a priori parameters. "rel" is the
return of the stock minus ${BENCH} over the same window — the honest target for a
relative-strength signal. Read directionally, not as proof of edge.
`);
