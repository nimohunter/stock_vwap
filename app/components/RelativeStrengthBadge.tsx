'use client';

import { RsResult } from '@/app/lib/relativeStrength';

interface Props {
  symbol: string;
  rs: RsResult;
}

const STATE_STYLE: Record<RsResult['state'], { label: string; cls: string }> = {
  overbought: { label: 'RS Overbought', cls: 'bg-red-500/15 text-red-300' },
  oversold: { label: 'RS Oversold', cls: 'bg-teal-500/15 text-teal-300' },
  neutral: { label: 'RS Neutral', cls: 'bg-slate-600/30 text-slate-400' },
};

export default function RelativeStrengthBadge({ symbol, rs }: Props) {
  const state = STATE_STYLE[rs.state];
  const perfs = rs.relPerf.filter((p) => p.value !== null);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex flex-col gap-1.5 min-w-[220px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-500">Relative Strength vs {rs.benchmark}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${state.cls}`}>
          {rs.extreme ? `${state.label} · Extreme` : state.label}
        </span>
      </div>

      {perfs.length > 0 && (
        <div className="flex items-stretch gap-2" title={`Change in the ${symbol}/${rs.benchmark} price ratio over each window — positive = outperforming the market.`}>
          {perfs.map((p) => {
            const up = (p.value as number) >= 0;
            return (
              <div key={p.label} className="flex-1 rounded bg-slate-900/40 px-2 py-1">
                <div className="text-[10px] text-slate-500">{p.label} vs {rs.benchmark}</div>
                <div className={`text-sm font-bold tabular-nums ${up ? 'text-green-400' : 'text-red-400'}`}>
                  {up ? '+' : ''}
                  {((p.value as number) * 100).toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        className="text-[11px] text-slate-500 tabular-nums"
        title={`RSI and ADX computed on the price ratio ${symbol}/${rs.benchmark} — "is the outperformance itself stretched, and how strong is the relative trend?" Overbought/oversold thresholds are adaptive percentiles of the ratio-RSI's own history (currently ${rs.thresholds.osEnter.toFixed(0)}/${rs.thresholds.obEnter.toFixed(0)}).`}
      >
        r-RSI {rs.rsi.toFixed(1)} · r-ADX {rs.adx.toFixed(1)}{' '}
        <span className={rs.trendStrength === 'strong' ? 'text-green-400' : 'text-slate-500'}>
          ({rs.trendStrength} relative trend)
        </span>
      </div>
    </div>
  );
}
