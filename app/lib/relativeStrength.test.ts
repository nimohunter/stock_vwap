import { describe, it, expect } from 'vitest';
import { DailyBar } from './bars';
import { adxSeries, Series } from './indicators';
import {
  computeRsSeries,
  computeRelativeStrength,
  runEpisodeMachine,
  eventsToEpisodes,
  RS_DEFAULTS,
  RsConfig,
  RsThresholds,
} from './relativeStrength';

function bar(date: string, close: number, range = 0.5, volume = 1_000_000): DailyBar {
  return { date, open: close, high: close + range, low: close - range, close, volume };
}

function dates(n: number): string[] {
  // Synthetic sequential dates; weekends don't matter for the math.
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000);
    return d.toISOString().slice(0, 10);
  });
}

const fixedConfig: RsConfig = {
  ...RS_DEFAULTS,
  adaptive: { ...RS_DEFAULTS.adaptive, enabled: false },
};

function fixedThresholds(n: number): RsThresholds {
  return {
    obEnter: new Array(n).fill(60),
    obHard: new Array(n).fill(70),
    osEnter: new Array(n).fill(40),
    osHard: new Array(n).fill(30),
  };
}

describe('adxSeries', () => {
  it('is null through the warm-up region, then defined', () => {
    const n = 60;
    const bars = dates(n).map((d, i) => bar(d, 100 + i));
    const adx = adxSeries(bars, 14, 14);
    for (let i = 0; i < 27; i++) expect(adx[i]).toBeNull();
    expect(adx[27]).not.toBeNull();
  });

  it('reads high in a persistent trend and low in directionless chop', () => {
    const n = 120;
    const trending = dates(n).map((d, i) => bar(d, 100 + i * 2, 1));
    const choppy = dates(n).map((d, i) => bar(d, 100 + (i % 2 === 0 ? 1 : -1), 1));
    const adxTrend = adxSeries(trending)[n - 1] as number;
    const adxChop = adxSeries(choppy)[n - 1] as number;
    expect(adxTrend).toBeGreaterThan(40);
    expect(adxChop).toBeLessThan(20);
    expect(adxTrend).toBeGreaterThan(adxChop);
  });
});

describe('runEpisodeMachine', () => {
  const n = 12;
  const ds = dates(n);
  const flat = (v: number): Series => new Array(n).fill(v);

  it('fires obStart once on crossing the hard threshold and obEnd on decay', () => {
    const rsi: Series = [50, 55, 58, 72, 75, 76, 74, 65, 55, 50, 50, 50];
    const { events } = runEpisodeMachine(ds, rsi, flat(30), flat(50), fixedThresholds(n), fixedConfig);
    expect(events).toEqual([
      { date: ds[3], type: 'obStart' },
      { date: ds[8], type: 'obEnd' }, // rsi 55 < enter 60
    ]);
  });

  it('suppresses starts when ADX is below the gate (filterWeak)', () => {
    const rsi: Series = [50, 55, 58, 72, 75, 76, 74, 65, 55, 50, 50, 50];
    const { events, state } = runEpisodeMachine(ds, rsi, flat(10), flat(50), fixedThresholds(n), fixedConfig);
    expect(events).toEqual([]);
    expect(state).toBe('neutral');

    const noFilter = { ...fixedConfig, filterWeak: false };
    const open = runEpisodeMachine(ds, rsi, flat(10), flat(50), fixedThresholds(n), noFilter);
    expect(open.events[0]).toEqual({ date: ds[3], type: 'obStart' });
  });

  it('ends an overbought episode early when ADX rolls over below the hard line', () => {
    const rsi: Series = [50, 72, 68, 68, 68, 68, 68, 68, 68, 68, 68, 68];
    const adx: Series = [30, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20];
    const { events } = runEpisodeMachine(ds, rsi, adx, flat(50), fixedThresholds(n), fixedConfig);
    // rsi stays above enter (60) but below hard (70) while ADX falls → end fires at ds[2]
    expect(events).toEqual([
      { date: ds[1], type: 'obStart' },
      { date: ds[2], type: 'obEnd' },
    ]);
  });

  it('fires oversold episodes and extreme flags on the rising edge only', () => {
    const rsi: Series = [50, 25, 25, 25, 25, 25, 25, 45, 50, 50, 50, 50];
    const mfi: Series = [50, 15, 15, 15, 25, 15, 15, 50, 50, 50, 50, 50];
    const { events } = runEpisodeMachine(ds, rsi, flat(30), mfi, fixedThresholds(n), fixedConfig);
    expect(events).toEqual([
      { date: ds[1], type: 'osStart' },
      { date: ds[1], type: 'osExtreme' }, // rsi<30, mfi<20, adx>25
      { date: ds[5], type: 'osExtreme' }, // re-fires after the mfi break at ds[4]
      { date: ds[7], type: 'osEnd' },
    ]);
  });

  it('flips directly from oversold to overbought, closing the old episode', () => {
    const rsi: Series = [50, 25, 25, 75, 75, 55, 50, 50, 50, 50, 50, 50];
    const { events } = runEpisodeMachine(ds, rsi, flat(30), flat(50), fixedThresholds(n), fixedConfig);
    expect(events).toEqual([
      { date: ds[1], type: 'osStart' },
      { date: ds[3], type: 'obStart' },
      { date: ds[3], type: 'osEnd' },
      { date: ds[5], type: 'obEnd' },
    ]);
  });
});

