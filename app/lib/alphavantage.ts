const BASE_URL = 'https://www.alphavantage.co/query';
const API_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? 'demo';

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchDailyBars(symbol: string): Promise<DailyBar[]> {
  // outputsize=full is premium-only; compact returns last 100 trading days (free tier)
  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 86400 } });
  const json = await res.json();

  if (json['Note'] || json['Information']) {
    throw new Error('Alpha Vantage rate limit hit');
  }

  const timeSeries = json['Time Series (Daily)'];
  if (!timeSeries) throw new Error(`No data for ${symbol}`);

  const bars: DailyBar[] = Object.entries(timeSeries)
    .map(([date, v]: [string, unknown]) => {
      const val = v as Record<string, string>;
      return {
        date,
        open: parseFloat(val['1. open']),
        high: parseFloat(val['2. high']),
        low: parseFloat(val['3. low']),
        close: parseFloat(val['4. close']),
        volume: parseInt(val['5. volume']),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return bars;
}

