'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import StatsPanel from './components/StatsPanel';
import SentimentRating from './components/SentimentRating';
import RelativeStrengthBadge from './components/RelativeStrengthBadge';
import OptionsLevelsPanel from './components/OptionsLevelsPanel';
import FundamentalsPanel from './components/FundamentalsPanel';
import SnapshotStrip from './components/SnapshotStrip';
import { DailyBar } from './lib/bars';
import { VwapBands } from './lib/vwap';
import { RsResult } from './lib/relativeStrength';
import { OptionsSummary } from './lib/optionsData';
import { Fundamentals } from './lib/fundamentalsData';
import tickers from './lib/tickers.json';

const VwapChart = dynamic(() => import('./components/VwapChart'), { ssr: false });

const TICKERS: string[] = tickers;

type Period = '3m' | '6m' | '1y';
const PERIODS: Period[] = ['3m', '6m', '1y'];

const MA_KEYS = ['ema10', 'ema20', 'ema50', 'ema200', 'cloud'] as const;
type MaKey = (typeof MA_KEYS)[number];

const STORAGE_KEY = 'vwap-view';

function staleDays(lastBarDate: string): number {
  const lastMs = new Date(lastBarDate + 'T00:00:00Z').getTime();
  return Math.floor((Date.now() - lastMs) / (24 * 60 * 60 * 1000));
}

/**
 * Fetch a per-key JSON resource, returning only the payload whose `key` matches the
 * current one — a stale response for a previously-selected symbol derives back to
 * `fallback` instead of flashing the wrong stock's data. Errors are swallowed (the
 * caller renders `fallback`). Pass `url = null` to skip fetching (e.g. pre-hydration).
 */
function useKeyedResource<T>(
  url: string | null,
  key: string,
  extract: (data: Record<string, unknown>) => T,
  fallback: T,
): T {
  const [state, setState] = useState<{ key: string; value: T }>({ key: '', value: fallback });
  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && !data?.error) setState({ key, value: extract(data) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, key, extract]);
  return state.key === key ? state.value : fallback;
}

// Pure response extractors (module-level → stable identity for the effect deps).
const pickAnchored = (d: Record<string, unknown>) => (d.anchoredBands ?? []) as VwapBands[];
const pickFundamentals = (d: Record<string, unknown>) => (d.fundamentals ?? null) as Fundamentals | null;
const pickRs = (d: Record<string, unknown>) => (d.rs ?? null) as RsResult | null;
const pickOptions = (d: Record<string, unknown>) => (d.options ?? null) as OptionsSummary | null;

