"""smart_beta 模块基础测试 — 纯函数，零网络依赖。"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from smart_beta import (  # noqa: E402
    allocate_sector_weights,
    build_snapshot,
    compose_weights,
    compute_risk_score,
    get_core_allocation,
    load_universe,
    risk_score_to_core_weight,
    run_backtest,
    score_sector_etf,
    select_sector_top_k,
)


# ── 辅助 ──────────────────────────────────────────────────
def _series(length=250, start=100.0, drift=0.0005, vol=0.01, seed=42):
    rng = np.random.RandomState(seed)
    rets = rng.normal(drift, vol, length)
    prices = start * np.cumprod(1 + rets)
    return pd.Series(prices)


# ── L1 风险层 ─────────────────────────────────────────────
def test_risk_score_high_when_safe_environment():
    spy = _series(length=250, drift=0.001, vol=0.008)
    risk = compute_risk_score(vix=12, spy_prices=spy, hy_spread=3.5, real_rate_chg=-0.3)
    assert risk["risk_score"] > 0.8
    assert risk["components"]["vix"] == 1.0


def test_risk_score_low_when_stress():
    spy = _series(length=250, drift=-0.001, vol=0.02)
    risk = compute_risk_score(vix=30, spy_prices=spy, hy_spread=7, real_rate_chg=0.5)
    # VIX/credit/real-rate 三项都=0；trend 在随机种子下可能 0.3-1.0 →
    # 总分上界 = 1.0 * 0.3 = 0.3。给一点边界容忍。
    assert risk["risk_score"] <= 0.30 + 1e-9
    assert risk["components"]["vix"] == 0.0
    assert risk["components"]["credit"] == 0.0
    assert risk["components"]["real_rate"] == 0.0


def test_risk_score_missing_data_neutral():
    spy = _series(length=10)
    risk = compute_risk_score(vix=None, spy_prices=spy, hy_spread=None, real_rate_chg=None)
    assert 0.4 < risk["risk_score"] < 0.6


def test_core_weight_inverse_of_risk():
    assert risk_score_to_core_weight(0.0) == 0.9
    assert risk_score_to_core_weight(1.0) == 0.4
    assert abs(risk_score_to_core_weight(0.5) - 0.65) < 0.01


# ── L2 Core 层 ────────────────────────────────────────────
def test_core_allocation_balanced():
    u = load_universe()
    alloc = get_core_allocation("balanced", u)
    assert alloc == {"SPY": 0.60, "QQQ": 0.25, "IWM": 0.15}


def test_core_allocation_simple():
    u = load_universe()
    alloc = get_core_allocation("simple", u)
    assert alloc == {"SPY": 1.0}


def test_core_allocation_unknown_preset_raises():
    u = load_universe()
    with pytest.raises(ValueError):
        get_core_allocation("nope", u)


# ── L3 Sector 层 ──────────────────────────────────────────
def test_score_sector_trend_up_high():
    # 低噪声 + 强 drift，让趋势/相对强度分项稳定占优（避免随机种子翻车）
    spy = _series(length=200, drift=0.0003, vol=0.005, seed=1)
    etf = _series(length=200, drift=0.003, vol=0.005, seed=99)
    sc = score_sector_etf(etf, spy)
    assert sc["score"] > 50
    assert sc["components"]["trend"] > 70
    assert sc["components"]["relative"] > 60  # ETF 跑赢 SPY 即可


def test_score_sector_insufficient_data():
    spy = _series(length=10)
    etf = _series(length=10)
    sc = score_sector_etf(etf, spy)
    assert sc["score"] == 0.0


def test_score_sector_rsi_overheat_detected():
    """构造单调上涨序列 → RSI 应 >75。"""
    spy = _series(length=200, drift=0.0003)
    monotonic = pd.Series([100.0 * (1.015 ** i) for i in range(200)])
    sc = score_sector_etf(monotonic, spy)
    assert sc["components"]["rsi"] > 75


def test_select_top_k_no_holdings():
    ranked = [{"ticker": f"X{i}", "score": 100 - i} for i in range(10)]
    selected = select_sector_top_k(ranked, current_holdings=None, k=3, buffer=2)
    assert selected == ["X0", "X1", "X2"]


def test_select_top_k_buffer_keeps_close_rank():
    """X3 排第 4，在 buffer=2 内 → 保留。"""
    ranked = [{"ticker": f"X{i}", "score": 100 - i} for i in range(10)]
    selected = select_sector_top_k(ranked, current_holdings=["X3", "X0"], k=3, buffer=2)
    assert "X3" in selected
    assert "X0" in selected
    assert len(selected) == 3


def test_select_top_k_buffer_evicts_far_drift():
    """X7 排第 8，超出 buffer=2 → 踢出。"""
    ranked = [{"ticker": f"X{i}", "score": 100 - i} for i in range(10)]
    selected = select_sector_top_k(ranked, current_holdings=["X7"], k=3, buffer=2)
    assert "X7" not in selected
    assert selected == ["X0", "X1", "X2"]


def test_allocate_equal():
    ranked = [{"ticker": "A", "score": 80}, {"ticker": "B", "score": 40}]
    alloc = allocate_sector_weights(["A", "B"], ranked, mode="equal")
    assert alloc == {"A": 0.5, "B": 0.5}


def test_allocate_momentum_weighted_by_score():
    ranked = [{"ticker": "A", "score": 80}, {"ticker": "B", "score": 20}]
    alloc = allocate_sector_weights(["A", "B"], ranked, mode="momentum")
    assert abs(alloc["A"] - 0.8) < 1e-3
    assert abs(alloc["B"] - 0.2) < 1e-3


def test_allocate_momentum_zero_total_falls_back_equal():
    ranked = [{"ticker": "A", "score": 0}, {"ticker": "B", "score": 0}]
    alloc = allocate_sector_weights(["A", "B"], ranked, mode="momentum")
    assert alloc == {"A": 0.5, "B": 0.5}


# ── 编排 ──────────────────────────────────────────────────
def test_compose_weights_sums_to_one():
    out = compose_weights(
        core_weight=0.65,
        core_alloc={"SPY": 0.60, "QQQ": 0.40},
        sector_alloc={"XLK": 0.5, "XLF": 0.5},
    )
    assert abs(sum(out.values()) - 1.0) < 1e-6
    assert abs(out["SPY"] - 0.39) < 1e-4   # 0.65 * 0.60
    assert abs(out["XLK"] - 0.175) < 1e-4  # 0.35 * 0.5


def test_compose_weights_merges_overlap():
    """同标的同时在 core 和 sector，权重应相加。"""
    out = compose_weights(
        core_weight=0.5,
        core_alloc={"SPY": 1.0},
        sector_alloc={"SPY": 1.0},
    )
    assert abs(out["SPY"] - 1.0) < 1e-6


# ── 端到端 ───────────────────────────────────────────────
def test_build_snapshot_smoke():
    spy = _series(length=250, drift=0.0005)
    sector_data = {
        "XLK": {"prices": _series(length=250, drift=0.001, seed=1),  "volumes": None, "name": "Tech"},
        "XLF": {"prices": _series(length=250, drift=0.0003, seed=2), "volumes": None, "name": "Fin"},
        "XLV": {"prices": _series(length=250, drift=0.0008, seed=3), "volumes": None, "name": "HC"},
        "XLE": {"prices": _series(length=250, drift=-0.0005, seed=4),"volumes": None, "name": "Energy"},
    }
    snap = build_snapshot(
        spy_prices=spy, sector_data=sector_data,
        vix=18, hy_spread=4.5, real_rate_chg=0.0,
        core_preset="balanced", k=2, weight_mode="equal",
    )
    assert "risk" in snap
    assert "weights" in snap
    assert abs(sum(snap["weights"].values()) - 1.0) < 1e-3
    assert len(snap["sector_selected"]) == 2
    assert len(snap["sector_ranked"]) == 4
    # ranked 必须按 score 降序
    scores = [r["score"] for r in snap["sector_ranked"]]
    assert scores == sorted(scores, reverse=True)


def test_build_snapshot_excludes_etfs_with_short_history():
    spy = _series(length=250, drift=0.0005)
    sector_data = {
        "XLK":   {"prices": _series(length=250, seed=1), "volumes": None, "name": "Tech"},
        "SHORT": {"prices": _series(length=50,  seed=2), "volumes": None, "name": "Short"},
    }
    snap = build_snapshot(
        spy_prices=spy, sector_data=sector_data,
        vix=20, hy_spread=4.5, real_rate_chg=0.0,
        core_preset="simple", k=1, weight_mode="equal",
    )
    tickers = [r["ticker"] for r in snap["sector_ranked"]]
    assert "SHORT" not in tickers
    assert "XLK" in tickers


# ── run_backtest 历史回测引擎 ──────────────────────────────
def _dated_series(n=760, start=100.0, drift=0.0004, osc=0.012, period=23):
    """确定性日频价格（带平滑振荡 → vol>0；无随机 → 测试稳定）。"""
    idx = pd.date_range("2021-01-04", periods=n, freq="B")
    tt = np.arange(n)
    prices = start * (1.0 + drift) ** tt * (1.0 + osc * np.sin(tt / period))
    return pd.Series(prices, index=idx)


def _bt_prices():
    """spy / core / sector 价格，ticker 取自真实 universe。"""
    uni = load_universe()
    core_tickers = list(get_core_allocation("balanced", uni).keys())
    sector_tickers = [s["ticker"] for s in uni.get("sector", [])][:8]
    spy = _dated_series(drift=0.0004)
    core_prices = {
        tk: (spy if tk == "SPY" else _dated_series(drift=0.0004 + 0.0001 * i, start=80 + 10 * i))
        for i, tk in enumerate(core_tickers)
    }
    drifts = [0.0007, 0.0005, 0.0003, 0.0001, -0.0001, -0.0003, 0.0006, 0.0002]
    sector_prices = {
        tk: _dated_series(drift=drifts[i % len(drifts)], start=50 + 3 * i)
        for i, tk in enumerate(sector_tickers)
    }
    return spy, core_prices, sector_prices


def test_run_backtest_smoke():
    spy, core_prices, sector_prices = _bt_prices()
    res = run_backtest(spy, sector_prices, core_prices, core_preset="balanced", k=3)
    assert "error" not in res
    n = len(res["dates"])
    assert n > 100
    assert len(res["strategy_nav"]) == n and len(res["benchmark_nav"]) == n
    assert all(np.isfinite(v) and v > 0 for v in res["strategy_nav"])
    assert abs(res["strategy_nav"][0] - 1.0) < 1e-9
    assert abs(res["benchmark_nav"][0] - 1.0) < 1e-9
    assert len(res["rebalances"]) >= 12
    for rb in res["rebalances"]:
        assert 0.0 <= rb["risk_score"] <= 1.0
        assert 0.4 <= rb["core_weight"] <= 0.9
        assert abs(sum(rb["weights"].values()) - 1.0) < 0.02
    for key in ("total_return", "annualized_return", "sharpe", "max_dd", "volatility"):
        assert np.isfinite(res["metrics"][key])
    assert res["metrics"]["max_dd"] <= 0.0
    assert res["benchmark_metrics"]["total_return"] > 0  # SPY 上行


def test_run_backtest_missing_core_ticker_renormalizes():
    """关键修复回归锁：core 缺一只 ETF（数据没拉到）时剩余权重必须重新归一化，
    否则净值每次再平衡被 ×Σw(<1) → 阶梯式暴跌。"""
    spy, core_prices, sector_prices = _bt_prices()
    drop = next(tk for tk in core_prices if tk != "SPY")
    core_prices.pop(drop)  # 模拟数据缺失
    res = run_backtest(spy, sector_prices, core_prices, core_preset="balanced", k=3)
    assert "error" not in res
    navs = res["strategy_nav"]
    assert all(v > 0 for v in navs)
    # 未归一化会 ~26×月度 ×0.85 → 终值≈0.01 collapse；归一化后上行市应增长
    assert navs[-1] > 0.5
    ratios = [navs[i + 1] / navs[i] for i in range(len(navs) - 1)]
    assert min(ratios) > 0.8  # 再平衡边界无跳水


def test_run_backtest_insufficient_spy_bars():
    res = run_backtest(_dated_series(n=150), {}, {}, core_preset="balanced", k=3)
    assert "error" in res
