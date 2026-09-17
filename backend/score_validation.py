"""Calculation availability never implies predictive validation."""
import json
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parents[1] / 'frontend/src/lib/validation-policy.json').read_text(encoding='utf-8'))


def score_validation(stock):
    requirements = POLICY['requirements'].get(stock['assetType'])
    product = (stock.get('assetAssessment') or {}).get('product') or {}
    return {'contractVersion': POLICY['version'], 'reviewedAt': POLICY['reviewedAt'],
            'predictiveStatus': POLICY['predictiveStatus'] if requirements else 'unsupported',
            'calculationStatus': 'composite_available' if stock.get('score') is not None else
                'components_only' if stock.get('timingScore') is not None or product.get('score') is not None else 'insufficient_data',
            'classificationStatus': 'not_reviewed' if stock['assetType'] == 'stock' else
                'source_linked' if stock.get('classificationSource') else 'needs_review',
            'requirements': requirements or ['dedicated_model'], 'historicalValidationRequired': True,
            'weightChangeAllowed': POLICY['weightChangeAllowed']}