export default function Home() {
  const [symbol, setSymbol] = useState('NVDA');
  const [chartData, setChartData] = useState<{
    key: string; bars: DailyBar[]; vwapBands: VwapBands[]; error: string | null;
  }>({ key: '', bars: [], vwapBands: [], error: null });
  const [period, setPeriod] = useState<Period>('1y');
  const [showVwap, setShowVwap] = useState(true);
  const [ma, setMa] = useState<Record<MaKey, boolean>>({
    ema10: false, ema20: false, ema50: false, ema200: false, cloud: false,
  });
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore view state once on mount: URL params win, then localStorage, then defaults.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore of view state after hydration */
    try {
      const params = new URLSearchParams(window.location.search);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

      const sym = params.get('symbol') ?? stored.symbol;
      if (sym && TICKERS.includes(sym.toUpperCase())) setSymbol(sym.toUpperCase());

      const p = (params.get('period') ?? stored.period) as Period;
      if (PERIODS.includes(p)) setPeriod(p);

      const maRaw = params.get('ma') ?? stored.ma;
      if (typeof maRaw === 'string') {
        const on = new Set(maRaw.split(',').filter(Boolean));
        setMa(Object.fromEntries(MA_KEYS.map((k) => [k, on.has(k)])) as Record<MaKey, boolean>);
      }

      const vwapRaw = params.get('vwap') ?? stored.vwap;
      if (vwapRaw === '0') setShowVwap(false);

      const a = params.get('anchor');
      if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) setAnchor(a);
    } catch {
      // corrupted storage/params — keep defaults
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Persist view state to the URL (shareable) and localStorage (survives new tabs).
  useEffect(() => {
    if (!hydrated) return;
    const maStr = MA_KEYS.filter((k) => ma[k]).join(',');
    const params = new URLSearchParams();
    params.set('symbol', symbol);
    params.set('period', period);
    if (maStr) params.set('ma', maStr);
    if (!showVwap) params.set('vwap', '0');
    if (anchor) params.set('anchor', anchor);
    window.history.replaceState(null, '', `?${params.toString()}`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbol, period, ma: maStr, vwap: showVwap ? '1' : '0' }));
  }, [hydrated, symbol, period, ma, anchor, showVwap]);

  useEffect(() => {
    if (!hydrated) return;
    const key = `${symbol}|${period}`;
    let cancelled = false;
    fetch(`/api/vwap?symbol=${symbol}&period=${period}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setChartData({ key, bars: data.bars ?? [], vwapBands: data.vwapBands ?? [], error: null });
      })
      .catch((e) => {
        if (!cancelled) setChartData({ key, bars: [], vwapBands: [], error: (e as Error).message });
      });
    return () => { cancelled = true; };
  }, [hydrated, symbol, period]);

  const chartKey = `${symbol}|${period}`;
  const loaded = chartData.key === chartKey;
  const bars = loaded ? chartData.bars : [];
  const vwapBands = loaded ? chartData.vwapBands : [];
  const error = loaded ? chartData.error : null;
  const loading = hydrated && !loaded;

  // Per-symbol sidecar data, each fetched from its own local-cache API route and keyed so
  // a stale response for a previously-selected symbol never renders (see useKeyedResource).
  const gate = (path: string) => (hydrated ? path : null);
  const anchoredBands = useKeyedResource(
    hydrated && anchor ? `/api/anchored-vwap?symbol=${symbol}&anchor=${anchor}` : null,
    `${symbol}|${anchor}`,
    pickAnchored,
    [] as VwapBands[],
  );
  const fundamentals = useKeyedResource(gate(`/api/fundamentals?symbol=${symbol}`), symbol, pickFundamentals, null);
  const rs = useKeyedResource(gate(`/api/relative-strength?symbol=${symbol}`), symbol, pickRs, null);
  const options = useKeyedResource(gate(`/api/options-levels?symbol=${symbol}`), symbol, pickOptions, null);

  const pastEarnings = fundamentals?.earnings.past ?? [];
  const earningsDates = pastEarnings.map((e) => e.date);

  const selectSymbol = (t: string) => {
    if (t === symbol) return;
    setSymbol(t);
    setAnchor(null); // an anchor date is symbol-specific
  };

  const handleAnchorSelect = useCallback((date: string) => setAnchor(date), []);

  const toggleMa = (k: MaKey) => setMa((m) => ({ ...m, [k]: !m[k] }));

  const currentPrice = bars.length ? bars[bars.length - 1].close : 0;
  const lastBands = vwapBands.length ? vwapBands[vwapBands.length - 1] : null;
  const lastBarDate = bars.length ? bars[bars.length - 1].date : null;
  const dataAgeDays = lastBarDate ? staleDays(lastBarDate) : 0;

  const lastEarnings = lastBarDate
    ? [...earningsDates].sort().reverse().find((d) => d <= lastBarDate) ?? null
    : null;

  const MA_BUTTONS: { key: MaKey; label: string; activeClass: string }[] = [
    { key: 'ema10', label: 'EMA 10', activeClass: 'bg-orange-500' },
    { key: 'ema20', label: 'EMA 20', activeClass: 'bg-purple-500' },
    { key: 'ema50', label: 'EMA 50', activeClass: 'bg-cyan-500' },
    { key: 'ema200', label: 'EMA 200', activeClass: 'bg-rose-500' },
    { key: 'cloud', label: 'EMA Cloud 34/50', activeClass: 'bg-teal-500' },
  ];

  return (
    <main className="min-h-screen bg-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">Stock VWAP Analyzer</h1>
              <Link
                href="/money-flow"
                className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors"
              >
                Sector Money Flow →
              </Link>
            </div>
            <p className="text-slate-400 text-sm mt-1">2Y price history · rolling VWAP with ±1σ / ±2σ bands</p>
            {lastBarDate && (
              <p className={`text-xs mt-1 ${dataAgeDays > 4 ? 'text-amber-400' : 'text-slate-500'}`}>
                Data as of {lastBarDate}
                {dataAgeDays > 4 && ` · ${dataAgeDays} days old`}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-slate-500">Rolling VWAP ±σ</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-600">
                {PERIODS.map((p) => {
                  const active = showVwap && period === p;
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        if (active) {
                          setShowVwap(false); // click the lit window again → hide VWAP
                        } else {
                          setPeriod(p);
                          setShowVwap(true);
                        }
                      }}
                      className={`px-5 py-2 text-sm font-medium transition-colors ${
                        active ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {p.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-slate-500">Moving Averages</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-600">
                {MA_BUTTONS.map(({ key, label, activeClass }) => (
                  <button
                    key={key}
                    onClick={() => toggleMa(key)}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      ma[key] ? `${activeClass} text-white` : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs text-slate-500">Anchored VWAP · double-click the chart to anchor</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-600">
                {lastEarnings && (
                  <button
                    onClick={() => setAnchor(anchor === lastEarnings ? null : lastEarnings)}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      anchor === lastEarnings ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    ⚓ Last earnings ({lastEarnings})
                  </button>
                )}
                {anchor && anchor !== lastEarnings && (
                  <button
                    onClick={() => setAnchor(null)}
                    className="px-4 py-2 text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                  >
                    ⚓ {anchor}
                  </button>
                )}
                {!anchor && !lastEarnings && (
                  <span className="px-4 py-2 text-sm text-slate-500">none</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap mb-6">
          {TICKERS.map((t) => (
            <button
              key={t}
              onClick={() => selectSymbol(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                symbol === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              {t}
            </button>
          ))}
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
            <div className="mb-4 flex flex-col lg:flex-row gap-4 lg:items-stretch">
              <div className="flex-1 min-w-0">
                <SentimentRating symbol={symbol} bars={bars} />
              </div>
              {rs && <RelativeStrengthBadge symbol={symbol} rs={rs} />}
            </div>
            <SnapshotStrip symbol={symbol} bars={bars} />
            <div className="bg-slate-800 rounded-lg p-2">
              <VwapChart
                bars={bars}
                vwapBands={vwapBands}
                anchoredBands={anchoredBands}
                earnings={pastEarnings}
                rsEvents={rs?.events ?? []}
                optionsLevels={options}
                onAnchorSelect={handleAnchorSelect}
                showVwap={showVwap}
                showEma10={ma.ema10}
                showEma20={ma.ema20}
                showEma50={ma.ema50}
                showEma200={ma.ema200}
                showEmaCloud={ma.cloud}
              />
            </div>
            <StatsPanel currentPrice={currentPrice} bands={lastBands} />
            {options && <OptionsLevelsPanel symbol={symbol} options={options} currentPrice={currentPrice} />}
            {fundamentals && (
              <FundamentalsPanel symbol={symbol} fundamentals={fundamentals} currentPrice={currentPrice} lastBarDate={lastBarDate} />
            )}
          </>
        ) : null}

        {bars.length > 0 && (
          <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-400">
            {showVwap && (
              <>
                <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-red-500 inline-block" /> +2σ</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-yellow-500 inline-block" /> +1σ</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-blue-400 inline-block" /> VWAP</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-green-500 inline-block" /> -1σ</span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-pink-500 inline-block" /> -2σ</span>
              </>
            )}
            {anchor && anchoredBands.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-0.5 bg-amber-500 inline-block" /> Anchored VWAP ±1σ (from {anchor})
              </span>
            )}
            {earningsDates.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="text-green-400">▲E</span>/<span className="text-red-400">▲E</span> earnings report
                <span className="text-slate-500">(green = beat, red = miss)</span>
              </span>
            )}
            {rs && rs.events.length > 0 && (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-2.5 bg-red-500/20 border border-red-500/50 inline-block" />
                  RS overbought vs {rs.benchmark}
                  <span className="text-slate-500">(outperformance stretched)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-2.5 bg-teal-400/20 border border-teal-400/50 inline-block" />
                  RS oversold
                  <span className="text-slate-500">(underperformance stretched)</span>
                </span>
                {rs.events.some((e) => e.type === 'obExtreme' || e.type === 'osExtreme') && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-red-400">■!</span> extreme day
                  </span>
                )}
              </>
            )}
            {ma.ema10 && (
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-orange-400 inline-block" /> EMA 10</span>
            )}
            {ma.ema20 && (
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-purple-500 inline-block" /> EMA 20</span>
            )}
            {ma.ema50 && (
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-cyan-400 inline-block" /> EMA 50</span>
            )}
            {ma.ema200 && (
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-rose-500 inline-block" /> EMA 200</span>
            )}
            {ma.cloud && (
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-2.5 bg-teal-400/30 border-y border-y-teal-400 inline-block" /> EMA Cloud 34/50
                <span className="text-slate-500">(green = bullish, red = bearish)</span>
              </span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
