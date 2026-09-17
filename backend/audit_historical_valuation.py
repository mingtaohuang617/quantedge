"""Offline valuation evidence audit; preserves blocked scores separately from diagnostics."""
import hashlib
import json
from decimal import Decimal
from pathlib import Path

from historical_valuation import evaluate, split_factor, unique_fact
from price_evidence import normalize_folder, read_evidence
from scoring import score_universe
from verify_sec_originals import parse_original


def main():
    root = Path(__file__).resolve().parents[1]
    reviews = root / 'docs/reviews'
    out = reviews / 'historical-valuation-2026-09-17'
    hashes = {}

    def read(path):
        raw = path.read_bytes()
        hashes[str(path.relative_to(root))] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)

    trial = read(reviews / 'financial-admission-2026-09-17/trial.json')
    for name, expected in trial['input_sha256'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Upstream admission evidence changed; rerun admission first')
    prices = read(out / 'prices.json')
    results = []
    dates = dict(NVDA='2026-02-25', PLUG='2021-05-14', MU='2023-10-06', MSFT='2024-07-30')
    for case in trial['cases']:
        ticker = case['ticker']
        collection = (reviews / 'sec-originals-2026-09-17/collection.json' if ticker == 'NVDA' else
                      reviews / 'sec-transforms-2026-09-17/plug-originals.json' if ticker == 'PLUG' else
                      reviews / f'financial-admission-2026-09-17/{ticker.lower()}-originals.json')
        entry = next(e for e in read(collection) if e['accession'] == case['accession'])
        raw, manifest = read_evidence(Path(entry['folder']))
        income = case['source_facts']['income']['fact']
        if manifest['request']['url'] != entry['url'] or income['source'] != entry.get('primary_url', entry['url']):
            raise ValueError('Original evidence mismatch')
        facts, issues = parse_original(raw.get('html', raw.get('xml')), income['cik'],
                                      {'CommonStockSharesOutstanding', 'WeightedAverageNumberOfDilutedSharesOutstanding', 'EarningsPerShareDiluted'})
        start, end = case['period']
        shares = unique_fact(facts, 'CommonStockSharesOutstanding', 'shares', None, end)
        eps = unique_fact(facts, 'EarningsPerShareDiluted', 'USD/shares', start, end)
        weighted = unique_fact(facts, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', start, end)
        price_entry = next(p for p in prices if p['symbol'] == ticker and p['status'] == 'captured')
        bundle = normalize_folder(Path(price_entry['evidence_folder']))
        if bundle['symbol'] != ticker or bundle['source_manifest']['raw_sha256'] != price_entry['raw_sha256']:
            raise ValueError('Price evidence mismatch')
        quotes = [r for r in bundle['rows'] if r['date'] == dates[ticker]]
        if len(quotes) != 1:
            raise ValueError('Missing/ambiguous selected close')
        # These four manually reviewed regular sessions are not a general exchange calendar.
        offset = '-05:00' if ticker == 'NVDA' else '-04:00'
        quote = {'close': quotes[0]['close'], 'closed_at': dates[ticker] + 'T16:00:00' + offset,
                 'currency': bundle['currency'], 'basis': bundle['close_basis']}
        result = evaluate(as_of=case['as_of'], price=quote, shares=shares['value'], eps=eps['value'],
                          equity=case['source_facts']['closing_equity']['fact']['value'],
                          revenue=case['source_facts']['revenue']['fact']['value'],
                          financial_available_at=income['available_at'], shares_date=end, period_end=end,
                          basis={'split_chain_complete': False})
        stock = {'ticker': ticker, 'market': 'US', 'assetType': 'stock', **case['inputs'], **result['inputs']}
        score_universe([stock])
        results.append({'ticker': ticker, 'as_of': case['as_of'], 'accession': case['accession'],
                        'original_evidence': manifest, 'shares': shares, 'weighted_average_shares': weighted,
                        'annual_eps': eps, 'original_parse_issues': issues, 'price': quote,
                        'price_evidence': bundle['source_manifest'], 'provider_splits': [a for a in bundle['actions'] if a['kind'] == 'splits'],
                        'valuation': result, 'qualityScore': stock['qualityScore'], 'scoring': stock['scoring']})
    earlier = read(reviews / 'sec-transforms-2026-09-17/cases.json')['eps_case']
    event = earlier['events'][0]
    factor = split_factor([{'date': event['effective_at'][:10], 'ratio': event['ratio'], 'source': event['source']}],
                          start='2024-06-07', end='2024-06-10')
    aligned = Decimal(earlier['original_value']) / factor
    if aligned != Decimal(earlier['aligned_value']):
        raise ValueError('Issuer split alignment disagrees with previous original audit')
    split_case = {'ticker': 'NVDA', 'source': event['source'], 'factor': str(factor),
                  'original_quarterly_eps': earlier['original_value'], 'aligned_quarterly_eps': str(aligned),
                  'limitation': 'Quarterly unit reconciliation only; not annual/TTM EPS or a complete action chain'}
    report = {'schema': 'historical-valuation-audit-1.0.0', 'input_sha256': hashes, 'cases': results,
              'issuer_split_case': split_case,
              'strict_pit_eligible': False, 'model_change_allowed': False}
    (out / 'valuation.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps([{'ticker': r['ticker'], 'close': r['price']['close'], 'shares': r['shares']['value'],
                       'diagnostics': r['valuation']['diagnostics'], 'status': r['valuation']['status']} for r in results]))


if __name__ == '__main__':
    main()
