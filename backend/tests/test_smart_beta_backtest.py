"""
测试 smart_beta.run_backtest
============================
覆盖：
  - 基本流程跑通 + 输出 schema
  - 月度再平衡日数量 = 月数
  - 净值序列长度与 benchmark 对齐
  - 指标合理性（数值范围）
  - 边界：数据不足
"""
import numpy as np
import pandas as pd
import pytest

import smart_beta as sb


def _make_price_series(start: str, end: str, drift: float, vol: float, seed: int) -> pd.Series:
    """生成几何布朗运动模拟价格 series（交易日 freq=B）。"""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(start=start, end=end, freq="B")
    n = len(dates)
    log_ret = rng.normal(loc=drift, scale=vol, size=n)
    nav = np.exp(np.cumsum(log_ret))
    return pd.Series(nav * 100.0, index=dates, name="price")


@pytest.fixture
def universe():
    return sb.load_universe()


@pytest.fixture
def sample_prices():
    """3 年模拟数据：SPY + 几个 core + 几个 sector ETF。"""
    start, end = "2022-01-01", "2025-01-01"
    spy = _make_price_series(start, end, 0.0004, 0.01, seed=1)
    core = {
        "SPY": spy,
        "QQQ": _make_price_series(start, end, 0.0005, 0.012, seed=2),
        "IWM": _make_price_series(start, end, 0.0003, 0.013, seed=3),
    }
    sector = {
        "XLK": _make_price_series(start, end, 0.0006, 0.014, seed=10),
        "XLF": _make_price_series(start, end, 0.0003, 0.011, seed=11),
        "XLV": _make_price_series(start, end, 0.0004, 0.010, seed=12),
        "XLE": _make_price_series(start, end, 0.0002, 0.018, seed=13),
        "XLI": _make_price_series(start, end, 0.0004, 0.012, seed=14),
        "XLY": _make_price_series(start, end, 0.0005, 0.013, seed=15),
        "XLP": _make_price_series(start, end, 0.0002, 0.008, seed=16),
        "XLU": _make_price_series(start, end, 0.0003, 0.009, seed=17),
        "XLB": _make_price_series(start, end, 0.0003, 0.012, seed=18),
        "XLRE": _make_price_series(start, end, 0.0003, 0.011, seed=19),
        "XLC": _make_price_series(start, end, 0.0004, 0.013, seed=20),
        "SOXX": _make_price_series(start, end, 0.0007, 0.018, seed=21),
        "SMH":  _make_price_series(start, end, 0.0007, 0.018, seed=22),
        "HACK": _make_price_series(start, end, 0.0005, 0.015, seed=23),
        "ICLN": _make_price_series(start, end, 0.0001, 0.020, seed=24),
        "ARKK": _make_price_series(start, end, -0.0001, 0.025, seed=25),
    }
    return spy, sector, core


def test_run_backtest_basic_flow(sample_prices, universe):
    """端到端跑通 + 返回字段齐全。"""
    spy, sector, core = sample_prices
    result = sb.run_backtest(
        spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe,
    )
    # 不能是 error
    assert "error" not in result, f"backtest 失败: {result.get('error')}"
    # 必备字段
    for key in ("dates", "strategy_nav", "benchmark_nav", "rebalances", "metrics", "benchmark_metrics"):
        assert key in result, f"缺少字段: {key}"
    # 序列对齐
    assert len(result["dates"]) == len(result["strategy_nav"]) == len(result["benchmark_nav"])
    assert len(result["dates"]) > 0


def test_rebalance_count_matches_months(sample_prices, universe):
    """3 年回测约 36 月；扣掉 sector ETF 120 bar 预热（约 6 月）≈ 20-40 区间。"""
    spy, sector, core = sample_prices
    result = sb.run_backtest(spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe)
    rebals = result["rebalances"]
    assert 20 <= len(rebals) <= 40, f"再平衡日数异常: {len(rebals)}"


def test_rebalance_has_required_fields(sample_prices, universe):
    """每个再平衡记录有 date/weights/risk_score/core_weight。"""
    spy, sector, core = sample_prices
    result = sb.run_backtest(spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe)
    for rb in result["rebalances"][:3]:
        assert {"date", "weights", "risk_score", "core_weight"} <= rb.keys()
        assert isinstance(rb["weights"], dict)
        # 权重总和接近 1
        total = sum(rb["weights"].values())
        assert 0.95 <= total <= 1.05, f"权重总和异常: {total}"


