"""Calendar gaps and additive-adjustment return traps, without network access."""
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reconcile_rklx import affine_diagnostic, distribution  # noqa: E402
from research_calendar import audit_sessions, sessions  # noqa: E402
from validate_scoring import inspect_series  # noqa: E402


def test_exceptional_closure_and_half_day_are_distinct():
    assert sessions('2025-01-08', '2025-01-10') == ['2025-01-08', '2025-01-10']
    assert sessions('2025-07-03', '2025-07-07') == ['2025-07-03', '2025-07-07']
    assert sessions('2025-11-27', '2025-11-28') == ['2025-11-28']
    assert sessions('2026-07-02', '2026-07-06') == ['2026-07-02', '2026-07-06']


@pytest.mark.parametrize('start,end,market', [('2024-12-31', '2025-01-02', 'US_EQUITY'),
    ('2026-09-15', '2026-09-16', 'US_EQUITY'), ('2025-01-08', '2025-01-07', 'US_EQUITY'),
    ('2025-01-08', '2025-01-10', 'HK')])
def test_calendar_does_not_guess(start, end, market):
    with pytest.raises(ValueError):
        sessions(start, end, market)


def test_gaps_duplicates_and_holiday_bars_are_not_silently_dropped():
    result = audit_sessions(['2025-01-08', '2025-01-08', '2025-01-09'], '2025-01-08', '2025-01-10')
    assert not result['passed']
    assert result['missing'] == ['2025-01-10']
    assert result['unexpected'] == ['2025-01-09']
    assert result['duplicates'] == ['2025-01-08']


def issuer_row(day='2025-12-30', amount='5.94640256'):
    return f'<tr><td data-sort="{day}" data-mtr-content="Ex-Div Date "></td><td data-sort="{amount}" data-mtr-content="Amount ($) "></td></tr>'


def test_cash_precision_and_future_unknown_amount():
    html = issuer_row('2026-12-30', '--') + issuer_row()
    assert distribution(html, '2025-12-30') - Decimal('5.946') == Decimal('0.00040256')


@pytest.mark.parametrize('html', ['', issuer_row() * 2, issuer_row(amount='NaN')])
def test_issuer_absent_duplicate_and_invalid_fail_closed(html):
    with pytest.raises(ValueError):
        distribution(html, '2025-12-30')


def test_additive_adjustment_explains_distortion_but_does_not_repair():
    result = affine_diagnostic([(6, .1), (7, 1.1), (8, 2.1)])
    assert result['offset'] == pytest.approx(-5.9)
    assert result['slope'] == pytest.approx(1)
    assert 1.1 / .1 - 1 > 10 * (7 / 6 - 1)


def test_negative_low_blocks_even_when_close_is_positive():
    assert 'nonpositive_or_missing_ohlc_not_return_eligible' in inspect_series([
        {'date': '2025-03-13', 'open': .7, 'high': .8, 'low': -.04, 'close': .1, 'source': 'futu'}])
