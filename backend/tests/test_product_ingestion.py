import copy
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from product_ingestion import issuer_observations, tracking_diagnostics
from asset_assessment import product_assessment
from scoring import asset_metadata, score_universe


PAGES = {
    'EWY': '<p>EWY iShares Expense Ratio: Fees as stated in the prospectus 0.59% MSCI Korea 25/50 Index (Net) 30 Day Median Bid/Ask Spread 0.02% as of Sep 15, 2026</p>',
    'TQQQ': '<p>TQQQ ProShares three times (3x) the daily performance of the Nasdaq-100 Net Expense Ratio 0.82% Price as of 9/15/2026 30-Day Median Bid Ask Spread 0.01% fee waiver through September 30, 2026</p>',
    'RKLX': '<p>RKLX Defiance Underlying Security: Rocket Lab (NASDAQ: RKLB) Fund Details Data as of 09/15/2026 Gross Expense Ratio 1.63% Median 30 Day Spread 0.23%</p>',
}


@pytest.mark.parametrize('ticker,fee,spread', [('EWY', .59, 2), ('TQQQ', .82, 1), ('RKLX', 1.63, 23)])
def test_issuer_units_dates_and_fee_basis(ticker, fee, spread):
    record = issuer_observations(ticker, PAGES[ticker], '2026-09-16')
    assert record['productMetrics']['expenseRatio']['value'] == fee
    assert record['productMetrics']['medianSpread30d']['value'] == spread
    assert record['productMetrics']['medianSpread30d']['asOf'] == '2026-09-15'
    assert record['productMetrics']['expenseRatio']['availableAt'] == '2026-09-16'
    if ticker == 'TQQQ':
        assert record['productMetrics']['expenseRatio']['validThrough'] == '2026-09-30'


@pytest.mark.parametrize('ticker', list(PAGES))
def test_parser_fails_on_wrong_product_future_or_missing_spread(ticker):
    with pytest.raises(ValueError):
        issuer_observations(ticker, PAGES[ticker].replace(ticker, 'WRONG'), '2026-09-16')
    with pytest.raises(ValueError):
        issuer_observations(ticker, PAGES[ticker], '2026-09-14')
    if ticker == 'TQQQ':
        partial = issuer_observations(ticker, PAGES[ticker].replace('Spread', 'Unrelated'), '2026-09-16')
        assert partial['productMetrics']['expenseRatio']['value'] == .82
        assert 'medianSpread30d' not in partial['productMetrics']
        assert partial['productDataIssues'] == ['median_spread_unavailable']
    else:
        with pytest.raises(ValueError):
            issuer_observations(ticker, PAGES[ticker].replace('Spread', 'Unrelated'), '2026-09-16')


def series():
    fund, benchmark = [], []
    f = b = 100
    for i in range(21):
        stamp = (date(2026, 7, 1) + timedelta(days=i)).isoformat()
        fund.append({'date': stamp, 'level': f})
        benchmark.append({'date': stamp, 'level': b})
        f *= 1 + .03 + (.001 if i % 2 else -.001)
        b *= 1.01
    return fund, benchmark


def calculate(fund, benchmark, **overrides):
    options = dict(multiple=3, benchmark_name='Test', currency='USD', benchmark_currency='USD',
                   fund_basis='nav_total_return', benchmark_basis='price_return', close_convention='NY16',
                   benchmark_close_convention='NY16', source='https://example.com/nav', benchmark_source='https://example.com/index')
    options.update(overrides)
    return tracking_diagnostics(fund, benchmark, **options)


def test_tracking_std_has_correct_units_and_keeps_signed_mean():
    fund, benchmark = series()
    result = calculate(fund, benchmark)
    assert result['observations'] == 20
    assert result['value'] == pytest.approx(math.sqrt(20 / 19) * 10, abs=1e-6)
    assert result['meanDifferenceBps'] == pytest.approx(0, abs=1e-6)
    # Constant underperformance has zero dispersion, but must remain visible as a signed bias.
    for i, row in enumerate(fund):
        row['level'] = 100 * 1.029 ** i
    result = calculate(fund, benchmark)
    assert result['value'] == pytest.approx(0, abs=1e-6)
    assert result['meanDifferenceBps'] == pytest.approx(-10, abs=1e-6)


@pytest.mark.parametrize('case', ['gap', 'duplicate', 'unsorted', 'zero', 'nan', 'short', 'currency', 'basis', 'clock', 'jump'])
def test_tracking_rejects_bad_alignment_and_corporate_action_discontinuities(case):
    fund, benchmark = series()
    options = {}
    if case == 'gap': benchmark.pop(10)
    if case == 'duplicate': fund[9] = dict(fund[10])
    if case == 'unsorted': fund.reverse()
    if case == 'zero': fund[10]['level'] = 0
    if case == 'nan': fund[10]['level'] = float('nan')
    if case == 'short': fund, benchmark = fund[:10], benchmark[:10]
    if case == 'currency': options['benchmark_currency'] = 'KRW'
    if case == 'basis': options['fund_basis'] = 'raw_price'
    if case == 'clock': options['benchmark_close_convention'] = 'Seoul15:30'
    if case == 'jump': fund[10]['level'] *= 2
    with pytest.raises(ValueError):
        calculate(fund, benchmark, **options)


def test_new_product_snapshot_does_not_overwrite_old_price_evidence_and_fee_expires():
    stock = {'ticker': 'TQQQ', 'scoring': {'priceAsOf': '2026-09-01'}}
    stock.update(asset_metadata(stock))
    fixture = json.loads((Path(__file__).parent / 'fixtures/product-observations-2026-09-16.json').read_text(encoding='utf-8'))
    stock.update(fixture['products']['TQQQ'])
    result = product_assessment(stock)
    assert result['coverage'] == 100
    assert result['asOf'] == '2026-09-16'
    assert stock['scoring']['priceAsOf'] == '2026-09-01'
    stock['productDataAsOf'] = '2026-10-01'
    result = product_assessment(stock)
    assert result['score'] is None
    assert result['reasons']['expenseRatio'] == 'expired'


def test_official_identity_and_unique_underlying_link():
    stock = {'ticker': 'RKLX', 'issuer': 'GraniteShares'}
    underlying = {'ticker': 'RKLB', 'market': 'US', 'pe': 20, 'pb': 2, 'roe': 20, 'profitMargin': 15, 'revenueGrowth': 10}
    score_universe([stock, underlying])
    assert stock['issuer'] == 'Defiance'
    assert stock['inceptionDate'] == '2025-03-12'
    assert stock['assetAssessment']['underlying']['ticker'] == 'RKLB'
    assert stock['score'] is None
    score_universe([stock, underlying, copy.deepcopy(underlying)])
    assert stock['assetAssessment']['underlying'] is None


def test_failed_tracking_fetch_preserves_only_valid_partial_metrics(tmp_path, monkeypatch):
    import refresh_product_data
    monkeypatch.setattr(refresh_product_data, 'ROOT', tmp_path)
    cache = tmp_path / 'backend/data/product_sources/2026-09-16'
    cache.mkdir(parents=True)
    for ticker, html in PAGES.items():
        (cache / (ticker + '.html')).write_text(html, encoding='utf-8')
    # No daily files: the CLI must not infer a tracking error or preserve an old score.
    payload, errors = refresh_product_data.refresh('2026-09-16', cache_only=True, output=tmp_path / 'snapshot.json')
    assert 'dailyTrackingError' not in payload['products']['TQQQ']['productMetrics']
    assert len(payload['products']['TQQQ']['productMetrics']) == 2
    assert errors[0]['stage'] == 'tracking'
