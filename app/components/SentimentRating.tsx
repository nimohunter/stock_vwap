'use client';

import { useMemo, useState } from 'react';
import { DailyBar } from '@/app/lib/alphavantage';
import { computeSentiment, Verdict } from '@/app/lib/sentiment';

interface Props {
  symbol: string;
  bars: DailyBar[];
}

function labelColor(score: number): { text: string; bg: string } {
  if (score >= 0.5) return { text: 'text-green-400', bg: 'bg-green-500' };
  if (score >= 0.15) return { text: 'text-lime-400', bg: 'bg-lime-500' };
  if (score > -0.15) return { text: 'text-yellow-400', bg: 'bg-yellow-500' };
  if (score > -0.5) return { text: 'text-orange-400', bg: 'bg-orange-500' };
  return { text: 'text-red-400', bg: 'bg-red-500' };
}

const DOT: Record<Verdict, string> = {
  bullish: 'bg-green-500',
  neutral: 'bg-slate-500',
  bearish: 'bg-red-500',
};

export default function SentimentRating({ symbol, bars }: Props) {
  const [open, setOpen] = useState(false);
  const sentiment = useMemo(() => computeSentiment(bars), [bars]);

  if (!sentiment) return null;

  const c = labelColor(sentiment.score);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg">
      <div className="px-4 py-3 flex items-center gap-4">
        {/* Score badge */}
        <div className="flex flex-col items-center justify-center shrink-0 w-14">
          <span className={`text-3xl font-bold leading-none ${c.text}`}>{sentiment.score100}</span>
          <span className="text-[10px] text-slate-500 mt-0.5">/ 100</span>
        </div>

        {/* Label + gauge */}
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm font-semibold ${c.text} flex items-center gap-2`}>
              {symbol} · {sentiment.label}
              {sentiment.divergenceFlag && (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                    sentiment.divergenceFlag.startsWith('Bullish')
                      ? 'bg-teal-500/15 text-teal-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}
                  title="Trend and internals disagree — see breakdown"
                >
                  ⚠ {sentiment.divergenceFlag}
                </span>
              )}
            </span>
            <span className="text-[11px] text-slate-500">Technical Sentiment</span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500">
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-slate-900 shadow"
              style={{ left: `${sentiment.score100}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-slate-600 mt-1">
            <span>Strong Sell</span>
            <span>Strong Buy</span>
          </div>
        </div>

        {/* Vote tally + toggle */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[11px] tabular-nums text-slate-400">
            <span className="text-green-400">{sentiment.bullish}▲</span>{' '}
            <span className="text-slate-500">{sentiment.neutral}•</span>{' '}
            <span className="text-red-400">{sentiment.bearish}▼</span>
          </span>
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
            aria-expanded={open}
          >
            {open ? 'hide' : 'signals'}
          </button>
        </div>
      </div>

      {/* Signal breakdown, organized by weighted group */}
      {open && (
        <div className="border-t border-slate-700 px-4 py-3 space-y-3 text-xs">
          {/* Divergence + extension context */}
          {(sentiment.divergences?.length || sentiment.extension) && (
            <div className="space-y-1.5 pb-1">
              {sentiment.divergences?.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${d.direction === 'bullish' ? 'bg-teal-400' : 'bg-amber-400'}`}
                  />
                  <span className="w-40 shrink-0 text-slate-300">
                    {d.kind === 'bucket' ? 'Bucket divergence' : d.kind === 'price-rsi' ? 'Price/RSI' : 'Price/MFI'}
                  </span>
                  <span className="flex-1 text-slate-500">{d.detail}</span>
                  <span className={d.direction === 'bullish' ? 'text-teal-300' : 'text-amber-300'}>{d.direction}</span>
                </div>
              ))}
              {sentiment.extension && (
                <div className="flex items-center gap-2 text-slate-500">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-slate-600" />
                  <span className="w-40 shrink-0 text-slate-400">Extension</span>
                  <span className="flex-1">
                    {sentiment.regime && <>regime {sentiment.regime} · </>}
                    {sentiment.extension.atrDistance !== null && (
                      <>{sentiment.extension.atrDistance.toFixed(1)} ATR from EMA50 · </>
                    )}
                    {sentiment.extension.bbPercentB !== null && <>%B {sentiment.extension.bbPercentB.toFixed(2)}</>}
                  </span>
                  {sentiment.extension.dampener < 1 && (
                    <span className="text-amber-300">trend ×{sentiment.extension.dampener.toFixed(2)}</span>
                  )}
                </div>
              )}
            </div>
          )}
          {sentiment.groups.map((g) => (
            <div key={g.name} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-semibold">{g.name}</span>
                <span className={`tabular-nums ${labelColor((g.score100 / 50) - 1).text}`}>{g.score100}/100</span>
              </div>
              {sentiment.signals
                .filter((s) => s.group === g.name)
                .map((s) => (
                  <div key={s.name} className="flex items-center gap-2 pl-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[s.verdict]}`} />
                    <span className="w-40 shrink-0 text-slate-400">{s.name}</span>
                    <span className="flex-1 text-slate-500">{s.detail}</span>
                    <span
                      className={`capitalize ${
                        s.verdict === 'bullish'
                          ? 'text-green-400'
                          : s.verdict === 'bearish'
                            ? 'text-red-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {s.verdict}
                    </span>
                  </div>
                ))}
            </div>
          ))}
          <p className="text-[11px] text-slate-500 pt-1">
            Weighted blend of three groups — Trend (collinear MA/VWAP signals collapsed to avoid double-counting, then
            dampened when price is stretched), Momentum and Money Flow (oscillators use the stock&apos;s own recent
            percentile thresholds, read relative to trend). Divergences are flagged separately, not folded into the
            score. Derived from price/volume only — not analyst or news sentiment.
          </p>
          <p className="text-[11px] text-amber-500/80">
            Caveat: on ~2y of history this score showed ≈zero rank correlation with forward returns and was contrarian
            at short horizons (extreme readings often mean-revert). Treat it as a technical snapshot, not a return
            forecast. Not investment advice.
          </p>
        </div>
      )}
    </div>
  );
}
