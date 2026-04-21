# Claude Prompt — Stock VWAP Analyzer

Build a personal web app for VWAP analysis on US stocks, deployable to Vercel. No real-time data needed — daily OHLCV is sufficient.

## Tech Stack
- Next.js 16 (App Router) + TypeScript
- Tailwind CSS
- TradingView Lightweight Charts v5 (npm: lightweight-charts)
- Offline OHLCV data in `app/data/*.json` (downloaded via yfinance)
- Alpha Vantage free API as fallback data source

## Tickers
Fixed set of 10: NVDA, META, GOOGL, AAPL, MSFT, AMZN, TSLA, VOO, SPMO, GLD

## VWAP Feature

### Anchored VWAP with SD Bands
- Anchor date = 1 year or 2 years before the last available bar (user-selectable via 1Y/2Y toggle)
- Formula: typical price `(High + Low + Close) / 3`, volume-weighted from anchor date
- Cumulative from anchor: `VWAP = sum(TP × Volume) / sum(Volume)`
- Standard deviation bands using volume-weighted variance: `SD = sqrt(E[TP²] - E[TP]²)`
- Display 5 lines: +2σ (red), +1σ (yellow), VWAP (blue), -1σ (green), -2σ (pink)
- Anchor marker shown on chart at the start date

## Data Pipeline
- `app/data/*.json` — offline OHLCV files, 2 years per ticker
- `scripts/download-data.py` — full download via yfinance (run from local machine)
- `scripts/fetch-data.mjs` — Node.js incremental refresh, runs as `predev`/`prebuild`
  - Skips tickers whose file is <20h old
  - Tries Yahoo Finance (2y), falls back to Alpha Vantage compact (100 days)
  - Merges new bars with existing history to preserve full date range

## API Routes
- `GET /api/vwap?symbol=NVDA&period=1y` — returns bars + anchored VWAP bands
  - `period` = `1y` (default) or `2y`
  - Anchor date computed server-side as `lastBarDate - period`

## UI
- Ticker quick-pick buttons for all 10 tickers + free-text input
- 1Y / 2Y toggle (top right)
- TradingView Lightweight Charts candlestick with 5 VWAP band lines
- Band price labels hidden (`lastValueVisible: false`) except VWAP center
- Anchor date marked with arrow on chart
- Stats panel: current price, VWAP value, % distance, SD zone label, band levels

## Key Design Decisions
- Typical price `(H+L+C)/3` is the standard VWAP formula used in professional platforms
- Offline-first: data lives in JSON files for fast loads and no API rate limits at runtime
- Auto-refresh via `predev`/`prebuild` hooks keeps data current without manual steps
- Vercel deployment uses data bundled at build time (filesystem is read-only at runtime)
- No earnings anchor: simplified to calendar-year anchor (1Y or 2Y from last bar)
- Fixed ticker list: avoids arbitrary symbol support, keeps data management simple
