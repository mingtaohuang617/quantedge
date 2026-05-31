"""
Smart Beta 回测路由集成测试
==========================
锁定 /api/smart-beta/backtest 行为，尤其是 perf 重构后的并行拉取路径：
  - SPY 纳入并行池（不再串行先拉）
  - 19 ticker 并行 + 分发到 sector/core
  - SPY fail-fast 检查移到拉取后
策略：monkeypatch load_universe + _fetch_etf_prices，零外部网络。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import server  # noqa: E402
import smart_beta as sb  # noqa: E402


def _seed(ticker: str) -> int:
    """确定性 seed（不依赖 hash randomization）。"""
    return sum(map(ord, ticker)) % 10000


@pytest.fixture
def bt_client(monkeypatch):
    server._smart_beta_bt_cache.clear()
    universe = {
        "core": {"balanced": {"weights": {"SPY": 0.6, "QQQ": 0.25, "IWM": 0.15}}},
        "sector": [
            {"ticker": "XLK", "name": "Tech"},
            {"ticker": "XLV", "name": "Health"},
            {"ticker": "XLE", "name": "Energy"},
            {"ticker": "XLF", "name": "Financials"},
        ],
    }
    monkeypatch.setattr(sb, "load_universe", lambda: universe)

    # 合成 ~5.5 年数据，确保覆盖 2022-01-01 → today
    def fake_fetch(ticker, days=280, min_bars=120):
        rng = np.random.default_rng(_seed(ticker))
        idx = pd.date_range("2021-06-01", periods=1400, freq="B")
        close = pd.Series(np.exp(np.cumsum(rng.normal(0.0004, 0.012, 1400))) * 100, index=idx)
        vol = pd.Series([1_000_000.0] * 1400, index=idx)
        return close, vol

    monkeypatch.setattr(server, "_fetch_etf_prices", fake_fetch)
    return TestClient(server.app)


def test_backtest_returns_200_with_metrics(bt_client):
    r = bt_client.get("/api/smart-beta/backtest?start_date=2022-01-01&core_preset=balanced&k=3")
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("dates", "strategy_nav", "benchmark_nav", "metrics", "benchmark_metrics", "rebalances"):
        assert key in d, f"缺字段 {key}"
    assert len(d["dates"]) == len(d["strategy_nav"]) == len(d["benchmark_nav"]) > 0


def test_backtest_zero_fetch_errors_spy_parallel(bt_client):
    """重构后 SPY 也走并行池 → 全部 ticker 拿到，fetch_errors 为空。"""
    r = bt_client.get("/api/smart-beta/backtest?start_date=2022-01-01&core_preset=balanced&k=3")
    assert r.status_code == 200
    assert r.json()["fetch_errors"] == []


def test_backtest_metrics_have_both_sides(bt_client):
    """metrics + benchmark_metrics 都齐全且数值合法。"""
    r = bt_client.get("/api/smart-beta/backtest?start_date=2022-01-01&core_preset=balanced&k=3")
    d = r.json()
    for m in (d["metrics"], d["benchmark_metrics"]):
        for f in ("total_return", "annualized_return", "sharpe", "max_dd"):
            assert isinstance(m[f], (int, float))
    assert "alpha_total" in d


def test_backtest_spy_fail_fast_503(bt_client, monkeypatch):
    """SPY 数据 < 200 bars → 503（fail-fast 在并行拉取后仍生效）。"""
    def short_fetch(ticker, days=280, min_bars=120):
        idx = pd.date_range("2025-01-01", periods=50, freq="B")
        return pd.Series(range(50), index=idx, dtype=float), None
    monkeypatch.setattr(server, "_fetch_etf_prices", short_fetch)
    r = bt_client.get("/api/smart-beta/backtest?start_date=2022-01-01")
    assert r.status_code == 503
    assert "SPY" in r.json().get("detail", "")


def test_backtest_cache_hit(bt_client):
    url = "/api/smart-beta/backtest?start_date=2022-01-01&core_preset=balanced&k=3"
    r1 = bt_client.get(url)
    assert r1.status_code == 200
    assert not r1.json().get("_cached")
    r2 = bt_client.get(url)
    assert r2.status_code == 200
    assert r2.json().get("_cached") is True


def test_backtest_invalid_core_preset_400(bt_client):
    r = bt_client.get("/api/smart-beta/backtest?start_date=2022-01-01&core_preset=nonexistent")
    assert r.status_code == 400


def test_backtest_start_after_end_400(bt_client):
    """start_date 在未来（> today）→ start >= end → 400。"""
    r = bt_client.get("/api/smart-beta/backtest?start_date=2099-01-01")
    assert r.status_code == 400
