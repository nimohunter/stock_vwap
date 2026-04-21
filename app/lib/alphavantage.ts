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

export interface EarningsDate {
  reportedDate: string;
  fiscalDateEnding: string;
  quarter: string;
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

export async function fetchEarningsDates(symbol: string): Promise<EarningsDate[]> {
  const url = `${BASE_URL}?function=EARNINGS&symbol=${symbol}&apikey=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 86400 } });
  const json = await res.json();

  if (json['Note'] || json['Information']) {
    throw new Error('Alpha Vantage rate limit hit');
  }

  const quarterly: unknown[] = json['quarterlyEarnings'] ?? [];
  return quarterly
    .slice(0, 8)
    .filter((e: unknown) => {
      const entry = e as Record<string, string>;
      return entry['reportedDate'] && entry['reportedDate'] !== 'None';
    })
    .map((e: unknown, i: number) => {
      const entry = e as Record<string, string>;
      const fiscal = entry['fiscalDateEnding'] ?? '';
      const month = new Date(fiscal).toLocaleString('en-US', { month: 'short', year: 'numeric' });
      return {
        reportedDate: entry['reportedDate'],
        fiscalDateEnding: fiscal,
        quarter: `Q${4 - (i % 4)} ${month}`,
      };
    });
}
