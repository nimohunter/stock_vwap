# Claude Prompt — Stock VWAP Analyzer

Build a personal web app that displays VWAP analysis for US stocks, deployable to Vercel. No real-time data needed — daily OHLCV is sufficient.

## Tech Stack
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- TradingView Lightweight Charts (npm: lightweight-charts) for all charting
- Alpha Vantage free API for price/volume and earnings data
- Environment variable: ALPHA_VANTAGE_API_KEY

## Two VWAP Features

### 1. Rolling 1-Year VWAP
- Fetch 252 trading days of daily adjusted OHLCV data
- Formula: sum(close * volume) / sum(volume) over trailing 252 days
- Plot as a line series on the chart alongside the daily close price

### 2. Anchored VWAP (from last earnings date)
- Fetch the company's earnings history using Alpha Vantage EARNINGS endpoint
- Identify the most recent earnings report date (reportedDate field)
- The anchored VWAP starts the day AFTER the earnings report date
  (reason: price action on earnings day itself is noise; institutional
  accumulation begins the following session)
- Formula: sum(close * volume) / sum(volume) from anchor date to today
- Plot as a separate line series on the same chart
- Show the anchor date label on the chart (e.g. "Anchored from 2025-01-29 (Q4 earnings)")
- If there are multiple recent earnings dates (e.g. last 4 quarters),
  allow the user to select which one to anchor from via a dropdown

## API Routes
- GET /api/vwap?symbol=NVDA
  Returns: daily OHLCV for 252 days + rolling 1-year VWAP series
- GET /api/anchored-vwap?symbol=NVDA&anchor=2025-01-30
  Returns: OHLCV from anchor date to today + anchored VWAP series
- GET /api/earnings?symbol=NVDA
  Returns: last 4 earnings report dates from Alpha Vantage EARNINGS endpoint
- Cache all responses for 24 hours (daily data, no need to refresh often)

## UI
- Ticker input at the top (default: NVDA)
- TradingView Lightweight Charts candlestick or line chart showing:
  - Daily close price (candlestick)
  - 1-year rolling VWAP line (blue)
  - Anchored VWAP line from selected earnings date (orange)
  - Vertical marker at the anchor date
- Dropdown to pick which earnings date to anchor from (last 4–8 quarters)
- Stats panel showing:
  - Current 1-year VWAP value
  - Current anchored VWAP value
  - % distance of current price from each VWAP
  - Whether price is above or below each VWAP (bullish/bearish label)
- Responsive layout

## Vercel Deployment
- .env.example with ALPHA_VANTAGE_API_KEY placeholder
- vercel.json for function timeout (free tier: 10s max)
- README with setup instructions

## Key Design Decisions
- Anchor day = earnings date + 1: standard practice; the earnings day itself has
  abnormal volume that skews the VWAP anchor
- Last 4–8 quarters selectable: useful to compare e.g. NVDA's VWAP anchored from
  each of the last several earnings prints
- 24h cache: keeps Alpha Vantage requests well within the free 25/day limit
- No database needed: all computation happens in the API route on cache miss
- No real-time data: personal project focused on daily positioning analysis
