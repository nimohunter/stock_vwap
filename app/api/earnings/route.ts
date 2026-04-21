import { NextRequest, NextResponse } from 'next/server';
import { fetchEarningsDates } from '@/app/lib/alphavantage';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  try {
    const earnings = await fetchEarningsDates(symbol);
    return NextResponse.json(
      { symbol, earnings },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
