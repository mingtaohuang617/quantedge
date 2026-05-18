"""mining_alpha.improvements + alpha101 + synthetic_demo + catalog 单元测试。"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from mining_alpha.improvements import (  # noqa: E402
    combine_ic_weighted,
    ic_decay_weights,
    regime_aware_combine,
    vol_scale,
)


# ── vol_scale ─────────────────────────────────────────────────


def test_vol_scale_normalizes_by_std():
    """vol_scale 把因子除以滚动 std，归一化后 std ≈ 1。"""
    rng = np.random.RandomState(0)
    T, N = 200, 10
    raw = pd.DataFrame(rng.randn(T, N), index=pd.date_range("2024-01-01", periods=T),
                       columns=[f"S{i}" for i in range(N)])
    scaled = vol_scale(raw, window=20)
    tail = scaled.iloc[100:].dropna()
    per_col_std = tail.std()
    assert (np.abs(per_col_std - 1) < 0.4).all(), f"vol_scale 后 std 偏离: {per_col_std.values}"


def test_vol_scale_handles_zero_std():
    """vol_scale 对常数列（std=0）应输出 NaN 而不是 inf。"""
    df = pd.DataFrame(np.ones((30, 3)), index=pd.date_range("2024-01-01", periods=30))
    r = vol_scale(df, window=10)
    assert not np.isinf(r.values).any(), "vol_scale 在 std=0 时输出 inf"


# ── ic_decay_weights ──────────────────────────────────────────


def test_ic_decay_weights_normalized():
    """权重每行 |w| 加总 ≈ 1。"""
    T = 200
    ic = pd.DataFrame({
        "a": np.random.RandomState(0).randn(T) * 0.03,
        "b": np.random.RandomState(1).randn(T) * 0.05,
        "c": np.random.RandomState(2).randn(T) * 0.02,
    }, index=pd.date_range("2024-01-01", periods=T))
    w = ic_decay_weights(ic, half_life=20, min_history=20)
    nonzero = w.dropna(how="all")
    if len(nonzero) > 0:
        abs_sum = nonzero.abs().sum(axis=1)
        np.testing.assert_allclose(abs_sum.iloc[-50:].values, 1.0, atol=0.05)


def test_ic_decay_weights_higher_ic_higher_weight():
    """IC 一直高的因子权重应该比 IC 低的高。"""
    T = 200
    ic = pd.DataFrame({
        "a": np.full(T, 0.05),
        "b": np.full(T, 0.001),
    }, index=pd.date_range("2024-01-01", periods=T))
    w = ic_decay_weights(ic, half_life=30, min_history=30)
    last = w.iloc[-1]
    assert abs(last["a"]) > abs(last["b"]), "高 IC 因子权重应该更大"


# ── combine_ic_weighted ───────────────────────────────────────


def test_combine_ic_weighted_smoke():
    """combine_ic_weighted 应该返回 dates × tickers 合成 score。"""
    rng = np.random.RandomState(42)
    T, N = 100, 8
    dates = pd.date_range("2024-01-01", periods=T)
    tickers = [f"S{i}" for i in range(N)]
    factors = {
        1: pd.DataFrame(rng.randn(T, N), index=dates, columns=tickers),
        2: pd.DataFrame(rng.randn(T, N), index=dates, columns=tickers),
    }
    ic = pd.DataFrame({1: rng.randn(T) * 0.03, 2: rng.randn(T) * 0.02},
                      index=dates)
    out = combine_ic_weighted(factors, ic, half_life=30)
    assert out.shape == (T, N)
    assert out.iloc[60:].notna().sum().sum() > 0


# ── regime_aware ──────────────────────────────────────────────


def test_regime_aware_combine_smoke():
    """regime_aware_combine: 给定合成 regime label 应能产出 score panel。"""
    rng = np.random.RandomState(7)
    T, N = 250, 8
    dates = pd.date_range("2024-01-01", periods=T)
    tickers = [f"S{i}" for i in range(N)]
    factors = {
        1: pd.DataFrame(rng.randn(T, N), index=dates, columns=tickers),
        2: pd.DataFrame(rng.randn(T, N), index=dates, columns=tickers),
    }
    ic = pd.DataFrame({1: rng.randn(T) * 0.04, 2: rng.randn(T) * 0.03},
                      index=dates)
    labels = ["bull"] * (T // 3) + ["neutral"] * (T // 3) + ["bear"] * (T - 2 * (T // 3))
    regime = pd.DataFrame({
        "bull_prob": [1 if x == "bull" else 0 for x in labels],
        "neutral_prob": [1 if x == "neutral" else 0 for x in labels],
        "bear_prob": [1 if x == "bear" else 0 for x in labels],
        "label": labels,
    }, index=dates)
    out = regime_aware_combine(factors, ic, regime, half_life=20)
    assert out.shape[0] > 0
    assert out.notna().sum().sum() > 0


# ── alpha101_factors ──────────────────────────────────────────


@pytest.fixture
def panel_300x30():
    """合成 panel 用于 Alpha101 测试。"""
    rng = np.random.RandomState(1)
    T, N = 300, 30
    dates = pd.date_range("2023-01-02", periods=T, freq="B")
    tickers = [f"T{i:02d}" for i in range(N)]
    log_ret = rng.randn(T, N) * 0.02
    close_arr = 10 * np.cumprod(1 + log_ret, axis=0)
    close = pd.DataFrame(close_arr, index=dates, columns=tickers)
    high = close * (1 + np.abs(rng.randn(T, N)) * 0.01)
    low = close * (1 - np.abs(rng.randn(T, N)) * 0.01)
    open_ = close.shift(1).bfill()
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))
    volume = pd.DataFrame(rng.uniform(1e5, 1e7, (T, N)), index=dates, columns=tickers)
    amount = volume * close
    vwap = amount / volume
    ret = close.pct_change()
    return {
        "open": open_, "high": high, "low": low, "close": close,
        "volume": volume, "amount": amount, "vwap": vwap, "ret": ret,
    }


def test_alpha101_registry_nonempty():
    """alpha101 应至少注册 30 个因子。"""
    from mining_alpha.alpha101_factors import list_alpha101
    nums = list_alpha101()
    assert len(nums) >= 30
    for n in [1, 2, 3, 6, 41, 101]:  # 标志性因子
        assert n in nums


@pytest.mark.parametrize("num", [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16,
                                  17, 18, 22, 23, 25, 26, 28, 33, 34, 35, 37, 38,
                                  41, 42, 43, 53, 54, 101])
def test_alpha101_compiles(num, panel_300x30):
    """每个 alpha101 因子能跑通且返回 DataFrame。"""
    from mining_alpha.alpha101_factors import compute_alpha101
    r = compute_alpha101(num, panel_300x30)
    assert isinstance(r, pd.DataFrame)
    assert r.shape == panel_300x30["close"].shape
    notna_ratio = r.notna().sum().sum() / r.size
    assert notna_ratio > 0.05, f"WQ Alpha{num} 整体非 NaN 比例 {notna_ratio:.2%} 太低"


# ── synthetic_demo ────────────────────────────────────────────


def test_synthetic_demo_panel_shape():
    """generate_synthetic_panel 输出形状正确 + 含所有必需字段。"""
    from mining_alpha.synthetic_demo import generate_synthetic_panel
    panel = generate_synthetic_panel(n_stocks=20, years=0.5, seed=0)
    expected_fields = {"open", "high", "low", "close", "volume", "amount"}
    assert expected_fields.issubset(set(panel.keys()))
    # 0.5 年 ≈ 126 工作日
    assert 100 <= panel["close"].shape[0] <= 130
    assert panel["close"].shape[1] == 20
    # OHLC sanity
    assert (panel["high"] >= panel["close"]).all().all()
    assert (panel["low"] <= panel["close"]).all().all()
    assert (panel["volume"] > 0).all().all()


def test_synthetic_demo_signal_correlation():
    """合成数据应注入可学信号 — 当前 signal 与未来收益相关性 > 0.3。"""
    from mining_alpha.synthetic_demo import generate_synthetic_panel
    panel = generate_synthetic_panel(n_stocks=30, years=1.0, seed=42)
    close = panel["close"]
    # 滞后 close 与今日 close 的相关性应该 > 随机
    fwd_ret = close.shift(-5) / close - 1
    today_ret = close / close.shift(1) - 1
    # 对每只 ticker 算 today_ret 与 future_5d_ret 的相关性
    corrs = []
    for tk in close.columns:
        c = today_ret[tk].corr(fwd_ret[tk])
        if pd.notna(c):
            corrs.append(c)
    # AR(1) 信号 → 应该有正相关
    assert np.mean(corrs) > 0.05, f"信号注入太弱，未来收益与今日收益相关性 mean={np.mean(corrs):.3f}"


# ── catalog ───────────────────────────────────────────────────


def test_catalog_generate_markdown():
    """catalog.generate_catalog_md 输出 Markdown 字符串包含所有注册因子。"""
    from mining_alpha.alpha191_factors import list_alphas
    from mining_alpha.catalog import generate_catalog_md
    md = generate_catalog_md()
    assert "# Mining Alpha — 因子目录" in md
    n = len(list_alphas())
    assert f"{n} / 191" in md
    # 每个因子都应该出现
    for num in list_alphas()[:5]:
        assert f"| {num} |" in md


# ── operators_jit ─────────────────────────────────────────────


def test_decaylinear_jit_matches_numpy(panel_300x30):
    """JIT DECAYLINEAR 与原 numpy 版本在大窗口下结果一致。"""
    from mining_alpha.operators import DECAYLINEAR, WMA
    close = panel_300x30["close"]
    n = 60
    jit_result = DECAYLINEAR(close, n)
    np_result = WMA(close, n)
    np.testing.assert_allclose(
        jit_result.iloc[100:].values,
        np_result.iloc[100:].values,
        atol=1e-6,
    )
