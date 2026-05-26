"""mining_alpha 端到端 pipeline 测试（preprocess + ic_report + 端到端集成）。"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from mining_alpha.alpha191_factors import compute_alpha  # noqa: E402
from mining_alpha.ic_report import (  # noqa: E402
    compute_forward_return,
    daily_ic,
    filter_alphas_by_ic,
    ic_stats,
    run_ic_report,
    top_decile_excess,
)
from mining_alpha.preprocess import (  # noqa: E402
    fillna_xs,
    neutralize_xs,
    preprocess_pipeline,
    winsorize_xs,
    zscore_xs,
)


@pytest.fixture
def panel_500x30():
    """500 天 × 30 票，足够计算所有窗口因子 + 横截面统计。"""
    rng = np.random.RandomState(7)
    T, N = 500, 30
    dates = pd.date_range("2022-01-03", periods=T, freq="B")
    tickers = [f"S{i:02d}" for i in range(N)]
    log_ret = rng.randn(T, N) * 0.02
    close_arr = 10.0 * np.cumprod(1 + log_ret, axis=0)
    close = pd.DataFrame(close_arr, index=dates, columns=tickers)
    high = close * (1 + np.abs(rng.randn(T, N)) * 0.01)
    low = close * (1 - np.abs(rng.randn(T, N)) * 0.01)
    open_ = close.shift(1).fillna(close)
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))
    volume = pd.DataFrame(rng.uniform(1e5, 1e7, size=(T, N)), index=dates, columns=tickers)
    amount = volume * close
    vwap = amount / volume
    ret = close.pct_change()
    return {"open": open_, "high": high, "low": low, "close": close,
            "volume": volume, "amount": amount, "vwap": vwap, "ret": ret}


# ── preprocess 测试 ───────────────────────────────────────────


def test_winsorize_xs_caps_extremes():
    """winsorize 把极端值截到 m ± k * MAD * 1.4826。"""
    df = pd.DataFrame(
        [[1, 2, 3, 4, 100]],   # 100 是极端值
        index=[pd.Timestamp("2024-01-01")], columns=list("ABCDE"),
    )
    r = winsorize_xs(df, k=3.0)
    # median=3, abs deviations = [2,1,0,1,97], MAD=1, sigma_proxy=1.4826
    # 上界 = 3 + 3*1.4826 ≈ 7.448
    # 所以 100 被截到 ≈ 7.448
    assert r.iloc[0, 4] < 10
    assert r.iloc[0, 0] >= 0  # 下限附近


def test_fillna_xs_median():
    """fillna_xs 用中位数填充 NaN。"""
    df = pd.DataFrame(
        [[1.0, 2.0, np.nan, 4.0]],
        index=[pd.Timestamp("2024-01-01")], columns=list("ABCD"),
    )
    r = fillna_xs(df, method="median")
    # median([1,2,4]) = 2
    assert r.iloc[0, 2] == 2.0


def test_zscore_xs_zero_mean_unit_std():
    """zscore_xs 输出每行均值=0、std=1。"""
    df = pd.DataFrame(np.random.RandomState(0).randn(5, 10),
                      index=pd.date_range("2024-01-01", periods=5))
    r = zscore_xs(df)
    np.testing.assert_allclose(r.mean(axis=1).values, 0.0, atol=1e-10)
    np.testing.assert_allclose(r.std(axis=1).values, 1.0, atol=1e-10)


def test_neutralize_residual_zero_when_perfect_lin():
    """y = 2*x + 3 时残差应 ≈ 0。"""
    rng = np.random.RandomState(0)
    T, N = 5, 30
    x = pd.DataFrame(rng.randn(T, N), index=pd.date_range("2024-01-01", periods=T),
                     columns=[f"S{i}" for i in range(N)])
    y = 2 * x + 3
    r = neutralize_xs(y, exposures={"x": x})
    np.testing.assert_allclose(r.values, 0.0, atol=1e-9)


def test_preprocess_pipeline_smoke(panel_500x30):
    """预处理管道在真实 panel 上不报错且输出合理。"""
    alpha20 = compute_alpha(20, panel_500x30)
    processed = preprocess_pipeline(alpha20)
    # 末尾 row 应该是有效的（接近 0 均值、单位 std）
    last_row = processed.iloc[-1].dropna()
    assert len(last_row) > 10
    assert abs(last_row.mean()) < 1e-6
    assert abs(last_row.std() - 1.0) < 0.5


# ── ic_report 测试 ────────────────────────────────────────────


def test_compute_forward_return(panel_500x30):
    """compute_forward_return: r_t = close_{t+5}/close_t - 1。"""
    close = panel_500x30["close"]
    fr = compute_forward_return(close, horizon=5)
    expected = close.iloc[100 + 5, 0] / close.iloc[100, 0] - 1
    np.testing.assert_allclose(fr.iloc[100, 0], expected, atol=1e-10)
    # 末尾 5 行应该是 NaN
    assert fr.iloc[-5:].isna().all().all()


def test_daily_ic_perfect_signal():
    """factor = forward_return 时，每日 IC 应该 = 1."""
    rng = np.random.RandomState(1)
    T, N = 50, 20
    dates = pd.date_range("2024-01-01", periods=T)
    tickers = [f"S{i}" for i in range(N)]
    r = pd.DataFrame(rng.randn(T, N), index=dates, columns=tickers)
    factor = r.copy()  # 完全一样
    ic = daily_ic(factor, r, method="spearman")
    # 几乎所有日都应该是 1
    assert ic.dropna().mean() > 0.99


def test_ic_stats_summarize():
    """ic_stats 返回标准字段。"""
    ic = pd.Series([0.05, 0.03, 0.04, -0.02, 0.06] * 50,
                   index=pd.date_range("2024-01-01", periods=250))
    s = ic_stats(ic)
    assert "ic_mean" in s and "ic_ir" in s and "ic_t" in s
    assert abs(s["ic_mean"] - 0.032) < 1e-6
    assert s["ic_ir"] > 0  # 正值（正向因子）


def test_top_decile_excess_positive_for_real_signal():
    """因子等于前瞻收益时，Top decile 超额应显著为正。"""
    rng = np.random.RandomState(2)
    T, N = 100, 50
    dates = pd.date_range("2024-01-01", periods=T)
    tickers = [f"S{i}" for i in range(N)]
    r = pd.DataFrame(rng.randn(T, N) * 0.01, index=dates, columns=tickers)
    factor = r.copy()
    excess = top_decile_excess(factor, r, decile=10)
    assert excess.dropna().mean() > 0.001  # Top 10% 应该领先全市场 >0.1%/day


def test_run_ic_report_end_to_end(panel_500x30):
    """端到端：5 个因子 → preprocess → ic_report，输出 DataFrame 结构正确。"""
    factors = {
        num: preprocess_pipeline(compute_alpha(num, panel_500x30))
        for num in [14, 18, 20, 53, 126]
    }
    rep = run_ic_report(factors, panel_500x30["close"], horizon=5, decile=10)
    assert isinstance(rep, pd.DataFrame)
    assert len(rep) == 5
    expected_cols = {"alpha", "ic_mean", "ic_std", "ic_ir", "ic_t",
                     "ic_pos_rate", "top_excess_mean", "top_excess_ir",
                     "turnover", "n_obs"}
    assert expected_cols.issubset(set(rep.columns))


def test_filter_alphas_by_ic():
    """filter_alphas_by_ic 应该返回满足阈值的因子列表。"""
    rep = pd.DataFrame({
        "alpha": [1, 2, 3, 4],
        "ic_mean": [0.03, 0.01, -0.04, 0.005],
        "ic_ir": [0.5, 0.1, -0.6, 0.05],
    })
    kept = filter_alphas_by_ic(rep, min_abs_ic_mean=0.02, min_abs_ic_ir=0.3)
    # 应保留 alpha 1（0.03/0.5）和 alpha 3（-0.04/-0.6），跳过 alpha 2 和 4
    assert set(kept) == {1, 3}
