"""mining_alpha.alpha191_factors 单元测试 — 前 30 个因子的端到端正确性 + 无前视检查。"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from mining_alpha.alpha191_factors import (  # noqa: E402
    _ALPHA_REGISTRY,
    compute_alpha,
    list_alphas,
)

# ── 测试数据：30 天 × 5 票 的伪行情 panel ────────────────────


@pytest.fixture
def synthetic_panel():
    """
    构造 300 天 × 50 票的真实形状 panel。
    300 天用于覆盖大窗口因子（Alpha25 SUM(RET,250)、Alpha26 CORR(...,230)、
    Alpha184 CORR(...,200)）。50 票保证 RANK 在多嵌套 CORR/DECAY 后仍有变化。
    """
    rng = np.random.RandomState(42)
    T, N = 300, 50
    dates = pd.date_range("2023-01-02", periods=T, freq="B")
    tickers = [f"T{i:02d}" for i in range(N)]

    # 模拟一个温和的随机游走 close
    base = 10.0
    log_ret = rng.randn(T, N) * 0.02
    close_arr = base * np.cumprod(1 + log_ret, axis=0)
    close = pd.DataFrame(close_arr, index=dates, columns=tickers)

    # 日内 high/low/open 围绕 close
    high = close * (1 + np.abs(rng.randn(T, N)) * 0.01)
    low = close * (1 - np.abs(rng.randn(T, N)) * 0.01)
    open_ = close.shift(1).fillna(close)  # 开盘取昨收
    # 修正 high >= max(open, close), low <= min(open, close)
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))

    # 量 / 额：随机正数
    volume = pd.DataFrame(rng.uniform(1e5, 1e7, size=(T, N)), index=dates, columns=tickers)
    amount = volume * close

    vwap = amount / volume
    ret = close.pct_change()

    # 注入合成基准（HS300 模拟）— 单序列广播为 dates × tickers
    bench_returns = rng.randn(T) * 0.012
    bench_close_1d = 3000 * np.cumprod(1 + bench_returns)
    bench_high_1d = bench_close_1d * (1 + np.abs(rng.randn(T)) * 0.005)
    bench_low_1d = bench_close_1d * (1 - np.abs(rng.randn(T)) * 0.005)
    bench_close = pd.DataFrame(np.tile(bench_close_1d[:, None], (1, N)),
                               index=dates, columns=tickers)
    bench_open = bench_close.shift(1).bfill()
    bench_high = pd.DataFrame(np.tile(bench_high_1d[:, None], (1, N)),
                              index=dates, columns=tickers)
    bench_low = pd.DataFrame(np.tile(bench_low_1d[:, None], (1, N)),
                             index=dates, columns=tickers)

    return {
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
        "amount": amount,
        "vwap": vwap,
        "ret": ret,
        "bench_open": bench_open,
        "bench_high": bench_high,
        "bench_low": bench_low,
        "bench_close": bench_close,
    }


# ── 注册器测试 ─────────────────────────────────────────────────


def test_registry_nonempty():
    """注册器应该至少有 30 个因子。"""
    nums = list_alphas()
    assert len(nums) >= 30
    # 几个标志性的因子号应该都在
    for n in [1, 14, 53, 96, 126, 153]:
        assert n in nums


def test_registry_meta():
    """注册器条目应该有 func/desc/category/name。"""
    info = _ALPHA_REGISTRY[1]
    assert "func" in info
    assert callable(info["func"])
    assert "desc" in info and len(info["desc"]) > 0
    assert "category" in info


# ── 全因子 smoke test ─────────────────────────────────────────


@pytest.mark.parametrize("num", sorted(_ALPHA_REGISTRY.keys()))
def test_factor_compiles_and_returns_dataframe(num, synthetic_panel):
    """每个因子能跑通、返回 DataFrame、形状正确、整体非 NaN 占比合理。"""
    result = compute_alpha(num, synthetic_panel)
    assert isinstance(result, pd.DataFrame), f"Alpha{num} 没返回 DataFrame"
    assert result.shape == synthetic_panel["close"].shape, f"Alpha{num} 形状错"
    # 整体非 NaN 比例 > 10%；这是"因子能算出值"的弱下界（大窗口因子也能过）
    notna_ratio = result.notna().sum().sum() / result.size
    assert notna_ratio > 0.10, (
        f"Alpha{num} 整体非 NaN 占比 {notna_ratio:.2%} 太低，可能是 panel 太小或因子断裂"
    )


# ── 抽样因子的数值正确性 ──────────────────────────────────────


def test_alpha14_known_value(synthetic_panel):
    """Alpha14: C - DELAY(C, 5)。手算第 10 天 ticker A：close[10] - close[5]。"""
    close = synthetic_panel["close"]
    r = compute_alpha(14, synthetic_panel)
    expected = close.iloc[10, 0] - close.iloc[5, 0]
    np.testing.assert_allclose(r.iloc[10, 0], expected, atol=1e-10)


def test_alpha15_overnight_gap(synthetic_panel):
    """Alpha15: OPEN/DELAY(CLOSE,1) - 1。"""
    open_ = synthetic_panel["open"]
    close = synthetic_panel["close"]
    r = compute_alpha(15, synthetic_panel)
    expected = open_.iloc[10, 0] / close.iloc[9, 0] - 1
    np.testing.assert_allclose(r.iloc[10, 0], expected, atol=1e-10)


def test_alpha18_close_ratio(synthetic_panel):
    """Alpha18: C/DELAY(C, 5)。"""
    close = synthetic_panel["close"]
    r = compute_alpha(18, synthetic_panel)
    expected = close.iloc[10, 0] / close.iloc[5, 0]
    np.testing.assert_allclose(r.iloc[10, 0], expected, atol=1e-10)


def test_alpha34_ma_ratio(synthetic_panel):
    """Alpha34: MEAN(C, 12) / C。"""
    close = synthetic_panel["close"]
    r = compute_alpha(34, synthetic_panel)
    expected = close.iloc[:15, 0].rolling(12).mean().iloc[-1] / close.iloc[14, 0]
    np.testing.assert_allclose(r.iloc[14, 0], expected, atol=1e-10)


def test_alpha53_up_days_pct(synthetic_panel):
    """Alpha53: COUNT(C>DELAY(C,1), 12)/12*100。"""
    close = synthetic_panel["close"]
    r = compute_alpha(53, synthetic_panel)
    # 在 idx=15 时，过去 12 个 (C>DELAY(C,1)) 的判断窗口 [4..15]
    win = (close.iloc[:16, 0] > close.iloc[:16, 0].shift(1)).iloc[4:16]
    expected = win.sum() / 12 * 100
    np.testing.assert_allclose(r.iloc[15, 0], expected, atol=1e-10)


def test_alpha100_volume_std(synthetic_panel):
    """Alpha100: STD(VOL, 20)。"""
    volume = synthetic_panel["volume"]
    r = compute_alpha(100, synthetic_panel)
    expected = volume.iloc[:25, 0].rolling(20).std().iloc[-1]
    np.testing.assert_allclose(r.iloc[24, 0], expected, atol=1e-10)


def test_alpha126_typical_price(synthetic_panel):
    """Alpha126: (C+H+L)/3。"""
    high = synthetic_panel["high"]
    low = synthetic_panel["low"]
    close = synthetic_panel["close"]
    r = compute_alpha(126, synthetic_panel)
    expected = (close.iloc[20, 0] + high.iloc[20, 0] + low.iloc[20, 0]) / 3
    np.testing.assert_allclose(r.iloc[20, 0], expected, atol=1e-10)


def test_alpha150_money_flow(synthetic_panel):
    """Alpha150: (C+H+L)/3 * VOL。"""
    high = synthetic_panel["high"]
    low = synthetic_panel["low"]
    close = synthetic_panel["close"]
    volume = synthetic_panel["volume"]
    r = compute_alpha(150, synthetic_panel)
    expected = (close.iloc[20, 0] + high.iloc[20, 0] + low.iloc[20, 0]) / 3 * volume.iloc[20, 0]
    np.testing.assert_allclose(r.iloc[20, 0], expected, atol=1e-10)


# ── 无前视性检查 ──────────────────────────────────────────────


@pytest.mark.parametrize("num", sorted(_ALPHA_REGISTRY.keys()))
def test_factor_no_lookahead(num, synthetic_panel):
    """计算到 t 日的因子值，不能依赖 t+1 及之后的数据。"""
    full = synthetic_panel
    # 截到第 40 天
    cutoff = 40
    truncated = {k: v.iloc[:cutoff] for k, v in full.items()}

    r_full = compute_alpha(num, full).iloc[:cutoff]
    r_trunc = compute_alpha(num, truncated)

    # 用 nan_equal 友好比较（两边 NaN 视为相等）
    diff = (r_full - r_trunc).abs()
    max_diff = diff.replace([np.inf, -np.inf], np.nan).max().max()
    if pd.isna(max_diff):
        max_diff = 0.0
    assert max_diff < 1e-9, (
        f"Alpha{num} 有前视！截断到 {cutoff} 行后与完整数据计算的前 {cutoff} 行不同 "
        f"(max diff = {max_diff:.6e})"
    )


# ── 因子值合理性范围检查 ─────────────────────────────────────


def test_alpha53_in_0_100_range(synthetic_panel):
    """Alpha53 = 上涨天数比例 × 100，应在 [0, 100]。"""
    r = compute_alpha(53, synthetic_panel)
    finite = r.values[np.isfinite(r.values)]
    assert finite.min() >= 0
    assert finite.max() <= 100


def test_alpha58_in_0_100_range(synthetic_panel):
    """Alpha58 同 53，应在 [0, 100]。"""
    r = compute_alpha(58, synthetic_panel)
    finite = r.values[np.isfinite(r.values)]
    assert finite.min() >= 0
    assert finite.max() <= 100


def test_alpha57_kdj_k_range(synthetic_panel):
    """Alpha57 是 KDJ K 值，由 SMA 平滑而来，应在合理范围 [0, 100]。"""
    r = compute_alpha(57, synthetic_panel)
    finite = r.values[np.isfinite(r.values)]
    assert finite.min() >= -1  # 允许极小的负边界（数值误差）
    assert finite.max() <= 101  # 允许极小的超出
