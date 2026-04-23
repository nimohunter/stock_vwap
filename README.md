# Stock VWAP Analyzer

A personal web app for VWAP analysis on US stocks, deployed to Vercel. Built with Next.js, TradingView Lightweight Charts, and offline daily OHLCV data.

**Live:** https://stockvwap.vercel.app

## Features

- **Rolling VWAP** — 3M / 6M / 1Y window toggle (63 / 126 / 252 bars)
- **Full 2Y Price History** — chart always shows all available data; window controls only the VWAP computation
- **±1σ / ±2σ Standard Deviation Bands** — 5-line display (red/yellow/blue/green/pink)
- **Typical Price Formula** — VWAP computed as `(High + Low + Close) / 3 × Volume`
- **10 Pre-loaded Tickers** — NVDA, META, GOOGL, AAPL, MSFT, AMZN, TSLA, VOO, SPMO, GLD
- **Stats Panel** — current price, VWAP value, % distance, SD zone (e.g. "+1σ to +2σ")
- **Auto Data Refresh** — `fetch-data.mjs` runs before every `dev` and `build`

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS
- TradingView Lightweight Charts v5
- Offline OHLCV data in `app/data/*.json` (2 years per ticker)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Download stock data (first time, or to refresh)

Run from your **local machine** (Yahoo Finance rate-limits cloud servers):

```bash
pip install yfinance
python3 scripts/download-data.py
```

This saves 2 years of daily OHLCV for all 10 tickers to `app/data/*.json`.

### 3. Start the dev server

```bash
npm run dev
```

`predev` automatically runs `scripts/fetch-data.mjs` to refresh any data older than 20 hours before starting Next.js.

Open [http://localhost:3001](http://localhost:3001).

## Data Refresh

| Script | When to use |
|--------|-------------|
| `python3 scripts/download-data.py` | Full 2-year download from your local machine |
| `node scripts/fetch-data.mjs` | Incremental refresh (auto-runs on `dev`/`build`) |

`fetch-data.mjs` tries Yahoo Finance first, falls back to Alpha Vantage (requires `ALPHA_VANTAGE_API_KEY` in `.env.local`), and merges new bars with existing history so no data is lost.

## Environment Variables

```bash
# .env.local
ALPHA_VANTAGE_API_KEY=your_key_here   # fallback data source, free at alphavantage.co
```

## Deployment

```bash
vercel --prod
```

`prebuild` runs `fetch-data.mjs` automatically during every Vercel build so the deployed app has the latest available data.

To keep full 2-year history on Vercel, periodically commit updated `app/data/*.json` files:

```bash
python3 scripts/download-data.py   # run locally
git add app/data/
git commit -m "refresh data"
git push
vercel --prod
```

> **⚠️ Data staleness warning:** Vercel's filesystem is read-only at runtime. Data is frozen at build time and does **not** update automatically between deploys. Options to fix this (not yet implemented — choose one):
>
> - **A) GitHub Actions cron** — daily scheduled workflow triggers a Vercel deploy hook; no code change needed
> - **B) Vercel Cron + Vercel Blob** — cron calls an API route that fetches from Yahoo and writes to Blob; API reads from Blob at runtime
> - **C) Live fetch in API route** — remove JSON files; `/api/vwap` fetches Yahoo Finance directly with Next.js `revalidate` caching
