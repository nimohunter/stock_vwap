#!/usr/bin/env node
/**
 * Auto-refresh stock data before dev/build.
 * - Tries Yahoo Finance first (2 years)
 * - Falls back to Alpha Vantage compact (100 days) if Yahoo is blocked
 * - Skips tickers whose data is less than 20 hours old
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'app', 'data');
const TICKERS = ['NVDA', 'META', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'VOO', 'SPMO', 'GLD'];
const ALPHA_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? '';
const STALE_MS = 20 * 60 * 60 * 1000; // 20 hours

fs.mkdirSync(DATA_DIR, { recursive: true });

function isStale(ticker) {
  const file = path.join(DATA_DIR, `${ticker}.json`);
  if (!fs.existsSync(file)) return true;
  return Date.now() - fs.statSync(file).mtimeMs > STALE_MS;
}

async function fetchYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com/',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No Yahoo data');

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  return timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open:   Math.round(quote.open?.[i]   * 10000) / 10000,
      high:   Math.round(quote.high?.[i]   * 10000) / 10000,
      low:    Math.round(quote.low?.[i]    * 10000) / 10000,
      close:  Math.round(quote.close?.[i]  * 10000) / 10000,
      volume: Math.round(quote.volume?.[i] ?? 0),
    }))
    .filter(b => b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
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

async function mergeBars(ticker, freshBars) {
  // Merge with existing data to preserve historical range
  const file = path.join(DATA_DIR, `${ticker}.json`);
  if (!fs.existsSync(file)) return freshBars;
  const existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const map = new Map(existing.map(b => [b.date, b]));
  for (const b of freshBars) map.set(b.date, b);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

let anyUpdated = false;
for (const ticker of TICKERS) {
  if (!isStale(ticker)) {
    console.log(`${ticker}: up to date, skipping`);
    continue;
  }
  process.stdout.write(`${ticker}: fetching... `);
  try {
    let bars = await fetchYahoo(ticker);
    console.log(`Yahoo ✓ (${bars.length} bars)`);
    bars = await mergeBars(ticker, bars);
    fs.writeFileSync(path.join(DATA_DIR, `${ticker}.json`), JSON.stringify(bars));
    anyUpdated = true;
  } catch (e) {
    process.stdout.write(`Yahoo failed (${e.message}), trying Alpha Vantage... `);
    try {
      let bars = await fetchAlphaVantage(ticker);
      bars = await mergeBars(ticker, bars);
      fs.writeFileSync(path.join(DATA_DIR, `${ticker}.json`), JSON.stringify(bars));
      console.log(`Alpha Vantage ✓ (${bars.length} bars)`);
      anyUpdated = true;
    } catch (e2) {
      console.log(`FAILED: ${e2.message} — keeping existing data`);
    }
  }
  await new Promise(r => setTimeout(r, 500));
}

console.log(anyUpdated ? 'Data refresh complete.' : 'All data is fresh, nothing to update.');
