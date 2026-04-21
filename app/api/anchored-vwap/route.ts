import { NextRequest, NextResponse } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import { computeAnchoredVwapBands } from '@/app/lib/vwap';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  const anchor = req.nextUrl.searchParams.get('anchor');

  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  if (!anchor) return NextResponse.json({ error: 'anchor date required' }, { status: 400 });

  try {
    const bars = loadLocalBars(symbol);
    const anchoredBands = computeAnchoredVwapBands(bars, anchor);

    return NextResponse.json(
      { symbol, anchor, anchoredBands },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
