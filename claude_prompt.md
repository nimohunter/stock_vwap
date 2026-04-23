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
No free-text input — ticker buttons only.

## VWAP Feature

### Rolling VWAP with SD Bands
- Window toggle: 3M / 6M / 1Y (63 / 126 / 252 bars) — labeled "VWAP Window" in the UI
- Chart always shows full 2Y of price history; the toggle controls only the rolling window size
- Formula: typical price `(High + Low + Close) / 3`, volume-weighted over a sliding window
- Rolling: `VWAP = sum(TP × Volume) / sum(Volume)` over the last N bars
- Standard deviation bands using volume-weighted variance: `SD = sqrt(E[TP²] - E[TP]²)`
- Display 5 lines: +2σ (red), +1σ (yellow), VWAP (blue), -1σ (green), -2σ (pink)
- Compute rolling VWAP on ALL available history before slicing the display window, so every bar has a fully-warmed window

## Data Pipeline
- `app/data/*.json` — offline OHLCV files, 2 years per ticker
- `scripts/download-data.py` — full download via yfinance (run from local machine)
- `scripts/fetch-data.mjs` — Node.js incremental refresh, runs as `predev`/`prebuild`
  - Skips tickers whose file is <20h old
  - Tries Yahoo Finance (2y), falls back to Alpha Vantage compact (100 days)
  - Merges new bars with existing history to preserve full date range

## API Routes
- `GET /api/vwap?symbol=NVDA&period=1y` — returns all bars + rolling VWAP bands
  - `period` = `3m` / `6m` / `1y` (default)
  - Returns full 2Y bars; VWAP computed with sliding window of size period

## UI
- Ticker quick-pick buttons for all 10 tickers (no free-text input)
- "VWAP Window" toggle top-right: 3M / 6M / 1Y
- TradingView Lightweight Charts candlestick with 5 VWAP band lines + volume histogram
- Band price labels hidden (`lastValueVisible: false`) except VWAP center
- Stats panel: current price, VWAP value, % distance, SD zone label, band levels

## Key Design Decisions
- Typical price `(H+L+C)/3` is the standard VWAP formula used in professional platforms
- Rolling (sliding window) VWAP, not anchored/cumulative — gives consistent band width across time
- Compute on all available data first so every displayed bar has a fully-loaded rolling window
- Always display full 2Y history — window toggle changes VWAP sensitivity, not chart zoom
- Offline-first: data lives in JSON files for fast loads and no API rate limits at runtime
- Auto-refresh via `predev`/`prebuild` hooks keeps data current without manual steps
- Vercel deployment uses data bundled at build time (filesystem is read-only at runtime)
- **Known limitation:** data is frozen at each deploy and does not auto-update between deploys. Three options to address (not yet implemented — user to choose):
  - A) GitHub Actions cron: daily workflow triggers a Vercel deploy hook (no code change)
  - B) Vercel Cron + Vercel Blob: cron → API route fetches Yahoo → writes to Blob; API reads Blob at runtime
  - C) Live fetch in API route: drop JSON files, fetch Yahoo Finance in `/api/vwap` with `revalidate` caching
- Fixed ticker list: avoids arbitrary symbol support, keeps data management simple
