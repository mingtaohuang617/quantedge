"""Valuation units, disclosure timing and proxy rejection."""
import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from historical_valuation import evaluate, split_factor, unique_fact  # noqa: E402


def valid(**overrides):
    args = dict(as_of='2024-07-31T12:00:00-04:00',
                price={'close': 100, 'closed_at': '2024-07-30T16:00:00-04:00', 'currency': 'USD',
                       'basis': 'raw_as_traded', 'basis_evidence': 'test-source'},
                shares=1000, eps=5, equity=20000, revenue=50000,
                financial_available_at='2024-07-31T00:00:00-04:00', shares_date='2024-07-30', period_end='2024-06-30',
                basis={'split_chain_complete': True, 'evidence': 'test-source',
                       'price_basis_id': 'same', 'financial_basis_id': 'same'})
    return evaluate(**(args | overrides))


def test_evidenced_same_basis_arithmetic():
    r = valid()
    assert r['inputs']['pe'] == 20
    assert r['inputs']['pb'] == 5
    assert r['inputs']['marketCap'] == 100000
    assert not r['strict_pit_eligible']


def test_period_end_shares_are_diagnostic_only():
    r = valid(shares_date='2024-06-30')
    assert r['inputs'] == {}
    assert r['diagnostics']['marketCap'] == 100000
    assert r['share_age_days'] == 31


@pytest.mark.parametrize('field', ['financial_available_at', 'shares_date', 'period_end'])
def test_future_financial_inputs_rejected(field):
    when = '2024-08-01T00:00:00Z' if field == 'financial_available_at' else '2024-08-01'
    assert valid(**{field: when})['status'] == 'future_input'


def test_future_price_and_unverified_basis_are_blocked():
    p = {'close': 100, 'closed_at': '2024-07-31T16:00:00-04:00', 'currency': 'USD', 'basis': 'raw_as_traded'}
    assert valid(price=p)['status'] == 'future_input'
    p['closed_at'] = '2024-07-30T16:00:00-04:00'
    p['basis'] = 'provider_close_not_asserted_as_traded'
    assert valid(price=p)['inputs'] == {}
    assert valid(basis={'split_chain_complete': False})['inputs'] == {}


@pytest.mark.parametrize('eps', [-5, 0, None])
def test_nonpositive_eps_never_made_positive(eps):
    assert valid(eps=eps)['diagnostics']['pe'] is None


def test_no_average_share_fallback_and_negative_book_value():
    assert valid(shares=None)['inputs'] == {}
    assert valid(equity=-10)['diagnostics']['pb'] is None


def test_split_chain_reverse_split_and_valuation_invariance():
    events = [{'date': '2024-06-10', 'ratio': 10, 'source': 'issuer'},
              {'date': '2024-07-10', 'ratio': .2, 'source': 'issuer'}]
    factor = split_factor(events, start='2024-06-01', end='2024-07-31')
    assert factor == 2
    price, eps, shares = Decimal(100), Decimal(5), Decimal(1000)
    assert (price / factor) / (eps / factor) == price / eps
    assert (price / factor) * (shares * factor) == price * shares
    assert split_factor(events, start='2024-06-10', end='2024-07-10') == Decimal('.2')
    with pytest.raises(ValueError):
        split_factor(events + [events[0]], start='2024-06-01', end='2024-07-31')


def test_exact_context_and_conflicting_original_shares():
    row = dict(concept='CommonStockSharesOutstanding', unit='shares', start=None, end='2024-06-30', value='100')
    def choose(rows):
        return unique_fact(rows, row['concept'], row['unit'], row['start'], row['end'])
    assert choose([row, row])['value'] == '100'
    assert choose([row, row | {'value': '101'}])['value'] is None
    assert choose([row | {'start': '2024-01-01'}])['value'] is None
