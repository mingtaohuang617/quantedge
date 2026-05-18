"""
test_finnhub_source — Finnhub data source 单测（mock httpx 零网络）
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from data_sources import finnhub_source
from data_sources.finnhub_source import (
    fetch_fundamentals_finnhub,
    enrich_us_fundamentals_finnhub,
    FinnhubError,
)


@pytest.fixture(autouse=True)
def set_api_key(monkeypatch):
    """所有测试默认设 FINNHUB_API_KEY=test，避免误触 _get_api_key 提前抛错"""
    monkeypatch.setenv("FINNHUB_API_KEY", "test_key_xxx")


def _mock_response(status: int = 200, json_data: dict | None = None):
    """构造一个 httpx Response mock"""
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = json_data or {}
    return resp


class TestFetchFundamentals:
    def test_normal_response_maps_fields(self):
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(200, {
                              "metric": {
                                  "peNormalizedAnnual": 15.5,
                                  "pbAnnual": 2.1,
                                  "dividendYieldIndicatedAnnual": 4.5,   # %
                                  "roeRfy": 18.0,                         # %
                                  "totalDebt/totalEquityAnnual": 0.85,
                              }
                          })):
            r = fetch_fundamentals_finnhub("AAPL")
            assert r["pe"] == 15.5
            assert r["pb"] == 2.1
            assert r["dividend_yield"] == 0.045    # 4.5% → 0.045
            assert r["roe"] == 0.18                # 18% → 0.18
            assert r["debt_to_equity"] == 0.85

    def test_fallback_pe_ttm(self):
        """peNormalizedAnnual 缺时 fallback peBasicExclExtraTTM"""
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(200, {
                              "metric": {
                                  "peBasicExclExtraTTM": 20.0,
                                  "pbAnnual": 3.0,
                              }
                          })):
            r = fetch_fundamentals_finnhub("AAPL")
            assert r["pe"] == 20.0
            assert r["pb"] == 3.0

    def test_missing_fields_returns_none(self):
        """metric 里没字段 → 对应字段 = None"""
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(200, {"metric": {}})):
            r = fetch_fundamentals_finnhub("XYZ")
            assert r["pe"] is None
            assert r["pb"] is None
            assert r["dividend_yield"] is None

    def test_zero_pe_filtered(self):
        """PE=0 视为无效（避免误读）"""
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(200, {
                              "metric": {"peNormalizedAnnual": 0, "pbAnnual": 2.0}
                          })):
            r = fetch_fundamentals_finnhub("ZERO")
            assert r["pe"] is None
            assert r["pb"] == 2.0

    def test_429_raises(self):
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(429)):
            with pytest.raises(FinnhubError, match="rate limit"):
                fetch_fundamentals_finnhub("AAPL")

    def test_401_raises_auth(self):
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(401)):
            with pytest.raises(FinnhubError, match="auth"):
                fetch_fundamentals_finnhub("AAPL")

    def test_500_returns_none(self):
        """非鉴权/限频的 HTTP 错 → 返回 None（不阻断批量）"""
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(500)):
            assert fetch_fundamentals_finnhub("AAPL") is None

    def test_network_error_returns_none(self):
        import httpx
        with patch.object(finnhub_source.httpx, "get",
                          side_effect=httpx.ConnectError("connection refused")):
            assert fetch_fundamentals_finnhub("AAPL") is None

    def test_no_api_key_raises(self, monkeypatch):
        monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
        with pytest.raises(FinnhubError, match="FINNHUB_API_KEY not set"):
            fetch_fundamentals_finnhub("AAPL")


class TestEnrichBatch:
    def test_only_missing_skips_filled(self):
        """only_missing=True 时已有 PE 的 item 跳过"""
        items = [
            {"ticker": "AAPL", "pe": 30.0},   # 已有 — 跳过
            {"ticker": "GOOG"},                # 缺 — enrich
        ]
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(200, {
                              "metric": {"peNormalizedAnnual": 25.0}
                          })), \
             patch.object(finnhub_source.time, "sleep"):
            n_ok, n_processed = enrich_us_fundamentals_finnhub(items, only_missing=True)
            assert n_processed == 1     # 只跑了 GOOG
            assert n_ok == 1
            assert items[0]["pe"] == 30.0   # AAPL 未动
            assert items[1]["pe"] == 25.0   # GOOG 被更新

    def test_force_overrides_filled(self):
        """only_missing=False 时强制覆盖"""
        items = [{"ticker": "AAPL", "pe": 30.0}]
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(200, {
                              "metric": {"peNormalizedAnnual": 35.0}
                          })), \
             patch.object(finnhub_source.time, "sleep"):
            n_ok, n_processed = enrich_us_fundamentals_finnhub(items, only_missing=False)
            assert n_processed == 1
            assert n_ok == 1
            assert items[0]["pe"] == 35.0   # 被覆盖

    def test_limit_caps_processing(self):
        items = [{"ticker": f"T{i}"} for i in range(10)]
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(200, {
                              "metric": {"peNormalizedAnnual": 20.0}
                          })), \
             patch.object(finnhub_source.time, "sleep"):
            n_ok, n_processed = enrich_us_fundamentals_finnhub(items, limit=3)
            assert n_processed == 3
            assert n_ok == 3

    def test_rate_limit_retries_then_continues(self):
        """429 触发 20s sleep + 重试一次；仍 429 时该 ticker 跳过"""
        items = [{"ticker": "AAPL"}]
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _mock_response(429)
            return _mock_response(200, {"metric": {"peNormalizedAnnual": 22.0}})

        with patch.object(finnhub_source.httpx, "get", side_effect=side_effect), \
             patch.object(finnhub_source.time, "sleep"):
            n_ok, n_processed = enrich_us_fundamentals_finnhub(items)
            assert n_processed == 1
            assert n_ok == 1
            assert items[0]["pe"] == 22.0
            assert call_count == 2   # 1 次 429 + 1 次成功 retry

    def test_auth_error_raises_uplifts(self):
        """401 / 403 致命错 → 终止整个批量"""
        items = [{"ticker": "T1"}, {"ticker": "T2"}]
        with patch.object(finnhub_source.httpx, "get",
                          return_value=_mock_response(401)), \
             patch.object(finnhub_source.time, "sleep"):
            with pytest.raises(FinnhubError, match="auth"):
                enrich_us_fundamentals_finnhub(items)

    def test_no_api_key_raises_upfront(self, monkeypatch):
        monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
        items = [{"ticker": "AAPL"}]
        with pytest.raises(FinnhubError, match="not set"):
            enrich_us_fundamentals_finnhub(items)
