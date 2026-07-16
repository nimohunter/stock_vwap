# Feature: MUU Leverage Estimator (MU → MUU price)

Add a decay-aware estimator to the MU page that converts a MU price into an
estimated MUU price. MUU = GraniteShares 2x Long MU Daily ETF (2× MU's DAILY
% move, rebalanced daily). MUU recently did a 20:1 forward split.

## Why
I trade MUU but think in terms of MU. Given a MU price (current, a target, or
a VWAP band level) I want the corresponding MUU price. Because MUU resets daily,
a multi-day hold decays vs. 2× MU — the estimate must show that, not just ×2.

## Data
- Add a companion-ticker config `app/lib/leveraged.json`:
  { "MU": { "ticker": "MUU", "leverage": 2,
            "name": "GraniteShares 2x Long MU Daily ETF",
            "expenseRatio": 0.0115 } }
- Fetch MUU daily into `app/data/MUU.json` via the existing pipeline
  (scripts/fetch-data.mjs), same as sector ETFs — NOT added to the on-page
  ticker button row (MUU is a companion to MU, not a standalone stock).
- 20:1 split: use Yahoo's split-adjusted series so daily returns are continuous
  across the split date. Verify no ~20× discontinuity in the stored series.

## Math (client-side, live as inputs change)
Inputs: target MU price (default = last close), holding horizon N (1d / 1w / 2w).
Reference: MU last close, MUU last close, MU realized daily vol σ (20d & 60d).
- Same-day:   MUU_est = MUU_now × (1 + 2·(target/MU_now − 1))
- Multi-day:  MUU_est = MUU_now × (target/MU_now)² × exp(−σ²·N) × (1−c)^N
              c = expenseRatio/252 (+ optional financing drag)
- Show both the naïve-2× (no-decay) value and the decay-adjusted value so the
  drag is explicit. Show implied MUU % move and the realized/empirical leverage.

## Verify from real data
- Empirical leverage = OLS slope of MUU daily returns on MU daily returns
  (expect ≈ 2). Show it next to the assumed 2× as a sanity check.

## UI (only when the selected symbol is MU)
Panel "MUU Leverage Estimator" under the MU chart:
- MU last close + MUU last close (with data-as-of date + "MUU split 20:1" note)
- Target-MU input with quick presets: current, ±5%, ±10%, and the VWAP ±1σ/±2σ
  band levels already computed on the page
- Horizon toggle: 1 day / 1 week / 2 weeks
- Output: estimated MUU price (same-day + decay-adjusted), MUU % move,
  realized-leverage sanity check
- Plain-language caveat: estimate is path-dependent; decay grows with vol × time.

## Non-goals
- No full MUU chart / standalone MUU page. MUU stays a MU companion.
- No intraday/real-time data — daily bars only, consistent with the app.
