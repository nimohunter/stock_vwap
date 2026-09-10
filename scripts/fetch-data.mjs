#!/usr/bin/env node
/**
 * Auto-refresh stock data before dev/build.
 * - Tries Yahoo Finance first (2 years)
 * - Falls back to Alpha Vantage compact (100 days) if Yahoo is blocked or serves a stale payload
 * - Skips tickers whose last bar date is less than 1 day old
 *
 * Freshness is verified, not assumed: Yahoo's own `meta.regularMarketTime` says when the
 * last regular session traded, so a payload whose newest bar predates that session is
 * rejected as stale (retried, then handed to the fallback). Without this the script used
 * to log "Yahoo ✓ (501 bars)" for a response that was a full trading day short — the bar
 * count is ~constant on a rolling 2y window, so it could not distinguish fresh data from
 * a re-fetch of yesterday's. Set STRICT_FRESHNESS=1 (the GitHub Action does) to exit
 * non-zero when any ticker ends up behind; dev/build runs only warn, so a bad upstream
 * day can't break the deploy.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'app', 'data');
const LIB_DIR = path.join(__dirname, '..', 'app', 'lib');
const SINGLE = JSON.parse(fs.readFileSync(path.join(LIB_DIR, 'tickers.json'), 'utf-8'));
// Sector ETFs power the money-flow page; VOO (their benchmark) is already in tickers.json.
const SECTORS = JSON.parse(fs.readFileSync(path.join(LIB_DIR, 'sectors.json'), 'utf-8')).map((s) => s.ticker);
// Leveraged companion ETFs (e.g. MUU = 2x MU) power the MUU estimator. Fetched like any
// other ticker but intentionally kept out of tickers.json so they don't show as standalone
// stock buttons — they're companions to their underlying, not independent picks.
const LEVERAGED = Object.values(JSON.parse(fs.readFileSync(path.join(LIB_DIR, 'leveraged.json'), 'utf-8'))).map((l) => l.ticker);
const TICKERS = [...new Set([...SINGLE, ...SECTORS, ...LEVERAGED])];
const ALPHA_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? '';
const STALE_DAYS = 1; // refetch if last bar is older than this many calendar days
const STRICT = process.env.STRICT_FRESHNESS === '1';
const YAHOO_ATTEMPTS = 3; // a stale payload is often just one CDN edge; retry before falling back
// Ignore the freshness check until the session has been closed a while — right at the open
// Yahoo reports a regularMarketTime for a bar it hasn't published yet.
const SETTLE_MS = 30 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function lastBarDate(ticker) {
  const file = path.join(DATA_DIR, `${ticker}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const bars = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return bars.length ? bars[bars.length - 1].date : null;
  } catch {
    return null;
  }
}

function isStale(ticker) {
  const lastDate = lastBarDate(ticker);
  if (!lastDate) return true;
  const lastMs = new Date(lastDate + 'T00:00:00Z').getTime();
  return Date.now() - lastMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * One Yahoo fetch. Returns the parsed bars plus `lastSession` — the date of the most
 * recent regular session according to Yahoo itself, or null when it can't be trusted yet.
 * Deriving the expected date from the response (rather than a local calendar) means market
 * holidays need no special casing: on the day after Labor Day Yahoo reports the Friday.
 */
