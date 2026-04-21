import { VwapBands } from '@/app/lib/vwap';

interface Props {
  currentPrice: number;
  bands: VwapBands | null;
}

function sdZone(price: number, b: VwapBands): string {
  if (price >= b.upper2) return 'above +2σ';
  if (price >= b.upper1) return '+1σ to +2σ';
  if (price >= b.vwap)   return '0 to +1σ';
  if (price >= b.lower1) return '-1σ to 0';
  if (price >= b.lower2) return '-2σ to -1σ';
  return 'below -2σ';
}

export default function StatsPanel({ currentPrice, bands }: Props) {
  if (!bands) return null;

  const pct = ((currentPrice - bands.vwap) / bands.vwap) * 100;
  const above = pct >= 0;
  const zone = sdZone(currentPrice, bands);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
      <div className="bg-slate-800 rounded-lg p-4">
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Price</p>
        <p className="text-white text-2xl font-bold">${currentPrice.toFixed(2)}</p>
      </div>

      <div className="bg-slate-800 rounded-lg p-4">
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">1Y VWAP</p>
        <p className="text-blue-400 text-2xl font-bold">${bands.vwap.toFixed(2)}</p>
        <span className={`text-xs font-semibold ${above ? 'text-green-400' : 'text-red-400'}`}>
          {above ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
        </span>
      </div>

      <div className="bg-slate-800 rounded-lg p-4">
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Zone</p>
        <p className="text-white text-sm font-semibold mt-1">{zone}</p>
      </div>

      <div className="bg-slate-800 rounded-lg p-4">
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">Bands</p>
        <p className="text-xs text-slate-300 leading-5">
          +2σ {bands.upper2.toFixed(2)}<br />
          +1σ {bands.upper1.toFixed(2)}<br />
          -1σ {bands.lower1.toFixed(2)}<br />
          -2σ {bands.lower2.toFixed(2)}
        </p>
      </div>
    </div>
  );
}
