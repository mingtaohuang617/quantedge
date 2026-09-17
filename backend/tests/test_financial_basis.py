import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from financial_basis import difference, align_eps  # noqa: E402


def fact(start='2024-01-01', end='2024-06-30', value=300):
    return {'cik': '0001045810', 'accession': 'filing', 'concept': 'NetIncomeLoss', 'unit': 'USD',
            'start': start, 'end': end, 'value': value, 'available_at': '2024-08-01T00:00:00-04:00',
            'original_check': 'matched', 'status': 'filing_linked_candidate'}


NOW = '2024-08-02T00:00:00-04:00'


def test_duration_prefix_suffix_and_availability():
    total = fact()
    prefix = fact(end='2024-03-31', value=100)
    tail = difference(total, prefix, NOW)
    assert (tail['start'], tail['end'], tail['value']) == ('2024-04-01', '2024-06-30', '200')
    assert tail['available_at'] == total['available_at']
    first = difference(total, fact(start='2024-04-01', value=200), NOW)
    assert first['value'] == '100'
    assert not first['strict_pit_eligible']


@pytest.mark.parametrize('patch', [{'accession': 'other'}, {'concept': 'EarningsPerShareDiluted'},
    {'unit': 'USD/shares'}, {'start': None}, {'original_check': 'ambiguous_original_context'},
    {'available_at': '2025-01-01T00:00:00Z'}])
def test_no_unreviewed_cross_filing_or_eps_subtraction(patch):
    with pytest.raises(ValueError):
        difference(fact(), fact(end='2024-03-31', value=100) | patch, NOW)


def test_interior_period_and_identical_period_rejected():
    for component in (fact(), fact(start='2024-02-01', end='2024-03-31')):
        with pytest.raises(ValueError):
            difference(fact(), component, NOW)


def eps_args():
    row = fact(value=5.98) | {'concept': 'EarningsPerShareDiluted', 'unit': 'USD/shares'}
    before = {'cik': row['cik'], 'split_ids': [], 'evidence': 'original-filing'}
    after = before | {'split_ids': ['split'], 'evidence': 'split-filing'}
    events = [{'id': 'split', 'cik': row['cik'], 'ratio': 10, 'source': 'SEC',
               'known_at': '2024-06-08T00:00:00-04:00', 'effective_at': '2024-06-10T09:30:00-04:00'}]
    return row, before, after, events


def test_split_conversion_is_explicit_and_idempotent():
    row, before, after, events = eps_args()
    result = align_eps(row, before, after, events, NOW)
    assert result['aligned_value'] == '0.598'
    assert not result['valuation_ready']
    result = align_eps(row | {'value': .598}, after, after, events, NOW)
    assert result['aligned_value'] == '0.598'
    assert align_eps(row | {'value': .598}, after, before, events, NOW)['aligned_value'] == '5.980'


@pytest.mark.parametrize('fault', ['missing', 'duplicate', 'future', 'wrong_cik', 'no_basis', 'zero_ratio'])
def test_missing_or_future_split_evidence_rejected(fault):
    row, before, after, events = eps_args()
    if fault == 'missing': events = []
    elif fault == 'duplicate': events *= 2
    elif fault == 'future': events[0]['effective_at'] = '2025-06-10T00:00:00Z'
    elif fault == 'wrong_cik': events[0]['cik'] = '0000000001'
    elif fault == 'no_basis': before['evidence'] = ''
    else: events[0]['ratio'] = 0
    with pytest.raises(ValueError):
        align_eps(row, before, after, events, NOW)