async function fetchYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com/',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No Yahoo data');

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const parsed = timestamps
    .map((ts, i) => ({
      date: utcDate(ts * 1000),
      open:   Math.round(quote.open?.[i]   * 10000) / 10000,
      high:   Math.round(quote.high?.[i]   * 10000) / 10000,
      low:    Math.round(quote.low?.[i]    * 10000) / 10000,
      close:  Math.round(quote.close?.[i]  * 10000) / 10000,
      volume: Math.round(quote.volume?.[i] ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // A bar with a null close (a session Yahoo hasn't aggregated yet) becomes 0 above and is
  // dropped — but say so, instead of losing the newest day silently.
  const bars = parsed.filter((b) => b.close > 0);
  const dropped = parsed.filter((b) => !(b.close > 0)).map((b) => b.date);
  if (dropped.length) console.warn(`\n  ${ticker}: dropped ${dropped.length} bar(s) with no close: ${dropped.join(', ')}`);

  const marketMs = (result.meta?.regularMarketTime ?? 0) * 1000;
  const settled = marketMs > 0 && Date.now() - marketMs > SETTLE_MS;
  return { bars, lastSession: settled ? utcDate(marketMs) : null };
}

async function fetchAlphaVantage(ticker) {
  if (!ALPHA_KEY) throw new Error('No ALPHA_VANTAGE_API_KEY set');
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${ALPHA_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = await res.json();
  if (json['Information'] || json['Note']) throw new Error('Alpha Vantage rate limit');
  const ts = json['Time Series (Daily)'] ?? {};
  return Object.entries(ts)
    .map(([date, v]) => ({
      date,
      open:   parseFloat(v['1. open']),
      high:   parseFloat(v['2. high']),
      low:    parseFloat(v['3. low']),
      close:  parseFloat(v['4. close']),
      volume: parseInt(v['5. volume']),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function writeMerged(ticker, freshBars) {
  // Merge with existing data to preserve historical range
  const file = path.join(DATA_DIR, `${ticker}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
  const map = new Map(existing.map((b) => [b.date, b]));
  for (const b of freshBars) map.set(b.date, b);
  const merged = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(file, JSON.stringify(merged));
  return merged[merged.length - 1]?.date ?? null;
}

// `--verify` mode: no bulk refetch. Ask Yahoo for one reference ticker's meta, which names
// the last regular session (holiday-proof, unlike a local calendar), and assert every local
// file reached it. Run as the LAST workflow step so whatever data did arrive is still
// committed, and the job still goes red when the committed set is a session short.
if (process.argv.includes('--verify')) {
  const REFERENCE = 'VOO';
  let lastSession = null;
  try {
    ({ lastSession } = await fetchYahoo(REFERENCE));
  } catch (e) {
    console.log(`Cannot verify freshness (${REFERENCE}: ${e.message}) — skipping check.`);
    process.exit(0);
  }
  if (!lastSession) {
    console.log('Market session too recent to have settled — skipping freshness check.');
    process.exit(0);
  }
  const short = TICKERS.map((t) => ({ ticker: t, last: lastBarDate(t) })).filter((f) => !f.last || f.last < lastSession);
  console.log(`Last regular session per Yahoo: ${lastSession}`);
  if (!short.length) {
    console.log(`All ${TICKERS.length} tickers are current through ${lastSession}.`);
    process.exit(0);
  }
  console.error(`\n✗ ${short.length} of ${TICKERS.length} ticker(s) missing the ${lastSession} session:`);
  for (const f of short) console.error(`    ${f.ticker} — last bar ${f.last ?? 'none'}`);
  console.error('\nData is behind. Re-run the workflow, or refresh locally:');
  console.error('    node scripts/fetch-data.mjs && python3 scripts/download-data.py');
  process.exit(1);
}

let anyUpdated = false;
const staleTickers = [];   // fetched fine, but upstream is a session behind
const failedTickers = [];  // no usable response at all

for (const ticker of TICKERS) {
  if (!isStale(ticker)) {
    console.log(`${ticker}: up to date (last bar ${lastBarDate(ticker)}), skipping`);
    continue;
  }
  process.stdout.write(`${ticker}: fetching... `);

  let payload = null;
  let short = null; // set when Yahoo answered but its newest bar predates the last session
  for (let attempt = 1; attempt <= YAHOO_ATTEMPTS; attempt++) {
    try {
      payload = await fetchYahoo(ticker);
    } catch (e) {
      process.stdout.write(`Yahoo attempt ${attempt} failed (${e.message}) `);
      payload = null;
      if (attempt < YAHOO_ATTEMPTS) await sleep(1000 * attempt);
      continue;
    }
    const newest = payload.bars[payload.bars.length - 1]?.date ?? null;
    if (!payload.lastSession || (newest && newest >= payload.lastSession)) {
      short = null;
      break;
    }
    short = `newest bar ${newest}, last session ${payload.lastSession}`;
    if (attempt < YAHOO_ATTEMPTS) {
      process.stdout.write(`Yahoo stale (${short}), retrying `);
      await sleep(1000 * attempt);
    }
  }

  // Yahoo answered but is a session behind — see if Alpha Vantage has the missing day.
  if (payload && short) {
    try {
      const av = await fetchAlphaVantage(ticker);
      const avNewest = av[av.length - 1]?.date ?? null;
      if (avNewest && avNewest >= payload.lastSession) {
        console.log(`Yahoo stale (${short}) → Alpha Vantage ✓ (${avNewest})`);
        writeMerged(ticker, payload.bars);
        writeMerged(ticker, av);
        anyUpdated = true;
        await sleep(500);
        continue;
      }
      process.stdout.write(`Alpha Vantage also stale (${avNewest}) `);
    } catch (e) {
      process.stdout.write(`Alpha Vantage unavailable (${e.message}) `);
    }
  }

  if (payload) {
    // Write even when short: the payload still carries revisions to earlier bars.
    const newest = writeMerged(ticker, payload.bars);
    anyUpdated = true;
    if (short) {
      console.log(`STALE — kept ${payload.bars.length} bars, still at ${newest}`);
      staleTickers.push(`${ticker} (${short})`);
    } else {
      console.log(`Yahoo ✓ (${payload.bars.length} bars, through ${newest})`);
    }
    await sleep(500);
    continue;
  }

  // Yahoo never answered — the original fallback path.
  try {
    const av = await fetchAlphaVantage(ticker);
    const newest = writeMerged(ticker, av);
    console.log(`Alpha Vantage ✓ (${av.length} bars, through ${newest})`);
    anyUpdated = true;
  } catch (e) {
    console.log(`FAILED: ${e.message} — keeping existing data`);
    failedTickers.push(`${ticker} (last bar ${lastBarDate(ticker) ?? 'none'})`);
  }
  await sleep(500);
}

// Cross-check: every ticker shares one trading calendar, so a ticker behind the newest
// date any of them reached is behind regardless of what upstream claimed.
const finals = TICKERS.map((t) => ({ ticker: t, last: lastBarDate(t) }));
const consensus = finals.reduce((m, f) => (f.last && f.last > m ? f.last : m), '');
const behind = finals.filter((f) => f.last && consensus && f.last < consensus);

console.log(anyUpdated ? 'Data refresh complete.' : 'All data is fresh, nothing to update.');
console.log(`Newest session across all tickers: ${consensus || 'unknown'}`);

if (staleTickers.length) console.warn(`\n⚠ upstream a session behind for ${staleTickers.length} ticker(s):\n  ${staleTickers.join('\n  ')}`);
if (failedTickers.length) console.warn(`\n⚠ no data fetched for ${failedTickers.length} ticker(s):\n  ${failedTickers.join('\n  ')}`);
if (behind.length) console.warn(`\n⚠ behind ${consensus}:\n  ${behind.map((b) => `${b.ticker} at ${b.last}`).join('\n  ')}`);

if (STRICT && (staleTickers.length || failedTickers.length || behind.length)) {
  console.error('\nSTRICT_FRESHNESS: data did not fully refresh — failing so this run does not look green.');
  process.exit(1);
}
