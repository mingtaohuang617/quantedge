"""Publication timing, revisions and exact financial contexts; no network."""
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sec_vintages import normalize, select_fact, filing_index  # noqa: E402

CIK = '0001045810'


def inputs():
    table = {'accessionNumber': ['original', 'amended'], 'filingDate': ['2025-05-01', '2025-08-01'],
             'acceptanceDateTime': ['2025-05-01T21:00:00Z', '2025-08-01T21:00:00Z'],
             'form': ['10-Q', '10-Q/A'], 'primaryDocument': ['original.htm', 'amended.htm']}
    facts = [{'start': '2025-01-01', 'end': '2025-03-31', 'filed': '2025-05-01', 'form': '10-Q', 'accn': 'original', 'val': 100},
             {'start': '2025-01-01', 'end': '2025-03-31', 'filed': '2025-08-01', 'form': '10-Q/A', 'accn': 'amended', 'val': 90}]
    company = {'cik': int(CIK), 'facts': {'us-gaap': {'NetIncomeLoss': {'units': {'USD': facts}}}}}
    return company, [table]


def choose(bundle, when, **extra):
    params = dict(concept='NetIncomeLoss', unit='USD', start='2025-01-01', end='2025-03-31', as_of=when)
    return select_fact(bundle, **(params | extra))


def test_period_end_and_same_day_do_not_make_fact_available():
    company, tables = inputs()
    bundle = normalize(company, tables, CIK)
    assert choose(bundle, '2025-03-31T20:00:00Z') is None
    assert choose(bundle, '2025-05-02T03:59:59Z') is None
    assert choose(bundle, '2025-05-02T04:00:00Z')['value'] == 100
    assert not bundle['strict_pit_eligible']


def test_later_amendment_never_overwrites_earlier_asof():
    company, tables = inputs()
    bundle = normalize(company, tables, CIK)
    assert choose(bundle, '2025-06-01T12:00:00Z')['value'] == 100
    assert choose(bundle, '2025-08-02T04:00:00Z')['value'] == 90
    assert len(bundle['records']) == 2


def test_exact_units_periods_and_concepts_no_silent_quarter_conversion():
    company, tables = inputs()
    bundle = normalize(company, tables, CIK)
    for override in [{'unit': 'USD/shares'}, {'start': None}, {'start': '2024-01-01'}, {'concept': 'Assets'}]:
        assert choose(bundle, '2026-01-01T12:00:00Z', **override) is None


def test_acceptance_after_filed_date_delays_availability():
    company, tables = inputs()
    tables[0]['acceptanceDateTime'][0] = '2025-05-03T01:00:00Z'  # May 2 NY
    bundle = normalize(company, tables, CIK)
    assert choose(bundle, '2025-05-02T16:00:00Z') is None
    assert choose(bundle, '2025-05-03T04:00:00Z')['value'] == 100


def test_conflicting_latest_context_blocks_instead_of_falling_back():
    company, tables = inputs()
    facts = company['facts']['us-gaap']['NetIncomeLoss']['units']['USD']
    facts.append({**facts[1], 'val': 89})
    bundle = normalize(company, tables, CIK)
    assert choose(bundle, '2025-06-01T12:00:00Z')['value'] == 100
    assert choose(bundle, '2025-08-02T04:00:00Z') is None
    assert bundle['issues']['conflicting_fact_contexts'] == 1


def test_duplicate_same_value_collapses_without_changing_version():
    company, tables = inputs()
    facts = company['facts']['us-gaap']['NetIncomeLoss']['units']['USD']
    facts.append(copy.deepcopy(facts[0]))
    assert len(normalize(company, tables, CIK)['records']) == 2


@pytest.mark.parametrize('change', ['timezone', 'value', 'date', 'form', 'filed', 'missing'])
def test_bad_facts_are_quarantined(change):
    company, tables = inputs()
    fact = company['facts']['us-gaap']['NetIncomeLoss']['units']['USD'][0]
    if change == 'timezone':
        tables[0]['acceptanceDateTime'][0] = '2025-05-01T21:00:00'
    elif change == 'value':
        fact['val'] = float('nan')
    elif change == 'date':
        fact['end'] = '2026-01-01'
    elif change == 'form':
        fact['form'] = '8-K'
    elif change == 'filed':
        fact['filed'] = '2025-05-02'
    else:
        fact['accn'] = 'unknown'
    bundle = normalize(company, tables, CIK)
    assert len(bundle['records']) == 1
    assert sum(bundle['issues'].values()) == 1


def test_misaligned_submission_or_cik_fails_closed():
    company, tables = inputs()
    with pytest.raises(ValueError):
        normalize(company, tables, '0000000001')
    tables[0]['form'].pop()
    with pytest.raises(ValueError):
        filing_index(tables)


def test_asof_requires_timezone():
    company, tables = inputs()
    with pytest.raises(ValueError):
        choose(normalize(company, tables, CIK), '2025-05-02')


def test_archived_sec_replay_and_tamper_detection(tmp_path):
    from collect_sec_vintages import run
    from price_evidence import persist_evidence, encode
    company, tables = inputs()
    submissions = {'cik': CIK, 'filings': {'recent': tables[0], 'files': []}}
    folders = []
    for url, payload in [(f'https://data.sec.gov/submissions/CIK{CIK}.json', submissions),
                         (f'https://data.sec.gov/api/xbrl/companyfacts/CIK{CIK}.json', company)]:
        folders.append(persist_evidence(tmp_path, encode(payload),
            {'provider': 'SEC', 'url': url, 'cik': CIK}, '2026-09-16T00:00:00+00:00'))
    result = run(CIK, tmp_path, True, 'unused')
    assert len(result['records']) == 2
    assert not result['production_database_modified']
    (folders[1] / 'raw.json').write_text('{}', encoding='utf-8')
    with pytest.raises(ValueError, match='hash mismatch'):
        run(CIK, tmp_path, True, 'unused')
