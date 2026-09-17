"""Explicit bounded Yahoo pilot collection; no fallback, database writes or repair."""
import argparse
import json
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import quote

import requests

from price_evidence import iso_day, normalize_folder, persist_evidence, read_evidence, summarize


def replay_symbol(symbol, start, end, root):
    candidates = []
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        _, manifest = read_evidence(folder)
        req = manifest['request']
        if (req['symbol'], req['start'], req['end_exclusive']) == (symbol, start, end):
            candidates.append((manifest['retrieved_at'], folder))
    if not candidates:
        raise ValueError('No matching archived source')
    folder = max(candidates)[1]
    return {**summarize(normalize_folder(folder)), 'evidence_folder': str(folder.resolve())}


def collect(symbol, start, end, root):
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + quote(symbol, safe='')
    params = {'period1': int(datetime.fromisoformat(start).replace(tzinfo=UTC).timestamp()),
              'period2': int(datetime.fromisoformat(end).replace(tzinfo=UTC).timestamp()),
              'interval': '1d', 'events': 'div,splits,capitalGains', 'includeAdjustedClose': 'true'}
    response = requests.get(url, params=params, headers={'User-Agent': 'QuantEdge-Research/1.0'}, timeout=25)
    response.raise_for_status()
    retrieved = datetime.now(UTC).isoformat()
    folder = persist_evidence(root, response.content,
        {'provider': 'Yahoo Finance', 'url': url, 'symbol': symbol, 'start': start,
         'end_exclusive': end, 'interval': '1d', 'events': params['events'], 'params': params}, retrieved)
    bundle = normalize_folder(folder)
    return {**summarize(bundle), 'evidence_folder': str(folder.resolve())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--symbols', nargs='+', required=True)
    parser.add_argument('--start', required=True)
    parser.add_argument('--end', required=True, help='Exclusive date; never includes today')
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--replay', action='store_true', help='Replay exact matching archived requests without network')
    args = parser.parse_args()
    if not iso_day(args.start) < iso_day(args.end) <= date.today().isoformat():
        parser.error('Require start < end <= today')
    if len(args.symbols) > 20 or len(set(args.symbols)) != len(args.symbols):
        parser.error('At most 20 unique symbols per explicit run')
    results = []
    for symbol in args.symbols:
        try:
            runner = replay_symbol if args.replay else collect
            result = runner(symbol, args.start, args.end, args.root)
            result['status'] = 'captured'
        except (requests.RequestException, ValueError, KeyError, TypeError, IndexError, OSError) as exc:
            result = {'symbol': symbol, 'status': 'failed', 'error_type': type(exc).__name__}
            if isinstance(exc, ValueError):
                result['detail'] = str(exc)[:200]
        results.append(result)
        print(json.dumps(result, ensure_ascii=False), flush=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({'start': args.start, 'end_exclusive': args.end, 'results': results,
        'production_database_modified': False, 'model_change_allowed': False}, ensure_ascii=False, indent=2), encoding='utf-8')
    return int(any(r['status'] == 'failed' for r in results))


if __name__ == '__main__':
    raise SystemExit(main())
