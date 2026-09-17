"""No-network regressions for admission and missing historical quality inputs."""
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from financial_admission import select_admitted  # noqa: E402
from historical_quality_trial import trial  # noqa: E402
from verify_sec_originals import compare  # noqa: E402


def record(concept='NetIncomeLoss', start='2020-01-01', end='2020-12-31', value=10, accession='old'):
    return dict(cik='0000000001', concept=concept, start=start, end=end, value=value, accession=accession,
                unit='USD', status='filing_linked_candidate', original_check='matched',
                source='https://example.test/' + accession, accepted_at='2021-02-01T20:00:00Z',
                available_at='2021-02-02T05:00:00Z')


def notice():
    return dict(cik='0000000001', affected_period_ends=['2020-12-31'], source='https://example.test/notice',
                known_at='2021-03-01T20:00:00Z', replacement_accessions=['replacement'])


def admitted(rows, checks, when, notices=None):
    return select_admitted({'records': rows}, checks, [notice()] if notices is None else notices,
                           concept='NetIncomeLoss', unit='USD', start='2020-01-01', end='2020-12-31', as_of=when)


def test_notice_boundary_and_no_automatic_expiry():
    r = record()
    assert admitted([r], [r], '2021-03-01T19:59:59Z')['fact']
    for when in ['2021-03-01T20:00:00Z', '2025-01-01T00:00:00Z']:
        assert admitted([r], [r], when)['status'] == 'blocked_non_reliance'


def test_replacement_requires_public_availability_and_verification():
    old, new = record(), record(accession='replacement', value=9)
    new.update(accepted_at='2021-04-01T20:00:00Z', available_at='2021-04-02T04:00:00Z')
    assert admitted([old, new], [old, new], '2021-04-02T03:59:59Z')['status'] == 'blocked_non_reliance'
    assert admitted([old, new], [old], '2021-04-02T04:00:00Z')['status'] == 'unverified_original'
    assert admitted([old, new], [old, new], '2021-04-02T04:00:00Z')['fact']['value'] == 9


def test_notice_does_not_block_other_company_or_period():
    r = record()
    n = notice()
    n['cik'] = '0000000002'
    assert admitted([r], [r], '2021-04-01T00:00:00Z', [n])['fact']
    n = notice()
    n['affected_period_ends'] = ['2019-12-31']
    assert admitted([r], [r], '2021-04-01T00:00:00Z', [n])['fact']


@pytest.mark.parametrize('field,value', [('value', 11), ('available_at', '2021-02-03T05:00:00Z'),
                                         ('original_check', 'value_mismatch')])
def test_modified_original_check_is_rejected(field, value):
    r, check = record(), record()
    check[field] = value
    assert admitted([r], [check], '2021-02-03T12:00:00Z')['status'] == 'unverified_original'


@pytest.mark.parametrize('value,decimals,expected', [('-58400000', '-5', 'matched_with_rounding'),
    ('-58500000', '-5', 'ambiguous_original_context'), ('-58400000', None, 'ambiguous_original_context'),
    ('-58400000', 'INF', 'ambiguous_original_context')])
def test_rounding_boundary_negative_and_real_conflicts(value, decimals, expected):
    r = record(value=-58350000)
    originals = [{**r, 'value': '-58350000', 'decimals': '-3'}, {**r, 'value': value, 'decimals': decimals}]
    assert compare([r], originals)[0]['original_check'] == expected


def test_rounding_never_invents_midpoint_or_ignores_third_conflict():
    r = record(value=100)
    originals = [{**r, 'value': '99', 'decimals': '-1'}, {**r, 'value': '101', 'decimals': '-1'}]
    assert compare([r], originals)[0]['original_check'] == 'ambiguous_original_context'
    originals.append({**r, 'value': '100', 'decimals': 'INF'})
    assert compare([r], originals)[0]['original_check'] == 'matched_with_rounding'
    originals.append({**r, 'value': '200', 'decimals': '-1'})
    assert compare([r], originals)[0]['original_check'] == 'ambiguous_original_context'


def annual_rows():
    return [record(), record('Revenues', value=100), record('Revenues', '2019-01-01', '2019-12-31', 80),
            record('StockholdersEquity', None, '2019-12-31', 40), record('StockholdersEquity', None, value=60)]


def run(rows, **overrides):
    params = dict(ticker='TEST', accession='old', start='2020-01-01', end='2020-12-31',
                  prior_start='2019-01-01', revenue_tag='Revenues', as_of='2021-02-03T12:00:00Z')
    return trial({'records': rows}, copy.deepcopy(rows), [], **(params | overrides))


def test_annual_ratios_are_traceable_but_missing_valuation_blocks_quality():
    result = run(annual_rows())
    assert result['inputs'] == {'roe': 20, 'profitMargin': 10, 'revenueGrowth': 25}
    assert result['qualityScore'] is None
    assert result['scoring']['qualityCoverage'] == 50
    assert result['subScores']['valuation'] is None
    assert not result['model_change_allowed']


def test_negative_revenue_and_equity_are_not_flipped_positive():
    rows = annual_rows()
    rows[1]['value'], rows[3]['value'] = -10, -40
    assert all(v is None for v in run(rows)['inputs'].values())


def test_missing_opening_equity_cannot_use_closing_only():
    rows = annual_rows()
    del rows[3]
    assert run(rows)['inputs']['roe'] is None


def test_future_or_other_filing_inputs_do_not_enter_trial():
    assert all(v is None for v in run(annual_rows(), as_of='2021-02-01T00:00:00Z')['inputs'].values())
    assert all(v is None for v in run(annual_rows(), accession='different')['inputs'].values())
    with pytest.raises(ValueError, match='annual'):
        run(annual_rows(), start='2020-10-01')
