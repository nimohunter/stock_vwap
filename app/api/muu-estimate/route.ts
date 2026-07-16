import { NextRequest, NextResponse } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import { leveragedSpecFor, realizedDailyVol, fitLeverage } from '@/app/lib/leveragedEstimate';

/**
 * Reference data for the leveraged-ETF estimator (e.g. MU → MUU). Returns the two
 * last closes (dollar anchor), the underlying's realized daily volatility, and the
 * empirically-fit leverage. The client computes the live estimate as inputs change.
 */
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  const spec = leveragedSpecFor(symbol);
  // No leveraged companion configured for this symbol — the client hides the panel.
  if (!spec) return NextResponse.json({ symbol, spec: null });

  try {
    const underlying = loadLocalBars(symbol);
    const leveraged = loadLocalBars(spec.ticker);
    const uCloses = underlying.map((b) => b.close);

    const uLast = underlying[underlying.length - 1];
    const lLast = leveraged[leveraged.length - 1];

    return NextResponse.json(
      {
        symbol,
        spec,
        underlyingClose: uLast.close,
        underlyingDate: uLast.date,
        leveragedClose: lLast.close,
        leveragedDate: lLast.date,
        dailyVol20: realizedDailyVol(uCloses, 20),
        dailyVol60: realizedDailyVol(uCloses, 60),
        fit: fitLeverage(underlying, leveraged),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' } }
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
