'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import StatsPanel from './components/StatsPanel';
import { DailyBar } from './lib/alphavantage';
import { VwapBands } from './lib/vwap';

const VwapChart = dynamic(() => import('./components/VwapChart'), { ssr: false });

const TICKERS = ['NVDA', 'META', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'VOO', 'SPMO', 'GLD'];

export default function Home() {
  const [symbol, setSymbol] = useState('NVDA');
  const [input, setInput] = useState('NVDA');
  const [bars, setBars] = useState<DailyBar[]>([]);
  const [vwapBands, setVwapBands] = useState<VwapBands[]>([]);
  const [period, setPeriod] = useState<'1y' | '2y'>('1y');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (sym: string, p: '1y' | '2y') => {
    setLoading(true);
    setError(null);
    setBars([]);
    setVwapBands([]);
    try {
      const res = await fetch(`/api/vwap?symbol=${sym}&period=${p}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBars(data.bars ?? []);
      setVwapBands(data.vwapBands ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(symbol, period); }, [symbol, period, fetchData]);

  const handleSearch = () => {
    const s = input.trim().toUpperCase();
    if (s) setSymbol(s);
  };

  const currentPrice = bars.length ? bars[bars.length - 1].close : 0;
  const lastBands = vwapBands.length ? vwapBands[vwapBands.length - 1] : null;

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Stock VWAP Analyzer</h1>
            <p className="text-slate-400 text-sm mt-1">Anchored VWAP with ±1σ / ±2σ bands</p>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-slate-600">
            {(['1y', '2y'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-5 py-2 text-sm font-medium transition-colors ${
                  period === p ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Ticker input */}
        <div className="flex flex-wrap gap-2 mb-6">
          <div className="flex gap-2 flex-1 min-w-0">
            <input
              className="bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 flex-1 min-w-0 uppercase"
              placeholder="Ticker symbol"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              {loading ? 'Loading...' : 'Go'}
            </button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {TICKERS.map((t) => (
              <button
                key={t}
                onClick={() => { setInput(t); setSymbol(t); }}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  symbol === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-400 rounded-lg p-3 mb-4 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-slate-800 rounded-lg h-[520px] flex items-center justify-center text-slate-400">
            Loading {symbol}...
          </div>
        ) : bars.length > 0 ? (
          <>
            <div className="bg-slate-800 rounded-lg p-2">
              <VwapChart bars={bars} vwapBands={vwapBands} />
            </div>
            <StatsPanel currentPrice={currentPrice} bands={lastBands} />
          </>
        ) : null}

        {bars.length > 0 && (
          <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-red-500 inline-block" /> +2σ</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-yellow-500 inline-block" /> +1σ</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-blue-400 inline-block" /> VWAP</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-green-500 inline-block" /> -1σ</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-pink-500 inline-block" /> -2σ</span>
          </div>
        )}
      </div>
    </main>
  );
}
