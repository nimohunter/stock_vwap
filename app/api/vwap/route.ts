import { NextRequest, NextResponse } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import { computeRollingVwapBands } from '@/app/lib/vwap';

const PERIOD_WINDOWS: Record<string, number> = {
  '6m': 126,
  '1y': 252,
  '2y': 504,
};

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  try {
    const allBars = loadLocalBars(symbol);
    const period = req.nextUrl.searchParams.get('period') ?? '1y';
    const window = PERIOD_WINDOWS[period] ?? 252;
    const bars = allBars.slice(-window);
    const vwapBands = computeRollingVwapBands(bars, window);

    return NextResponse.json(
      { symbol, bars, vwapBands },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
