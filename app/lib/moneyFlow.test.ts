import { describe, it, expect } from 'vitest';
import { DailyBar } from './bars';
import {
  computePerf,
  computeAllPerf,
  computeRatioSeries,
  computeRrg,
  rrgFromRatioSeries,
  startIndexForTimeframe,
  quadrantOf,
  rrgSeriesFromRatio,
  RRG_DEFAULTS,
  RRG_CONFIGS,
  RRG_TIMEFRAMES,
  TIMEFRAMES,
} from './moneyFlow';

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1_000_000 };
}

/** Daily bars for `n` calendar days (weekends included — fine for this math). */
function seq(startYmd: string, n: number, price: (i: number) => number): DailyBar[] {
  const start = new Date(startYmd + 'T00:00:00Z').getTime();
  return Array.from({ length: n }, (_, i) =>
    bar(new Date(start + i * 86400000).toISOString().slice(0, 10), price(i)),
  );
}

describe('computePerf', () => {
  it('computes 1D change from the previous bar', () => {
    const bars = [bar('2026-01-05', 100), bar('2026-01-06', 110)];
    const p = computePerf(bars, '1D');
    expect(p.start).toBe(100);
    expect(p.last).toBe(110);
    expect(p.changeAbs).toBeCloseTo(10);
    expect(p.changePct).toBeCloseTo(0.1);
  });

  it('anchors calendar timeframes on the last bar on-or-before the lookback date', () => {
    const bars = seq('2026-01-01', 200, () => 100);
    bars[bars.length - 1] = bar(bars[bars.length - 1].date, 120);
    const p = computePerf(bars, '1M');
    // ~1 month back the price was still 100.
    expect(p.start).toBe(100);
    expect(p.changePct).toBeCloseTo(0.2);
    expect(p.startDate).not.toBeNull();
  });

  it('baselines YTD on the prior year final close', () => {
    // Dec 2025 into Jan 2026.
    const bars = [
      bar('2025-12-29', 90),
      bar('2025-12-30', 95),
      bar('2025-12-31', 100), // prior-year final close → YTD baseline
      bar('2026-01-02', 105),
      bar('2026-01-05', 110),
    ];
    const p = computePerf(bars, 'YTD');
    expect(p.startDate).toBe('2025-12-31');
    expect(p.start).toBe(100);
    expect(p.changePct).toBeCloseTo(0.1);
  });

  it('returns null change when history is too short for the window', () => {
    const bars = seq('2026-06-01', 10, () => 100);
    const p = computePerf(bars, '1Y');
    expect(p.start).toBeNull();
    expect(p.changePct).toBeNull();
    expect(p.last).toBe(100);
  });

  it('produces one entry per timeframe', () => {
    const bars = seq('2024-01-01', 400, (i) => 100 + i * 0.1);
    const all = computeAllPerf(bars);
    expect(all.map((p) => p.timeframe)).toEqual(TIMEFRAMES);
  });
});

describe('startIndexForTimeframe', () => {
  it('returns the prior trading day for 1D and 5 back for 5D', () => {
    const dates = seq('2026-01-01', 30, () => 0).map((b) => b.date);
    expect(startIndexForTimeframe(dates, '1D')).toBe(dates.length - 2);
    expect(startIndexForTimeframe(dates, '5D')).toBe(dates.length - 6);
  });

  it('anchors YTD on the prior year final date', () => {
    const dates = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05'];
    expect(startIndexForTimeframe(dates, 'YTD')).toBe(1); // 2025-12-31
  });

  it('returns null when the window predates all data', () => {
    const dates = seq('2026-06-01', 5, () => 0).map((b) => b.date);
    expect(startIndexForTimeframe(dates, '1Y')).toBeNull();
  });
});

describe('computeRatioSeries', () => {
  it('aligns by date and drops bars with no benchmark', () => {
    const sector = [bar('2026-01-05', 50), bar('2026-01-06', 55), bar('2026-01-07', 60)];
    const bench = [bar('2026-01-05', 100), bar('2026-01-07', 100)]; // no 01-06
    const { dates, ratio } = computeRatioSeries(sector, bench);
    expect(dates).toEqual(['2026-01-05', '2026-01-07']);
    expect(ratio).toEqual([50, 60]); // 100 × 50/100, 100 × 60/100
  });
});

describe('quadrantOf', () => {
  it('maps the four rotation phases', () => {
    expect(quadrantOf(101, 101)).toBe('Leading');
    expect(quadrantOf(101, 99)).toBe('Weakening');
    expect(quadrantOf(99, 99)).toBe('Lagging');
    expect(quadrantOf(99, 101)).toBe('Improving');
  });
});

