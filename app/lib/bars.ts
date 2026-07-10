/** A single daily OHLCV bar — the core data type used across the app.
 *  Data is sourced from Yahoo Finance (Alpha Vantage fallback) by
 *  scripts/fetch-data.mjs and stored as local JSON in app/data/<TICKER>.json. */
export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
