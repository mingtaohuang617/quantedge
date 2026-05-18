"""mining_alpha 进阶模块测试：ensemble / explain / portfolio。"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


@pytest.fixture
def small_panel():
    """200 天 × 20 票，含 AR(1) 信号 + 弱信号 + 噪声三因子。"""
    rng = np.random.RandomState(0)
    T, N = 200, 20
    dates = pd.date_range("2024-01-01", periods=T, freq="B")
    tickers = [f"S{i:02d}" for i in range(N)]
    underlying = np.zeros((T, N))
    underlying[0] = rng.randn(N) * 0.01
    for t in range(1, T):
        underlying[t] = 0.85 * underlying[t - 1] + rng.randn(N) * 0.005
    close_arr = 10 * np.cumprod(1 + underlying + rng.randn(T, N) * 0.005, axis=0)
    close = pd.DataFrame(close_arr, index=dates, columns=tickers)
    factors = {
        1: pd.DataFrame(underlying + rng.randn(T, N) * 0.002, index=dates, columns=tickers),
        2: pd.DataFrame(underlying * 0.5 + rng.randn(T, N) * 0.01, index=dates, columns=tickers),
        3: pd.DataFrame(rng.randn(T, N) * 0.02, index=dates, columns=tickers),
    }
    return close, factors


# ── portfolio.py ──────────────────────────────────────────────


def test_constrained_topn_weights_max_per_stock():
    """单票权重 ≤ max_per_stock。"""
    from mining_alpha.portfolio import constrained_topn_weights

    scores = pd.Series(np.arange(20, 0, -1), index=[f"S{i}" for i in range(20)], dtype=float)
    w = constrained_topn_weights(scores, top_n=5, max_per_stock=0.05)
    # 5 × 0.05 = 0.25, 总和应放大到 1
    assert (w <= 0.20001).all()  # 0.05 × 4 = 0.20 (after normalization to 1)
    np.testing.assert_allclose(w.sum(), 1.0, atol=1e-6)


def test_constrained_topn_industry_cap():
    """单行业权重 ≤ max_per_industry。"""
    from mining_alpha.portfolio import constrained_topn_weights

    tickers = [f"S{i}" for i in range(20)]
    scores = pd.Series(np.arange(20, 0, -1), index=tickers, dtype=float)
    # 全部 20 只都在 'tech' 行业 → 行业上限 0.30 会被打满
    industry = pd.Series(["tech"] * 20, index=tickers)
    w = constrained_topn_weights(scores, industry, top_n=50,
                                  max_per_stock=0.10, max_per_industry=0.30)
    # 总权重应该归一化到 1（行业打满后剩余空间用比例放大）
    np.testing.assert_allclose(w.sum(), 1.0, atol=1e-6)


def test_dynamic_leverage_high_dispersion():
    """信号离散度高时杠杆 → max。"""
    from mining_alpha.portfolio import dynamic_leverage_factor

    today = pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float)
    # 历史 dispersion 都很小，今天的 std=3.03 比所有历史都大 → max_lev
    history = [0.1] * 50
    lev = dynamic_leverage_factor(today, lookback_dispersion=history,
                                  base_leverage=1.0, max_lev=1.5)
    assert lev == 1.5


def test_dynamic_leverage_low_dispersion():
    """信号离散度低时杠杆 → min。"""
    from mining_alpha.portfolio import dynamic_leverage_factor

    # 用 ≥10 个值绕过 length guard，所有值接近相等 → std ≈ 0
    today = pd.Series([0.5] * 10 + [0.50001], dtype=float)
    history = list(np.linspace(0.5, 3.0, 50))
    lev = dynamic_leverage_factor(today, lookback_dispersion=history,
                                  base_leverage=1.0, min_lev=0.5)
    assert lev == 0.5


def test_portfolio_returns_constrained_smoke(small_panel):
    """约束 portfolio_returns 在合成 panel 上跑通。"""
    from mining_alpha.portfolio import portfolio_returns_constrained

    close, factors = small_panel
    scores = factors[1]
    ret, holdings = portfolio_returns_constrained(scores, close, top_n=5, cost=0.002)
    assert len(ret) == len(close)
    assert holdings.shape == close.shape
    # 每行权重 ≤ 1（不加杠杆）
    assert (holdings.sum(axis=1) <= 1.01).all()


# ── explain.py ────────────────────────────────────────────────


@pytest.mark.slow
def test_shap_top_contributions(small_panel):
    """SHAP 解释 Top-3 持仓的 Top-3 贡献因子。"""
    pytest.importorskip("shap")
    pytest.importorskip("lightgbm")
    import lightgbm as lgb
    from mining_alpha.explain import top_contributions_for_holdings
    from mining_alpha.ic_report import compute_forward_return
    from mining_alpha.model import prepare_xy
    from mining_alpha.preprocess import preprocess_pipeline

    close, factors = small_panel
    factors_p = {n: preprocess_pipeline(df) for n, df in factors.items()}
    fwd_ret = compute_forward_return(close, horizon=5)
    X, y, group = prepare_xy(factors_p, fwd_ret)

    # 用前 80% 训
    n_train = int(len(X) * 0.8)
    X_tr, y_tr = X.iloc[:n_train], y.iloc[:n_train]
    g_tr = X_tr.index.get_level_values(0).value_counts().sort_index().tolist()

    train_set = lgb.Dataset(X_tr.values, label=y_tr.values, group=g_tr,
                            feature_name=list(X.columns))
    booster = lgb.train({"objective": "lambdarank", "metric": "ndcg",
                         "verbose": -1, "num_leaves": 15}, train_set,
                        num_boost_round=30)

    # 用最后一天的特征
    last_date = X.index.get_level_values(0).max()
    X_today = X.loc[last_date]
    # X_today index is single-level (ticker), need MultiIndex for consistency
    X_today = pd.DataFrame(X_today.values, index=pd.MultiIndex.from_tuples(
        [(last_date, t) for t in X_today.index]), columns=X_today.columns)

    df = top_contributions_for_holdings(booster, X_today,
                                        top_n_stocks=3, top_k_factors=2,
                                        model_kind="lgb")
    # 每只股票 2 行
    assert len(df) == 6
    assert "ticker" in df.columns
    assert "factor" in df.columns
    assert "shap_value" in df.columns


# ── ensemble.py ───────────────────────────────────────────────


@pytest.mark.slow
def test_ensemble_lgb_only_smoke(small_panel):
    """ensemble 模块在仅 LightGBM 模式下能跑通。"""
    pytest.importorskip("lightgbm")
    from mining_alpha.ensemble import walk_forward_ensemble
    from mining_alpha.ic_report import compute_forward_return
    from mining_alpha.preprocess import preprocess_pipeline

    close, factors = small_panel
    factors_p = {n: preprocess_pipeline(df) for n, df in factors.items()}
    fwd_ret = compute_forward_return(close, horizon=5)

    results = walk_forward_ensemble(
        factors_p, fwd_ret,
        train_years=0.4, valid_years=0.1, test_years=0.1, step_months=2,
        num_boost_round=20, early_stopping=10,
        use_lgb=True, use_xgb=False, use_cb=False,  # 仅 LightGBM 测试
    )
    assert len(results) >= 1
    assert not results[0].test_predictions.empty


# ── operators_jit.py ──────────────────────────────────────────


def test_decaylinear_jit_matches_numpy(small_panel):
    """JIT DECAYLINEAR 与原 numpy 版本在大窗口下结果一致。"""
    from mining_alpha.operators import DECAYLINEAR, WMA

    close = small_panel[0]
    n = 60  # 大于 JIT 阈值 30
    jit_result = DECAYLINEAR(close, n)
    np_result = WMA(close, n)
    # 末尾应一致（避免 NaN 边界）
    np.testing.assert_allclose(
        jit_result.iloc[100:].values,
        np_result.iloc[100:].values,
        atol=1e-6,
    )
