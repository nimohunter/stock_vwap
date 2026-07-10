import { NextRequest, NextResponse } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import { computeRelativeStrength, RS_DEFAULTS } from '@/app/lib/relativeStrength';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  const benchmark = RS_DEFAULTS.benchmark;
  try {
    // RS against itself is meaningless — the client hides the badge on null.
    const rs =
      symbol === benchmark ? null : computeRelativeStrength(loadLocalBars(symbol), loadLocalBars(benchmark));
    return NextResponse.json(
      { symbol, benchmark, rs },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
