"""One reproducible cross-asset acceptance ledger; blocked is never passed."""
import hashlib
import json
import statistics
from collections import Counter
from datetime import UTC, datetime
from itertools import combinations
from pathlib import Path

from backtest_scoring import spearman
from crypto_evidence import normalize as normalize_crypto
from historical_valuation import evaluate, unique_fact
from price_evidence import encode, persist_evidence, read_evidence
from product_data import REGISTRY
from scoring import score_universe
from verify_sec_originals import parse_original

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/reviews/scoring-completion-2026-09-17'


def release_status(evidence):
    """Report a dated release observation, never infer model validity from it."""
    complete = bool(
        evidence
        and evidence.get('software_release_complete') is True
        and evidence.get('deployment_status') == 'READY'
        and evidence.get('deployment_target') == 'production'
        and evidence.get('production_run_conclusion') == 'success'
        and evidence.get('commit') and evidence.get('deployment_id')
        and evidence.get('verified_at')
    )
    return {
        'software_release_complete': complete,
        'release_verified_at': evidence.get('verified_at') if complete else None,
        'release_commit': evidence.get('commit') if complete else None,
        'release_deployment_id': evidence.get('deployment_id') if complete else None,
        'release_evidence_scope': 'Dated recorded observation; not a live health check',
        'full_model_validation_complete': False,
        'model_change_allowed': False,
    }


def crypto_diagnosis(collection):
    all_rows = collection['results']
    usable = [r for r in all_rows if r['status'] == 'captured' and r['calendar_complete']]
    for item in usable:
        pages = []
        for evidence in item['evidence']:
            payload, manifest = read_evidence(Path(evidence['folder']))
            if manifest['request']['product'] != item['ticker'] or manifest['raw_sha256'] != evidence['raw_sha256']:
                raise ValueError('Crypto evidence mismatch')
            pages.append(payload)
        replay = normalize_crypto(pages, item['start'], item['end_exclusive'], min(e['retrieved_at'] for e in item['evidence']))
        if replay['rows'] != item['rows'] or not replay['calendar_complete']:
            raise ValueError('Crypto normalized history was modified')
    windows = []
    for category in sorted({r['category'] for r in usable}):
        group = [r for r in usable if r['category'] == category]
        if len(group) < 8:
            continue
        dates = [r['date'] for r in group[0]['rows']]
        if any([r['date'] for r in g['rows']] != dates for g in group):
            raise ValueError('Crypto dates must align exactly; never inner join gaps')
        boundary = int(len(dates) * .7)
        for i in range(200, len(dates) - 21, 21):
            end = i + 21
            if i < boundary <= end:
                continue
            stocks = [{'ticker': r['ticker'], 'market': 'CRYPTO', 'assetType': 'crypto', 'cryptoCategory': category} for r in group]
            score_universe(stocks, {r['ticker']: r['rows'][:i + 1] for r in group})
            scores = {s['ticker']: s['timingScore'] for s in stocks}
            if any(scores[r['ticker']] is None for r in group):
                continue
            for cost in (0, 10, 25, 50):
                outcomes = []
                for r in group:
                    prices = [x['close'] for x in r['rows'][i + 1:end + 1]]
                    gross = prices[-1] / prices[0] - 1
                    net = prices[-1] * (1 - cost / 10000) / (prices[0] * (1 + cost / 10000)) - 1
                    outcomes.append({'ticker': r['ticker'], 'score': scores[r['ticker']], 'gross_return': gross, 'net_return': net})
                windows.append({'category': category, 'signal_date': dates[i], 'entry_date': dates[i + 1], 'exit_date': dates[end],
                                'split': 'development' if end < boundary else 'holdout', 'cost_bps_per_side': cost,
                                'ic': spearman([r['score'] for r in outcomes], [r['net_return'] for r in outcomes]), 'outcomes': outcomes})
    summary = []
    for split in ('development', 'holdout'):
        for cost in (0, 10, 25, 50):
            group = [r for r in windows if r['split'] == split and r['cost_bps_per_side'] == cost and r['ic'] is not None]
            summary.append({'split': split, 'cost_bps_per_side': cost, 'windows': len(group),
                            'mean_ic': statistics.mean(r['ic'] for r in group) if group else None,
                            'mean_equal_weight_net_return': statistics.mean(statistics.mean(o['net_return'] for o in r['outcomes']) for r in group) if group else None})
    return {'categories': dict(Counter(r['category'] for r in usable)), 'windows': windows, 'summary': summary,
            'status': 'diagnostic_only', 'model_change_allowed': False,
            'limitations': ['Selected surviving Coinbase USD spot products; not historical universe',
                           'Monetary group has fewer than eight peers and no cross-category fallback',
                           'Fixed UTC daily close; next-day close entry; 20 daily intervals; nonoverlapping windows',
                           'Fees are scenarios, not observed spread/impact; no staking or financing returns',
                           'No parameter selection, significance claim, network fundamentals or deployment eligibility']}


