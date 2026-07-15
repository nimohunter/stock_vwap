# Stock VWAP Analyzer

A personal web app for VWAP analysis on US stocks, deployed to Vercel. Built with Next.js, TradingView Lightweight Charts, and offline daily OHLCV data.

**Live:** https://stockvwap.vercel.app

## Features

- **Rolling VWAP** — 3M / 6M / 1Y window toggle (63 / 126 / 252 bars); click the active window again to hide the VWAP + σ bands for a clean chart
- **Anchored VWAP** — double-click any candle to anchor a VWAP (amber, with dashed ±1σ) from that date, or anchor to the last earnings report with one click
- **Earnings Markers & Calendar** — past reports flagged on the chart (▲E, green = beat / red = miss) plus the next report date + EPS estimate, from yfinance
- **Fundamentals Panel** — valuation, margins, balance sheet, short interest, and analyst consensus (mean target + upside) per stock
- **Snapshot Strip** — 1D/5D/10D returns, EMA 10/20/50 stack, RSI trajectory, ADX/DI trend read, ATR, and relative volume above the chart
- **Copy AI Analysis Prompt** — one click builds a full LLM prompt (120-day raw technicals + fundamentals + analyst task) for any ticker, ready to paste into an AI chat
- **Shareable / Persistent Views** — symbol, VWAP window, MA toggles, and anchor live in the URL and are remembered across visits
- **Full 2Y Price History** — chart always shows all available data; window controls only the VWAP computation
- **±1σ / ±2σ Standard Deviation Bands** — 5-line display (red/yellow/blue/green/pink)
- **Typical Price Formula** — VWAP computed as `(High + Low + Close) / 3 × Volume`
- **11 Pre-loaded Tickers** — NVDA, META, GOOGL, AAPL, MSFT, AMZN, TSLA, MU, VOO, SPMO, GLD
- **Moving Averages** — toggleable EMA 10/20/50/200 overlays (the 10/20/50 trend stack + the long-term 200)
- **Ripster EMA Cloud 34/50** — trend-colored cloud between the 34 and 50 EMAs (see below)
- **Stats Panel** — current price, VWAP value, % distance, SD zone (e.g. "+1σ to +2σ")
- **Technical Rating** — per-stock Strong Sell → Strong Buy rating (−1…+1, TradingView-style two-group model) with divergence + extension flags and a signal breakdown (see below)
- **Relative Strength vs VOO** — RSI/ADX computed on the stock÷VOO price ratio, with overbought/oversold episode markers on the chart (see below)
- **Options Levels (MU)** — call wall / put wall / gamma flip drawn on the chart plus a GEX/P-C/IV panel, from a once-a-day FlashAlpha snapshot (see below)
- **Sector Money Flow page** (`/money-flow`) — a separate dashboard for capital rotation across the 11 SPDR sectors + SMH/SOXX (semis) vs VOO: a sortable performance table, relative-strength sparklines, and a Relative Rotation Graph (RRG), each with its own timeframe selector (see below)
- **Auto Data Refresh** — `fetch-data.mjs` runs before every `dev` and `build`; a GitHub Action refreshes data every weeknight. The header shows a "Data as of" date that turns amber when data is >4 days old.

The single-stock ticker list lives in one place — [`app/lib/tickers.json`](app/lib/tickers.json) — read by the UI, the API layer, and both data scripts. The `/money-flow` page has its own ETF list in [`app/lib/sectors.json`](app/lib/sectors.json); the data scripts fetch both.

## Anchored VWAP & Earnings

**Anchored VWAP** accumulates price×volume from a fixed start date instead of a rolling
window — the classic way to ask "what's the average price everyone has paid *since event X*?"