describe('eventsToEpisodes', () => {
  it('pairs starts with ends and leaves an open episode running to the last bar', () => {
    const spans = eventsToEpisodes(
      [
        { date: '2025-01-05', type: 'osStart' },
        { date: '2025-01-05', type: 'osExtreme' }, // extremes don't affect spans
        { date: '2025-02-01', type: 'osEnd' },
        { date: '2025-03-10', type: 'obStart' },
        { date: '2025-04-01', type: 'obEnd' },
        { date: '2025-06-01', type: 'obStart' },
      ],
      '2025-07-01',
    );
    expect(spans).toEqual([
      { from: '2025-01-05', to: '2025-02-01', kind: 'os', ongoing: false },
      { from: '2025-03-10', to: '2025-04-01', kind: 'ob', ongoing: false },
      { from: '2025-06-01', to: '2025-07-01', kind: 'ob', ongoing: true },
    ]);
  });

  it('handles a direct oversold→overbought flip (same-date start and end)', () => {
    const spans = eventsToEpisodes(
      [
        { date: '2025-01-05', type: 'osStart' },
        { date: '2025-02-01', type: 'obStart' },
        { date: '2025-02-01', type: 'osEnd' },
        { date: '2025-03-01', type: 'obEnd' },
      ],
      '2025-07-01',
    );
    expect(spans).toEqual([
      { from: '2025-01-05', to: '2025-02-01', kind: 'os', ongoing: false },
      { from: '2025-02-01', to: '2025-03-01', kind: 'ob', ongoing: false },
    ]);
  });
});

describe('computeRsSeries / computeRelativeStrength', () => {
  it('aligns by date intersection and needs minBars of overlap', () => {
    const ds = dates(150);
    const stock = ds.map((d, i) => bar(d, 100 + i));
    const bench = ds.slice(60).map((d, i) => bar(d, 200 + i)); // only 90 overlapping
    expect(computeRsSeries(stock, bench, { ...fixedConfig, minBars: 100 })).toBeNull();
    const ok = computeRsSeries(stock, bench, { ...fixedConfig, minBars: 80 });
    expect(ok).not.toBeNull();
    expect(ok!.dates.length).toBe(90);
    expect(ok!.dates[0]).toBe(ds[60]);
  });

  it('reads overbought when the stock persistently outperforms the benchmark', () => {
    const n = 300;
    const ds = dates(n);
    // Stock compounds 0.4%/day vs a flat benchmark → ratio rises steadily.
    const stock = ds.map((d, i) => bar(d, 100 * Math.pow(1.004, i), 0.8));
    const bench = ds.map((d) => bar(d, 400, 1));
    const rs = computeRelativeStrength(stock, bench, fixedConfig);
    expect(rs).not.toBeNull();
    expect(rs!.state).toBe('overbought');
    expect(rs!.trendStrength).toBe('strong');
    expect(rs!.relPerf).toBeGreaterThan(0);
    expect(rs!.rsi).toBeGreaterThan(70);
    expect(rs!.events.some((e) => e.type === 'obStart')).toBe(true);
  });

  it('is symmetric: persistent underperformance reads oversold', () => {
    const n = 300;
    const ds = dates(n);
    const stock = ds.map((d, i) => bar(d, 100 * Math.pow(0.996, i), 0.8));
    const bench = ds.map((d) => bar(d, 400, 1));
    const rs = computeRelativeStrength(stock, bench, fixedConfig);
    expect(rs).not.toBeNull();
    expect(rs!.state).toBe('oversold');
    expect(rs!.relPerf).toBeLessThan(0);
  });
});