def factor_audit(stocks):
    keys = ['valuation', 'profitability', 'growth', 'momentum', 'trend', 'rsi']
    rows = [s for s in stocks if s['assetType'] == 'stock' and s['market'] == 'US']
    pairs = []
    for a, b in combinations(keys, 2):
        sample = [s for s in rows if s['subScores'].get(a) is not None and s['subScores'].get(b) is not None]
        corr = spearman([s['subScores'][a] for s in sample], [s['subScores'][b] for s in sample]) if len(sample) >= 8 else None
        pairs.append({'factors': [a, b], 'n': len(sample), 'spearman': corr, 'review_redundancy': corr is not None and abs(corr) >= .85})
    complete = [s for s in rows if s['qualityScore'] is not None and s['timingScore'] is not None]
    base = [.6 * s['qualityScore'] + .4 * s['timingScore'] for s in complete]
    sensitivity = [{'quality_weight': w, 'n': len(complete),
                    'rank_correlation_to_current': spearman(base, [w * s['qualityScore'] + (1-w) * s['timingScore'] for s in complete])}
                   for w in (.3, .4, .6, .7)] if len(complete) >= 8 else []
    return {'scope': 'Current US stock snapshot, not historical predictive evidence', 'factor_pairs': pairs,
            'weight_sensitivity': sensitivity, 'selected_weight': None, 'model_change_allowed': False}


