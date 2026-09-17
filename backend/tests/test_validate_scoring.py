"""Leakage, execution, missing observations and fail-closed validation contracts."""
import sys
import json
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_scoring import (  # noqa: E402
    audit, diagnose, forward_outcome, inspect_series, point_in_time_record, score_on_date, split_label, summarize_cohort,
)
from backtest_scoring import window_ic  # noqa: E402
from validate_product_paths import path_comparison, replay  # noqa: E402


def test_publication_and_revision_do_not_time_travel():
    original = {'period_end': '2025-03-31', 'available_at': '2025-05-01', 'version': 'original', 'source': 'filing', 'roe': 10}
    revised = {**original, 'available_at': '2025-08-01', 'version': 'amended', 'roe': 20}
    assert point_in_time_record([original, revised], '2025-04-30') is None
    assert point_in_time_record([original, revised], '2025-05-01') is None
    assert point_in_time_record([original, revised], '2025-05-02')['roe'] == 10
    assert point_in_time_record([original, revised], '2025-08-02')['roe'] == 20
    assert point_in_time_record([{'period_end': '2025-03-31', 'roe': 99}], '2026-01-01') is None


def test_execution_is_after_signal_with_two_sided_cost_and_path_drawdown():
    calendar = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04']
    rows = {d: {'close': p} for d, p in zip(calendar, [1, 100, 80, 110], strict=True)}
    r = forward_outcome(rows, calendar, 0, 2, 10)
    assert r['gross'] == pytest.approx(.1)
    assert r['net'] == pytest.approx(110 * .999 / (100 * 1.001) - 1)
    assert r['drawdown'] == pytest.approx(-.2)
    assert r['entry'] == '2025-01-02'
    del rows['2025-01-03']
    assert forward_outcome(rows, calendar, 0, 2, 10) is None
    assert forward_outcome(rows, calendar, 0, 120, 10) is None


def test_overlapping_labels_purged():
    assert split_label('2025-06-30', '2025-01-01', '2025-07-01') == 'development'
    assert split_label('2025-07-01', '2025-01-01', '2025-07-01') == 'purged'
    assert split_label('2025-08-01', '2025-07-01', '2025-07-01') == 'holdout'


def test_bad_rows_and_source_changes_are_visible():
    rows = [{'date': '2025-01-01', 'close': 100, 'source': 'a'}, {'date': '2025-01-01', 'close': 10, 'source': 'b'}]
    assert set(inspect_series(rows)) == {'invalid_or_duplicate_dates', 'mixed_sources', 'unreviewed_jump_over_50pct'}
    assert 'invalid_close' in inspect_series([{'date': '2025-01-01', 'close': float('nan')}])


def test_ties_do_not_create_arbitrary_top_bottom_portfolios():
    r = summarize_cohort([{'score': 50, 'gross': i / 100, 'net': 0, 'drawdown': 0} for i in range(10)])
    assert r['ic'] is None
    assert r['top_net'] is None


def test_strict_adapter_cannot_silently_authorize_weights():
    report = audit([{'ticker': 'A', 'market': 'US'}], {}, {})
    assert report['strict_status'] == 'blocked'
    assert report['model_change_allowed'] is False
    assert 'fundamental_vintages' in report['blockers']


def test_old_dated_cli_logic_is_rejected():
    with pytest.raises(ValueError, match='calendar aligned'):
        window_ic([], {'A': [{'date': '2025-01-01', 'close': 1}]}, 1, 1)


def test_future_prices_and_current_financials_do_not_change_historical_signal():
    stocks = [{'ticker': str(i), 'market': 'US', 'pe': 10, 'roe': 30} for i in range(10)]
    bars = {s['ticker']: [{'date': (date(2024, 1, 1) + timedelta(days=j)).isoformat(), 'close': 100 + j * (int(s['ticker']) + 1) / 20} for j in range(260)] for s in stocks}
    day = bars['0'][220]['date']
    before = score_on_date(stocks, bars, day)
    for s in stocks:
        s.update(pe=1000, roe=-100, qualityScore=100, score=100)
        for r in bars[s['ticker']][221:]:
            r['close'] *= 3
    after = score_on_date(stocks, bars, day)
    assert [s['timingScore'] for s in before] == [s['timingScore'] for s in after]
    assert all(s['qualityScore'] is None and s['score'] is None for s in after)
    assert all(s['scoring']['priceAsOf'] == day for s in after)


def test_daily_leverage_path_is_not_multiple_of_period_return():
    r = path_comparison([100, 130, 130 * (1 - 3 / 11)], [100, 110, 100], 3)
    assert r['multiple_of_period_return'] == 0
    assert r['daily_reset_target'] < 0
    assert r['actual_minus_daily_target'] == pytest.approx(0)
    with pytest.raises(ValueError):
        path_comparison([100, 110], [100], 3)


def test_missing_future_label_rejects_cohort_not_just_the_missing_stock():
    stocks = [{'ticker': str(i), 'market': 'US'} for i in range(10)]
    bars = {s['ticker']: [{'date': (date(2024, 1, 1) + timedelta(days=j)).isoformat(), 'close': 100 + j * (int(s['ticker']) + 1) / 20, 'source': 'test'} for j in range(300)] for s in stocks}
    day = bars['0'][220]['date']
    before = diagnose(stocks, bars, audit(stocks, bars, {}), horizons=(20,), costs=(10,))
    assert any(c['date'] == day for c in before['cohorts'])
    del bars['0'][230]
    after = diagnose(stocks, bars, audit(stocks, bars, {}), horizons=(20,), costs=(10,))
    assert not any(c['date'] == day for c in after['cohorts'])
    assert after['excluded_cohorts']['incomplete_forward_cohort'] > 0


def test_tampered_product_source_is_rejected(tmp_path):
    (tmp_path / 'manifest.json').write_text(json.dumps({'files': {'TQQQ-nav.csv': {'sha256': 'wrong'}}}))
    (tmp_path / 'TQQQ-nav.csv').write_text('changed')
    with pytest.raises(ValueError, match='hash mismatch'):
        replay(tmp_path)
