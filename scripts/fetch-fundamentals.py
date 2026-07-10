#!/usr/bin/env python3
"""Fetch fundamentals + analyst consensus + earnings calendar for all tickers via
yfinance and cache to app/data/<TICKER>.fundamentals.json (one file per ticker).

Skips tickers whose cache is younger than STALE_HOURS, so repeated runs are free.
Run locally or from the nightly GitHub Action:
  pip install yfinance
  python3 scripts/fetch-fundamentals.py
ETFs (VOO/SPMO/GLD) simply store nulls for the fields they don't have.
"""
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print('Install yfinance first:  pip install yfinance')
    sys.exit(1)

ROOT = Path(__file__).parent.parent
TICKERS = json.loads((ROOT / 'app' / 'lib' / 'tickers.json').read_text())
OUT_DIR = ROOT / 'app' / 'data'
STALE_HOURS = 20

# yfinance Ticker.info keys → our stable output keys.
INFO_FIELDS = {
    'name': ('longName', 'shortName'),
    'sector': ('sector',),
    'industry': ('industry',),
    'marketCap': ('marketCap',),
    'beta': ('beta',),
    'trailingPE': ('trailingPE',),
    'forwardPE': ('forwardPE',),
    'peg': ('pegRatio', 'trailingPegRatio'),
    'priceToBook': ('priceToBook',),
    'priceToSales': ('priceToSalesTrailing12Months',),
    'evToEbitda': ('enterpriseToEbitda',),
    'trailingEps': ('trailingEps',),
    'forwardEps': ('forwardEps',),
    'profitMargin': ('profitMargins',),
    'operatingMargin': ('operatingMargins',),
    'roe': ('returnOnEquity',),
    'revenueGrowth': ('revenueGrowth',),
    'earningsGrowth': ('earningsGrowth',),
    'totalCash': ('totalCash',),
    'totalDebt': ('totalDebt',),
    'debtToEquity': ('debtToEquity',),
    'currentRatio': ('currentRatio',),
    'freeCashflow': ('freeCashflow',),
    'dividendYield': ('dividendYield',),
    'payoutRatio': ('payoutRatio',),
    'shortPctFloat': ('shortPercentOfFloat',),
    'shortRatio': ('shortRatio',),
    'recommendation': ('recommendationKey',),
    'targetMean': ('targetMeanPrice',),
    'targetHigh': ('targetHighPrice',),
    'targetLow': ('targetLowPrice',),
    'numAnalysts': ('numberOfAnalystOpinions',),
}


def clean(v):
    if v is None or isinstance(v, str):
        return v
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else (int(f) if f == int(f) and abs(f) >= 1000 else round(f, 6))
    except (TypeError, ValueError):
        return None


def col(row, *names):
    for n in names:
        if n in row.index:
            return clean(row[n])
    return None


def fetch_earnings(tk):
    """Upcoming report (date + estimate) and past reports (with actual + surprise)."""
    upcoming, past = None, []
    try:
        ed = tk.earnings_dates
        if ed is None or ed.empty:
            return upcoming, past
        today = datetime.now(timezone.utc).date()
        for idx, row in ed.iterrows():
            d = idx.date()
            rec = {
                'date': d.isoformat(),
                'epsEstimate': col(row, 'EPS Estimate', 'epsEstimate'),
                'epsActual': col(row, 'Reported EPS', 'epsActual'),
                'surprisePct': col(row, 'Surprise(%)', 'surprisePct'),
            }
            if rec['epsActual'] is None and d >= today:
                # keep the nearest future report
                if upcoming is None or rec['date'] < upcoming['date']:
                    upcoming = rec
            elif rec['epsActual'] is not None:
                past.append(rec)
        past.sort(key=lambda r: r['date'], reverse=True)
    except Exception as e:  # earnings data is best-effort (ETFs have none)
        print(f'(earnings: {e})', end=' ')
    return upcoming, past[:8]


def is_fresh(path):
    if not path.exists():
        return False
    try:
        fetched = json.loads(path.read_text())['fetched_at']
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(fetched)).total_seconds() / 3600
        return age_h < STALE_HOURS
    except Exception:
        return False


for ticker in TICKERS:
    out_file = OUT_DIR / f'{ticker}.fundamentals.json'
    if is_fresh(out_file):
        print(f'{ticker}: fundamentals fresh, skipping')
        continue
    print(f'{ticker}: fetching fundamentals...', end=' ', flush=True)
    try:
        tk = yf.Ticker(ticker)
        info = tk.info or {}
        data = {out: next((clean(info[k]) for k in keys if info.get(k) is not None), None)
                for out, keys in INFO_FIELDS.items()}
        upcoming, past = fetch_earnings(tk)
        out_file.write_text(json.dumps({
            'fetched_at': datetime.now(timezone.utc).isoformat(),
            'info': data,
            'earnings': {'upcoming': upcoming, 'past': past},
        }))
        print(f'ok (next earnings: {upcoming["date"] if upcoming else "n/a"}, past reports: {len(past)})')
    except Exception as e:
        print(f'ERROR: {e} — keeping existing data')
    time.sleep(1)

print('Fundamentals refresh complete.')
