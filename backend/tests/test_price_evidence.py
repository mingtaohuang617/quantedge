"""Return-basis, cash-action and immutable-source regressions; no network."""
import copy
import json
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from price_evidence import exact_total_return, normalize_yahoo, persist_evidence, read_evidence  # noqa: E402
from audit_price_evidence import compare  # noqa: E402


def records(prices, splits=None, cash=None):
    return [{'date': f'2025-01-0{i+1}', 'close': p, 'currency': 'USD', 'split': (splits or [1] * len(prices))[i],
             'cash': (cash or [0] * len(prices))[i], 'actions_complete': True} for i, p in enumerate(prices)]


def returns(rows, basis='raw_as_traded'):
    return exact_total_return(rows, [r['date'] for r in rows], price_basis=basis, currency='USD', cash_basis='same_units_as_close')


def test_split_and_reverse_split_preserve_wealth():
    out = returns(records([100, 50, 250], [1, 2, .2]))
    assert [r['total_return_index'] for r in out] == [100, 100, 100]


def test_cash_distribution_reinvested_not_lost_or_counted_twice():
    assert returns(records([100, 98, 100], cash=[0, 2, 0]))[-1]['total_return_index'] == pytest.approx(100 / 98 * 100)
    assert returns(records([100, 49], splits=[1, 2], cash=[0, 1]))[-1]['total_return_index'] == 100


def test_fixed_share_units_never_reapply_split():
    assert returns(records([50, 50], splits=[1, 2]), 'fixed_split_units')[-1]['total_return_index'] == 100


@pytest.mark.parametrize('change', [{'cash': None}, {'split': None}, {'actions_complete': False}, {'currency': 'HKD'}, {'close': float('nan')}])
def test_missing_action_or_basis_does_not_become_zero(change):
    rows = records([100, 101]); rows[1].update(change)
    with pytest.raises(ValueError):
        returns(rows)


def test_missing_calendar_session_rejected():
    rows = records([100, 101])
    with pytest.raises(ValueError, match='sessions'):
        exact_total_return(rows, ['2025-01-01', '2025-01-02', '2025-01-03'], price_basis='raw_as_traded', currency='USD', cash_basis='same_units_as_close')


def fixture():
    timestamps = [int(datetime(2025, 1, i, tzinfo=UTC).timestamp()) for i in (1, 2, 3)]
    quote = {'open': [100, 100, 100], 'high': [101, 101, 101], 'low': [99, 99, 99], 'close': [100, 100, 100], 'volume': [1, 1, 1]}
    payload = {'chart': {'result': [{'meta': {'symbol': 'TEST', 'dataGranularity': '1d', 'currency': 'USD', 'exchangeTimezoneName': 'UTC'},
                'timestamp': timestamps, 'indicators': {'quote': [quote], 'adjclose': [{'adjclose': [100, 100, 100]}]}}], 'error': None}}
    manifest = {'request': {'symbol': 'TEST', 'start': '2025-01-01', 'end_exclusive': '2025-01-04', 'interval': '1d', 'events': 'div,splits,capitalGains'},
                'retrieved_at': '2025-01-04T10:00:00+00:00'}
    return payload, manifest


def test_vendor_proxy_not_certified_and_today_explicitly_excluded():
    payload, manifest = fixture()
    manifest['retrieved_at'] = '2025-01-03T10:00:00+00:00'
    result = normalize_yahoo(payload, manifest)
    assert len(result['rows']) == 2
    assert result['excluded_sessions'] == ['2025-01-03']
    assert result['strict_total_return_eligible'] is False
    assert result['return_basis'] == 'vendor_adjusted_proxy'


def test_unexplained_adjustment_change_is_quarantined():
    payload, manifest = fixture()
    payload['chart']['result'][0]['indicators']['adjclose'][0]['adjclose'] = [99, 100, 100]
    assert 'adjustment_change_without_action' in normalize_yahoo(payload, manifest)['issues']


def test_missing_adjusted_close_does_not_fallback_to_close():
    payload, manifest = fixture()
    del payload['chart']['result'][0]['indicators']['adjclose']
    with pytest.raises(ValueError, match='lengths differ'):
        normalize_yahoo(payload, manifest)


def test_wrong_symbol_and_unsupported_events_rejected():
    payload, manifest = fixture()
    wrong = copy.deepcopy(manifest); wrong['request']['symbol'] = 'OTHER'
    with pytest.raises(ValueError, match='Wrong symbol'):
        normalize_yahoo(payload, wrong)
    payload['chart']['result'][0]['events'] = {'spinoff': {}}
    with pytest.raises(ValueError, match='Unsupported'):
        normalize_yahoo(payload, manifest)


def test_revisions_are_retained_and_tampering_detected(tmp_path):
    payload, manifest = fixture()
    raw = json.dumps(payload).encode()
    folder = persist_evidence(tmp_path, raw, manifest['request'], manifest['retrieved_at'])
    assert read_evidence(folder)[0] == payload
    assert persist_evidence(tmp_path, raw, manifest['request'], manifest['retrieved_at']) == folder
    revised = persist_evidence(tmp_path, raw, manifest['request'], '2025-01-05T10:00:00+00:00')
    assert revised != folder
    (folder / 'raw.json').write_text('{}')
    with pytest.raises(ValueError, match='hash mismatch'):
        read_evidence(folder)


def test_legacy_comparison_never_compares_two_day_return_to_one_day(tmp_path):
    payload, manifest = fixture()
    folder = persist_evidence(tmp_path, json.dumps(payload).encode(), manifest['request'], manifest['retrieved_at'])
    database = tmp_path / 'test.db'
    with sqlite3.connect(database) as conn:
        conn.execute('CREATE TABLE daily_bars (ticker TEXT, trade_date TEXT, close REAL, source TEXT)')
        conn.executemany('INSERT INTO daily_bars VALUES (?,?,?,?)', [('TEST', '2025-01-01', 100, 'test'), ('TEST', '2025-01-03', 110, 'test')])
    report = compare(database, {'results': [{'status': 'captured', 'evidence_folder': str(folder)}]}, [])
    assert report['results'][0]['matched_return_intervals'] == 0