def test_nav_starts_at_initial(sample_prices, universe):
    """净值序列首日 ≈ initial_nav（容忍权重总和浮点累加误差）。"""
    spy, sector, core = sample_prices
    result = sb.run_backtest(
        spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe,
        initial_nav=1.0,
    )
    # 容忍 0.1% — 权重小数累加误差（compose_weights 浮点）
    assert abs(result["strategy_nav"][0] - 1.0) < 1e-3
    assert abs(result["benchmark_nav"][0] - 1.0) < 1e-6


def test_metrics_reasonable_range(sample_prices, universe):
    """指标在合理数值范围内（不是 NaN / inf / 异常值）。"""
    spy, sector, core = sample_prices
    result = sb.run_backtest(spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe)
    m = result["metrics"]
    # 不是 NaN / inf
    for k in ("total_return", "annualized_return", "sharpe", "max_dd", "volatility"):
        v = m[k]
        assert isinstance(v, float)
        assert not np.isnan(v) and not np.isinf(v), f"{k}={v}"
    # max_dd 必须 ≤ 0
    assert m["max_dd"] <= 0
    # volatility 必须 ≥ 0
    assert m["volatility"] >= 0


def test_alpha_total_consistent(sample_prices, universe):
    """alpha_total = strategy_total - benchmark_total。"""
    spy, sector, core = sample_prices
    result = sb.run_backtest(spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe)
    expected = result["metrics"]["total_return"] - result["benchmark_metrics"]["total_return"]
    assert abs(result["alpha_total"] - expected) < 1e-9


def test_insufficient_spy_data_returns_error():
    """SPY 数据 < 200 → error 而非 crash。"""
    spy = pd.Series([100.0] * 100, index=pd.date_range("2024-01-01", periods=100, freq="B"))
    result = sb.run_backtest(spy_prices=spy, sector_prices={}, core_prices={"SPY": spy})
    assert "error" in result
    assert "200" in result["error"] or "不足" in result["error"]


def test_custom_date_range(sample_prices, universe):
    """指定 start/end，回测窗口缩小。"""
    spy, sector, core = sample_prices
    result_full = sb.run_backtest(
        spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe,
    )
    result_short = sb.run_backtest(
        spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe,
        start_date="2023-06-01", end_date="2024-06-01",
    )
    assert len(result_short["dates"]) < len(result_full["dates"])
    assert 10 <= len(result_short["rebalances"]) <= 14  # ~12 months


def test_different_core_presets(sample_prices, universe):
    """切 core_preset 应改变 weights 结构。"""
    spy, sector, core = sample_prices
    res_balanced = sb.run_backtest(
        spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe,
        core_preset="balanced",
    )
    res_simple = sb.run_backtest(
        spy_prices=spy, sector_prices=sector, core_prices=core, universe=universe,
        core_preset="simple",
    )
    # 第一次再平衡的 weights 应不同
    w_balanced = res_balanced["rebalances"][0]["weights"]
    w_simple = res_simple["rebalances"][0]["weights"]
    assert w_balanced != w_simple


def test_missing_ticker_normalizes_no_stepdrop(sample_prices, universe):
    """回归（生产 -82% 暴跌 bug）：balanced 权重含 QQQ/IWM，但 core_prices 只给 SPY
    （模拟 QQQ/IWM 数据没拉到）。修复前 valid_w 总和 < 1 → 净值每次再平衡 ×Σw 阶梯
    暴跌；修复后归一化到 Σ=1 → 净值起点 ≈1.0 且无人为断崖。"""
    spy, sector, _full_core = sample_prices
    core_only_spy = {"SPY": spy}  # 故意缺 QQQ/IWM
    result = sb.run_backtest(
        spy_prices=spy, sector_prices=sector, core_prices=core_only_spy,
        universe=universe, core_preset="balanced", initial_nav=1.0,
    )
    assert "error" not in result
    nav = result["strategy_nav"]
    # 1) 起点 ≈ 1.0（修复前会是 Σw ≈ 0.x）
    assert abs(nav[0] - 1.0) < 0.05, f"净值起点异常 {nav[0]}（归一化失效?）"
    # 2) 无单日人为断崖（再平衡边界不应出现 ~35% 的跳水）
    max_drop = min((nav[i] / nav[i - 1] - 1) for i in range(1, len(nav)))
    assert max_drop > -0.20, f"出现单日 {max_drop*100:.0f}% 断崖 — 归一化未生效"
    # 3) 总收益落在合理范围（不该是 -80%+ 的暴亏）
    assert result["metrics"]["total_return"] > -0.5
