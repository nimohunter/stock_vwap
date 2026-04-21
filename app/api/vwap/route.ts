import { NextRequest, NextResponse } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import { computeAnchoredVwapBands } from '@/app/lib/vwap';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  try {
    const bars = loadLocalBars(symbol);

    // Anchor from 1 or 2 years before the last bar
    const years = req.nextUrl.searchParams.get('period') === '2y' ? 2 : 1;
    const lastDate = new Date(bars[bars.length - 1].date);
    lastDate.setFullYear(lastDate.getFullYear() - years);
    const anchorDate = lastDate.toISOString().slice(0, 10);

    const vwapBands = computeAnchoredVwapBands(bars, anchorDate);

    return NextResponse.json(
      { symbol, bars, vwapBands },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
