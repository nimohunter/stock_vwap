/**
 * Reader + types for the locally cached FlashAlpha options summaries
 * (app/data/<TICKER>.options.json, refreshed at most once a day by
 * scripts/fetch-options-data.mjs — the free API key allows 5 queries/day).
 * Only fields the UI consumes are typed; the raw payload is preserved on disk.
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'app/data');

export interface OptionsSummary {
  asOf: string;
  spot: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
  netGex: number | null;
  regime: string | null;
  gammaInterpretation: string | null;
  highestOiStrike: number | null;
  oiWeightedDte: number | null;
  pcRatioOi: number | null;
  pcRatioVolume: number | null;
  totalCallOi: number | null;
  totalPutOi: number | null;
  atmIv: number | null;
  hv20: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Returns null when no cached options data exists for the symbol (most tickers). */
export function loadOptionsSummary(symbol: string): OptionsSummary | null {
  const file = path.join(DATA_DIR, `${symbol.toUpperCase()}.options.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const { summary } = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const exp = summary?.exposure ?? {};
    const flow = summary?.options_flow ?? {};
    const vol = summary?.volatility ?? {};
    return {
      asOf: str(summary?.as_of) ?? '',
      spot: num(summary?.price?.last),
      callWall: num(exp.call_wall),
      putWall: num(exp.put_wall),
      gammaFlip: num(exp.gamma_flip),
      netGex: num(exp.net_gex),
      regime: str(exp.regime),
      gammaInterpretation: str(exp.interpretation?.gamma),
      highestOiStrike: num(exp.highest_oi_strike),
      oiWeightedDte: num(exp.oi_weighted_dte),
      pcRatioOi: num(flow.pc_ratio_oi),
      pcRatioVolume: num(flow.pc_ratio_volume),
      totalCallOi: num(flow.total_call_oi),
      totalPutOi: num(flow.total_put_oi),
      atmIv: num(vol.atm_iv),
      hv20: num(vol.hv_20),
    };
  } catch {
    return null;
  }
}
