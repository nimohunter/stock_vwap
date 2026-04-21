#!/usr/bin/env python3
"""Download daily OHLCV data for all tickers and save to app/data/*.json.
Run this script whenever you want to refresh the local data.
  pip install yfinance
  python3 scripts/download-data.py
"""
import sys, json, os, time
from pathlib import Path

try:
    import yfinance as yf
except ImportError:
    print("Install yfinance first:  pip install yfinance")
    sys.exit(1)

TICKERS = ['NVDA', 'META', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'VOO', 'SPMO', 'GLD']
OUT_DIR = Path(__file__).parent.parent / 'app' / 'data'
OUT_DIR.mkdir(parents=True, exist_ok=True)
PERIOD = '2y'

for ticker in TICKERS:
    print(f'Downloading {ticker}...', end=' ', flush=True)
    try:
        df = yf.download(ticker, period=PERIOD, interval='1d', auto_adjust=True, progress=False)
        # Newer yfinance returns MultiIndex columns — flatten them
        if isinstance(df.columns, __import__('pandas').MultiIndex):
            df.columns = df.columns.droplevel(1)
        df = df.dropna()
        bars = [
            {
                'date': d.strftime('%Y-%m-%d'),
                'open':   round(float(row['Open']), 4),
                'high':   round(float(row['High']), 4),
                'low':    round(float(row['Low']), 4),
                'close':  round(float(row['Close']), 4),
                'volume': int(row['Volume']),
            }
            for d, row in df.iterrows()
        ]
        (OUT_DIR / f'{ticker}.json').write_text(json.dumps(bars))
        print(f'{len(bars)} bars saved  [{bars[0]["date"]} → {bars[-1]["date"]}]')
    except Exception as e:
        print(f'ERROR: {e}')
    time.sleep(1)

print('Done! Restart the Next.js dev server to pick up new data.')
