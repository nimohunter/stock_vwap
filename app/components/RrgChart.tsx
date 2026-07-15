'use client';

import { useMemo, useState } from 'react';
import { type MoneyFlowPayload, type Quadrant, QUADRANT_COLORS } from '@/app/lib/moneyFlow';

interface Props {
  data: MoneyFlowPayload;
}

const VW = 680;
const VH = 540;
const M = { top: 24, right: 24, bottom: 40, left: 48 };
const PX0 = M.left;
const PX1 = VW - M.right;
const PY0 = M.top;
const PY1 = VH - M.bottom;

const QUADRANTS: { q: Quadrant; corner: string }[] = [
  { q: 'Improving', corner: 'tl' },
  { q: 'Leading', corner: 'tr' },
  { q: 'Lagging', corner: 'bl' },
  { q: 'Weakening', corner: 'br' },
];

export default function RrgChart({ data }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const sectors = useMemo(() => data.sectors.filter((s) => s.rrg && s.rrg.tail.length), [data]);

  const { xDom, yDom } = useMemo(() => {
    let mx = 0.5;
    let my = 0.5;
    for (const s of sectors)
      for (const p of s.rrg!.tail) {
        mx = Math.max(mx, Math.abs(p.rsRatio - 100));
        my = Math.max(my, Math.abs(p.rsMomentum - 100));
      }
    return { xDom: mx * 1.2, yDom: my * 1.2 };
  }, [sectors]);

  const sx = (v: number) => PX0 + ((v - (100 - xDom)) / (2 * xDom)) * (PX1 - PX0);
  const sy = (v: number) => PY1 - ((v - (100 - yDom)) / (2 * yDom)) * (PY1 - PY0);
  const cx = sx(100);
  const cy = sy(100);

  return (
    <section className="bg-slate-800 rounded-lg p-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-white">Relative Rotation Graph (RRG)</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          RS-Ratio (x) vs RS-Momentum (y) around 100, both computed against {data.benchmark.ticker}. Tails trace the
          last ~12 weeks; sectors rotate clockwise Improving → Leading → Weakening → Lagging.
        </p>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-auto" style={{ maxHeight: 560 }}>
          {/* quadrant fills */}
          {QUADRANTS.map(({ q, corner }) => {
            const x = corner[1] === 'l' ? PX0 : cx;
            const y = corner[0] === 't' ? PY0 : cy;
            const w = corner[1] === 'l' ? cx - PX0 : PX1 - cx;
            const h = corner[0] === 't' ? cy - PY0 : PY1 - cy;
            return <rect key={q} x={x} y={y} width={w} height={h} fill={QUADRANT_COLORS[q]} opacity={0.08} />;
          })}

          {/* quadrant labels */}
          {QUADRANTS.map(({ q, corner }) => {
            const x = corner[1] === 'l' ? PX0 + 8 : PX1 - 8;
            const y = corner[0] === 't' ? PY0 + 16 : PY1 - 8;
            return (
              <text
                key={q}
                x={x}
                y={y}
                textAnchor={corner[1] === 'l' ? 'start' : 'end'}
                fontSize={12}
                fontWeight={700}
                letterSpacing={1}
                fill={QUADRANT_COLORS[q]}
                opacity={0.65}
              >
                {q.toUpperCase()}
              </text>
            );
          })}

          {/* axes at 100 */}
          <line x1={cx} y1={PY0} x2={cx} y2={PY1} stroke="#475569" strokeWidth={1} />
          <line x1={PX0} y1={cy} x2={PX1} y2={cy} stroke="#475569" strokeWidth={1} />
          {/* plot frame */}
          <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill="none" stroke="#334155" strokeWidth={1} />

          {/* axis titles */}
          <text x={(PX0 + PX1) / 2} y={VH - 8} textAnchor="middle" fontSize={11} fill="#94a3b8">
            RS-Ratio  →  relative strength
          </text>
          <text
            x={14}
            y={(PY0 + PY1) / 2}
            textAnchor="middle"
            fontSize={11}
            fill="#94a3b8"
            transform={`rotate(-90 14 ${(PY0 + PY1) / 2})`}
          >
            RS-Momentum  →  acceleration
          </text>

          {/* sector tails + heads */}
          {sectors.map((s) => {
            const tail = s.rrg!.tail;
            const color = QUADRANT_COLORS[s.rrg!.quadrant];
            const active = hover === s.ticker;
            const dim = hover !== null && !active;
            const path = tail.map((p, i) => `${i ? 'L' : 'M'}${sx(p.rsRatio).toFixed(1)} ${sy(p.rsMomentum).toFixed(1)}`).join(' ');
            const head = tail[tail.length - 1];
            return (
              <g key={s.ticker} opacity={dim ? 0.2 : 1} style={{ transition: 'opacity 120ms' }}>
                <path d={path} fill="none" stroke={color} strokeWidth={active ? 2.5 : 1.5} strokeLinecap="round" opacity={0.5} />
                {tail.slice(0, -1).map((p, i) => (
                  <circle key={i} cx={sx(p.rsRatio)} cy={sy(p.rsMomentum)} r={2} fill={color} opacity={0.35 + (0.5 * i) / tail.length} />
                ))}
                <circle
                  cx={sx(head.rsRatio)}
                  cy={sy(head.rsMomentum)}
                  r={active ? 8 : 6}
                  fill={color}
                  stroke="#0f172a"
                  strokeWidth={1.5}
                  onMouseEnter={() => setHover(s.ticker)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'pointer' }}
                />
                <text
                  x={sx(head.rsRatio) + 9}
                  y={sy(head.rsMomentum) + 4}
                  fontSize={11}
                  fontWeight={700}
                  fill="#e2e8f0"
                  pointerEvents="none"
                >
                  {s.ticker}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
        {QUADRANTS.map(({ q }) => (
          <span key={q} className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: QUADRANT_COLORS[q] }} />
            {q}
          </span>
        ))}
      </div>
    </section>
  );
}
