"""Conditional cash-reinvestment research; never certifies provider share units."""
import argparse
import hashlib
import json
import math
from pathlib import Path

from price_evidence import normalize_folder, positive
from reconcile_rklx import distribution
from validate_issuer_checkpoints import checkpoints, evaluate


def cash_scenario(bundle, points, cash_events):
    """Assume supplied closes/cash share fixed split units and events are complete.

    These are explicit hypotheses, not an actions_complete assertion. No extra
    split multiplier is applied to prices hypothesized to be split-adjusted.
    """
    event_days = [e['date'] for e in cash_events]
    if len(set(event_days)) != len(event_days):
        raise ValueError('Duplicate cash dates')
    if any(not positive(e['amount']) for e in cash_events):
        raise ValueError('Invalid cash amount')
    mapping = {r['date']: r for r in bundle['rows']}
    if any(d not in mapping for d in event_days):
        raise ValueError('Cash event has no trading close')
    if any(not positive(r['close']) for r in bundle['rows']):
        raise ValueError('Invalid scenario close')
    result = evaluate(points, bundle)
    for check in result['checks']:
        if check['status'] not in ('within_display_rounding', 'mismatch'):
            continue
        start, end = check['start'], check['end']
        events = [e for e in cash_events if start < e['date'] <= end]
        factor = math.prod(1 + e['amount'] / mapping[e['date']]['close'] for e in events)
        scenario = mapping[end]['close'] / mapping[start]['close'] * factor - 1
        delta = (scenario - check['issuer_market_return']) * 10000
        check.update(cash_scenario_return=scenario, cash_scenario_difference_bps=delta,
                     cash_scenario_status='within_display_rounding' if abs(delta) <= .5 + 1e-8 else 'mismatch',
                     cash_events_applied=events,
                     splits_in_interval=[e for e in bundle['actions'] if e['kind'] == 'splits' and start < e['date'] <= end])
    result['cash_scenario_passed'] = sum(r.get('cash_scenario_status') == 'within_display_rounding' for r in result['checks'])
    result['assumptions'] = ['Close and cash use the same fixed split-adjusted share units',
                             'Supplied issuer cash list is complete within each interval',
                             'Cash is reinvested at ex-date market close; no tax or trading costs',
                             'Split is not multiplied again; no independent raw-price certification']
    result['return_basis'] = 'conditional_issuer_cash_reinvestment'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('issuer-folder', 'evidence-folder', 'output'):
        parser.add_argument('--' + arg, type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.issuer_folder / 'manifest.json').read_text(encoding='utf-8'))['files']['RKLX.html']
    raw = (args.issuer_folder / 'RKLX.html').read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest['sha256']:
        raise ValueError('Issuer source hash mismatch')
    html = raw.decode('utf-8')
    bundle = normalize_folder(args.evidence_folder)
    if bundle['symbol'] != 'RKLX':
        raise ValueError('Expected RKLX')
    if ({e['date'] for e in bundle['actions'] if e['kind'] == 'dividends'} != {'2025-12-30'}
            or any(e['kind'] == 'capitalGains' for e in bundle['actions'])):
        raise ValueError('Corporate action set changed; review required')
    # Reviewed event from the issuer table, not a fitted amount. Unknown future
    # distributions are not turned into zero cash and cannot enter these periods.
    events = [{'date': '2025-12-30', 'amount': float(distribution(html, '2025-12-30'))}]
    points = checkpoints(html, include_one_year=True)
    if any(p['as_of'] not in ('2026-06-30', '2026-08-31') for p in points):
        raise ValueError('Outside reviewed checkpoint dates')
    result = cash_scenario(bundle, points, events)
    result['sources'] = {'issuer': manifest, 'candidate': bundle['source_manifest']}
    result['event_review_scope'] = 'RKLX 2025-12-30 cash event only; no general-purpose issuer action completeness claim'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'checks': len(result['checks']), 'vendor_passed': result['passed_checkpoints'],
                      'cash_scenario_passed': result['cash_scenario_passed'], 'strict_total_return_eligible': False}))
    return 0 if result['cash_scenario_passed'] == len(result['checks']) else 2


if __name__ == '__main__':
    raise SystemExit(main())
