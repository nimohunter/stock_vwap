import { NextResponse } from 'next/server';
import { loadLocalBars } from '@/app/lib/localData';
import {
  SECTOR_BENCHMARK,
  SECTORS,
  computeAllPerf,
  computeRatioSeries,
  computeRrg,
  type SectorPayload,
  type MoneyFlowPayload,
} from '@/app/lib/moneyFlow';

// Trailing window (trading days) shown in the RS-ratio line chart (dashboard 2).
const RATIO_LOOKBACK = 252;

export async function GET() {
  try {
    const benchBars = loadLocalBars(SECTOR_BENCHMARK);
    const asOf = benchBars[benchBars.length - 1].date;

    // Shared date axis for the ratio chart: the benchmark's last N trading days.
    const ratioDates = benchBars.slice(-RATIO_LOOKBACK).map((b) => b.date);

    const sectors: SectorPayload[] = SECTORS.map(({ ticker, name }) => {
      const bars = loadLocalBars(ticker);
      const { dates, ratio } = computeRatioSeries(bars, benchBars);
      const byDate = new Map(dates.map((d, i) => [d, ratio[i]]));

      // Rebase to 100 at the first available point in the window so lines compare.
      const windowVals = ratioDates.map((d) => byDate.get(d) ?? null);
      const base = windowVals.find((v) => v !== null) ?? null;
      const rebased = windowVals.map((v) => (v !== null && base ? (v / base) * 100 : null));

      return {
        ticker,
        name,
        perf: computeAllPerf(bars),
        rrg: computeRrg(bars, benchBars),
        ratio: rebased,
      };
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
