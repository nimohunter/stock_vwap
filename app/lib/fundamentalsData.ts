/**
 * Reader + types for the locally cached yfinance fundamentals
 * (app/data/<TICKER>.fundamentals.json, refreshed daily by
 * scripts/fetch-fundamentals.py). ETFs have most fields null.
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'app/data');

export interface EarningsEvent {
  date: string;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
}

export interface Fundamentals {
  asOf: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  beta: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  peg: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  roe: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  freeCashflow: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  shortPctFloat: number | null;
  shortRatio: number | null;
  recommendation: string | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  numAnalysts: number | null;
  earnings: { upcoming: EarningsEvent | null; past: EarningsEvent[] };
}

export function loadFundamentals(symbol: string): Fundamentals | null {
  const file = path.join(DATA_DIR, `${symbol.toUpperCase()}.fundamentals.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const { fetched_at, info, earnings } = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return {
      asOf: fetched_at ?? '',
      ...info,
      earnings: {
        upcoming: earnings?.upcoming ?? null,
        past: earnings?.past ?? [],
      },
    } as Fundamentals;
  } catch {
    return null;
  }
}
