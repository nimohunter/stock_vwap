import { describe, it, expect } from 'vitest';
import { DailyBar } from './bars';
import { realizedDailyVol, fitLeverage, estimateLeveragedPrice } from './leveragedEstimate';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1_000_000 };
}

// Build a leveraged series that is EXACTLY 2× the underlying's daily move each day.
function makeSeries(underlyingReturns: number[], levFactor: number) {
  const dates = underlyingReturns.map((_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`);
  const u: DailyBar[] = [bar(dates[0], 100)];
  const l: DailyBar[] = [bar(dates[0], 10)];
  for (let i = 0; i < underlyingReturns.length; i++) {
    const r = underlyingReturns[i];
    u.push(bar(dates[i + 1], u[u.length - 1].close * (1 + r)));
    l.push(bar(dates[i + 1], l[l.length - 1].close * (1 + levFactor * r)));
  }
  return { u, l };
}

describe('realizedDailyVol', () => {
  it('returns null when not enough data', () => {
    expect(realizedDailyVol([1, 2, 3], 20)).toBeNull();
  });

  it('is zero for a flat series', () => {
    expect(realizedDailyVol(Array(30).fill(100), 20)).toBeCloseTo(0, 10);
  });
});

describe('fitLeverage', () => {
  it('recovers a clean 2× relationship with R²≈1', () => {
    const { u, l } = makeSeries([0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025], 2);
    const fit = fitLeverage(u, l)!;
    expect(fit.slope).toBeCloseTo(2, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.days).toBe(7);
  });

  it('only regresses over shared dates', () => {
    const { u, l } = makeSeries([0.01, -0.02, 0.03], 2);
    // Drop the underlying's first bar → one fewer aligned return.
    const fit = fitLeverage(u.slice(1), l)!;
    expect(fit.slope).toBeCloseTo(2, 6);
  });
});

describe('estimateLeveragedPrice', () => {
  const base = {
    underlyingNow: 100,
    levNow: 10,
    leverage: 2,
    dailyVol: 0,
    days: 1,
    expenseRatio: 0,
  };

  it('same-day: exactly 2× the daily move, no decay', () => {
    const r = estimateLeveragedPrice({ ...base, target: 110 }); // +10%
    expect(r.underlyingMovePct).toBeCloseTo(10, 9);
    expect(r.naivePct).toBeCloseTo(20, 9); // 2× move
    expect(r.naivePrice).toBeCloseTo(12, 9); // 10 × 1.20
  });

  it('with zero vol and zero cost, decay price uses compounding only', () => {
    const r = estimateLeveragedPrice({ ...base, target: 110, days: 10 });
    // (1.1)^2 = 1.21 → 12.10, no decay/cost drag applied
    expect(r.decayPrice).toBeCloseTo(12.1, 9);
  });

  it('volatility decay drags a multi-day hold below the naïve 2×', () => {
    const flat = estimateLeveragedPrice({ ...base, target: 100, dailyVol: 0.05, days: 10 });
    // Underlying unchanged (naive = levNow = 10), but 10 days of 5% daily vol erodes the fund.
    expect(flat.naivePrice).toBeCloseTo(10, 9);
    expect(flat.decayPrice).toBeLessThan(10);
    expect(flat.decayDragPct).toBeLessThan(0);
  });

  it('longer holds and higher vol increase the decay drag', () => {
    const short = estimateLeveragedPrice({ ...base, target: 105, dailyVol: 0.04, days: 3 });
    const long = estimateLeveragedPrice({ ...base, target: 105, dailyVol: 0.04, days: 21 });
    expect(long.decayDragPct).toBeLessThan(short.decayDragPct);
  });
});
