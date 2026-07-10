/**
 * Builds the "institutional analyst" LLM prompt (same format as
 * .resource/MU_analysis_prompt 120 days.txt) from local OHLCV + cached
 * fundamentals — paste it into any LLM chat for a structured analysis.
 */
import { DailyBar } from './bars';
import { Series, rsiSeries, mfiSeries, atrSeries, dmiSeries } from './indicators';
import { computeEMA } from './vwap';
import { Fundamentals } from './fundamentalsData';

const DAYS = 120;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const at = (s: Series, i: number): number | null => s[i] ?? null;

function emaByDate(bars: DailyBar[], window: number): Map<string, number> {
  return new Map(computeEMA(bars, window).map((p) => [p.date, r2(p.value)]));
}

const fmtNum = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined ? 'n/a' : v.toLocaleString('en-US', { maximumFractionDigits: digits });

const fmtBig = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return 'n/a';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  return v.toLocaleString('en-US');
};

const pctChange = (bars: DailyBar[], n: number): string => {
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 1 - n];
  return prev ? `${(((last.close - prev.close) / prev.close) * 100).toFixed(2)}%` : 'n/a';
};

export function buildAnalysisPrompt(symbol: string, bars: DailyBar[], f: Fundamentals | null): string {
  const n = bars.length;
  const last = bars[n - 1];
  const pulled = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const closes = bars.map((b) => b.close);
  const ema10 = emaByDate(bars, 10);
  const ema20 = emaByDate(bars, 20);
  const ema50 = emaByDate(bars, 50);
  const rsi = rsiSeries(closes, 14);
  const mfi = mfiSeries(bars, 14);
  const atr = atrSeries(bars, 14);
  const { adx, plusDi, minusDi } = dmiSeries(bars, 14, 14);

  const vol20 = (i: number): number | null => {
    if (i < 20) return null;
    let s = 0;
    for (let j = i - 20; j < i; j++) s += bars[j].volume;
    const avg = s / 20;
    return avg > 0 ? r2(bars[i].volume / avg) : null;
  };

  // JSONL block — last DAYS trading days, oldest → newest.
  const lines: string[] = [];
  for (let i = Math.max(0, n - DAYS); i < n; i++) {
    const b = bars[i];
    lines.push(
      JSON.stringify({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        ema10: ema10.get(b.date) ?? null,
        ema20: ema20.get(b.date) ?? null,
        ema50: ema50.get(b.date) ?? null,
        rsi14: at(rsi, i) !== null ? r1(at(rsi, i)!) : null,
        mfi14: at(mfi, i) !== null ? r1(at(mfi, i)!) : null,
        adx14: at(adx, i) !== null ? r1(at(adx, i)!) : null,
        di_plus14: at(plusDi, i) !== null ? r1(at(plusDi, i)!) : null,
        di_minus14: at(minusDi, i) !== null ? r1(at(minusDi, i)!) : null,
        atr14: at(atr, i) !== null ? r2(at(atr, i)!) : null,
        vol_vs_20d_avg: vol20(i),
      })
    );
  }

  const li = n - 1;
  const e10 = ema10.get(last.date);
  const e20 = ema20.get(last.date);
  const e50 = ema50.get(last.date);
  const stack =
    e10 !== undefined && e20 !== undefined && e50 !== undefined
      ? e10 > e20 && e20 > e50
        ? 'bullish (10>20>50)'
        : e10 < e20 && e20 < e50
          ? 'bearish (10<20<50)'
          : 'mixed'
      : 'n/a';
  const rsiNow = at(rsi, li);
  const rsiPrev5 = at(rsi, li - 5);
  const rsiTrend = rsiNow !== null && rsiPrev5 !== null ? (rsiNow > rsiPrev5 ? 'rising' : 'falling') : 'n/a';
  const adxNow = at(adx, li);
  const adxPrev5 = at(adx, li - 5);
  const adxTrend = adxNow !== null && adxPrev5 !== null ? (adxNow > adxPrev5 ? 'rising' : 'falling') : 'n/a';

  const yearBars = bars.slice(-252);
  const hi52 = Math.max(...yearBars.map((b) => b.high));
  const lo52 = Math.min(...yearBars.map((b) => b.low));

  const earnings = f?.earnings;
  const fundBlock = f
    ? `
------------------------------------------------------------
FUNDAMENTALS
------------------------------------------------------------
COMPANY
  Name: ${f.name ?? symbol}
  Sector / Industry: ${f.sector ?? 'n/a'} / ${f.industry ?? 'n/a'}
  Market Cap: ${fmtBig(f.marketCap)}
  Beta: ${fmtNum(f.beta)}

VALUATION
  Trailing P/E: ${fmtNum(f.trailingPE)}
  Forward P/E: ${fmtNum(f.forwardPE)}
  PEG Ratio: ${fmtNum(f.peg)}
  Price/Book: ${fmtNum(f.priceToBook)}
  Price/Sales (ttm): ${fmtNum(f.priceToSales)}
  EV/EBITDA: ${fmtNum(f.evToEbitda)}

EARNINGS / PROFITABILITY
  Trailing EPS: ${fmtNum(f.trailingEps)}
  Forward EPS: ${fmtNum(f.forwardEps)}
  Profit Margin: ${fmtNum(f.profitMargin, 4)} (fraction)
  Operating Margin: ${fmtNum(f.operatingMargin, 4)} (fraction)
  Return on Equity: ${fmtNum(f.roe, 4)} (fraction)
  Revenue Growth (yoy): ${fmtNum(f.revenueGrowth, 4)} (fraction)
  Earnings Growth (yoy): ${fmtNum(f.earningsGrowth, 4)} (fraction)

BALANCE SHEET / CASH
  Total Cash: ${fmtBig(f.totalCash)}
  Total Debt: ${fmtBig(f.totalDebt)}
  Debt/Equity: ${fmtNum(f.debtToEquity)}
  Current Ratio: ${fmtNum(f.currentRatio)}
  Free Cash Flow: ${fmtBig(f.freeCashflow)}

DIVIDEND / SHORT INTEREST
  Dividend Yield: ${fmtNum(f.dividendYield, 4)}
  Payout Ratio: ${fmtNum(f.payoutRatio, 4)} (fraction)
  Short % of Float: ${fmtNum(f.shortPctFloat, 4)} (fraction)
  Short Ratio (days to cover): ${fmtNum(f.shortRatio)}

ANALYST CONSENSUS (from yfinance, may lag real-time sell-side updates)
  Recommendation: ${f.recommendation ?? 'n/a'}
  Mean Target: ${fmtNum(f.targetMean)}
  High / Low Target: ${fmtNum(f.targetHigh)} / ${fmtNum(f.targetLow)}
  # Analysts: ${fmtNum(f.numAnalysts, 0)}

EARNINGS CALENDAR
  Upcoming: ${earnings?.upcoming ? `${earnings.upcoming.date} | EPS estimate: ${fmtNum(earnings.upcoming.epsEstimate)}` : 'n/a'}
${(earnings?.past ?? [])
  .slice(0, 3)
  .map((p) => `  Past: ${p.date} | Est: ${fmtNum(p.epsEstimate)} | Actual: ${fmtNum(p.epsActual)} | Surprise: ${fmtNum(p.surprisePct)}%`)
  .join('\n')}
`
    : '\n(No cached fundamentals for this symbol — technicals only.)\n';

  return `You are a highly skilled institutional equity trader and analyst. You will be given
verified, current quantitative data (technicals and fundamentals) for ${symbol}, pulled
programmatically at ${pulled}. Treat every number below as ground truth —
it is more current and reliable than anything in your training data or general knowledge.

Do NOT re-derive or contradict these figures from memory. If you use web search, use it
ONLY to supplement what is missing here — e.g. recent news/catalysts, qualitative sector
commentary, analyst rating changes not reflected above, macro backdrop, or competitor
context. Do not let web search override the price/indicator/fundamental values given below.

============================================================
TICKER: ${symbol}   |   Data as of: ${last.date}   |   Pulled: ${pulled}
============================================================

SNAPSHOT
  Last Close: ${fmtNum(last.close)}   (1D: ${pctChange(bars, 1)}, 5D: ${pctChange(bars, 5)}, 10D: ${pctChange(bars, 10)})
  Day Range: ${fmtNum(last.low)} - ${fmtNum(last.high)}   |   Open: ${fmtNum(last.open)}
  52-Week Range: ${fmtNum(lo52)} - ${fmtNum(hi52)}
  Volume: ${last.volume.toLocaleString('en-US')}  (${fmtNum(vol20(li))}x the 20-day average)

TREND / MOMENTUM READ (derived, for context only — verify against the daily data below)
  Price vs EMA50: ${e50 !== undefined ? (last.close >= e50 ? 'above' : 'below') : 'n/a'}
  EMA stack (10/20/50): ${stack}
  RSI14: ${rsiNow !== null ? r1(rsiNow) : 'n/a'} (5-bar trend: ${rsiTrend})
  MFI14: ${at(mfi, li) !== null ? r1(at(mfi, li)!) : 'n/a'}
  ADX14: ${adxNow !== null ? r1(adxNow) : 'n/a'} (5-bar trend: ${adxTrend}) | +DI14: ${at(plusDi, li) !== null ? r1(at(plusDi, li)!) : 'n/a'} | -DI14: ${at(minusDi, li) !== null ? r1(at(minusDi, li)!) : 'n/a'}
  ATR14: ${at(atr, li) !== null ? r2(at(atr, li)!) : 'n/a'} (use for stop-loss / position sizing context)

LAST ${Math.min(DAYS, n)} TRADING DAYS — RAW TECHNICALS (JSONL: one JSON object per day, oldest to newest)
${lines.join('\n')}
${fundBlock}
============================================================
YOUR TASK
============================================================
Acting as a senior institutional trader/analyst, produce a structured analysis of ${symbol}:

1. TECHNICAL READ: Interpret trend, momentum, and volume using the data above (EMA
   stack, RSI/MFI overbought-oversold state and trajectory, ADX/DI for trend strength
   and direction, ATR for volatility regime). Note any divergences (e.g. price making
   highs while RSI/MFI don't confirm).

2. FUNDAMENTAL READ: Assess valuation (P/E, forward P/E, PEG, EV/EBITDA) relative to
   growth and profitability. Flag balance sheet risk or strength. Note proximity to the
   next earnings date and what that implies for positioning (e.g. IV crush risk, earnings
   gap risk).

3. SYNTHESIS / THESIS: State a clear directional or neutral thesis (bullish / bearish /
   range-bound / avoid), and explicitly weigh technical vs fundamental signals where they
   agree or conflict.

4. TRADE PLAN: Propose concrete plans — entry zone(s), invalidation/stop-loss level
   (tie to ATR or a technical level), profit target(s) with rough risk:reward, suggested
   time horizon (swing/position), and what would change your mind. If relevant, comment
   on position sizing/risk given the volatility (ATR) and any upcoming earnings event.
   State a conviction level (high/medium/low) based on how many independent signals
   (technical + fundamental) align vs conflict, and explain what's driving that rating.

5. GAPS: If you use web search to fill in missing context (news, catalysts, updated
   analyst moves), cite what you found and clearly separate it from the verified
   quantitative data above.

Be direct and specific with numbers/levels — avoid vague hedging. Where signals conflict,
say so explicitly rather than smoothing it over.
`;
}
