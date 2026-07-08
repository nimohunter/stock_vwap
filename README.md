# Stock VWAP Analyzer

A personal web app for VWAP analysis on US stocks, deployed to Vercel. Built with Next.js, TradingView Lightweight Charts, and offline daily OHLCV data.

**Live:** https://stockvwap.vercel.app

## Features

- **Rolling VWAP** — 3M / 6M / 1Y window toggle (63 / 126 / 252 bars)
- **Full 2Y Price History** — chart always shows all available data; window controls only the VWAP computation
- **±1σ / ±2σ Standard Deviation Bands** — 5-line display (red/yellow/blue/green/pink)
- **Typical Price Formula** — VWAP computed as `(High + Low + Close) / 3 × Volume`
- **11 Pre-loaded Tickers** — NVDA, META, GOOGL, AAPL, MSFT, AMZN, TSLA, MU, VOO, SPMO, GLD
- **Moving Averages** — toggleable SMA 50/200 and EMA 50/200 overlays
- **Ripster EMA Cloud 34/50** — trend-colored cloud between the 34 and 50 EMAs (see below)
- **Stats Panel** — current price, VWAP value, % distance, SD zone (e.g. "+1σ to +2σ")
- **Fear & Greed Gauge** — market-sentiment banner; extreme readings are highlighted as contrarian signals (see below)
- **Technical Sentiment Rating** — per-stock Strong Sell → Strong Buy score with divergence flags and a signal breakdown (see below)
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
   toggle on the banner explains this and shows the sub-signal breakdown.

### How the estimate is calculated

1. **Fetch 1 year of daily closes** (in parallel, tolerating individual failures) for
   five symbols: `^GSPC` (S&P 500), `^VIX`, `TLT` (long bonds), `HYG` (junk bonds),
   `LQD` (investment-grade bonds).

2. **Score each sub-signal 0–100** (100 = maximum greed) with a clamped linear map:

   ```
   norm(x, lo, hi) = clamp01((x - lo) / (hi - lo)) * 100
   ```

   | Sub-signal | Raw value `x` | `lo` → `hi` |
   |------------|---------------|-------------|
   | Market Momentum | S&P close ÷ its 125-day average − 1 | −0.10 → +0.10 |
   | Price Strength | S&P close, within its 52-week low/high range | 52w low → 52w high |
   | Volatility (VIX) | VIX ÷ its 50-day average | 1.15 → 0.85 *(inverted: low VIX = greed)* |
   | Safe Haven Demand | 20-day return of S&P − 20-day return of TLT | −0.05 → +0.05 |
   | Junk Bond Demand | 20-day return of HYG − 20-day return of LQD | −0.03 → +0.03 |

3. **Average** the available components and round to get the 0–100 score. (A symbol that
   fails to fetch is simply dropped from the average.)

4. **Map to a label** (same bands as CNN): `<25` Extreme Fear · `25–44` Fear ·
   `45–55` Neutral · `56–75` Greed · `>75` Extreme Greed.

> The `lo`/`hi` bounds are hand-chosen heuristics and the index uses 5 signals where CNN
> uses 7 (CNN's put/call ratio and NYSE breadth aren't cleanly available from free data).
> So the computed number is **directionally** aligned with CNN but won't match it exactly —
> hence the `estimate` badge. Source of truth: [`app/lib/fearGreed.ts`](app/lib/fearGreed.ts).

## Moving Averages & Ripster EMA Cloud

The **Moving Averages** control group toggles four overlay lines plus the EMA cloud,
all computed in [`app/lib/vwap.ts`](app/lib/vwap.ts) and drawn in
[`app/components/VwapChart.tsx`](app/components/VwapChart.tsx):

| Overlay | Color | Calculation |
|---------|-------|-------------|
| SMA 50 / SMA 200 | orange / purple | Simple moving average (rolling mean of closes) |
| EMA 50 / EMA 200 | cyan / rose | Exponential moving average, `k = 2 / (window + 1)` |
| EMA Cloud 34/50 | teal fill | Filled band between the EMA 34 and EMA 50 |

