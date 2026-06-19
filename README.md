# Stock VWAP Analyzer

A personal web app for VWAP analysis on US stocks, deployed to Vercel. Built with Next.js, TradingView Lightweight Charts, and offline daily OHLCV data.

**Live:** https://stockvwap.vercel.app

## Features

- **Rolling VWAP** — 3M / 6M / 1Y window toggle (63 / 126 / 252 bars)
- **Full 2Y Price History** — chart always shows all available data; window controls only the VWAP computation
- **±1σ / ±2σ Standard Deviation Bands** — 5-line display (red/yellow/blue/green/pink)
- **Typical Price Formula** — VWAP computed as `(High + Low + Close) / 3 × Volume`
- **11 Pre-loaded Tickers** — NVDA, META, GOOGL, AAPL, MSFT, AMZN, TSLA, MU, VOO, SPMO, GLD
- **Stats Panel** — current price, VWAP value, % distance, SD zone (e.g. "+1σ to +2σ")
- **Fear & Greed Gauge** — market-sentiment banner; extreme readings are highlighted as contrarian signals (see below)
- **Auto Data Refresh** — `fetch-data.mjs` runs before every `dev` and `build`

## Fear & Greed Gauge

A banner at the top of the page shows current market sentiment on a 0–100 scale
(Extreme Fear → Extreme Greed), mirroring [CNN's Fear & Greed Index](https://edition.cnn.com/markets/fear-and-greed).
Extreme readings are visually highlighted (⚡ + colored ring) because they can act
as contrarian signals — extreme fear may flag a buying opportunity, extreme greed a
time for caution.

**Data source (`app/lib/fearGreed.ts`, served by `app/api/fear-greed`):**

1. **CNN first** — tries CNN's official index. CNN bot-blocks data-center IPs, so this
   often fails on hosted environments.
2. **Computed fallback** — when CNN is unavailable, a CNN-style index is computed from
   live Yahoo Finance data and the badge switches from `CNN` to `estimate`. The "how?"
   toggle on the banner explains this and shows the sub-signal breakdown. Components,
   each scored 0–100 (100 = max greed) and averaged:

   | Sub-signal | What it measures |
   |------------|------------------|
   | Market Momentum | S&P 500 vs its 125-day moving average |
   | Price Strength | Where the S&P sits in its 52-week high/low range |
   | Volatility (VIX) | VIX vs its 50-day average (low = greed) |
   | Safe Haven Demand | 20-day return of stocks vs bonds (TLT) |
   | Junk Bond Demand | 20-day return of junk (HYG) vs investment-grade (LQD) |

   The computed number is an estimate and won't exactly match CNN's official value.

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

## Automated weekly refresh

`.github/workflows/refresh-data.yml` runs every Saturday at 06:00 UTC (after Friday's US close), executes `fetch-data.mjs`, and commits any new bars back to `master`. Vercel auto-deploys on the push, so the live site always has fresh data without a manual rebuild.

Manual trigger: GitHub → Actions → **Refresh stock data** → **Run workflow**.

To enable the Alpha Vantage fallback in the workflow, add `ALPHA_VANTAGE_API_KEY` under **Settings → Secrets and variables → Actions**.
