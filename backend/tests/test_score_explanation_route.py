"""Ensure API request parsing preserves asset boundaries before any model call."""
from types import SimpleNamespace

import pytest

import server
from score_explanation import build_score_prompt


@pytest.mark.parametrize('asset_type', ['stock', 'crypto', 'index_etf', None])
def test_explanation_route_preserves_asset_type(monkeypatch, asset_type):
    def explain(stock, weights, **kwargs):
        assert stock['assetType'] == asset_type
        try:
            prompt = build_score_prompt(stock, weights)
            return {'ok': True, 'explanation': prompt}
        except ValueError:
            return {'ok': False}

    monkeypatch.setattr(server, 'HAS_LLM', True)
    monkeypatch.setattr(server, '_llm_mod', SimpleNamespace(explain_score=explain))
    request = server.LLMExplainScoreReq(
        ticker='TEST', assetType=asset_type, score=74, qualityScore=70, timingScore=80,
        modelVersion='3.2.0', scoring={'version': '3.2.0', 'status': 'ready'},
    )
    assert server.llm_explain_score(request)['ok'] is (asset_type == 'stock')
