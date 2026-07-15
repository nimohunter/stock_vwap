'use client';

import { useMemo, useState } from 'react';
import {
  type MoneyFlowPayload,
  type Perf,
  type Timeframe,
  TIMEFRAMES,
} from '@/app/lib/moneyFlow';

interface Props {
  data: MoneyFlowPayload;
}

const TF_LABEL: Record<Timeframe, string> = {
  '1D': '1 Day',
  '5D': '5 Day',
  '1M': '1 Month',
  '3M': '3 Month',
  '6M': '6 Month',
  YTD: 'YTD',
  '1Y': '1 Year',
};

const perfFor = (perf: Perf[], tf: Timeframe) => perf.find((p) => p.timeframe === tf)!;
const fmtPrice = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAbs = (v: number) => `${v >= 0 ? '+' : ''}${fmtPrice(v)}`;
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

/** Center-anchored bar: green extends right, red left, scaled to the row set's max move. */
function ChangeBar({ pct, max }: { pct: number; max: number }) {
  const frac = max > 0 ? Math.min(1, Math.abs(pct) / max) : 0;
  const up = pct >= 0;
  return (
    <div className="flex items-center h-4 w-full min-w-[80px]">
      <div className="flex-1 flex justify-end">
        {!up && <div className="h-3 rounded-l-sm bg-red-500/80" style={{ width: `${frac * 100}%` }} />}
      </div>
      <div className="w-px h-4 bg-slate-600 shrink-0" />
      <div className="flex-1 flex justify-start">
        {up && <div className="h-3 rounded-r-sm bg-emerald-500/80" style={{ width: `${frac * 100}%` }} />}
      </div>
    </div>
  );
}

interface RowData {
  ticker: string;
  name: string;
  p: Perf;
}

function Row({ r, maxAbs, bench = false }: { r: RowData; maxAbs: number; bench?: boolean }) {
  const { p } = r;
  const pctTone = p.changePct == null ? 'text-slate-500' : p.changePct >= 0 ? 'text-emerald-400' : 'text-red-400';
  return (
    <tr className={bench ? 'bg-slate-700/40 border-t-2 border-slate-600' : 'border-t border-slate-700/60'}>
      <td className="py-2 pl-1 pr-2">
        <span className="inline-block px-2 py-0.5 rounded bg-slate-900 border border-slate-600 text-xs font-bold tabular-nums text-slate-200">
          {r.ticker}
        </span>
      </td>
      <td className={`py-2 pr-4 text-sm font-medium ${bench ? 'text-slate-300' : 'text-slate-100'}`}>{r.name}</td>
      <td className="py-2 pr-4 text-right text-sm tabular-nums text-slate-200">{fmtPrice(p.last)}</td>
      <td className="py-2 pr-4 text-right text-sm tabular-nums text-slate-400">
        {p.start != null ? fmtPrice(p.start) : '—'}
      </td>
      <td className={`py-2 pr-4 text-right text-sm tabular-nums ${pctTone}`}>
        {p.changeAbs != null ? fmtAbs(p.changeAbs) : '—'}
      </td>
      <td className={`py-2 pr-2 text-right text-sm font-semibold tabular-nums ${pctTone} whitespace-nowrap`}>
        {p.changePct != null ? fmtPct(p.changePct) : '—'}
      </td>
      <td className="py-2 pl-2 pr-1 w-[22%] min-w-[90px]">
        {p.changePct != null && <ChangeBar pct={p.changePct} max={maxAbs} />}
      </td>
    </tr>
  );
}

export default function SectorPerformanceTable({ data }: Props) {
  const [tf, setTf] = useState<Timeframe>('1M');

  const { rows, benchRow, maxAbs, startDate } = useMemo(() => {
    const rows: RowData[] = data.sectors
      .map((s) => ({ ticker: s.ticker, name: s.name, p: perfFor(s.perf, tf) }))
      .sort((a, b) => (b.p.changePct ?? -Infinity) - (a.p.changePct ?? -Infinity));
    const benchRow: RowData = { ticker: data.benchmark.ticker, name: 'S&P 500 benchmark', p: perfFor(data.benchmark.perf, tf) };
    const maxAbs = Math.max(
      ...[...rows, benchRow].map((r) => (r.p.changePct != null ? Math.abs(r.p.changePct) : 0)),
      0.0001,
    );
    const startDate = rows.find((r) => r.p.startDate)?.p.startDate ?? benchRow.p.startDate;
    return { rows, benchRow, maxAbs, startDate };
  }, [data, tf]);

  return (
    <section className="bg-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Sector Performance</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            SPDR sector ETFs, sorted by return · {TF_LABEL[tf]}
            {startDate && <span className="text-slate-500"> · since {startDate}</span>}
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

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="pb-1 pl-1 pr-2 font-medium">Ticker</th>
              <th className="pb-1 pr-4 font-medium">Sector</th>
              <th className="pb-1 pr-4 font-medium text-right">Last</th>
              <th className="pb-1 pr-4 font-medium text-right">Start</th>
              <th className="pb-1 pr-4 font-medium text-right">Change $</th>
              <th className="pb-1 pr-2 font-medium text-right">Change %</th>
              <th className="pb-1 pl-2 pr-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.ticker} r={r} maxAbs={maxAbs} />
            ))}
            <Row r={benchRow} maxAbs={maxAbs} bench />
          </tbody>
        </table>
      </div>
    </section>
  );
}
