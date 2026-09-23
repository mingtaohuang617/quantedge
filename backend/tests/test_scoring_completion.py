"""Cross-asset evidence gates, UTC dates and explanation consistency."""
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crypto_evidence import normalize  # noqa: E402
from score_explanation import build_score_prompt  # noqa: E402
from score_validation import score_validation  # noqa: E402
from product_data import product_enrichment  # noqa: E402
from asset_assessment import product_assessment  # noqa: E402
from historical_valuation import evaluate  # noqa: E402
from audit_scoring_completion import crypto_diagnosis, release_status  # noqa: E402
from price_evidence import encode, persist_evidence, read_evidence  # noqa: E402
from scoring import asset_metadata  # noqa: E402


def candle(stamp=1704067200):
    return [stamp, 90, 110, 95, 100, 20]


def release_evidence():
    return {'software_release_complete': True, 'deployment_status': 'READY',
            'deployment_target': 'production', 'production_run_conclusion': 'success',
            'commit': 'abc', 'deployment_id': 'dpl_example', 'verified_at': '2026-09-17T07:10:20Z'}


def test_release_does_not_promote_model_validation():
    result = release_status({**release_evidence(), 'full_model_validation_complete': True, 'model_change_allowed': True})
    assert result['software_release_complete'] is True
    assert result['release_verified_at'] == '2026-09-17T07:10:20Z'
    assert result['full_model_validation_complete'] is False
    assert result['model_change_allowed'] is False


@pytest.mark.parametrize('field', list(release_evidence()))
def test_incomplete_release_evidence_is_not_success(field):
    evidence = release_evidence()
    del evidence[field]
    assert release_status(evidence)['software_release_complete'] is False


@pytest.mark.parametrize('field,value', [('deployment_target', 'preview'), ('deployment_status', 'ERROR'),
                                        ('production_run_conclusion', 'failure'), ('software_release_complete', 'true')])
def test_failed_or_preview_release_is_not_production(field, value):
    assert release_status({**release_evidence(), field: value})['software_release_complete'] is False


def test_crypto_duplicate_boundaries_and_no_weekend_skip():
    row = candle()
    result = normalize([[row], [row, candle(1704153600)]], '2024-01-01', '2024-01-03', '2024-01-04T00:00:00+00:00')
    assert len(result['rows']) == 2
    assert result['calendar_complete']
    result = normalize([[row]], '2024-01-01', '2024-01-03', '2024-01-04T00:00:00+00:00')
    assert result['missing_days'] == ['2024-01-02']
    assert not result['calendar_complete']


@pytest.mark.parametrize('index,value', [(0,1704067201), (1,101), (4,-1), (5,-1), (4,float('nan'))])
def test_crypto_invalid_bucket_or_ohlc_rejected(index, value):
    row = candle()
    row[index] = value
    with pytest.raises(ValueError):
        normalize([[row]], '2024-01-01', '2024-01-02', '2024-01-03T00:00:00+00:00')


def test_crypto_conflict_and_unfinished_day_rejected():
    other = candle()
    other[4] = 101
    with pytest.raises(ValueError, match='Conflicting'):
        normalize([[candle(), other]], '2024-01-01', '2024-01-02', '2024-01-03T00:00:00+00:00')
    with pytest.raises(ValueError, match='completed'):
        normalize([[candle()]], '2024-01-01', '2024-01-02', '2024-01-01T12:00:00+00:00')


