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
  const outperf = rs.relPerf !== null && rs.relPerf >= 0;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex flex-col gap-1.5 min-w-[220px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-500">Relative Strength vs {rs.benchmark}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${state.cls}`}>
          {rs.extreme ? `${state.label} · Extreme` : state.label}
        </span>
      </div>

      {rs.relPerf !== null && (
        <div className="flex items-baseline gap-2">
          <span className={`text-xl font-bold leading-none ${outperf ? 'text-green-400' : 'text-red-400'}`}>
            {outperf ? '+' : ''}
            {(rs.relPerf * 100).toFixed(1)}%
          </span>
          <span className="text-xs text-slate-400">
            3M vs {rs.benchmark} · {outperf ? 'outperforming' : 'underperforming'}
          </span>
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