**EMA seeding.** The EMA is seeded with the SMA of the first `window` closes, then
iterated as `ema = close·k + ema_prev·(1 − k)`. This matches TradingView's `ta.ema`
to within ~0.01% — EMA 34/50 are identical across conventions, and EMA 200 differs by
about 2 cents on a $190 price (slow EMAs carry a tiny residual seed weight; every
charting platform shows the same).

**Ripster EMA Cloud.** A custom Lightweight-Charts canvas primitive
([`app/components/emaCloudPrimitive.ts`](app/components/emaCloudPrimitive.ts)) fills the
area between the EMA 34 (fast) and EMA 50 (slow) lines:

- **Green** when EMA 34 ≥ EMA 50 → short-term momentum above medium-term (bullish).
- **Red** when EMA 34 < EMA 50 → bearish.

The cloud is rendered beneath the candles so price action stays readable on top. The
34/50 pair is one of the most common Ripster cloud settings for swing/trend context.

## Technical Sentiment Rating

Each stock gets a per-symbol **Strong Sell → Strong Buy** rating (0–100) shown above the
chart, computed entirely from its own price/volume in
[`app/lib/sentiment.ts`](app/lib/sentiment.ts) (indicator math in
[`app/lib/indicators.ts`](app/lib/indicators.ts); every tunable lives in
[`app/lib/sentimentConfig.ts`](app/lib/sentimentConfig.ts)) — no analyst or news data
(those sources aren't reliably reachable server-side). Signals are organized into **three
weighted groups** (equal by default):

| Group | Signals | Notes |
|-------|---------|-------|
| **Trend** | EMA 50 vs 200, Price vs SMA 200, Price vs 1Y VWAP **(collapsed into one component)** + EMA Cloud 34/50 | de-duplicated so collinear trend-followers can't triple-count |
| **Momentum** | RSI (14), Stochastic (14,3), MACD (12/26/9) | oscillator thresholds adapt to the stock's own percentiles |
| **Money Flow** | Money Flow Index (14), Chaikin Money Flow (20) | volume-weighted buying/selling pressure |

Key mechanics:

- **De-redundant trend:** the three collinear trend-followers average into a *single*
  component so an uptrend can't max the bucket by itself.
- **Extension dampener:** the trend score is scaled down (to a floor of 0.4) as price
  stretches beyond ~3 ATR from its EMA 50 — a parabolic move reads with less conviction.
  Bollinger %B and ATR-distance are shown in the breakdown.
- **Adaptive, regime-aware oscillators:** overbought/oversold come from each indicator's
  own trailing percentiles, and are read relative to the trend (oversold in an uptrend =
  bullish dip; overbought in a downtrend = bearish; otherwise tempered).
- **Divergence detection:** price/RSI, price/MFI, and trend-vs-internals divergences are
  flagged as a **separate badge**, not folded into the number.

Bands (on the −1…+1 score): `≥0.5` Strong Buy · `≥0.15` Buy · `−0.15…0.15` Neutral ·
`≤−0.15` Sell · `≤−0.5` Strong Sell.

### Validation (be honest about what this is)

A walk-forward backtest (`npm run backtest`, no look-ahead) over the local ~2y history
found the **score has ≈zero rank correlation with forward returns** and is **contrarian at
short horizons** (in this mostly-bull sample, "Strong Sell" readings had the *highest*
10-day forward returns — mean reversion). The **divergence flag** was weakly but correctly
directional. So treat the rating as a **technical snapshot, not a return forecast** — the
label mapping is *not* a validated buy/sell signal. This is a technical indicator, **not
investment advice**.

Unit tests cover the indicators and divergence logic: `npm test`.

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

This saves 2 years of daily OHLCV for all 11 tickers to `app/data/*.json`.

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