def test_crypto_replay_next_day_execution_and_costs(tmp_path):
    results = []
    first = datetime(2024,1,1,tzinfo=UTC)
    end = (first + timedelta(days=300)).date().isoformat()
    for i in range(8):
        ticker = f'CASE{i}-USD'
        rows = []
        for j in range(300):
            close = 100 + j * (.1 + i * .03) + j % 5
            rows.append([int((first+timedelta(days=j)).timestamp()),close-2,close+2,close,close,100])
        folder = persist_evidence(tmp_path,encode(rows),{'product':ticker},'2025-01-01T00:00:00+00:00')
        _,manifest = read_evidence(folder)
        result = normalize([rows],'2024-01-01',end,manifest['retrieved_at'])
        results.append(dict(ticker=ticker,category='network',status='captured',start='2024-01-01',end_exclusive=end,
                            evidence=[{'folder':str(folder),**manifest}],**result))
    report = crypto_diagnosis({'results':results})
    assert report['windows']
    for window in report['windows']:
        assert window['signal_date'] < window['entry_date'] < window['exit_date']
        assert (datetime.fromisoformat(window['exit_date'])-datetime.fromisoformat(window['entry_date'])).days == 20
        assert all(o['net_return'] <= o['gross_return']+1e-12 for o in window['outcomes'])
    results[0]['rows'][0]['close'] += 1
    with pytest.raises(ValueError,match='modified'):
        crypto_diagnosis({'results':results})


def test_product_historical_asof_never_advances_to_current_snapshot():
    assert product_enrichment({'ticker':'TQQQ', 'evaluationAsOf':'2024-01-01'}) == {}
    assert not asset_metadata({'ticker':'SOXS','evaluationAsOf':'2024-01-01'}).get('classificationSource')
    stock = {'evaluationAsOf':'2024-01-01', 'productDataAsOf':'2026-09-17', 'productMetrics':{
        'expenseRatio': {'value':.1, 'asOf':'2026-09-17', 'unit':'percent', 'source':'https://example.com'}}}
    p = product_assessment(stock)
    assert p['score'] is None and p['coverage'] == 0
    assert p['asOf'] == '2024-01-01'


@pytest.mark.parametrize('kind', ['stock','index_etf','leveraged_stock_etf','leveraged_index_etf','crypto'])
def test_calculable_score_does_not_claim_validation(kind):
    v = score_validation({'assetType':kind,'score':80})
    assert v['calculationStatus'] == 'composite_available'
    assert v['predictiveStatus'] == 'not_validated'
    assert not v['weightChangeAllowed']


def stock():
    return {'ticker':'TEST','assetType':'stock','score':74,'qualityScore':70,'timingScore':80,'modelVersion':'3.2.0',
            'scoring':{'version':'3.2.0','status':'ready'},'subScores':{'growth':None}}


def test_explanation_declares_validation_and_missingness():
    p = build_score_prompt(stock(), {'quality':60,'timing':40})
    assert '尚未通过完整样本外验证' in p
    assert '覆盖率' in p


@pytest.mark.parametrize('override', [{'isETF':True}, {'score':99}, {'modelVersion':'old'}, {'qualityScore':None},
                                     {'score':float('nan')}, {'assetType':'crypto'}, {'assetType':None}])
def test_explanation_rejects_wrong_asset_stale_version_and_arithmetic(override):
    with pytest.raises(ValueError):
        build_score_prompt(stock() | override, {'quality':60,'timing':40})


def test_latest_disclosed_estimate_requires_actions_review_and_freshness():
    args = dict(as_of='2024-07-31T12:00:00-04:00', price={'close':100,'closed_at':'2024-07-30T16:00:00-04:00',
                'currency':'USD','basis':'raw_as_traded','basis_evidence':'source'}, shares=1000,eps=5,equity=20000,revenue=50000,
                financial_available_at='2024-07-31T00:00:00-04:00',shares_date='2024-07-25',period_end='2024-06-30',
                basis={'split_chain_complete':True,'evidence':'source','price_basis_id':'same','financial_basis_id':'same'},
                share_policy='latest_disclosed')
    assert evaluate(**args)['inputs'] == {}
    evidence = {'source':'https://example.com','is_latest_public':True,'available_at':'2024-07-31T00:00:00-04:00',
                'capital_actions_reviewed_through':'2024-07-30'}
    result = evaluate(**args,share_evidence=evidence)
    assert result['status'] == 'research_estimate' and result['estimated_market_cap']
    assert evaluate(**(args | {'shares_date':'2024-05-01'}),share_evidence=evidence)['inputs'] == {}
