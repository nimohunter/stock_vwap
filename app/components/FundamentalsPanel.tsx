'use client';

import { Fundamentals } from '@/app/lib/fundamentalsData';

interface Props {
  symbol: string;
  fundamentals: Fundamentals;
  currentPrice: number;
  lastBarDate: string | null;
}

const fmtBig = (v: number | null): string => {
  if (v === null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString('en-US')}`;
};
const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));
const fmtPct = (v: number | null, d = 1) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`);

function Stat({ label, value, sub, tone = 'text-white' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <p className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`font-bold text-sm ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

const REC_TONE: Record<string, string> = {
  strong_buy: 'text-green-400',
  buy: 'text-lime-400',
  hold: 'text-yellow-400',
  sell: 'text-orange-400',
  strong_sell: 'text-red-400',
};

export default function FundamentalsPanel({ symbol, fundamentals: f, currentPrice, lastBarDate }: Props) {
  // ETFs: no meaningful fundamentals — render nothing.
  if (f.forwardPE === null && f.trailingPE === null && f.targetMean === null && !f.earnings.upcoming) return null;

  const upside = f.targetMean !== null && currentPrice > 0 ? f.targetMean / currentPrice - 1 : null;
  const upcoming = f.earnings.upcoming;
  const daysToEarnings =
    upcoming && lastBarDate
      ? Math.round((new Date(upcoming.date + 'T00:00:00Z').getTime() - new Date(lastBarDate + 'T00:00:00Z').getTime()) / 86400000)
      : null;
  const lastReport = f.earnings.past[0] ?? null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg mt-4 px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <span className="text-sm font-semibold text-slate-200">
          {symbol} Fundamentals
          {f.sector && <span className="ml-2 text-[11px] font-normal text-slate-500">{f.sector} · {f.industry}</span>}
        </span>
        <span className="text-[11px] text-slate-500">yfinance · refreshed daily</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-3 gap-y-4 text-sm">
        <Stat label="Mkt Cap · Beta" value={fmtBig(f.marketCap)} sub={f.beta !== null ? `β ${fmt(f.beta)}` : undefined} />
        <Stat
          label="P/E fwd / trail"
          value={`${fmt(f.forwardPE, 1)} / ${fmt(f.trailingPE, 1)}`}
          sub={f.peg !== null ? `PEG ${fmt(f.peg)}` : undefined}
          tone={f.forwardPE !== null && f.trailingPE !== null && f.forwardPE < f.trailingPE ? 'text-green-400' : 'text-white'}
        />
        <Stat
          label="EPS fwd / trail"
          value={`${fmt(f.forwardEps, 1)} / ${fmt(f.trailingEps, 1)}`}
          sub={f.evToEbitda !== null ? `EV/EBITDA ${fmt(f.evToEbitda, 1)}` : undefined}
        />
        <Stat
          label="Margins op / net"
          value={`${fmtPct(f.operatingMargin)} / ${fmtPct(f.profitMargin)}`}
          sub={f.roe !== null ? `ROE ${fmtPct(f.roe)}` : undefined}
        />
        <Stat
          label="Cash / Debt"
          value={`${fmtBig(f.totalCash)} / ${fmtBig(f.totalDebt)}`}
          sub={f.freeCashflow !== null ? `FCF ${fmtBig(f.freeCashflow)}` : undefined}
          tone={f.totalCash !== null && f.totalDebt !== null && f.totalCash > f.totalDebt ? 'text-green-400' : 'text-white'}
        />
        <Stat
          label="Short % float"
          value={fmtPct(f.shortPctFloat)}
          sub={f.shortRatio !== null ? `${fmt(f.shortRatio, 1)}d to cover` : undefined}
        />

        {f.targetMean !== null && (
          <Stat
            label={`Analysts (${fmt(f.numAnalysts, 0)})`}
            value={`${(f.recommendation ?? '').replace(/_/g, ' ')} · $${fmt(f.targetMean, 0)}`}
            sub={
              upside !== null
                ? `${upside >= 0 ? '+' : ''}${(upside * 100).toFixed(1)}% to mean · range $${fmt(f.targetLow, 0)}–$${fmt(f.targetHigh, 0)}`
                : undefined
            }
            tone={REC_TONE[f.recommendation ?? ''] ?? 'text-white'}
          />
        )}
        {upcoming && (
          <Stat
            label="Next earnings"
            value={daysToEarnings !== null ? `${upcoming.date} (${daysToEarnings}d)` : upcoming.date}
            sub={upcoming.epsEstimate !== null ? `EPS est ${fmt(upcoming.epsEstimate)}` : undefined}
            tone={daysToEarnings !== null && daysToEarnings <= 7 ? 'text-amber-300' : 'text-white'}
          />
        )}
        {lastReport && (
          <Stat
            label="Last report"
            value={`${fmt(lastReport.epsActual)} vs ${fmt(lastReport.epsEstimate)} est`}
            sub={lastReport.surprisePct !== null ? `${lastReport.surprisePct >= 0 ? '+' : ''}${fmt(lastReport.surprisePct, 1)}% surprise · ${lastReport.date}` : lastReport.date}
            tone={lastReport.surprisePct !== null && lastReport.surprisePct >= 0 ? 'text-green-400' : 'text-red-400'}
          />
        )}
        {f.dividendYield !== null && (
          <Stat label="Dividend" value={`${fmt(f.dividendYield)}%`} sub={f.payoutRatio !== null ? `payout ${fmtPct(f.payoutRatio)}` : undefined} />
        )}
        {f.revenueGrowth !== null && (
          <Stat
            label="Growth rev / eps"
            value={`${fmtPct(f.revenueGrowth)} / ${fmtPct(f.earningsGrowth)}`}
            tone={f.revenueGrowth >= 0 ? 'text-green-400' : 'text-red-400'}
          />
        )}
      </div>
    </div>
  );
}
