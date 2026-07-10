#!/usr/bin/env node
/**
 * Refresh per-stock options data (call/put walls, GEX, IV…) from the FlashAlpha API.
 *
 * QUOTA: the free key allows only 5 queries/day (and only for the tickers below),
 * so this script is aggressively conservative: one endpoint per ticker, skipped
 * entirely while the cached file is younger than STALE_HOURS. Requires
 * FLASHALPHA_API_KEY (in .env.local locally, repo secret in CI); silently a no-op
 * without it so dev/build never breaks.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'app', 'data');

// Plain `node` doesn't read .env.local (Next.js does) — load it for local runs.
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

// Tickers the API key is entitled to. Deliberately NOT the full tickers.json list.
const OPTIONS_TICKERS = ['MU'];
const STALE_HOURS = 20;

const API_KEY = process.env.FLASHALPHA_API_KEY ?? '';
if (!API_KEY) {
  console.log('options: FLASHALPHA_API_KEY not set, skipping');
  process.exit(0);
}

for (const ticker of OPTIONS_TICKERS) {
  const file = path.join(DATA_DIR, `${ticker}.options.json`);
  if (fs.existsSync(file)) {
    try {
      const { fetched_at } = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const ageH = (Date.now() - new Date(fetched_at).getTime()) / 3600000;
      if (ageH < STALE_HOURS) {
        console.log(`${ticker} options: ${ageH.toFixed(1)}h old, skipping (quota: 5/day)`);
        continue;
      }
    } catch {
      // unreadable cache — refetch
    }
  }
  process.stdout.write(`${ticker} options: fetching... `);
  try {
    const res = await fetch(`https://lab.flashalpha.com/v1/stock/${ticker.toLowerCase()}/summary`, {
      headers: { 'X-Api-Key': API_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const summary = await res.json();
    if (!summary?.exposure) throw new Error('unexpected payload shape');
    fs.writeFileSync(file, JSON.stringify({ fetched_at: new Date().toISOString(), summary }));
    console.log(`✓ (as_of ${summary.as_of})`);
  } catch (e) {
    console.log(`FAILED: ${e.message} — keeping existing data`);
  }
}
