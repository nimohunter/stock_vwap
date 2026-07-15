'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { type MoneyFlowPayload } from '@/app/lib/moneyFlow';
import SectorPerformanceTable from '@/app/components/SectorPerformanceTable';
import RsRatioChart from '@/app/components/RsRatioChart';
import RrgChart from '@/app/components/RrgChart';

function staleDays(lastBarDate: string): number {
  const lastMs = new Date(lastBarDate + 'T00:00:00Z').getTime();
  return Math.floor((Date.now() - lastMs) / (24 * 60 * 60 * 1000));
}

export default function MoneyFlowPage() {
  const [data, setData] = useState<MoneyFlowPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/money-flow')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  const age = data ? staleDays(data.asOf) : 0;

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Sector Money Flow</h1>
            <p className="text-slate-400 text-sm mt-1">
              Where capital is rotating across the 11 S&amp;P 500 sectors — performance, relative strength, and rotation.
            </p>
            {data && (
              <p className={`text-xs mt-1 ${age > 4 ? 'text-amber-400' : 'text-slate-500'}`}>
                Data as of {data.asOf}
                {age > 4 && ` · ${age} days old`}
              </p>
            )}
          </div>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            ← Single-stock VWAP
          </Link>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-lg p-3 mb-4 text-sm">{error}</div>
        )}

        {!data && !error ? (
          <div className="bg-slate-800 rounded-lg h-[400px] flex items-center justify-center text-slate-400">
            Loading sector data…
          </div>
        ) : data ? (
          <div className="flex flex-col gap-6">
            <SectorPerformanceTable data={data} />
            <RsRatioChart data={data} />
            <RrgChart data={data} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
