import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from asset_assessment import product_assessment, leverage_scenarios


def test_product_policy_and_scenarios_match_browser():
    stocks = []
    for leverage in (1, 2, 3, -1, -3, None):
        for invalid in (None, 'future', 'source', 'unit', 'target', 'missing'):
            stock = {'leverageMultiple': leverage, 'benchmark': 'Test Index', 'scoring': {'priceAsOf': '2026-09-15'}, 'productMetrics': {}}
            for key, value, unit in [('expenseRatio', .1, 'percent'), ('medianSpread30d', 5, 'bps'), ('dailyTrackingError', 5, 'bps')]:
                stock['productMetrics'][key] = {'value': value, 'unit': unit, 'asOf': '2026-09-14', 'source': 'https://example.com/fund', 'targetMultiple': leverage, 'method': 'sample_std_daily_difference', 'fundBasis': 'nav_total_return', 'observations': 30, 'benchmark': 'Test Index'}
            entry = stock['productMetrics']['dailyTrackingError']
            if invalid == 'future': entry['asOf'] = '2026-09-16'
            if invalid == 'source': entry['source'] = ''
            if invalid == 'unit': entry['unit'] = 'percent'
            if invalid == 'target': entry['targetMultiple'] = 7
            if invalid == 'missing': del stock['productMetrics']['dailyTrackingError']
            stocks.append(stock)
    script = """
      import {productAssessment, leverageScenarios} from './frontend/src/lib/asset-assessment.js';
      let input=''; for await (const chunk of process.stdin) input+=chunk;
      console.log(JSON.stringify(JSON.parse(input).map(s => [productAssessment(s), leverageScenarios(s.leverageMultiple)])));
    """
    run = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, input=json.dumps(stocks), text=True, capture_output=True, check=True)
    expected = [[product_assessment(s), leverage_scenarios(s['leverageMultiple'])] for s in stocks]
    assert json.loads(run.stdout) == expected
    assert expected[0][0]['score'] == 95
    assert expected[1][0]['score'] is None