def main():
    hashes = {}

    def read(path):
        raw = path.read_bytes()
        hashes[str(path.relative_to(ROOT))] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)

    source = ROOT / 'frontend/src/data.js'
    raw = source.read_bytes()
    hashes[str(source.relative_to(ROOT))] = hashlib.sha256(raw).hexdigest()
    stocks = json.loads(raw.decode().split('export const STOCKS =', 1)[1].split('export const ALERTS', 1)[0].strip().rstrip(';'))
    products = read(OUT / 'products.json')
    cache = ROOT / 'backend/data/product_sources' / products['asOf']
    product_manifest = json.loads((cache / 'manifest.json').read_text(encoding='utf-8'))
    product_archives = []
    for name, metadata in product_manifest['files'].items():
        content = (cache / name).read_bytes()
        if hashlib.sha256(content).hexdigest() != metadata['sha256']:
            raise ValueError('Issuer cached evidence changed')
        request = {'capture_mode': 'archive_of_dated_cache', 'source_metadata': metadata, 'filename': name}
        folder = persist_evidence(ROOT / 'backend/data/product_evidence', encode({'text': content.decode('utf-8-sig')}), request, datetime.now(UTC).isoformat())
        product_archives.append({'folder': str(folder), 'source_metadata': metadata})
    for s in stocks:
        if s['ticker'] in products['products']:
            s.update(products['products'][s['ticker']])
    score_universe(stocks)
    crypto = crypto_diagnosis(read(OUT / 'crypto.json'))
    equity = read(OUT / 'equity-validation.json')
    entry = read(ROOT / 'docs/reviews/financial-admission-2026-09-17/msft-originals.json')[0]
    original, manifest = read_evidence(Path(entry['folder']))
    shares, _ = parse_original(original['html'], '0000789019', {'EntityCommonStockSharesOutstanding'})
    latest = unique_fact(shares, 'EntityCommonStockSharesOutstanding', 'shares', None, '2024-07-25')
    previous = next(r for r in read(ROOT / 'docs/reviews/historical-valuation-2026-09-17/valuation.json')['cases'] if r['ticker'] == 'MSFT')
    trial = next(r for r in read(ROOT / 'docs/reviews/financial-admission-2026-09-17/trial.json')['cases'] if r['ticker'] == 'MSFT')
    value = evaluate(as_of=previous['as_of'], price=previous['price'], shares=latest['value'], eps=previous['annual_eps']['value'],
                     equity=trial['source_facts']['closing_equity']['fact']['value'], revenue=trial['source_facts']['revenue']['fact']['value'],
                     financial_available_at=trial['source_facts']['income']['fact']['available_at'], shares_date='2024-07-25', period_end='2024-06-30',
                     basis={'split_chain_complete': False}, share_policy='latest_disclosed',
                     share_evidence={'source': entry['url'], 'available_at': trial['source_facts']['income']['fact']['available_at'],
                                     'is_latest_public': False})
    inventory = [{'ticker': s['ticker'], 'assetType': s['assetType'], 'validation': s['scoring']['validation'],
                  'product': (s.get('assetAssessment') or {}).get('product'), 'classificationSource': s.get('classificationSource')}
                 for s in stocks if s['assetType'] != 'stock']
    report = {'reviewed_at': '2026-09-17', 'replayed_at': datetime.now(UTC).isoformat(),
              'replay_scope': 'Original dated inputs; not refreshed market data',
              'input_sha256': hashes, 'model_change_allowed': False,
              'production_release_ready': False, 'asset_counts': dict(Counter(s['assetType'] for s in stocks)),
              'stock_valuation': {'latest_disclosed_shares': latest, 'evidence': manifest, 'valuation': value,
                                  'independent_price_attempt': read(OUT / 'msft-price-source.json')},
              'equity_validation': {'status': equity['strict_status'], 'blockers': equity['blockers']},
              'product_inventory': inventory, 'product_adapter_coverage': sorted(REGISTRY),
              'product_source_archives': product_archives,
              'crypto': crypto, 'calibration': factor_audit(stocks),
              'unresolved': ['Complete historical equity membership including delistings and historical financial coverage',
                             'Independent historical price basis and capital-action review for stock valuation',
                             'Official benchmark/NAV/action and historical spread panels for all ETF classes',
                             'Crypto historical membership, network/supply/security data and venue-execution costs',
                             'Untouched final validation sample and statistical acceptance before weight changes']}
    release_file = OUT / 'production-verification.json'
    release = release_status(read(release_file) if release_file.exists() else {})
    report.update(release)
    report['production_release_ready_scope'] = 'Full model/data qualification, not software deployment status'
    report['batches'] = [
        {'id': 1, 'implementation': 'implemented', 'acceptance': 'blocked', 'reason': 'MSFT recent disclosed shares extracted; price basis and action review remain unverified'},
        {'id': 2, 'implementation': 'implemented', 'acceptance': 'blocked', 'reason': 'Equity diagnostic rerun; full historical membership and fundamentals missing'},
        {'id': 3, 'implementation': 'implemented', 'acceptance': 'blocked', 'reason': 'Partial current issuer metrics only; not complete historical product panels'},
        {'id': 4, 'implementation': 'implemented', 'acceptance': 'partial', 'reason': 'Ten spot histories and UTC validation; no crypto fundamentals or market-wide membership'},
        {'id': 5, 'implementation': 'implemented', 'acceptance': 'hold_weights', 'reason': 'Sensitivity and redundancy diagnostics do not establish predictive validity'},
        {'id': 6, 'implementation': 'released' if release['software_release_complete'] else 'local_release_candidate',
         'acceptance': 'software_released_model_unvalidated' if release['software_release_complete'] else 'release_not_verified',
         'reason': 'Software release and full model/data qualification are separate; see dated release evidence'},
    ]
    (OUT / 'acceptance.json').write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    print(json.dumps({'asset_counts': report['asset_counts'], 'crypto': crypto['summary'],
                      'software_release_complete': report['software_release_complete'],
                      'release_verified_at': report['release_verified_at'],
                      'full_model_validation_complete': False, 'model_change_allowed': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
