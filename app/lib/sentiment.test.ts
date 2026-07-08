import { describe, it, expect } from 'vitest';
import { DailyBar } from './alphavantage';
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

  it('preserves the existing output contract (backward compatible)', () => {
    const s = computeSentiment(uptrend)!;
    expect(s).not.toBeNull();
    // legacy fields
    expect(typeof s.score).toBe('number');
    expect(s.score100).toBeGreaterThanOrEqual(0);
    expect(s.score100).toBeLessThanOrEqual(100);
    expect(['Strong Sell', 'Sell', 'Neutral', 'Buy', 'Strong Buy']).toContain(s.label);
    expect(s.bullish + s.neutral + s.bearish).toBe(s.signals.length);
    expect(s.groups.length).toBeGreaterThan(0);
    // new additive fields
    expect(['uptrend', 'downtrend', 'neutral']).toContain(s.regime);
    expect(Array.isArray(s.divergences)).toBe(true);
    expect(s.extension).toBeDefined();
    expect(s.weights).toBeDefined();
  });
});

describe('computeSentiment — direction', () => {
  it('rates a steady uptrend bullish and a downtrend bearish', () => {
    expect(computeSentiment(uptrend)!.score).toBeGreaterThan(0);
    expect(computeSentiment(uptrend)!.regime).toBe('uptrend');
    expect(computeSentiment(downtrend)!.score).toBeLessThan(0);
    expect(computeSentiment(downtrend)!.regime).toBe('downtrend');
  });
});

describe('computeSentiment — config is honored', () => {
  it('weighting only the Trend bucket makes the score equal the Trend group score', () => {
    const s = computeSentiment(uptrend, { weights: { Trend: 1, Momentum: 0, 'Money Flow': 0 } })!;
    const trend = s.groups.find((g) => g.name === 'Trend')!;
    expect(s.score100).toBe(trend.score100);
  });

  it('label cutoffs are configurable', () => {
    const base = computeSentiment(uptrend)!;
    // Force everything at/above the current score to read "Strong Buy".
    const relabeled = computeSentiment(uptrend, {
      labels: { strongBuy: base.score - 0.001, buy: -1, sell: -1, strongSell: -1 },
    })!;
    expect(relabeled.label).toBe('Strong Buy');
  });

  it('disabling adaptive thresholds still yields a valid rating', () => {
    const s = computeSentiment(uptrend, { adaptive: { enabled: false } })!;
    expect(s.score).toBeGreaterThan(0);
    expect(s.score100).toBeGreaterThanOrEqual(0);
    expect(s.score100).toBeLessThanOrEqual(100);
  });
});

describe('computeSentiment — extension dampener', () => {
  it('reports extension context and dampens trend when price is stretched', () => {
    // Parabolic blow-off top: gentle base then a sharp vertical ramp far above EMA50.
    const base = Array.from({ length: 220 }, (_, i) => 100 + i * 0.1);
    const blowoff = Array.from({ length: 20 }, (_, i) => 122 + i * i); // accelerates hard
    const s = computeSentiment(makeBars([...base, ...blowoff]))!;
    expect(s.extension!.atrDistance).not.toBeNull();
    expect(s.extension!.atrDistance!).toBeGreaterThan(3); // well beyond the dampening threshold
    expect(s.extension!.dampener).toBeLessThan(1);
  });
});
