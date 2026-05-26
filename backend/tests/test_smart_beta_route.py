"""
backend/server.py — /api/smart-beta/snapshot FastAPI route 集成测试

之前 test_smart_beta.py 只覆盖 smart_beta 模块 17 个函数级单测，但 HTTP route 本身
（参数解析 / cache 命中 / 503 错误 / sanitize / fetch_errors 聚合）没人测过。

策略：用 monkeypatch 把 _fetch_etf_prices / _fetch_fred_latest / sb.build_snapshot
替换成确定性 stub，避免触网 + 让 route 跑完整流程。

覆盖：
  - GET 默认参数 → 200 + snapshot 关键字段
  - core_preset / k / weight_mode / current_holdings 4 个 query param 透传
  - SPY 数据缺失 → 503
  - 相同 cache_key 第二次调用 → _cached=True
  - fetch_errors 聚合（多只 ETF 失败时）
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import server  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    """每个测试前清空 smart-beta cache，避免互污染。"""
    server._smart_beta_cache.clear()
    return TestClient(server.app)


@pytest.fixture
def fake_universe(monkeypatch):
    """4 个行业 ETF 的最小 universe（够触发 build_snapshot）。"""
    import smart_beta as sb
    universe = {
        "sector": [
            {"ticker": "XLK", "name": "Technology"},
            {"ticker": "XLV", "name": "Health Care"},
            {"ticker": "XLE", "name": "Energy"},
            {"ticker": "XLF", "name": "Financials"},
        ]
    }
    monkeypatch.setattr(sb, "load_universe", lambda: universe)
    return universe


@pytest.fixture
def fake_spy(monkeypatch):
    """SPY 280 天伪数据（>100 bars 通过 503 守门）。"""
    idx = pd.date_range("2025-01-01", periods=280, freq="B")
    close = pd.Series(range(450, 730), index=idx, dtype=float)
    volume = pd.Series([1_000_000] * 280, index=idx, dtype=float)

    def fake_fetch(ticker, days=280, min_bars=120):
        if ticker == "SPY":
            return close, volume
        if ticker == "^VIX":
            return pd.Series([15.0, 16.5, 18.0]), None
        # 行业 ETF — 200 bars 数据（> MIN_BARS=120）
        sec_idx = pd.date_range("2025-01-01", periods=200, freq="B")
        sec_close = pd.Series(range(100, 300), index=sec_idx, dtype=float)
        sec_vol = pd.Series([500_000] * 200, index=sec_idx, dtype=float)
        return sec_close, sec_vol

    monkeypatch.setattr(server, "_fetch_etf_prices", fake_fetch)
    return close


@pytest.fixture
def fake_fred(monkeypatch):
    """FRED HY spread / 实际利率 stub。"""
    def fake_fetch(series_id, days_back=90):
        if series_id == "BAMLH0A0HYM2":
            return 3.5, 3.2  # latest, older
        if series_id == "DFII10":
            return 2.0, 2.1
        return None, None
    monkeypatch.setattr(server, "_fetch_fred_latest", fake_fetch)


@pytest.fixture
def fake_snapshot(monkeypatch):
    """sb.build_snapshot 返回简化 snapshot — 让我们能 assert 入参。"""
    import smart_beta as sb
    captured = {}

    def fake_build(**kwargs):
        captured.update(kwargs)
        return {
            "core_weight": 0.6,
            "satellite_weight": 0.4,
            "tilts": [{"ticker": "XLK", "weight": 0.5}],
            "as_of": "2026-05-24",
        }
    monkeypatch.setattr(sb, "build_snapshot", fake_build)
    return captured


class TestDefaultRequest:
    """默认参数返回 200 + 关键字段"""

    def test_default_returns_200(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        r = client.get("/api/smart-beta/snapshot")
        assert r.status_code == 200

    def test_default_response_has_snapshot_fields(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        r = client.get("/api/smart-beta/snapshot")
        data = r.json()
        assert "core_weight" in data
        assert "tilts" in data
        assert "fetch_errors" in data
        assert "data_sources" in data

    def test_default_data_sources_populated(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        r = client.get("/api/smart-beta/snapshot")
        ds = r.json()["data_sources"]
        assert ds["vix"] == 18.0  # last value
        assert ds["hy_spread"] == 3.5
        assert ds["real_rate_now"] == 2.0
        # real_rate_chg = 2.0 - 2.1 = -0.1
        assert abs(ds["real_rate_chg"] - (-0.1)) < 1e-9


class TestQueryParams:
    """4 个 query 参数透传"""

    def test_core_preset_passed_through(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?core_preset=simple")
        assert fake_snapshot["core_preset"] == "simple"

    def test_k_passed_through(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?k=5")
        assert fake_snapshot["k"] == 5

    def test_weight_mode_passed_through(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?weight_mode=momentum")
        assert fake_snapshot["weight_mode"] == "momentum"

    def test_current_holdings_parsed_to_list(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?current_holdings=XLK,XLV,XLE")
        assert fake_snapshot["current_holdings"] == ["XLK", "XLV", "XLE"]

    def test_current_holdings_uppercased_and_trimmed(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?current_holdings=xlk, xlv ,XLE")
        assert fake_snapshot["current_holdings"] == ["XLK", "XLV", "XLE"]

    def test_current_holdings_empty_string_is_none(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?current_holdings=")
        assert fake_snapshot["current_holdings"] is None

    def test_current_holdings_default_is_none(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot")
        assert fake_snapshot["current_holdings"] is None

    def test_k_out_of_range_rejected(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        # ge=1, le=10
        assert client.get("/api/smart-beta/snapshot?k=0").status_code == 422
        assert client.get("/api/smart-beta/snapshot?k=11").status_code == 422


class TestSPYUnavailable:
    """SPY 数据不可用 → 503"""

    def test_spy_none_returns_503(self, client, fake_universe, fake_fred, fake_snapshot, monkeypatch):
        monkeypatch.setattr(server, "_fetch_etf_prices",
                            lambda t, days=280, min_bars=120: (None, None))
        r = client.get("/api/smart-beta/snapshot")
        assert r.status_code == 503
        assert "SPY" in r.json()["detail"]

    def test_spy_too_few_bars_returns_503(self, client, fake_universe, fake_fred, fake_snapshot, monkeypatch):
        # < 100 bars
        short_spy = pd.Series(range(50), dtype=float)
        monkeypatch.setattr(server, "_fetch_etf_prices",
                            lambda t, days=280, min_bars=120: (short_spy, None))
        r = client.get("/api/smart-beta/snapshot")
        assert r.status_code == 503


class TestCacheBehavior:
    """同参数第二次调用走缓存（_cached=True）"""

    def test_first_call_not_cached(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        r = client.get("/api/smart-beta/snapshot")
        assert r.json().get("_cached") is not True

    def test_second_call_same_params_is_cached(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot")
        r = client.get("/api/smart-beta/snapshot")
        assert r.json().get("_cached") is True

    def test_different_params_bust_cache(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?core_preset=balanced")
        r = client.get("/api/smart-beta/snapshot?core_preset=simple")
        # 不同 preset → 不同 cache key → 重新算 → _cached 不存在
        assert r.json().get("_cached") is not True

    def test_different_holdings_bust_cache(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot):
        client.get("/api/smart-beta/snapshot?current_holdings=XLK")
        r = client.get("/api/smart-beta/snapshot?current_holdings=XLV")
        assert r.json().get("_cached") is not True


class TestFetchErrors:
    """ETF 拉取失败时 fetch_errors 应聚合"""

    def test_fetch_exception_recorded(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot, monkeypatch):
        # 让 XLE 抛异常，其它正常
        idx = pd.date_range("2025-01-01", periods=280, freq="B")
        spy_close = pd.Series(range(450, 730), index=idx, dtype=float)
        sec_idx = pd.date_range("2025-01-01", periods=200, freq="B")

        def fake_fetch(ticker, days=280, min_bars=120):
            if ticker == "SPY":
                return spy_close, None
            if ticker == "^VIX":
                return pd.Series([15.0]), None
            if ticker == "XLE":
                raise RuntimeError("network down")
            return pd.Series(range(100, 300), index=sec_idx, dtype=float), None
        monkeypatch.setattr(server, "_fetch_etf_prices", fake_fetch)

        r = client.get("/api/smart-beta/snapshot")
        assert r.status_code == 200
        errors = r.json()["fetch_errors"]
        xle = [e for e in errors if e["ticker"] == "XLE"]
        assert len(xle) == 1
        assert xle[0]["reason"] == "fetch_exception"
        assert "network down" in xle[0]["detail"]

    def test_no_data_recorded(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot, monkeypatch):
        # 让 XLV 返回 None（no_data）
        idx = pd.date_range("2025-01-01", periods=280, freq="B")
        spy_close = pd.Series(range(450, 730), index=idx, dtype=float)
        sec_idx = pd.date_range("2025-01-01", periods=200, freq="B")

        def fake_fetch(ticker, days=280, min_bars=120):
            if ticker == "SPY":
                return spy_close, None
            if ticker == "^VIX":
                return pd.Series([15.0]), None
            if ticker == "XLV":
                return None, None
            return pd.Series(range(100, 300), index=sec_idx, dtype=float), None
        monkeypatch.setattr(server, "_fetch_etf_prices", fake_fetch)

        r = client.get("/api/smart-beta/snapshot")
        errors = r.json()["fetch_errors"]
        xlv = [e for e in errors if e["ticker"] == "XLV"]
        assert len(xlv) == 1
        assert xlv[0]["reason"] == "no_data"

    def test_insufficient_bars_recorded(self, client, fake_universe, fake_spy, fake_fred, fake_snapshot, monkeypatch):
        # 让 XLF 返回少于 MIN_BARS=120 条
        idx = pd.date_range("2025-01-01", periods=280, freq="B")
        spy_close = pd.Series(range(450, 730), index=idx, dtype=float)
        sec_idx = pd.date_range("2025-01-01", periods=200, freq="B")
        short_idx = pd.date_range("2025-01-01", periods=50, freq="B")

        def fake_fetch(ticker, days=280, min_bars=120):
            if ticker == "SPY":
                return spy_close, None
            if ticker == "^VIX":
                return pd.Series([15.0]), None
            if ticker == "XLF":
                return pd.Series(range(50), index=short_idx, dtype=float), None
            return pd.Series(range(100, 300), index=sec_idx, dtype=float), None
        monkeypatch.setattr(server, "_fetch_etf_prices", fake_fetch)

        r = client.get("/api/smart-beta/snapshot")
        errors = r.json()["fetch_errors"]
        xlf = [e for e in errors if e["ticker"] == "XLF"]
        assert len(xlf) == 1
        assert xlf[0]["reason"] == "insufficient_bars"
        assert xlf[0]["bars"] == 50
        assert xlf[0]["min"] == 120