- **Double-click a candle** to anchor there (the anchor day's bar is included).
- **⚓ Last earnings** anchors to the most recent earnings report date — earnings-anchored
  VWAP is the common institutional variant.
- Rendered as a solid amber line with dashed ±1σ bands; the anchor is part of the URL, so
  an anchored view can be shared.

**Earnings dates** come from the cached yfinance fundamentals (see below) and are drawn
as ▲E markers under the bars — green when the report beat the EPS estimate, red when it
missed, amber when no estimate exists.

## Fundamentals, Earnings Calendar & AI Analysis Prompt

`scripts/fetch-fundamentals.py` (yfinance, no API key) caches one
`app/data/<TICKER>.fundamentals.json` per ticker daily — valuation (P/E, PEG, EV/EBITDA),
profitability, balance sheet, short interest, analyst consensus (recommendation, mean/high/low
target, analyst count), and the earnings calendar (next report date + EPS estimate, past
reports with surprise %). It skips while the cache is under 20h old; the nightly GitHub
Action refreshes and commits it. ETFs simply store nulls and get no panel.

On the page this powers:
- the **Fundamentals panel** below the stats (with "% to mean target" and "next earnings in N days"),
- the **snapshot strip** above the chart (returns, EMA stack, RSI/ADX/ATR, relative volume — computed client-side from the local bars),
- the **⧉ Copy AI analysis prompt** button, which assembles the full institutional-analyst
  prompt — 120 days of raw daily technicals (EMA 10/20/50, RSI, MFI, ADX/±DI, ATR, relative
  volume as JSONL) plus the fundamentals block and a structured task — via
  `app/api/analysis-prompt` ([`app/lib/analysisPrompt.ts`](app/lib/analysisPrompt.ts)).
  Paste it into any LLM chat for a technical + fundamental read. Not investment advice.

## Moving Averages & Ripster EMA Cloud

The **Moving Averages** control group toggles four overlay lines plus the EMA cloud,
all computed in [`app/lib/vwap.ts`](app/lib/vwap.ts) and drawn in
[`app/components/VwapChart.tsx`](app/components/VwapChart.tsx):

| Overlay | Color | Calculation |
|---------|-------|-------------|
| EMA 10 / EMA 20 | orange / purple | Fast trend-stack legs (with EMA 50: bullish when 10>20>50) |
| EMA 50 / EMA 200 | cyan / rose | Exponential moving average, `k = 2 / (window + 1)` |
| EMA Cloud 34/50 | teal fill | Filled band between the EMA 34 and EMA 50 |

The snapshot strip above the chart reports the current **EMA 10/20/50 stack** state
(bullish / bearish / mixed) so you can check the stack without toggling the overlays on.

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

## Technical Rating (TradingView-style)

Each stock gets a per-symbol **Strong Sell → Strong Buy** rating on a **−1 … +1** scale
shown above the chart, computed entirely from its own price/volume in
[`app/lib/sentiment.ts`](app/lib/sentiment.ts) (indicator math in
[`app/lib/indicators.ts`](app/lib/indicators.ts); every tunable lives in
[`app/lib/sentimentConfig.ts`](app/lib/sentimentConfig.ts)) — no analyst or news data.
It follows the **TradingView Technical Rating** model: **two equally-weighted groups**,
each averaging +1 / 0 / −1 votes into a group rating, then blended into the overall score.

| Group | Votes |
|-------|-------|
| **Moving Averages** | Price vs EMA 10 / 20 / 50 / 100 / 200 · EMA-stack orderings (10 vs 20, 20 vs 50, 50 vs 200) · Price vs 1Y VWAP |
| **Oscillators** | RSI (14) · Stochastic (14,3,3) · CCI (20) · ADX (14)/±DI · Momentum (10) · MACD (12/26/9) · Money Flow Index (14) · Chaikin Money Flow (20) |

Moving-average votes are `sign(price − MA)` / `sign(fast − slow)` — deliberately collinear,
so the group rating measures **how much of the MA ladder price has cleared** (a graded
trend-breadth gauge, not one signal counted many times). Oscillators use TradingView's
**level + direction** rule (e.g. RSI votes buy only when it's oversold *and turning up*).

**Two deliberate improvements over TradingView, kept from the previous engine:**

- **Adaptive overbought/oversold levels** — RSI/Stoch/CCI/MFI thresholds come from each
  stock's own trailing percentiles (85th/15th over ~1y), not fixed 30/70 lines, so a
  high-beta name like MU (which rarely prints RSI 30) doesn't go mute. Fixed values are
  the fallback below 60 samples.
- **Divergence badge** — price/RSI, price/MFI, and MA-vs-Oscillator group divergences are
  surfaced as a **separate flag**, never folded into the number.

**Extension** (ATR distance from EMA 50 + Bollinger %B) is shown as a `⚠ extended N.N ATR`
badge when price is ≥ 3 ATR from its EMA 50 — informational, and (unlike the previous
engine) **no longer secretly scales the score**, so the number stays comparable to
TradingView's for the same ticker.

Bands (on the −1…+1 score, matching TradingView): `≥0.5` Strong Buy · `>0.1` Buy ·
`−0.1…0.1` Neutral · `<−0.1` Sell · `≤−0.5` Strong Sell.

### Validation (be honest about what this is)

A walk-forward backtest (`npm run backtest`, no look-ahead) over the local ~2y history
(11 tickers, ~3,500 samples) finds a **small positive rank IC at 10–20 days** (≈ +0.03 /
+0.04) and **≈zero at 5 days**. Label buckets are **non-monotonic and contrarian at short
horizons**: in this mostly-bull sample "Strong Sell" readings had the *highest* forward
returns (mean reversion) — though "Strong Buy" was second, so the extremes carry more
signal than the middle. The **divergence flag** is weakly but correctly directional
(bullish divergence beat the base rate at 10d). So treat the rating as a **technical
snapshot, not a return forecast** — the label mapping is *not* a validated buy/sell signal.
This is a technical indicator, **not investment advice**.

Unit tests cover the indicators, the two-group rating, and divergence logic: `npm test`.

## Relative Strength vs VOO

A badge next to the sentiment rating (and episode markers on the chart) measures the stock
**relative to the market** instead of in isolation — a port of a TradingView "relative
strength RSI/MFI/ADX" indicator (`.resource/based-rsi-mfi-adx.pine`) to the local daily
data, using **VOO** (already in `app/data/`) as the S&P 500 benchmark. Implementation:
[`app/lib/relativeStrength.ts`](app/lib/relativeStrength.ts), served by
`app/api/relative-strength`.

Everything is computed on the **strength ratio** `stock ÷ VOO × 100`:

- **r-RSI (14)** — is the *outperformance itself* overbought/oversold?
- **r-ADX (14/14, Wilder)** — how strong is the relative trend? Episode starts are
  suppressed while r-ADX < 20; ≥ 25 reads as a "strong relative trend".
- **Relative performance (1D / 7D / 3M)** — plain ratio change over 1, 7, and 63 bars
  (outperforming / underperforming vs the market, per window, on the badge).
- **OB/OS episode machine** — stateful start/end events (not per-bar flicker): an episode
  starts when r-RSI breaks its own adaptive threshold *and* makes a fresh 30-bar extreme
  (or crosses a hard threshold), and ends when it decays or r-ADX rolls over. Extremes
  (r-RSI + r-MFI + r-ADX all stretched) get a separate flag. Episodes are drawn on the
  chart as shaded background zones — red = overbought stretch, teal = oversold stretch —
  and extreme days get a ■! marker.
- **Adaptive thresholds** — like the sentiment engine, OB/OS lines come from trailing
  percentiles of the r-RSI's own history (clamped), not the Pine script's fixed 60/70/40/30.

### Validation

`npm run backtest:rs` (walk-forward; the engine is causal so one pass per ticker is
honest). On the local ~2y sample: the **r-RSI level showed a small positive 20-day IC**
(≈ +0.05 vs absolute, +0.03 vs relative forward returns) — weak, but notably better than
the sentiment score (≈ 0) and than a plain 63-day relative-momentum baseline (≈ 0).
**Episode events were near base rate** (n < 100 each; extremes n ≈ 15, unusable). Treat
the badge as context, the markers as annotations — not trade signals. Not investment advice.

## Sector Money Flow

A **separate page at [`/money-flow`](https://stockvwap.vercel.app/money-flow)** (linked from
the header) that tracks where capital is rotating *across sectors* instead of analyzing a
single stock. It reads its own ETF list — [`app/lib/sectors.json`](app/lib/sectors.json): the
**11 SPDR sector ETFs** (XLK, XLF, XLV, XLY, XLC, XLI, XLP, XLE, XLU, XLRE, XLB) plus **SMH**
and **SOXX** (semiconductors) — all measured against **VOO** as the S&P 500 benchmark. Math
lives in [`app/lib/moneyFlow.ts`](app/lib/moneyFlow.ts) and is served in one request by
`app/api/money-flow`, which sends each ETF's full RS-ratio series on a shared,
benchmark-driven date axis; the dashboards window and recompute everything **client-side**, so
switching timeframes is instant.

Three dashboards, each with its own timeframe selector:

1. **Sector Performance** — a table of each ETF's % change over the chosen window
   (1D / 5D / 1M / 3M / 6M / YTD / 1Y), sorted best-to-worst, with a center-anchored red/green
   bar and the VOO benchmark row pinned at the bottom. Windows are calendar-anchored (YTD
   baselines on the prior-year close, matching mainstream sector dashboards).
2. **Relative Strength vs VOO** — small-multiple sparklines of each ETF's RS ratio
   (`sector ÷ VOO × 100`), rebased to 100 at the window start and sorted strongest-first. A
   rising line = gaining on the market; above 100 = outperforming over the window. Full
   1D…1Y selector.
3. **Relative Rotation Graph (RRG)** — the industry-standard rotation view (Julius de
   Kempenaer / StockCharts): **RS-Ratio** (x) vs **RS-Momentum** (y), two oscillators centred
   on 100 that place each ETF in one of four quadrants it cycles through clockwise —
   **Improving → Leading → Weakening → Lagging**. Each dot carries a rotation tail; the
   duration selector (1M / 3M / 6M / 1Y) sets both the normalization horizon and the tail
   span. 1D/5D are omitted here — rotation needs enough history to normalize.

The true StockCharts JdK RS-Ratio / RS-Momentum formula is proprietary; the versions here are
a documented reproduction — a rolling z-score of the RS ratio (and of its rate of change),
recentred on 100 and lightly smoothed. Rotation and quadrant transitions track the published
RRGs closely; absolute levels are not identical. Quadrant colours were validated for
colour-blind separation and contrast on the dark surface. Unit tests cover the timeframe
windowing, RS rebasing, and per-duration RRG: `npm test`. Not investment advice.

The sector ETFs ride the same pipeline as everything else — `fetch-data.mjs` and
`download-data.py` read `sectors.json` alongside `tickers.json`, and the nightly Action keeps
them fresh.

## Options Levels (MU)

For tickers with a cached options snapshot (currently **MU** only), the page shows an
**Options Levels** panel — call wall, put wall, gamma flip, net GEX, put/call ratios,
ATM IV vs HV20 — and draws the three price levels on the chart as dashed horizontal
lines (red = call wall ≈ resistance, green = put wall ≈ support, blue = gamma flip,
below which dealer hedging amplifies moves instead of dampening them).

**Data & quota:** the source is the FlashAlpha API, whose free key allows **5 queries
per day** (and only entitled symbols). To stay safely inside that,
`scripts/fetch-options-data.mjs`:

- runs in `predev`/`prebuild` and the nightly GitHub Action,
- fetches **one** endpoint per ticker (`/v1/stock/<sym>/summary`),
- **skips entirely while the cached `app/data/<SYM>.options.json` is younger than 20h**,
- is a silent no-op when `FLASHALPHA_API_KEY` is unset.

Net usage: ~1 query/day. The page itself never calls the upstream API —
`app/api/options-levels` only reads the local cache. To add another entitled ticker,
append it to `OPTIONS_TICKERS` in the script. The key lives in `.env.local` locally and
in the `FLASHALPHA_API_KEY` GitHub Actions secret.

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS
- TradingView Lightweight Charts v5
- Offline data in `app/data/` (committed to the repo): `<T>.json` (≈2y daily OHLCV per ticker), plus `<T>.fundamentals.json` and `MU.options.json` sidecar caches

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

This saves 2 years of daily OHLCV for every ticker — the single stocks in `tickers.json` plus the sector/industry ETFs in `sectors.json` — to `app/data/*.json`.

### 3. Start the dev server

```bash
npm run dev
```

`predev` automatically runs `scripts/fetch-data.mjs` (bars, refreshed once the last bar is
over a day old) and `scripts/fetch-options-data.mjs` (options snapshot, ~1 query/day) before
starting Next.js.

Open [http://localhost:3000](http://localhost:3000).

## Data Refresh

| Script | When to use |
|--------|-------------|
| `python3 scripts/download-data.py` | Full 2-year download from your local machine |
| `node scripts/fetch-data.mjs` | Incremental refresh (auto-runs on `dev`/`build`) |

`fetch-data.mjs` tries Yahoo Finance first, falls back to Alpha Vantage (requires `ALPHA_VANTAGE_API_KEY` in `.env.local`), and merges new bars with existing history so no data is lost.

## Environment Variables

```bash
# .env.local
ALPHA_VANTAGE_API_KEY=your_key_here   # fallback daily-bars source, free at alphavantage.co
FLASHALPHA_API_KEY=your_key_here      # options levels (5 queries/day free tier, MU only)
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

## Automated daily refresh

`.github/workflows/refresh-data.yml` runs every weeknight at 22:30 UTC (after the US market close) and commits any changes back to `master`, in three steps: `fetch-data.mjs` (bars), `fetch-options-data.mjs` (options snapshot), and `fetch-fundamentals.py` (fundamentals + earnings calendar). Vercel auto-deploys on the push, so the live site always has fresh data without a manual rebuild.

Manual trigger: GitHub → Actions → **Refresh stock data** → **Run workflow**.

Optional secrets under **Settings → Secrets and variables → Actions** (repository secrets): `ALPHA_VANTAGE_API_KEY` (bars fallback) and `FLASHALPHA_API_KEY` (options levels). Without them those steps are silent no-ops and the last committed snapshot is kept.
