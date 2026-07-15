import { NextResponse } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import {
  SECTOR_BENCHMARK,
  SECTORS,
  computeAllPerf,
  type SectorPayload,
  type MoneyFlowPayload,
} from '@/app/lib/moneyFlow';

// Trailing window (trading days) of RS history sent to the client. Bounds the
// payload and comfortably covers the longest client need (1Y RS window + 1Y RRG
// normalization warmup + tail).
const RATIO_LOOKBACK = 400;

export async function GET() {
  try {
    const benchBars = loadLocalBars(SECTOR_BENCHMARK);
    const benchByDate = new Map(benchBars.map((b) => [b.date, b.close]));

    // Axis = the benchmark's most recent trading days. Each sector aligns to it
    // independently with nulls where it lacks a bar, so one lagging or
    // short-history ETF never truncates the window for the others.
    const ratioDates = benchBars
      .slice(-RATIO_LOOKBACK)
      .map((b) => b.date)
      .filter((d) => benchByDate.get(d)! > 0);
    const asOf = ratioDates[ratioDates.length - 1];

    const sectors: SectorPayload[] = SECTORS.map(({ ticker, name }) => {
      const bars = loadLocalBars(ticker);
      const closes = new Map(bars.map((b) => [b.date, b.close]));
      const ratio = ratioDates.map((d) => {
        const sc = closes.get(d);
        return sc !== undefined && sc > 0 ? (sc / benchByDate.get(d)!) * 100 : null;
      });
      return { ticker, name, perf: computeAllPerf(bars), ratio };
    });

    const payload: MoneyFlowPayload = {
      benchmark: { ticker: SECTOR_BENCHMARK, perf: computeAllPerf(benchBars) },
      asOf,
      ratioDates,
      sectors,
    };

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
