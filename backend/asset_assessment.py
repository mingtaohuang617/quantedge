"""Product execution diagnostics. Never combine them with expected-return scores."""
import json
import math
from datetime import date
from pathlib import Path

SPECS = json.loads((Path(__file__).resolve().parents[1] / 'frontend/src/lib/product-policy.json').read_text())


def rounded(value):
    return math.floor(value * 10 + .5 + 1e-9) / 10


def day(value):
    try:
        parsed = date.fromisoformat(value)
        return parsed.toordinal() if parsed.isoformat() == value else None
    except (ValueError, TypeError):
        return None


def product_assessment(stock):
    dates = [d for d in (day(stock.get('scoring', {}).get('priceAsOf')), day(stock.get('productDataAsOf'))) if d is not None]
    reference = day(stock['evaluationAsOf']) if stock.get('evaluationAsOf') else max(dates) if dates else None
    fields, missing, reasons = {}, [], {}
    metrics = stock.get('productMetrics')
    if not isinstance(metrics, dict):
        metrics = {}
    for key, spec in SPECS.items():
        entry = metrics.get(key)
        if not isinstance(entry, dict):
            entry = {}
        observed, value = day(entry.get('asOf')), entry.get('value')
        available, expiry = day(entry.get('availableAt', entry.get('asOf'))), day(entry.get('validThrough'))
        valid = (reference is not None and observed is not None and 0 <= reference - observed <= spec['maxAge']
                 and available is not None and available <= reference and (not entry.get('validThrough') or (expiry is not None and reference <= expiry))
                 and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                 and 0 <= value <= spec['limit'] and entry.get('unit') == spec['unit']
                 and isinstance(entry.get('source'), str) and entry['source'].startswith('https://')
                 and (key != 'dailyTrackingError' or (entry.get('method') == 'sample_std_daily_difference' and entry.get('fundBasis') == 'nav_total_return'
                      and (not stock.get('targetReturnBasis') or entry.get('benchmarkBasis') == stock['targetReturnBasis'])
                      and isinstance(entry.get('observations'), (int, float))
                      and math.isfinite(entry['observations']) and entry['observations'] >= 20 and isinstance(stock.get('leverageMultiple'), (int, float)) and bool(stock.get('benchmark')) and entry.get('targetMultiple') == stock.get('leverageMultiple')
                      and entry.get('benchmark') == stock.get('benchmark'))))
        score = next((v for threshold, v in zip(spec['thresholds'], [95, 80, 60, 40], strict=True) if value <= threshold), 20) if valid else None
        fields[key] = {**entry, 'score': score} if valid else None
        if not valid:
            missing.append(key)
            reasons[key] = ('missing' if not entry else 'expired' if expiry is not None and reference is not None and reference > expiry else
                            'stale' if observed is not None and reference is not None and reference - observed > spec['maxAge'] else
                            'not_yet_available' if available is not None and reference is not None and reference < available else 'invalid')
    score = None if missing else rounded(sum(fields[k]['score'] * spec['weight'] for k, spec in SPECS.items()))
    return {'score': score, 'asOf': date.fromordinal(reference).isoformat() if reference is not None else None, 'reasons': reasons, 'coverage': rounded(sum(spec['weight'] * 100 for k, spec in SPECS.items() if fields[k])), 'fields': fields, 'missing': missing}


def leverage_scenarios(multiple):
    if not isinstance(multiple, (int, float)) or not math.isfinite(multiple) or multiple in (0, 1) or abs(multiple) > 5:
        return []
    result = []
    for path in ('up', 'down', 'round_trip'):
        for days in (1, 5, 20):
            benchmark = product = 1
            for i in range(days):
                r = .01 if path == 'up' else -.01 if path == 'down' else 1 / 1.01 - 1 if i % 2 else .01
                benchmark *= 1 + r
                product *= 1 + multiple * r
            result.append({'path': path, 'days': days, 'benchmarkReturn': rounded((benchmark - 1) * 100), 'productReturn': rounded((product - 1) * 100)})
    return result


def attach_assessments(stocks):
    for stock in stocks:
        if stock['assetType'] == 'stock':
            stock.pop('assetAssessment', None)
            continue
        candidates = [s for s in stocks if s['ticker'] == stock.get('underlyingSymbol') and s is not stock and s['assetType'] == 'stock']
        underlying = candidates[0] if stock.get('underlyingType') == 'stock' and len(candidates) == 1 else None
        category = stock.get('cryptoCategory')
        stock['assetAssessment'] = {
            'version': '1.1.0', 'mode': 'crypto_research' if stock['assetType'] == 'crypto' else 'product_research',
            'product': product_assessment(stock) if stock.get('isETF') else None,
            'underlying': {k: underlying.get(k) for k in ('ticker', 'qualityScore', 'timingScore')} | {'priceAsOf': underlying['scoring']['priceAsOf']} if underlying else None,
            'scenarios': leverage_scenarios(stock['leverageMultiple']) if stock.get('isETF') else [],
            'cryptoCategory': (category if category in ('monetary', 'network', 'application', 'stablecoin') else 'unknown') if stock['assetType'] == 'crypto' else None,
        }
        if stock.get('productDataAsOf') and stock.get('isETF'):
            fee = stock['assetAssessment']['product']['fields']['expenseRatio'] or {}
            stock['expenseRatio'] = fee.get('value')
            stock['expenseRatioAsOf'] = fee.get('asOf')
            stock['decayRate'] = None
        for key in ('score', 'qualityScore', 'rank', 'scoreSmoothed', 'scoreDelta5d', 'scoreHistoryVersion'):
            stock[key] = None
        stock['scoring'].update(compositeEligible=False, status='separate_dimensions', qualityCoverage=0,
                                coverage=(stock['assetAssessment']['product'] or {}).get('coverage', 0), qualityDeduction=0)
        stock['scoring']['warnings'] = [w for w in stock['scoring']['warnings'] if '规模为流动性代理' not in w and '该资产类型尚未启用' not in w]
        for key in ('cost', 'liquidity', 'diversification'):
            if key in stock['subScores']:
                stock['subScores'][key] = None
