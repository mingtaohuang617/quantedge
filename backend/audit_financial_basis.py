"""Reproduce reviewed NVDA duration/share-unit and PLUG revision case studies."""
import argparse
import json
from pathlib import Path

from financial_basis import difference, align_eps
from sec_vintages import select_fact


def audit(nvda, plug, plug_verified):
    records = [r for f in nvda['filings'] for r in f['checks']]
    def fact(accession, concept, start, end):
        matches = [r for r in records if (r['accession'], r['concept'], r['start'], r['end']) == (accession, concept, start, end)]
        if len(matches) != 1:
            raise ValueError('Missing/ambiguous reviewed case')
        return matches[0]
    q2 = '0001045810-24-000264'
    total = fact(q2, 'NetIncomeLoss', '2024-01-29', '2024-07-28')
    component = fact(q2, 'NetIncomeLoss', '2024-04-29', '2024-07-28')
    derived = difference(total, component, '2024-08-29T12:00:00-04:00')
    earlier = fact('0001045810-24-000124', 'NetIncomeLoss', '2024-01-29', '2024-04-28')
    derived['earlier_original_value'] = earlier['value']
    derived['earlier_original_available_at'] = earlier['available_at']
    derived['agrees_with_earlier_original'] = float(derived['value']) == earlier['value']
    eps = fact('0001045810-24-000124', 'EarningsPerShareDiluted', '2024-01-29', '2024-04-28')
    source = 'https://www.sec.gov/Archives/edgar/data/1045810/000104581024000144/nvda-20240607.htm'
    event = {'id': 'NVDA-2024-06-10-10for1', 'cik': '0001045810', 'ratio': 10,
             'known_at': '2024-06-08T00:00:00-04:00', 'effective_at': '2024-06-10T09:30:00-04:00',
             'source': source, 'date_basis': 'First split-adjusted trading session; known_at is conservative next-day use of June 7 filing, not first announcement'}
    before = {'cik': '0001045810', 'split_ids': [], 'evidence': eps['source']}
    after = {'cik': '0001045810', 'split_ids': [event['id']], 'evidence': source}
    aligned = align_eps(eps, before, after, [event], '2024-06-10T16:00:00-04:00')
    verified = {(r['accession'], r['concept'], r['start'], r['end']): r['original_check']
                for f in plug_verified['filings'] for r in f['checks']}
    queries = []
    for when in ('2021-05-14T12:00:00-04:00', '2021-05-15T12:00:00-04:00', '2022-03-15T12:00:00-04:00'):
        row = select_fact(plug, concept='NetIncomeLoss', unit='USD', start='2019-01-01', end='2019-12-31', as_of=when)
        if not row or verified.get((row['accession'], row['concept'], row['start'], row['end'])) != 'matched':
            raise ValueError('Revision case lacks original verification')
        queries.append({'as_of': when, 'fact': row, 'original_check': 'matched'})
    return {'duration_case': derived, 'eps_case': aligned, 'revision_queries': queries,
            'strict_pit_eligible': False, 'model_change_allowed': False,
            'limitations': ['Selected cases only, no complete revision or split-chain certification',
                            'Non-reliance notices and earlier earnings releases not yet modeled',
                            'Quarterly EPS is not a TTM valuation denominator']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('nvda', 'plug', 'plug-verified', 'output'):
        parser.add_argument('--' + key, type=Path, required=True)
    args = parser.parse_args()
    read = lambda path: json.loads(path.read_text(encoding='utf-8'))
    result = audit(read(args.nvda), read(args.plug), read(args.plug_verified))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'derived_income': result['duration_case']['value'], 'aligned_eps': result['eps_case']['aligned_value'],
                      'revision_values': [r['fact']['value'] for r in result['revision_queries']]}))


if __name__ == '__main__':
    main()
