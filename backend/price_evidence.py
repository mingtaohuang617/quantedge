"""Immutable source evidence and explicit return bases. No production DB writes.

Yahoo adjusted closes are vendor proxies, not independently certified total returns.
The exact return calculator requires an explicitly normalized input contract.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import date, datetime
from zoneinfo import ZoneInfo


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def iso_day(day):
    if date.fromisoformat(day).isoformat() != day:
        raise ValueError('Expected ISO date')
    return day


def persist_evidence(root, raw, request, retrieved_at):
    """Content-addressed raw bytes AND request/timestamp; revisions cannot overwrite."""
    dt = datetime.fromisoformat(retrieved_at)
    if dt.tzinfo is None:
        raise ValueError('Retrieval time requires timezone')
    manifest = {'schema': 1, 'request': request, 'retrieved_at': retrieved_at,
                'raw_sha256': hashlib.sha256(raw).hexdigest()}
    identity = hashlib.sha256(encode(manifest)).hexdigest()
    folder = root / identity
    folder.mkdir(parents=True, exist_ok=True)
    for name, content in [('raw.json', raw), ('manifest.json', encode(manifest))]:
        path = folder / name
        try:
            with path.open('xb') as stream:
                stream.write(content)
        except FileExistsError:
            if path.read_bytes() != content:
                raise ValueError('Evidence collision or modification') from None
    return folder


def read_evidence(folder):
    manifest_raw = (folder / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_raw)
    raw = (folder / 'raw.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest['raw_sha256']:
        raise ValueError('Raw source hash mismatch')
    if hashlib.sha256(encode(manifest)).hexdigest() != folder.name:
        raise ValueError('Manifest identity mismatch')
    return json.loads(raw), manifest


def exact_total_return(rows, sessions, *, price_basis, currency, cash_basis):
    """Reinvest cash at ex-date close; no tax, commission, FX or intraday execution.

    raw_as_traded: split is new shares / old share; cash is per post-action share.
    fixed_split_units: both prices and cash already use identical share units;
    never apply split ratios a second time. Exact is mathematical, not source-certified.
    """
    if price_basis not in ('raw_as_traded', 'fixed_split_units'):
        raise ValueError('Unknown price basis')
    if not currency or cash_basis != 'same_units_as_close':
        raise ValueError('Cash currency/share-unit reconciliation required')
    days = [iso_day(r['date']) for r in rows]
    if len(days) < 2 or days != sorted(set(days)) or days != sessions:
        raise ValueError('Missing, duplicate or unordered sessions')
    wealth, result = 100., []
    for i, row in enumerate(rows):
        if row.get('currency') != currency or not positive(row.get('close')):
            raise ValueError('Invalid price or inconsistent currency')
        # Explicit zeros/ones required. Missing actions are not interpreted as no actions.
        cash, split = row.get('cash'), row.get('split')
        if not positive(split) or not isinstance(cash, (int, float)) or isinstance(cash, bool) or not math.isfinite(cash) or cash < 0:
            raise ValueError('Explicit valid cash and split observations required')
        if not row.get('actions_complete'):
            raise ValueError('Corporate actions unverified')
        daily = None
        if i:
            share_change = split if price_basis == 'raw_as_traded' else 1.
            daily = (row['close'] + cash) * share_change / rows[i - 1]['close'] - 1
            wealth *= 1 + daily
        result.append({'date': row['date'], 'total_return_index': wealth, 'daily_return': daily})
    return result


def normalize_yahoo(payload, manifest):
    """Preserve supplied OHLC/adjusted close/actions; no guessed split repair."""
    request = manifest['request']
    if request.get('interval') != '1d' or request.get('events') != 'div,splits,capitalGains':
        raise ValueError('Daily series with all supported actions required')
    if payload['chart'].get('error'):
        raise ValueError('Provider returned error')
    results = payload['chart']['result']
    if len(results) != 1:
        raise ValueError('Expected one chart')
    chart = results[0]
    meta = chart['meta']
    if meta['symbol'] != request['symbol'] or meta.get('dataGranularity') != '1d':
        raise ValueError('Wrong symbol or granularity')
    zone = ZoneInfo(meta['exchangeTimezoneName'])
    if not meta.get('currency'):
        raise ValueError('Currency missing')
    timestamps = chart['timestamp']
    quote = chart['indicators']['quote'][0]
    adjusted = chart['indicators'].get('adjclose', [{}])[0].get('adjclose', [])
    fields = ('open', 'high', 'low', 'close', 'volume')
    if any(len(quote.get(k, [])) != len(timestamps) for k in fields) or len(adjusted) != len(timestamps):
        raise ValueError('Price/adjusted-price lengths differ')
    days = [datetime.fromtimestamp(ts, zone).date().isoformat() for ts in timestamps]
    if len(days) < 2 or days != sorted(set(days)):
        raise ValueError('Duplicate or unordered sessions')
    start, end = request['start'], request['end_exclusive']
    # Today's day in the exchange timezone is not certified as a completed bar.
    retrieval_day = datetime.fromisoformat(manifest['retrieved_at']).astimezone(zone).date().isoformat()
    retained = [i for i, d in enumerate(days) if start <= d < end and d < retrieval_day]
    excluded = [d for i, d in enumerate(days) if i not in retained]
    if len(retained) < 2:
        raise ValueError('Insufficient completed sessions in requested interval')
    quote = {k: [quote[k][i] for i in retained] for k in fields}
    adjusted = [adjusted[i] for i in retained]
    days = [days[i] for i in retained]
    events, actions = chart.get('events', {}), []
    if set(events) - {'dividends', 'splits', 'capitalGains'}:
        raise ValueError('Unsupported corporate-action type')
    issues = []
    for kind, entries in events.items():
        seen = set()
        for key, event in entries.items():
            day = datetime.fromtimestamp(event['date'], zone).date().isoformat()
            if day in seen:
                raise ValueError('Duplicate same-type event date')
            seen.add(day)
            if day not in days:
                issues.append('event_without_price_session')
            if kind == 'splits':
                if not positive(event.get('numerator')) or not positive(event.get('denominator')):
                    raise ValueError('Invalid split ratio')
            elif not positive(event.get('amount')):
                raise ValueError('Invalid distribution')
            actions.append({'kind': kind, 'date': day, 'provider_key': key, 'payload': event})
    action_days = {e['date'] for e in actions}
    rows = []
    for i, day in enumerate(days):
        row = {k: quote[k][i] for k in fields}
        if not all(positive(row[k]) for k in fields[:-1]) or not positive(adjusted[i]):
            raise ValueError('Missing/nonpositive OHLC or adjusted close')
        if row['low'] > min(row['open'], row['close']) or row['high'] < max(row['open'], row['close']) or row['low'] > row['high']:
            raise ValueError('Invalid OHLC ordering')
        if not isinstance(row['volume'], (int, float)) or isinstance(row['volume'], bool) or not math.isfinite(row['volume']) or row['volume'] < 0:
            raise ValueError('Invalid or missing volume')
        factor = adjusted[i] / row['close']
        if i and abs(factor / rows[-1]['vendor_adjustment_factor'] - 1) > .0001 and day not in action_days:
            issues.append('adjustment_change_without_action')
        if i and abs(adjusted[i] / adjusted[i - 1] - 1) > .5:
            issues.append('unreviewed_adjusted_jump_over_50pct')
        rows.append({'date': day, **row, 'adjusted_close': adjusted[i],
                     'vendor_adjustment_factor': factor, 'vendor_return_index': adjusted[i] / adjusted[0] * 100})
    return {'schema': 1, 'normalizer_version': '1.0.0', 'symbol': meta['symbol'], 'currency': meta['currency'], 'timezone': str(zone),
            'instrument_type': meta.get('instrumentType'), 'return_basis': 'vendor_adjusted_proxy',
            'close_basis': 'provider_close_not_asserted_as_traded', 'rows': rows, 'actions': actions,
            'issues': sorted(set(issues)), 'excluded_sessions': excluded, 'source_manifest': manifest,
            'strict_total_return_eligible': False,
            'blockers': ['independent_actions_and_cash_share_units_unverified',
                         'historical_vintages_unavailable_before_retrieval', 'exchange_calendar_not_verified']}


def summarize(bundle):
    return {'symbol': bundle['symbol'], 'first': bundle['rows'][0]['date'], 'last': bundle['rows'][-1]['date'],
            'rows': len(bundle['rows']), 'actions': {kind: sum(a['kind'] == kind for a in bundle['actions']) for kind in ('dividends', 'splits', 'capitalGains')},
            'issues': bundle['issues'], 'return_basis': bundle['return_basis'],
            'strict_total_return_eligible': bundle['strict_total_return_eligible'],
            'excluded_sessions': bundle['excluded_sessions'],
            'raw_sha256': bundle['source_manifest']['raw_sha256']}


def normalize_folder(folder):
    payload, manifest = read_evidence(folder)
    bundle = normalize_yahoo(payload, manifest)
    # A derivative is versioned by its contents, never used to replace raw evidence.
    data = encode(bundle)
    target = folder / ('normalized-' + hashlib.sha256(data).hexdigest() + '.json')
    try:
        with target.open('xb') as stream:
            stream.write(data)
    except FileExistsError:
        if target.read_bytes() != data:
            raise ValueError('Modified normalized evidence') from None
    return bundle
