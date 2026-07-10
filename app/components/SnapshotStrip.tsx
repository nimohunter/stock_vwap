'use client';

import { useMemo, useState } from 'react';
import { DailyBar } from '@/app/lib/alphavantage';
import { rsiSeries, atrSeries, dmiSeries, lastVal } from '@/app/lib/indicators';
import { computeEMA } from '@/app/lib/vwap';

interface Props {
  symbol: string;
  bars: DailyBar[];
}

function Chip({ label, value, tone = 'text-slate-200', hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <span className="flex items-baseline gap-1.5 bg-slate-800 border border-slate-700 rounded px-2.5 py-1" title={hint}>
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${tone}`}>{value}</span>
    </span>
  );
}

const pctTone = (v: number) => (v >= 0 ? 'text-green-400' : 'text-red-400');
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

export default function SnapshotStrip({ symbol, bars }: Props) {
  const [copied, setCopied] = useState(false);

  const snap = useMemo(() => {
    if (bars.length < 60) return null;
    const n = bars.length;
    const last = bars[n - 1];
    const ret = (d: number) => last.close / bars[n - 1 - d].close - 1;

    const emaLast = (w: number) => {
      const s = computeEMA(bars, w);
      return s.length ? s[s.length - 1].value : null;
    };
    const e10 = emaLast(10);
    const e20 = emaLast(20);
    const e50 = emaLast(50);
    const stack =
      e10 !== null && e20 !== null && e50 !== null
        ? e10 > e20 && e20 > e50
          ? 'bullish'
          : e10 < e20 && e20 < e50
            ? 'bearish'
            : 'mixed'
        : null;

    const closes = bars.map((b) => b.close);
    const rsi = rsiSeries(closes, 14);
    const rsiNow = lastVal(rsi);
    const rsiPrev = rsi[n - 6] ?? null;

    const { adx, plusDi, minusDi } = dmiSeries(bars, 14, 14);
    const adxNow = lastVal(adx);
    const pDi = lastVal(plusDi);
    const mDi = lastVal(minusDi);

    const atrNow = lastVal(atrSeries(bars, 14));

    let volSum = 0;
    for (let i = n - 21; i < n - 1; i++) volSum += bars[i].volume;
    const volRatio = volSum > 0 ? last.volume / (volSum / 20) : null;

    return {
      d1: ret(1),
      d5: ret(5),
      d10: ret(10),
      stack,
      rsiNow,
      rsiDir: rsiNow !== null && rsiPrev !== null ? (rsiNow > rsiPrev ? '↗' : '↘') : '',
      adxNow,
      diBull: pDi !== null && mDi !== null ? pDi >= mDi : null,
      atrNow,
      atrPct: atrNow !== null ? atrNow / last.close : null,
      volRatio,
    };
  }, [bars]);

  const copyPrompt = async () => {
    try {
      const res = await fetch(`/api/analysis-prompt?symbol=${symbol}`);
      if (!res.ok) throw new Error(await res.text());
      await navigator.clipboard.writeText(await res.text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!snap) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <Chip label="1D" value={pct(snap.d1)} tone={pctTone(snap.d1)} />
      <Chip label="5D" value={pct(snap.d5)} tone={pctTone(snap.d5)} />
      <Chip label="10D" value={pct(snap.d10)} tone={pctTone(snap.d10)} />
      {snap.stack && (
        <Chip
          label="EMA 10/20/50"
          value={snap.stack}
          tone={snap.stack === 'bullish' ? 'text-green-400' : snap.stack === 'bearish' ? 'text-red-400' : 'text-slate-300'}
          hint="Stacking order of the 10/20/50-day EMAs"
        />
      )}
      {snap.rsiNow !== null && (
        <Chip
          label="RSI 14"
          value={`${snap.rsiNow.toFixed(1)} ${snap.rsiDir}`}
          tone={snap.rsiNow >= 70 ? 'text-red-400' : snap.rsiNow <= 30 ? 'text-green-400' : 'text-slate-200'}
          hint="Arrow = direction vs 5 bars ago"
        />
      )}
      {snap.adxNow !== null && (
        <Chip
          label="ADX 14"
          value={`${snap.adxNow.toFixed(1)} ${snap.adxNow >= 25 ? 'strong' : snap.adxNow >= 20 ? 'moderate' : 'weak'}${snap.diBull !== null ? (snap.diBull ? ' · +DI' : ' · −DI') : ''}`}
          tone={snap.adxNow >= 25 ? (snap.diBull ? 'text-green-400' : 'text-red-400') : 'text-slate-300'}
          hint="Trend strength; +DI/−DI shows which directional line leads"
        />
      )}
      {snap.atrNow !== null && (
        <Chip
          label="ATR 14"
          value={`$${snap.atrNow.toFixed(2)} (${(snap.atrPct! * 100).toFixed(1)}%)`}
          hint="Average daily true range — stop-loss / position-sizing context"
        />
      )}
      {snap.volRatio !== null && (
        <Chip
          label="Vol"
          value={`${snap.volRatio.toFixed(2)}× 20d avg`}
          tone={snap.volRatio >= 1.5 ? 'text-amber-300' : 'text-slate-200'}
        />
      )}
      <button
        onClick={copyPrompt}
        className="ml-auto text-[11px] px-2.5 py-1 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
        title="Copies a full LLM analysis prompt (120-day technicals + fundamentals) to the clipboard — paste into any AI chat"
      >
        {copied ? '✓ Copied' : '⧉ Copy AI analysis prompt'}
      </button>
    </div>
  );
}
