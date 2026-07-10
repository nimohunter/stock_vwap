import { NextRequest, NextResponse } from 'next/server';
import { loadOptionsSummary } from '@/app/lib/optionsData';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  // Reads the local daily cache only — never hits the quota-limited upstream API.
  return NextResponse.json(
    { symbol, options: loadOptionsSummary(symbol) },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
  );
}
