'use client';

import { useEffect, useState } from 'react';
import { VwapBands } from '@/app/lib/vwap';
import { estimateLeveragedPrice, LeveragedSpec } from '@/app/lib/leveragedEstimate';

interface MuuData {
  spec: LeveragedSpec | null;
  underlyingClose: number;
  underlyingDate: string;
  leveragedClose: number;
  leveragedDate: string;
  dailyVol20: number | null;
  dailyVol60: number | null;
  fit: { slope: number; r2: number; days: number } | null;
}

interface Props {
  symbol: string;
  bands: VwapBands | null;
}

const HORIZONS: { label: string; days: number }[] = [
  { label: '3D', days: 3 },
  { label: '1W', days: 5 },
  { label: '2W', days: 10 },
  { label: '1M', days: 21 },
];

const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export default function MuuEstimator({ symbol, bands }: Props) {
  // Keyed like the page's other resources: set state only in the async callback and gate on the
  // key, so a stale response for a previously-selected symbol never renders (avoids clearing in an effect).
  const [state, setState] = useState<{ key: string; value: MuuData | null }>({ key: '', value: null });
  // `null` target = "use the underlying's last close"; a number means the user edited it.
  const [target, setTarget] = useState<number | null>(null);
  const [days, setDays] = useState(5);

  // Reference data for this underlying (returns spec:null for symbols with no companion → panel hidden).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/muu-estimate?symbol=${symbol}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && !d?.error) setState({ key: symbol, value: d.spec ? d : null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const data = state.key === symbol ? state.value : null;
  if (!data || !data.spec) return null;

  const effectiveTarget = target ?? data.underlyingClose;
  const vol = data.dailyVol20 ?? data.dailyVol60 ?? 0;
  const est = estimateLeveragedPrice({
    underlyingNow: data.underlyingClose,
    levNow: data.leveragedClose,
    target: effectiveTarget > 0 ? effectiveTarget : data.underlyingClose,
    leverage: data.spec.leverage,
    dailyVol: vol,
    days,
    expenseRatio: data.spec.expenseRatio,
  });

  const { ticker, leverage, name } = data.spec;

  const presets: { label: string; value: number }[] = [
    { label: 'Now', value: data.underlyingClose },
    { label: '+5%', value: data.underlyingClose * 1.05 },
    { label: '-5%', value: data.underlyingClose * 0.95 },
    { label: '+10%', value: data.underlyingClose * 1.1 },
    { label: '-10%', value: data.underlyingClose * 0.9 },
  ];
  if (bands) {
    presets.push(
      { label: '+2σ', value: bands.upper2 },
      { label: '+1σ', value: bands.upper1 },
      { label: 'VWAP', value: bands.vwap },
      { label: '-1σ', value: bands.lower1 },
      { label: '-2σ', value: bands.lower2 }
    );
  }

  const setTargetTo = (v: number) => setTarget(Math.round(v * 100) / 100);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg mt-4 px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <span className="text-sm font-semibold text-slate-200">
          {ticker} Leverage Estimator
          <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">
            {leverage}× {symbol} daily
          </span>
        </span>
        <span className="text-[11px] text-slate-500">
          {symbol} ${data.underlyingClose.toFixed(2)} · {ticker} ${data.leveragedClose.toFixed(2)} · as of{' '}
          {data.leveragedDate}
        </span>
      </div>

      {/* Target underlying price input + presets */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-xs text-slate-400 uppercase tracking-wide">If {symbol} =</label>
        <div className="flex items-center bg-slate-900 border border-slate-600 rounded-lg overflow-hidden">
          <span className="pl-2 text-slate-500 text-sm">$</span>
          <input
            type="number"
            step="0.01"
            value={Number.isFinite(effectiveTarget) ? Math.round(effectiveTarget * 100) / 100 : ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setTarget(Number.isNaN(v) ? null : v);
            }}
            className="w-24 bg-transparent px-1 py-1.5 text-white text-sm font-semibold focus:outline-none"
          />
        </div>
        <span className="text-[11px] text-slate-500">({signedPct(est.underlyingMovePct)} vs now)</span>
        {target !== null && (
          <button
            onClick={() => {
              setTarget(null);
            }}
            className="text-[11px] text-slate-400 hover:text-white underline"
          >
            reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => setTargetTo(p.value)}
            className="px-2 py-1 rounded text-[11px] font-medium bg-slate-700/60 text-slate-300 hover:bg-slate-700 transition-colors"
            title={`$${p.value.toFixed(2)}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Estimates */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="bg-slate-900/50 rounded-lg p-3">
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">Same-day {ticker}</p>
          <p className="text-white text-2xl font-bold">${est.naivePrice.toFixed(2)}</p>
          <p className={`text-xs font-semibold ${est.naivePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {signedPct(est.naivePct)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Exact if the whole move happens in one session.</p>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-slate-400 text-xs uppercase tracking-wide">Hold (decay-adj)</p>
            <div className="flex rounded overflow-hidden border border-slate-600">
              {HORIZONS.map((h) => (
                <button
                  key={h.days}
                  onClick={() => setDays(h.days)}
                  className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    days === h.days ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-purple-300 text-2xl font-bold">${est.decayPrice.toFixed(2)}</p>
          <p className={`text-xs font-semibold ${est.decayPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {signedPct(est.decayPct)}
            <span className="text-slate-500 font-normal"> · decay {signedPct(est.decayDragPct)} vs 2×</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            If the move takes ~{days} trading days at {(vol * 100).toFixed(1)}% daily vol.
          </p>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3">
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">Realized leverage</p>
          <p className="text-white text-2xl font-bold">
            {data.fit ? `${data.fit.slope.toFixed(2)}×` : '—'}
          </p>
          {data.fit && (
            <p className="text-[11px] text-slate-500 mt-1">
              vs {leverage}× target · R² {data.fit.r2.toFixed(3)} over {data.fit.days}d
            </p>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-500 mt-3">
        {name}. {ticker} tracks {leverage}× {symbol}&apos;s <em>daily</em> move and resets each day, so a multi-day hold
        drifts below a naïve {leverage}× because of volatility decay (the daily resets compound) plus fees. The estimate
        is path-dependent — the &quot;hold&quot; figure assumes a steady move over the horizon; a choppy path to the same
        {' '}{symbol} price leaves {ticker} lower. Not investment advice.
      </p>
    </div>
  );
}
