import { describe, it, expect } from 'vitest';
import { DailyBar } from './bars';
import { computeSentiment } from './sentiment';

function makeBars(closes: number[]): DailyBar[] {
  return closes.map((c, i) => ({
    date: `2023-${String((Math.floor(i / 28) % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    open: i === 0 ? c : closes[i - 1],
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1_000_000,
  }));
}

const uptrend = makeBars(Array.from({ length: 260 }, (_, i) => 100 + i)); // steady rise
const downtrend = makeBars(Array.from({ length: 260 }, (_, i) => 400 - i)); // steady fall

describe('computeSentiment — guards & contract', () => {
  it('returns null below minBars', () => {
    expect(computeSentiment(makeBars([1, 2, 3, 4, 5]))).toBeNull();
  });

  it('exposes the two-group TradingView-style contract', () => {
    const s = computeSentiment(uptrend)!;
    expect(s).not.toBeNull();
    expect(typeof s.score).toBe('number');
    expect(s.score).toBeGreaterThanOrEqual(-1);
    expect(s.score).toBeLessThanOrEqual(1);
    expect(['Strong Sell', 'Sell', 'Neutral', 'Buy', 'Strong Buy']).toContain(s.label);
    expect(s.bullish + s.neutral + s.bearish).toBe(s.signals.length);
    expect(s.groups.map((g) => g.name).sort()).toEqual(['Moving Averages', 'Oscillators']);
    for (const g of s.groups) {
      expect(g.score).toBeGreaterThanOrEqual(-1);
      expect(g.score).toBeLessThanOrEqual(1);
      expect(g.bullish + g.neutral + g.bearish).toBe(s.signals.filter((x) => x.group === g.name).length);
    }
    expect(['uptrend', 'downtrend', 'neutral']).toContain(s.regime);
    expect(Array.isArray(s.divergences)).toBe(true);
    expect(s.extension).toBeDefined();
    expect(typeof s.extension.stretched).toBe('boolean');
    expect(s.weights).toBeDefined();
  });
});

describe('computeSentiment — direction', () => {
  it('rates a steady uptrend a strong buy with maxed MA group, downtrend the mirror', () => {
    const up = computeSentiment(uptrend)!;
    expect(up.score).toBeGreaterThan(0);
    expect(up.regime).toBe('uptrend');
    // Every MA vote (price above the whole ladder + rising stack + above VWAP) is bullish.
    expect(up.groups.find((g) => g.name === 'Moving Averages')!.score).toBe(1);
    expect(up.label).toBe('Strong Buy');

    const down = computeSentiment(downtrend)!;
    expect(down.score).toBeLessThan(0);
    expect(down.regime).toBe('downtrend');
    expect(down.groups.find((g) => g.name === 'Moving Averages')!.score).toBe(-1);
  });
});

describe('computeSentiment — config is honored', () => {
  it('weighting only Moving Averages makes the score equal the MA group rating', () => {
    const s = computeSentiment(uptrend, { weights: { 'Moving Averages': 1, Oscillators: 0 } })!;
    const ma = s.groups.find((g) => g.name === 'Moving Averages')!;
    expect(s.score).toBeCloseTo(ma.score, 10);
  });

  it('label cutoffs are configurable', () => {
    const base = computeSentiment(uptrend)!;
    const relabeled = computeSentiment(uptrend, {
      labels: { strongBuy: 2, buy: base.score - 0.001, sell: -1, strongSell: -1 },
    })!;
    expect(relabeled.label).toBe('Buy');
  });

  it('disabling adaptive thresholds still yields a valid rating', () => {
    const s = computeSentiment(uptrend, { adaptive: { enabled: false } })!;
    expect(s.score).toBeGreaterThanOrEqual(-1);
    expect(s.score).toBeLessThanOrEqual(1);
  });
});

describe('computeSentiment — oscillator direction rule', () => {
  it('oversold + turning up votes bullish; oversold + still falling does not', () => {
    // Long gentle uptrend to seed history, then a sharp dip that starts recovering on
    // the very last bar → RSI is low but rising.
    const baseLen = 240;
    const base = Array.from({ length: baseLen }, (_, i) => 100 + i * 0.5);
    const dip = [200, 180, 160, 150, 158]; // last bar ticks back up
    const recovering = computeSentiment(makeBars([...base, ...dip]))!;
    const rsiSigRec = recovering.signals.find((s) => s.name === 'RSI (14)')!;
    expect(rsiSigRec.verdict).toBe('bullish');

    // Same dip but the last bar is still falling → RSI low and NOT rising → neutral.
    const stillFalling = computeSentiment(makeBars([...base, 200, 180, 160, 150, 142]))!;
    const rsiSigFall = stillFalling.signals.find((s) => s.name === 'RSI (14)')!;
    expect(rsiSigFall.verdict).toBe('neutral');
  });
});

describe('computeSentiment — extension badge (no longer dampens the score)', () => {
  it('flags stretched when price is far from EMA50 in ATR units', () => {
    const base = Array.from({ length: 220 }, (_, i) => 100 + i * 0.1);
    const blowoff = Array.from({ length: 20 }, (_, i) => 122 + i * i); // accelerates hard
    const s = computeSentiment(makeBars([...base, ...blowoff]))!;
    expect(s.extension.atrDistance).not.toBeNull();
    expect(Math.abs(s.extension.atrDistance!)).toBeGreaterThan(3);
    expect(s.extension.stretched).toBe(true);
  });
});
