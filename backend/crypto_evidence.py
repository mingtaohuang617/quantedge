"""Coinbase spot daily evidence: UTC 24/7, no filling or pooled venue volume."""
import argparse
import json
import math
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import requests

from price_evidence import persist_evidence, read_evidence

PRODUCTS = {'BTC-USD': 'monetary', 'LTC-USD': 'monetary', 'ETH-USD': 'network', 'SOL-USD': 'network',
            'ADA-USD': 'network', 'AVAX-USD': 'network', 'DOT-USD': 'network', 'ATOM-USD': 'network',
            'NEAR-USD': 'network', 'ALGO-USD': 'network'}


def normalize(pages, start, end, retrieved_at):
    first, stop = date.fromisoformat(start), date.fromisoformat(end)
    retrieved = datetime.fromisoformat(retrieved_at)
    if retrieved.tzinfo is None or not first < stop <= retrieved.astimezone(UTC).date():
        raise ValueError('Require completed UTC days')
    by_day = {}
    for page in pages:
        if not isinstance(page, list):
            raise ValueError('Unexpected candle schema')
        for raw in page:
            if len(raw) != 6 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in raw):
                raise ValueError('Invalid candle values')
            stamp, low, high, opening, close, volume = raw
            if stamp % 86400 or min(low, high, opening, close) <= 0 or volume < 0 or not low <= min(opening, close) <= max(opening, close) <= high:
                raise ValueError('Invalid UTC bucket or OHLC bounds')
            day = datetime.fromtimestamp(stamp, UTC).date()
            if not first <= day < stop:
                continue
            row = {'date': str(day), 'open': opening, 'high': high, 'low': low, 'close': close, 'volume': volume}
            if day in by_day and by_day[day] != row:
                raise ValueError('Conflicting duplicate UTC day')
            by_day[day] = row
    expected = [first + timedelta(days=i) for i in range((stop - first).days)]
    missing = [str(d) for d in expected if d not in by_day]
    return {'rows': [by_day[d] for d in expected if d in by_day], 'missing_days': missing,
            'calendar': 'UTC_24_7', 'calendar_complete': not missing, 'volume_scope': 'Coinbase spot base-asset units only',
            'strict_pit_eligible': False, 'limitations': ['Retrieved history is not a historical API vintage',
            'Selected surviving spot products; not historical market membership', 'No network fundamentals, staking, funding or futures returns']}


def collect(product, start, end, root, replay=False):
    first, stop = date.fromisoformat(start), date.fromisoformat(end)
    if product not in PRODUCTS or not 0 < (stop - first).days <= 1100:
        raise ValueError('Bounded reviewed product and date range required')
    pages, evidence = [], []
    cursor = first
    while cursor < stop:
        finish = min(cursor + timedelta(days=290), stop)
        url = f'https://api.exchange.coinbase.com/products/{product}/candles'
        params = {'start': str(cursor) + 'T00:00:00Z', 'end': str(finish) + 'T00:00:00Z', 'granularity': 86400}
        request = {'provider': 'Coinbase Exchange', 'url': url, 'product': product, 'params': params}
        if replay:
            matches = []
            for folder in root.iterdir():
                if not folder.is_dir():
                    continue
                raw, manifest = read_evidence(folder)
                if manifest['request'] == request:
                    matches.append((manifest['retrieved_at'], str(folder), raw, manifest))
            if not matches:
                raise ValueError('Missing exact archived request')
            _, folder, payload, manifest = max(matches)
        else:
            response = requests.get(url, params=params, timeout=25, headers={'User-Agent': 'QuantEdge Research https://mintoview.com'})
            response.raise_for_status()
            folder = persist_evidence(root, response.content, request, datetime.now(UTC).isoformat())
            payload, manifest = read_evidence(folder)
            time.sleep(.15)
        pages.append(payload)
        evidence.append({'folder': str(Path(folder).resolve()), **manifest})
        cursor = finish
    result = normalize(pages, start, end, min(e['retrieved_at'] for e in evidence))
    return {'ticker': product, 'category': PRODUCTS[product], 'start': start, 'end_exclusive': end, **result, 'evidence': evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start', default='2024-01-01')
    parser.add_argument('--end', default='2026-09-15')
    parser.add_argument('--root', type=Path, default=Path('backend/data/crypto_evidence'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--replay', action='store_true')
    args = parser.parse_args()
    results = []
    for product in PRODUCTS:
        try:
            result = collect(product, args.start, args.end, args.root, args.replay)
            result['status'] = 'captured' if result['calendar_complete'] else 'incomplete'
        except (requests.RequestException, ValueError, OSError) as exc:
            result = {'ticker': product, 'status': 'failed', 'error_type': type(exc).__name__, 'detail': str(exc)[:200]}
        results.append(result)
        print(json.dumps({k: v for k, v in result.items() if k in ('ticker', 'status', 'missing_days', 'detail')}), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'results': results, 'model_change_allowed': False}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
