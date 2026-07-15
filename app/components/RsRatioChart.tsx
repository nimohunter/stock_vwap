'use client';

import { useMemo, useState } from 'react';
import { type MoneyFlowPayload, type Timeframe, TIMEFRAMES, startIndexForTimeframe } from '@/app/lib/moneyFlow';

interface Props {
  data: MoneyFlowPayload;
}

const W = 260;
const H = 64;
const PAD = 4;

/** One sector's relative-strength sparkline (RS ratio rebased to 100 at window start). */
function Sparkline({
  values,
  dates,
  color,
}: {
  values: (number | null)[];
  dates: string[];
  color: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const { d, x, y, lo, hi } = useMemo(() => {
    const nums = values.filter((v): v is number => v !== null);
    const lo = Math.min(100, ...nums);
    const hi = Math.max(100, ...nums);
    const span = hi - lo || 1;
    const n = values.length;
    const x = (i: number) => PAD + (i / Math.max(1, n - 1)) * (W - 2 * PAD);
    const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - 2 * PAD);
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return { d, x, y, lo, hi };
  }, [values]);

  const baselineY = y(100);
  const hv = hover !== null ? values[hover] : null;

  return (
    <div
      className="relative"
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;
        const i = Math.round(frac * (values.length - 1));
        setHover(i >= 0 && i < values.length ? i : null);
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-16 block">
        {/* 100 baseline = parity with the market */}
        <line x1={PAD} x2={W - PAD} y1={baselineY} y2={baselineY} stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
        <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
        {hover !== null && hv !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - PAD} stroke="#64748b" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(hv)} r={2.5} fill={color} />
          </>
        )}
      </svg>
      {hover !== null && hv !== null && (
        <div className="absolute top-0 left-0 text-[10px] bg-slate-900/90 border border-slate-700 rounded px-1.5 py-0.5 pointer-events-none tabular-nums text-slate-200">
          {dates[hover]} · {(hv - 100 >= 0 ? '+' : '') + (hv - 100).toFixed(2)}%
        </div>
      )}
      <div className="flex justify-between text-[9px] text-slate-600 tabular-nums px-0.5">
        <span>{lo.toFixed(1)}</span>
        <span>{hi.toFixed(1)}</span>
      </div>
    </div>
  );
}

const lastNonNull = (a: (number | null)[]): number | null => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null) return a[i];
  return null;
};

export default function RsRatioChart({ data }: Props) {
  const [tf, setTf] = useState<Timeframe>('1Y');

  const { rows, windowStart } = useMemo(() => {
    const start = startIndexForTimeframe(data.ratioDates, tf) ?? 0;
    const dates = data.ratioDates.slice(start);
    const rows = data.sectors
      .map((s) => {
        const slice = s.ratio.slice(start);
        const base = slice.find((v) => v != null) ?? null;
        // Rebase to 100 at the window start so every sector's line is comparable.
        const values = slice.map((v) => (v != null && base ? (v / base) * 100 : null));
        return { ticker: s.ticker, name: s.name, values, dates, end: lastNonNull(values) };
      })
      .sort((a, b) => (b.end ?? -Infinity) - (a.end ?? -Infinity));
    return { rows, windowStart: data.ratioDates[start] };
  }, [data, tf]);

  return (
    <section className="bg-slate-800 rounded-lg p-4">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Relative Strength vs {data.benchmark.ticker}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sector price ÷ S&amp;P 500, rebased to 100 at {windowStart}. Rising = gaining on the market; above 100 =
            outperforming over the window. Sorted strongest first.
          </p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-600 flex-wrap">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                tf === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
        {rows.map((r) => {
          const out = r.end != null && r.end >= 100;
          const tone = out ? 'text-emerald-400' : 'text-red-400';
          const line = out ? '#34d399' : '#f87171';
          return (
            <div key={r.ticker}>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block px-1.5 py-0.5 rounded bg-slate-900 border border-slate-600 text-[11px] font-bold tabular-nums text-slate-200">
                  {r.ticker}
                </span>
                <span className="text-xs text-slate-300 truncate flex-1">{r.name}</span>
                <span className={`text-xs font-semibold tabular-nums ${tone}`}>
                  {r.end != null ? `${r.end - 100 >= 0 ? '+' : ''}${(r.end - 100).toFixed(2)}%` : '—'}
                </span>
              </div>
              <Sparkline values={r.values} dates={r.dates} color={line} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
