'use client';

import { OptionsSummary } from '@/app/lib/optionsData';

interface Props {
  symbol: string;
  options: OptionsSummary;
  currentPrice: number;
}

const fmtM = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
};

function distPct(level: number | null, price: number): string | null {
  if (level === null || !price) return null;
  const d = (level / price - 1) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

export default function OptionsLevelsPanel({ symbol, options: o, currentPrice }: Props) {
  const positive = o.regime === 'positive_gamma';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg mt-4 px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <span className="text-sm font-semibold text-slate-200">
          {symbol} Options Levels
          {o.regime && (
            <span
              className={`ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                positive ? 'bg-teal-500/15 text-teal-300' : 'bg-amber-500/15 text-amber-300'
              }`}
            >
              {positive ? 'Positive gamma' : o.regime.replace(/_/g, ' ')}
            </span>
          )}
        </span>
        <span className="text-[11px] text-slate-500">
          FlashAlpha · as of {o.asOf.slice(0, 10)} · refreshed daily
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">Call Wall</p>
          <p className="text-red-400 font-bold">{o.callWall !== null ? `$${o.callWall}` : '—'}</p>
          {o.callWall !== null && <p className="text-[11px] text-slate-500">{distPct(o.callWall, currentPrice)} away</p>}
        </div>
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">Put Wall</p>
          <p className="text-green-400 font-bold">{o.putWall !== null ? `$${o.putWall}` : '—'}</p>
          {o.putWall !== null && <p className="text-[11px] text-slate-500">{distPct(o.putWall, currentPrice)} away</p>}
        </div>
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">Gamma Flip</p>
          <p className="text-sky-400 font-bold">{o.gammaFlip !== null ? `$${o.gammaFlip.toFixed(1)}` : '—'}</p>
          {o.gammaFlip !== null && <p className="text-[11px] text-slate-500">{distPct(o.gammaFlip, currentPrice)} away</p>}
        </div>
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">Net GEX</p>
          <p className={`font-bold ${o.netGex !== null && o.netGex >= 0 ? 'text-teal-300' : 'text-amber-300'}`}>
            {o.netGex !== null ? `$${fmtM(o.netGex)}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5" title="Put/Call ratio (open interest · volume)">
            P/C Ratio
          </p>
          <p className="text-white font-bold">
            {o.pcRatioOi !== null ? o.pcRatioOi.toFixed(2) : '—'}
            {o.pcRatioVolume !== null && <span className="text-slate-400 font-normal"> · {o.pcRatioVolume.toFixed(2)} vol</span>}
          </p>
          {o.totalCallOi !== null && o.totalPutOi !== null && (
            <p className="text-[11px] text-slate-500">
              OI {fmtM(o.totalCallOi)}C / {fmtM(o.totalPutOi)}P
            </p>
          )}
        </div>
        <div>
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5" title="At-the-money implied volatility vs 20-day historical volatility">
            ATM IV / HV20
          </p>
          <p className="text-white font-bold">
            {o.atmIv !== null ? o.atmIv.toFixed(0) : '—'}
            <span className="text-slate-400 font-normal"> / {o.hv20 !== null ? o.hv20.toFixed(0) : '—'}</span>
          </p>
          {o.oiWeightedDte !== null && (
            <p className="text-[11px] text-slate-500">OI-wtd DTE {o.oiWeightedDte.toFixed(0)}d</p>
          )}
        </div>
      </div>

      {o.gammaInterpretation && (
        <p className="text-[11px] text-slate-500 mt-3">
          {o.gammaInterpretation}. Walls mark the strikes with the heaviest dealer-hedging pressure — the put wall
          tends to act as support, the call wall as resistance; below the gamma flip, hedging amplifies moves instead
          of dampening them. Levels are drawn on the chart. Not investment advice.
        </p>
      )}
    </div>
  );
}
