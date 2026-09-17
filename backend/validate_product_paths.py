"""Replay verified TQQQ NAV/NDX paths; descriptive product diagnostics, not alpha."""
import argparse
import csv
import hashlib
import io
import json
import math
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from product_ingestion import parse_date, tqqq_tracking


def path_comparison(fund, benchmark, multiple):
    if len(fund) != len(benchmark) or len(fund) < 2:
        raise ValueError('Exactly aligned levels required')
    if any(not math.isfinite(v) or v <= 0 for v in fund + benchmark):
        raise ValueError('Positive finite levels required')
    daily_target = math.prod(1 + multiple * (b / a - 1) for a, b in zip(benchmark[:-1], benchmark[1:], strict=True)) - 1
    naive = multiple * (benchmark[-1] / benchmark[0] - 1)
    actual = fund[-1] / fund[0] - 1
    return {'nav_return': actual, 'daily_reset_target': daily_target,
            'multiple_of_period_return': naive, 'path_compounding_effect': daily_target - naive,
            'actual_minus_daily_target': actual - daily_target}


def replay(cache):
    manifest = json.loads((cache / 'manifest.json').read_text(encoding='utf-8'))['files']
    names = ('TQQQ-nav.csv', 'NDX-chart.json', 'TQQQ-distributions.json', 'TQQQ-actions.json')
    data = {}
    for name in names:
        raw = (cache / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != manifest[name]['sha256']:
            raise ValueError('Source hash mismatch: ' + name)
        data[name] = raw.decode('utf-8') if name.endswith('.csv') else json.loads(raw)
    as_of = manifest['TQQQ-nav.csv']['retrievedAt']
    tracking = tqqq_tracking(data[names[0]], data[names[1]], data[names[2]], data[names[3]], as_of)
    chart = data['NDX-chart.json']['chart']['result'][0]
    nav = {parse_date(r['Date']): float(r['NAV']) for r in csv.DictReader(io.StringIO(data['TQQQ-nav.csv'])) if r.get('Ticker') == 'TQQQ'}
    days = [datetime.fromtimestamp(ts, ZoneInfo('America/New_York')).date().isoformat() for ts in chart['timestamp']]
    pairs = [(d, c) for d, c in zip(days, chart['indicators']['quote'][0]['close'], strict=True) if d <= tracking['asOf']]
    paths = []
    for horizon in (1, 5, 20, 60, 120):
        # Disjoint holding intervals. No model or entry selection on this short window.
        windows = [{'start': pairs[i][0], 'end': pairs[i + horizon][0],
                    **path_comparison([nav[d] for d, _ in pairs[i:i + horizon + 1]],
                                      [v for _, v in pairs[i:i + horizon + 1]], 3)}
                   for i in range(0, len(pairs) - horizon, horizon)]
        paths.append({'horizon': horizon, 'windows': windows, 'count': len(windows)})
    return {'ticker': 'TQQQ', 'available_at': as_of, 'tracking': tracking, 'paths': paths,
            'sources': {n: manifest[n] for n in names}, 'model_change_allowed': False,
            'limitations': ['NAV, not executable market prices; spread and commission excluded',
                            '52 daily returns do not validate product score thresholds or predict returns',
                            'fees are already embedded in NAV; do not subtract expense ratio twice',
                            '60/120-day paths unavailable; no extrapolation']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = replay(args.cache)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'tracking': report['tracking'], 'paths': [(x['horizon'], x['count']) for x in report['paths']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
