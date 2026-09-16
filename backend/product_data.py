"""Read-only enrichment shared with the browser. Never fetch on a scoring request."""
import json
from functools import lru_cache
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / 'frontend/src/lib'
REGISTRY = json.loads((BASE / 'product-registry.json').read_text(encoding='utf-8'))
SNAPSHOT = BASE / 'product-observations.json'


@lru_cache(maxsize=2)
def _snapshot(_stamp):
    return json.loads(SNAPSHOT.read_text(encoding='utf-8'))


def product_enrichment(stock):
    config = REGISTRY.get(stock.get('ticker'))
    if not config:
        return {}
    result = {**config['metadata'], 'classificationSource': config['source']}
    snapshot = _snapshot(SNAPSHOT.stat().st_mtime_ns) if SNAPSHOT.exists() else {}
    record = snapshot.get('products', {}).get(stock.get('ticker'))
    if record and record['productDataAsOf'] >= (stock.get('productDataAsOf') or ''):
        result.update(record)
    return result
