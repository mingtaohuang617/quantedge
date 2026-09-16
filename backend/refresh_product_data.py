"""Refresh public issuer observations without touching prices or the database.

python backend/refresh_product_data.py
python backend/refresh_product_data.py --cache-only --as-of 2026-09-16
"""
import argparse
import hashlib
import json
import os
from datetime import date, datetime, timedelta, UTC
from pathlib import Path

import requests

from product_ingestion import REGISTRY, ROOT, issuer_observations, tqqq_tracking

OUTPUT = ROOT / 'frontend/src/lib/product-observations.json'


def refresh(as_of, cache_only=False, output=OUTPUT):
    cache = ROOT / 'backend/data/product_sources' / as_of
    cache.mkdir(parents=True, exist_ok=True)
    manifest, products, issues = {}, {}, []

    def read(name, url, params=None):
        path = cache / name
        if not cache_only:
            response = requests.get(url, params=params, timeout=20, headers={'User-Agent': 'QuantEdge-Research/1.0'})
            response.raise_for_status()
            path.write_bytes(response.content)
        raw = path.read_bytes()
        manifest[name] = {'source': url, 'params': params, 'retrievedAt': as_of, 'sha256': hashlib.sha256(raw).hexdigest()}
        return raw.decode('utf-8-sig')

    for ticker, config in REGISTRY.items():
        try:
            products[ticker] = issuer_observations(ticker, read(ticker + '.html', config['source']), as_of)
        except (requests.RequestException, ValueError, KeyError, IndexError, OSError) as exc:
            # Do not silently retain an old successful score after a parser or feed failure.
            products[ticker] = {'productDataAsOf': as_of, 'productMetrics': {}, 'productDataIssues': ['issuer_fetch_or_schema_failure']}
            issues.append({'ticker': ticker, 'stage': 'issuer', 'error': type(exc).__name__})

    start = date.fromisoformat(as_of) - timedelta(days=77)
    params = {'period1': int(datetime.combine(start, datetime.min.time(), UTC).timestamp()),
              'period2': int(datetime.combine(date.fromisoformat(as_of), datetime.min.time(), UTC).timestamp()),
              'interval': '1d', 'events': 'div,splits'}
    try:
        nav = read('TQQQ-nav.csv', 'https://accounts.profunds.com/etfdata/ByFund/TQQQ-historical_nav.csv')
        ndx = json.loads(read('NDX-chart.json', 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX', params))
        actions = json.loads(read('TQQQ-actions.json', 'https://query1.finance.yahoo.com/v8/finance/chart/TQQQ', params))
        distributions = json.loads(read('TQQQ-distributions.json', 'https://www.proshares.com/api/distributionsummary/', {'fund': 'TQQQ', 'year': as_of[:4]}))
        products['TQQQ']['productMetrics']['dailyTrackingError'] = tqqq_tracking(nav, ndx, distributions, actions, as_of)
    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError, OSError) as exc:
        products['TQQQ']['productDataIssues'].append('tracking_alignment_or_action_review_required')
        issues.append({'ticker': 'TQQQ', 'stage': 'tracking', 'error': type(exc).__name__, 'detail': str(exc)[:180] if isinstance(exc, ValueError) else None})
    products['EWY']['productDataIssues'].append('official_index_daily_series_required')
    products['RKLX']['productDataIssues'].append('nav_total_return_daily_series_required')
    payload = {'schemaVersion': 1, 'asOf': as_of, 'products': products}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    os.replace(temp, output)
    (cache / 'manifest.json').write_text(json.dumps({'files': manifest, 'issues': issues}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return payload, issues


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-only', action='store_true')
    parser.add_argument('--as-of', default=date.today().isoformat())
    args = parser.parse_args()
    date.fromisoformat(args.as_of)
    if not args.cache_only and args.as_of != date.today().isoformat():
        parser.error('Live retrieval must use today; use cache-only to replay a dated snapshot')
    result, errors = refresh(args.as_of, args.cache_only)
    print(json.dumps({'asOf': result['asOf'], 'metricCounts': {k: len(v['productMetrics']) for k, v in result['products'].items()}, 'issues': errors}, ensure_ascii=False))