describe('rrgSeriesFromRatio', () => {
  it('centres RS-Ratio near 100 and rises for a steadily outperforming ratio', () => {
    // Steadily increasing ratio → most recent z-scores positive → RS-Ratio > 100.
    const ratio = Array.from({ length: 120 }, (_, i) => 100 + i);
    const { rsRatio, rsMomentum } = rrgSeriesFromRatio(ratio, RRG_DEFAULTS);
    const lastR = rsRatio[rsRatio.length - 1];
    const lastM = rsMomentum[rsMomentum.length - 1];
    expect(lastR).not.toBeNull();
    expect(lastM).not.toBeNull();
    expect(lastR as number).toBeGreaterThan(100);
  });

  it('leaves values null until the normalization window fills', () => {
    const ratio = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i));
    const { rsRatio } = rrgSeriesFromRatio(ratio, RRG_DEFAULTS);
    expect(rsRatio[0]).toBeNull();
    expect(rsRatio[RRG_DEFAULTS.window - 2]).toBeNull();
  });
});

describe('computeRrg', () => {
  it('returns a tail and a quadrant for a sector outperforming the benchmark', () => {
    const bench = seq('2024-01-01', 200, () => 100);
    const sector = seq('2024-01-01', 200, (i) => 50 + i * 0.2); // rising vs flat bench
    const rrg = computeRrg(sector, bench);
    expect(rrg).not.toBeNull();
    expect(rrg!.tail.length).toBeGreaterThan(0);
    expect(rrg!.tail[rrg!.tail.length - 1].rsRatio).toBeCloseTo(rrg!.rsRatio);
    expect(['Leading', 'Weakening', 'Lagging', 'Improving']).toContain(rrg!.quadrant);
  });

  it('returns null with too little overlapping history', () => {
    const bench = seq('2026-01-01', 20, () => 100);
    const sector = seq('2026-01-01', 20, (i) => 100 + i);
    expect(computeRrg(sector, bench)).toBeNull();
  });
});

describe('rrgFromRatioSeries + RRG_CONFIGS', () => {
  it('has a config for every offered duration', () => {
    for (const tf of RRG_TIMEFRAMES) expect(RRG_CONFIGS[tf]).toBeDefined();
  });

  it('computes a reading from an aligned ratio series for each duration', () => {
    const n = 300;
    const dates = seq('2024-01-01', n, () => 0).map((b) => b.date);
    const ratio = Array.from({ length: n }, (_, i) => 100 + i * 0.1); // steadily rising RS
    for (const tf of RRG_TIMEFRAMES) {
      const cfg = RRG_CONFIGS[tf];
      const res = rrgFromRatioSeries(dates, ratio, cfg);
      expect(res).not.toBeNull();
      expect(res!.tail.length).toBeGreaterThan(0);
      expect(['Leading', 'Weakening', 'Lagging', 'Improving']).toContain(res!.quadrant);
    }
  });

  it('handles a nullable ratio series (leading + trailing gaps) via the last valid tail', () => {
    const n = 300;
    const dates = seq('2024-01-01', n, () => 0).map((b) => b.date);
    const ratio: (number | null)[] = Array.from({ length: n }, (_, i) => 100 + i * 0.1);
    ratio[0] = null; // leading gap (young ETF)
    ratio[n - 1] = null; // trailing gap (sector lags the benchmark by a day)
    const res = rrgFromRatioSeries(dates, ratio, RRG_CONFIGS['3M']);
    expect(res).not.toBeNull();
    expect(res!.tail.length).toBeGreaterThan(0);
    // The current reading falls back to the last non-null point, not the null tail head.
    expect(res!.tail[res!.tail.length - 1].date).not.toBe(dates[n - 1]);
  });

  it('returns null when history is below the (accurate) warmup requirement', () => {
    const cfg = RRG_CONFIGS['1Y'];
    const need = 2 * cfg.window + 2 * cfg.smooth + cfg.momentumPeriod;
    const short = need - 10;
    const dates = seq('2024-01-01', short, () => 0).map((b) => b.date);
    const ratio = Array.from({ length: short }, (_, i) => 100 + i * 0.1);
    expect(rrgFromRatioSeries(dates, ratio, cfg)).toBeNull();
  });

  it('matches computeRrg for the same underlying ratio', () => {
    const bench = seq('2024-01-01', 200, () => 100);
    const sector = seq('2024-01-01', 200, (i) => 50 + i * 0.2);
    const viaBars = computeRrg(sector, bench);
    const { dates, ratio } = computeRatioSeries(sector, bench);
    const viaRatio = rrgFromRatioSeries(dates, ratio);
    expect(viaRatio).not.toBeNull();
    expect(viaRatio!.rsRatio).toBeCloseTo(viaBars!.rsRatio);
    expect(viaRatio!.quadrant).toBe(viaBars!.quadrant);
  });
});
