import { DailyBar } from './alphavantage';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'app/data');

const TICKER_MAP: Record<string, string> = {
  GOOG: 'GOOGL',
};

export function loadLocalBars(symbol: string): DailyBar[] {
  const resolved = TICKER_MAP[symbol] ?? symbol;
  const filePath = path.join(DATA_DIR, `${resolved}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No local data for ${symbol}. Run scripts/download-data.py to fetch it.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DailyBar[];
}

export const LOCAL_TICKERS = ['NVDA', 'META', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'VOO', 'SPMO', 'GLD'];
