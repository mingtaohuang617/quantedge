"""Cash reinvestment, split units and one-year checkpoint boundary regressions."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rklx_cash_scenario import cash_scenario  # noqa: E402
from research_calendar import sessions  # noqa: E402
from validate_issuer_checkpoints import boundaries, checkpoints  # noqa: E402


def annual_html():
    rows = [['', '1 Year', '3 Years', '5 Years', 'Since Inception'],
            ['Total Return (%)', '165.59%', 'xx.xx%', 'xx.xx%', '377.88%'],
            ['Market Price (%)', '165.68%', 'xx.xx%', 'xx.xx%', '378.07%']]
    return '<table id="average-06-30-2026" data-date="06-30-2026">' + ''.join(
        '<tr>' + ''.join(f'<th>{v}</th>' for v in row) + '</tr>' for row in rows) + '</table>'


def test_only_explicit_one_year_is_admitted():
    points = checkpoints(annual_html(), include_one_year=True)
    assert len(points) == 1
    assert points[0]['period'] == '1 Year'
    assert points[0]['issuer_market_return'] == pytest.approx(1.6568)
    assert boundaries('2026-08-31', '1 Year') == ('2025-08-29', '2026-08-31')
    with pytest.raises(ValueError):
        checkpoints(annual_html().replace('1 Year', '2 Years'), include_one_year=True)
    with pytest.raises(ValueError):
        checkpoints(annual_html() * 2, include_one_year=True)


def fixture():
    days = sessions('2025-11-28', '2025-12-31')
    rows = [{'date': d, 'close': 100 if d < '2025-12-30' else 90, 'adjusted_close': 100} for d in days]
    point = {'as_of': '2025-12-31', 'period': '1 Month', 'issuer_market_return': 0, 'issuer_nav_return': 0}
    bundle = {'symbol': 'TEST', 'rows': rows, 'actions': [{'kind': 'splits', 'date': '2025-12-09', 'ratio': 3}]}
    return bundle, [point], [{'date': '2025-12-30', 'amount': 10}]


def test_reinvestment_preserves_wealth_without_double_split():
    bundle, points, events = fixture()
    result = cash_scenario(bundle, points, events)
    assert result['checks'][0]['cash_scenario_return'] == pytest.approx(0)
    assert len(result['checks'][0]['splits_in_interval']) == 1
    assert not result['strict_total_return_eligible']
    assert not result['model_change_allowed']
    assert cash_scenario(bundle, points, [])['checks'][0]['cash_scenario_return'] == pytest.approx(-.1)


@pytest.mark.parametrize('events', [[{'date': '2025-12-30', 'amount': -1}],
    [{'date': '2025-12-30', 'amount': float('nan')}], [{'date': '2025-12-25', 'amount': 1}],
    [{'date': '2025-12-30', 'amount': 1}] * 2])
def test_invalid_cash_or_non_session_fails(events):
    bundle, points, _ = fixture()
    with pytest.raises(ValueError):
        cash_scenario(bundle, points, events)


def test_no_interpolation_over_missing_session():
    bundle, points, events = fixture()
    del bundle['rows'][3]
    result = cash_scenario(bundle, points, events)
    assert result['cash_scenario_passed'] == 0
    assert 'cash_scenario_return' not in result['checks'][0]
