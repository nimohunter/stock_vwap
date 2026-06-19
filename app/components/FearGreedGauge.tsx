'use client';

import { useEffect, useState } from 'react';

type Rating = 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';

interface FearGreed {
  score: number;
  rating: Rating;
  source: 'cnn' | 'computed';
  asOf: string;
  components?: { label: string; score: number }[];
}

// score -> tailwind color classes (text/border/marker share one hue family)
function colorFor(score: number): { text: string; bg: string; ring: string } {
  if (score < 25) return { text: 'text-red-400', bg: 'bg-red-500', ring: 'ring-red-500/40' };
  if (score < 45) return { text: 'text-orange-400', bg: 'bg-orange-500', ring: 'ring-orange-500/40' };
  if (score <= 55) return { text: 'text-yellow-400', bg: 'bg-yellow-500', ring: 'ring-yellow-500/40' };
  if (score <= 75) return { text: 'text-lime-400', bg: 'bg-lime-500', ring: 'ring-lime-500/40' };
  return { text: 'text-green-400', bg: 'bg-green-500', ring: 'ring-green-500/40' };
}

export default function FearGreedGauge() {
  const [data, setData] = useState<FearGreed | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/fear-greed')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setError(true);
        else setData(d);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return null;

  if (!data) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 animate-pulse text-slate-500 text-sm">
        Loading market sentiment…
      </div>
    );
  }

  const c = colorFor(data.score);
  const isExtreme = data.rating === 'Extreme Fear' || data.rating === 'Extreme Greed';
  const isComputed = data.source === 'computed';
  const asOf = new Date(data.asOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div className={`bg-slate-800 border border-slate-700 rounded-lg ${isExtreme ? `ring-2 ${c.ring}` : ''}`}>
      <div className="px-4 py-3 flex items-center gap-4">
        {/* Score badge */}
        <div className="flex flex-col items-center justify-center shrink-0">
          <span className={`text-3xl font-bold leading-none ${c.text}`}>{data.score}</span>
          <span className="text-[10px] text-slate-500 mt-0.5">/ 100</span>
        </div>

        {/* Label + gradient bar */}
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm font-semibold ${c.text}`}>
              {isExtreme ? '⚡ ' : ''}
              {data.rating}
            </span>
            <span className="text-[11px] text-slate-500">Fear &amp; Greed</span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500">
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-slate-900 shadow"
              style={{ left: `${data.score}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-slate-600 mt-1">
            <span>Extreme Fear</span>
            <span>Extreme Greed</span>
          </div>
        </div>

        {/* Source badge + info toggle */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              isComputed ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-700 text-slate-300'
            }`}
            title={isComputed ? 'Estimated from market data' : 'CNN Fear & Greed Index'}
          >
            {isComputed ? 'estimate' : 'CNN'}
          </span>
          <span className="text-[10px] text-slate-500">{asOf}</span>
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[10px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
            aria-expanded={open}
          >
            {open ? 'hide' : 'how?'}
          </button>
        </div>
      </div>

      {/* Methodology / source disclosure */}
      {open && (
        <div className="border-t border-slate-700 px-4 py-3 text-xs text-slate-400 space-y-3">
          {isComputed ? (
            <p>
              <span className="text-amber-400 font-medium">Estimated index.</span> CNN&apos;s official Fear &amp; Greed
              Index was unavailable, so this is computed from live market data and won&apos;t exactly match CNN&apos;s
              number. Each sub-signal below is scored 0–100 (100 = maximum greed) and averaged.
            </p>
          ) : (
            <p>
              Source:{' '}
              <a
                href="https://edition.cnn.com/markets/fear-and-greed"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                CNN Fear &amp; Greed Index
              </a>
              , a composite of seven market indicators. Reading: 0–24 Extreme Fear · 25–44 Fear · 45–55 Neutral · 56–74
              Greed · 75–100 Extreme Greed.
            </p>
          )}

          {data.components && data.components.length > 0 && (
            <div className="space-y-1.5">
              {data.components.map((comp) => {
                const cc = colorFor(comp.score);
                return (
                  <div key={comp.label} className="flex items-center gap-2">
                    <span className="w-36 shrink-0 text-slate-400">{comp.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                      <div className={`h-full ${cc.bg}`} style={{ width: `${comp.score}%` }} />
                    </div>
                    <span className={`w-7 text-right tabular-nums ${cc.text}`}>{comp.score}</span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            Extreme readings can be contrarian signals — extreme fear may flag a buying opportunity, extreme greed a time
            for caution. Not investment advice.
          </p>
        </div>
      )}
    </div>
  );
}
