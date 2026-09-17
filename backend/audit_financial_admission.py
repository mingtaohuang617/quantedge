"""Reproduce four reviewed cases and the PLUG non-reliance boundary offline."""
import hashlib
import json
from pathlib import Path

from financial_admission import select_admitted
from historical_quality_trial import trial
from price_evidence import read_evidence
from sec_vintages import timestamp


def main():
    root = Path(__file__).resolve().parents[1]
    reviews = root / 'docs/reviews'
    out = reviews / 'financial-admission-2026-09-17'
    hashes = {}

    def read(path):
        data = path.read_bytes()
        hashes[str(path.relative_to(root))] = hashlib.sha256(data).hexdigest()
        return json.loads(data)

    notices = read(out / 'non-reliance.json')
    for notice in notices:
        _, manifest = read_evidence(Path(notice['evidence_folder']))
        if manifest['request']['url'] != notice['source']:
            raise ValueError('Notice evidence URL mismatch')
        raw, _ = read_evidence(Path(notice['acceptance_evidence_folder']))
        table = raw.get('filings', {}).get('recent', raw)
        i = table['accessionNumber'].index(notice['accession'])
        if (timestamp(table['acceptanceDateTime'][i]) != timestamp(notice['known_at'])
                or table['form'][i] != '8-K'
                or not notice['source'].endswith('/' + table['primaryDocument'][i])):
            raise ValueError('Notice publication metadata mismatch')
    cases = [
        ('nvda', '0001045810-26-000021', '2025-01-27', '2026-01-25', '2024-01-29', 'Revenues', '2026-02-26T12:00:00-05:00'),
        ('plug', '0001558370-21-007147', '2020-01-01', '2020-12-31', '2019-01-01', 'Revenues', '2021-05-15T12:00:00-04:00'),
        ('mu', '0000723125-23-000054', '2022-09-02', '2023-08-31', '2021-09-03', 'RevenueFromContractWithCustomerExcludingAssessedTax', '2023-10-07T12:00:00-04:00'),
        ('msft', '0000950170-24-087843', '2023-07-01', '2024-06-30', '2022-07-01', 'RevenueFromContractWithCustomerExcludingAssessedTax', '2024-07-31T12:00:00-04:00'),
    ]
    results, boundary = [], []
    for ticker, accession, start, end, prior_start, tag, as_of in cases:
        candidate_path = (reviews / 'sec-vintages-2026-09-16/nvda.json' if ticker == 'nvda' else
                          reviews / 'sec-transforms-2026-09-17/plug-candidates.json' if ticker == 'plug' else out / f'{ticker}-candidates.json')
        check_path = reviews / 'sec-originals-2026-09-17/verification.json' if ticker == 'nvda' else out / f'{ticker}-verification.json'
        bundle, verified = read(candidate_path), read(check_path)
        if verified['candidate_sha256'] != hashes[str(candidate_path.relative_to(root))]:
            raise ValueError('Candidate/check hash mismatch')
        checks = [r for filing in verified['filings'] for r in filing['checks']]
        results.append(trial(bundle, checks, notices, ticker=ticker.upper(), accession=accession,
                             start=start, end=end, prior_start=prior_start, revenue_tag=tag, as_of=as_of))
        if ticker == 'plug':
            for when in ['2021-03-12T23:00:00Z', '2021-03-16T20:52:20Z', '2021-03-16T20:52:21Z',
                         '2021-05-14T16:00:00Z', '2021-05-15T04:00:00Z', '2022-03-15T04:00:00Z']:
                boundary.append({'as_of': when, **select_admitted(bundle, checks, notices, concept='NetIncomeLoss',
                                 unit='USD', start='2019-01-01', end='2019-12-31', as_of=when)})
    report = {'schema': 'financial-admission-trial-1.0.0', 'input_sha256': hashes, 'cases': results,
              'non_reliance_queries': boundary, 'strict_pit_eligible': False, 'model_change_allowed': False}
    (out / 'trial.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps([{'ticker': r['ticker'], 'inputs': r['inputs'], 'qualityScore': r['qualityScore'],
                       'coverage': r['scoring']['qualityCoverage']} for r in results]))
    print(json.dumps([{'as_of': r['as_of'], 'status': r['status']} for r in boundary]))


if __name__ == '__main__':
    main()
