import { NextRequest, NextResponse } from 'next/server';
import { loadFundamentals } from '@/app/lib/fundamentalsData';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  // Local daily cache only — no upstream calls at request time.
  return NextResponse.json(
    { symbol, fundamentals: loadFundamentals(symbol) },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
  );
}
