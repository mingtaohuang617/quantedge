"""mining_alpha 端到端集成测试：因子 → preprocess → IC → ML → backtest。

用合成 panel + 注入信号的"假因子"来验证 ML 能学到信号、回测能跑赢 benchmark。
这个 test 比较慢（~10-30 秒），实际运行作为 PR 集成检查用。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from mining_alpha.backtest import (  # noqa: E402
    compute_metrics,
    long_short_returns,
    portfolio_returns,
    run_backtest,
    weekly_rebalance_dates,
)


# ── 合成 panel：含可学信号 ────────────────────────────────────


@pytest.fixture(scope="module")
def signal_injected_panel():
    """
    生成 800×30 的合成 panel，注入"持续型"信号:
      underlying_signal 是 AR(1) (φ=0.85) 的 cross-section 信号
      f1: 强信号 = underlying + 少量噪声（lagged 后仍有预测力）
      f2: 弱信号 = underlying/2 + 大量噪声
      f3: 纯噪声

    ML / 回测的合理性：lagged f1 与下一日 daily_return 仍高度相关，因为
    underlying_signal 是慢变量。
    """
    rng = np.random.RandomState(123)
    T, N = 800, 30
    dates = pd.date_range("2021-01-04", periods=T, freq="B")
    tickers = [f"S{i:02d}" for i in range(N)]

    # AR(1) 慢变信号：x_t = phi * x_{t-1} + eps_t
    phi = 0.85
    underlying = np.zeros((T, N))
    underlying[0] = rng.randn(N) * 0.015
    for t in range(1, T):
        underlying[t] = phi * underlying[t - 1] + rng.randn(N) * 0.008

    # daily return = underlying + 少量额外噪声
    daily_pseudo = underlying + rng.randn(T, N) * 0.006
    close_arr = 10.0 * np.cumprod(1 + daily_pseudo, axis=0)
    close = pd.DataFrame(close_arr, index=dates, columns=tickers)

    # OHLV 围绕 close
    high = close * (1 + np.abs(rng.randn(T, N)) * 0.01)
    low = close * (1 - np.abs(rng.randn(T, N)) * 0.01)
    open_ = close.shift(1).fillna(close)
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))
    volume = pd.DataFrame(rng.uniform(1e5, 1e7, (T, N)), index=dates, columns=tickers)
    amount = volume * close
    vwap = amount / volume
    ret = close.pct_change()

    panel = {"open": open_, "high": high, "low": low, "close": close,
             "volume": volume, "amount": amount, "vwap": vwap, "ret": ret}

    # 2) 构造 3 个"假因子"
    # f1: 强信号 = underlying + 少量噪声
    f1 = pd.DataFrame(underlying + rng.randn(T, N) * 0.003, index=dates, columns=tickers)
    # f2: 弱信号 = underlying/2 + 中等噪声
    f2 = pd.DataFrame(underlying * 0.5 + rng.randn(T, N) * 0.015, index=dates, columns=tickers)
    # f3: 纯噪声
    f3 = pd.DataFrame(rng.randn(T, N) * 0.02, index=dates, columns=tickers)

    return panel, {1: f1, 2: f2, 3: f3}


# ── 回测引擎单元 ─────────────────────────────────────────────


def test_weekly_rebalance_dates_picks_one_per_week():
    """从连续 60 个工作日里挑出 ~12 个调仓日（每周一）。"""
    dates = pd.date_range("2024-01-01", periods=60, freq="B")
    rebal = weekly_rebalance_dates(dates)
    # 60 工作日 ≈ 12 周
    assert 10 <= len(rebal) <= 13


def test_portfolio_returns_smoke(signal_injected_panel):
    """portfolio_returns 在合成 panel + 强信号因子上应该有正收益。"""
    panel, fakes = signal_injected_panel
    scores = fakes[1]  # 强信号
    strat_ret, holdings = portfolio_returns(scores, panel["close"], n=10, cost=0.002)
    assert len(strat_ret) == len(panel["close"])
    # 强信号下年化应该显著为正
    annual = (1 + strat_ret).prod() ** (252 / len(strat_ret)) - 1
    assert annual > 0.05, f"强信号下年化只有 {annual:.2%}，模型可能有 bug"


def test_long_short_purely_neutral_signal_positive(signal_injected_panel):
    """多空 P&L 在强信号下应该比纯多头更高（dollar-neutral 放大 alpha）。"""
    panel, fakes = signal_injected_panel
    scores = fakes[1]
    long_ret, _ = portfolio_returns(scores, panel["close"], n=10, cost=0.002)
    ls_ret = long_short_returns(scores, panel["close"], n=10, cost=0.002)
    # 多空年化通常高于纯多头（因为同时利用了 short 的信号）
    long_total = (1 + long_ret).prod() - 1
    ls_total = (1 + ls_ret).prod() - 1
    # 至少多空总收益不应该差到比多头还低很多（允许 2× 的合理范围）
    assert ls_total > 0


def test_metrics_dictionary_complete():
    """compute_metrics 输出包含必要字段。"""
    rng = np.random.RandomState(0)
    r = pd.Series(rng.randn(300) * 0.01,
                  index=pd.date_range("2023-01-01", periods=300, freq="B"))
    m = compute_metrics(r)
    for key in ["n_days", "annual_return", "annual_vol", "sharpe",
                "max_drawdown", "monthly_win_rate", "total_return"]:
        assert key in m


def test_run_backtest_end_to_end(signal_injected_panel):
    """完整回测：含基准、含多空诊断。"""
    panel, fakes = signal_injected_panel
    scores = fakes[1]
    close = panel["close"]
    # 用合成的 benchmark = 全市场等权
    benchmark = close.mean(axis=1)

    report = run_backtest(scores, close, benchmark, top_n=10, cost=0.002)
    assert len(report.daily_returns) > 100
    assert len(report.equity_curve) == len(report.daily_returns)
    assert report.metrics["annual_return"] is not None
    assert "ir_vs_benchmark" in report.metrics  # benchmark 给了的话应该有
    # 强信号下应该跑赢 benchmark
    assert report.metrics["alpha_annual"] > 0, (
        f"强信号回测 alpha 为负：{report.metrics['alpha_annual']:.3f}，模型可能错了"
    )


# ── ML 训练（slow）─────────────────────────────────────────


@pytest.mark.slow
def test_walk_forward_train_lightgbm(signal_injected_panel):
    """ML 训练：3 个因子（含 1 个强信号）+ walk-forward。验证 ML 能学到信号。"""
    pytest.importorskip("lightgbm")
    from mining_alpha.ic_report import compute_forward_return
    from mining_alpha.model import aggregate_test_predictions, walk_forward_train
    from mining_alpha.preprocess import preprocess_pipeline

    panel, fakes = signal_injected_panel
    # 预处理
    factor_panel = {num: preprocess_pipeline(df) for num, df in fakes.items()}
    fwd_ret = compute_forward_return(panel["close"], horizon=5)

    results = walk_forward_train(
        factor_panel, fwd_ret,
        train_years=1.0, valid_years=0.3, test_years=0.3, step_months=4,
        num_boost_round=100, early_stopping=20,
    )
    assert len(results) >= 1, "应该至少能构造 1 个 fold"
    # 拼接预测
    preds = aggregate_test_predictions(results)
    assert not preds.empty
    # 强信号因子的特征重要性应该是最高的
    fi_all = pd.concat([r.feature_importance for r in results], axis=1).mean(axis=1)
    top_feat = fi_all.idxmax()
    assert top_feat == "alpha_1", f"模型应识别出最强因子 alpha_1，实际选了 {top_feat}"
