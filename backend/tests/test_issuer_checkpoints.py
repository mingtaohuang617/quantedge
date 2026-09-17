"""Independent checkpoint validation must not become full-series certification."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_issuer_checkpoints import boundaries, checkpoints, evaluate  # noqa: E402
from research_calendar import sessions  # noqa: E402


def html():
    rows = [ ['', 'YTD', '1 Month', '3 Months', '6 Months', 'Since Inception'],
             ['Total Return NAV (%)', '1.00%', '2.00%', '3.00%', '4.00%', '5.00%'],
             ['Market Price (%)', '1.10%', '2.10%', '3.10%', '4.10%', '5.10%'] ]
    return '<table id="cumulative-test" data-date="08-31-2026">' + ''.join(
        '<tr>' + ''.join(f'<td><span>{cell}</span></td>' for cell in row) + '</tr>' for row in rows) + '</table>'


def test_cumulative_market_and_nav_are_distinct_and_inception_excluded():
    result = checkpoints(html())
    assert len(result) == 4
    assert result[0]['issuer_market_return'] == pytest.approx(.011)
    assert result[0]['issuer_nav_return'] == .01
    assert all(r['period'] != 'Since Inception' for r in result)


@pytest.mark.parametrize('source', ['', html() * 2, html().replace('1.10%', 'N/A'),
    html().replace('Market Price (%)', 'Annualized Market Price (%)'), html().replace('</table>', '')])
def test_bad_or_changed_schema_fails_closed(source):
    with pytest.raises(ValueError):
        checkpoints(source)


def test_weekend_month_end_uses_calendar_not_available_rows():
    assert boundaries('2026-08-31', '6 Months') == ('2026-02-27', '2026-08-31')
    assert boundaries('2026-06-30', '1 Month') == ('2026-05-29', '2026-06-30')
    with pytest.raises(ValueError):
        boundaries('2026-08-30', '1 Month')


def candidate(last=110):
    days = sessions('2026-07-31', '2026-08-31')
    return {'symbol': 'TEST', 'rows': [{'date': d, 'adjusted_close': last if d == days[-1] else 100} for d in days]}


POINT = {'as_of': '2026-08-31', 'period': '1 Month', 'issuer_market_return': .10, 'issuer_nav_return': .09}


def test_rounding_pass_never_certifies_total_returns():
    result = evaluate([POINT], candidate())
    assert result['passed_checkpoints'] == 1
    assert not result['strict_total_return_eligible']
    assert not result['model_change_allowed']
    assert result['checks'][0]['market_minus_nav_bps'] == pytest.approx(100)


def test_mismatch_and_missing_session_are_not_repaired():
    assert evaluate([POINT], candidate(111))['checks'][0]['status'] == 'mismatch'
    bundle = candidate()
    del bundle['rows'][3]
    assert evaluate([POINT], bundle)['checks'][0]['status'] == 'missing_or_unexpected_sessions'


def test_duplicate_and_out_of_range_are_rejected():
    bundle = candidate()
    bundle['rows'].append(bundle['rows'][-1])
    with pytest.raises(ValueError):
        evaluate([POINT], bundle)
    result = evaluate([{**POINT, 'as_of': '2024-12-31'}], candidate())
    assert result['checks'][0]['status'] == 'unsupported_scope'
