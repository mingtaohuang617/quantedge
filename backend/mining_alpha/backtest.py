"""
mining_alpha.backtest — 向量化回测引擎
====================================

策略:
  - 每周一开盘按上周五收盘后预测分数调仓（T+1 entry）
  - 持仓 Top N 等权（默认 50，约为 CSI800 的 6.25%）
  - 双边成本 0.2%（印花税 0.1% 单边 + 佣金 0.03% + 滑点 0.07%）
  - 不限单票权重（等权天然 ≤ 1/N）；行业约束在 weights_top_n 里可选

输出:
  - daily_returns: 日净值序列
  - metrics: dict (年化/Sharpe/Calmar/最大回撤/IR vs benchmark/月度胜率/换手率)
  - 多空诊断：Top-Bottom N 等权 dollar-neutral 净值（仅诊断，不当落地策略）

公开接口:
  - weekly_rebalance_dates(dates) → 列表
  - select_top_n(scores, n) → 每个调仓日的票池 dict[date, list[ticker]]
  - portfolio_returns(scores, close, n=50, cost=0.002) → 日 returns Series
  - compute_metrics(strategy_returns, benchmark_returns) → dict
  - run_backtest(scores, close, benchmark) → BacktestReport
  - run_long_short_diagnostic(scores, close, n=50) → 多空 returns
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd


# ── 调仓日 ────────────────────────────────────────────────────


def weekly_rebalance_dates(dates: pd.DatetimeIndex) -> list[pd.Timestamp]:
    """从交易日序列里筛出每周第一个交易日（通常是周一，节假日时顺延）。"""
    dates = pd.DatetimeIndex(sorted(set(pd.DatetimeIndex(dates))))
    if dates.empty:
        return []
    out = [dates[0]]
    last_week = dates[0].isocalendar().week
    last_year = dates[0].year
    for d in dates[1:]:
        wk = d.isocalendar().week
        yr = d.year
        if (yr, wk) != (last_year, last_week):
            out.append(d)
            last_year, last_week = yr, wk
    return out


# ── 选股 ──────────────────────────────────────────────────────


def select_top_n(
    scores: pd.DataFrame, n: int = 50, *, ascending: bool = False,
) -> dict[pd.Timestamp, list[str]]:
    """
    每个日期挑 score 最高（或最低）的 n 只票。NaN 票位剔除。

    Returns:
      {date: [ticker, ticker, ...]}
    """
    out: dict[pd.Timestamp, list[str]] = {}
    for t, row_raw in scores.iterrows():
        row = row_raw.dropna()
        if len(row) == 0:
            out[t] = []
            continue
        if ascending:
            picks = row.nsmallest(n).index.tolist()
        else:
            picks = row.nlargest(n).index.tolist()
        out[t] = picks
    return out


# ── 仓位生成（等权 Top N） ───────────────────────────────────


def _equal_weight_holdings(
    rebalance_picks: dict[pd.Timestamp, list[str]],
    all_dates: pd.DatetimeIndex,
    all_tickers: pd.Index,
) -> pd.DataFrame:
    """
    把"每个调仓日的票池"展开为日度持仓矩阵（dates × tickers，权重在每行加总=1）。
    在两个调仓日之间持仓不变（forward-fill）。
    """
    rebal_dates = sorted(rebalance_picks.keys())
    sparse_weights = pd.DataFrame(0.0, index=rebal_dates, columns=all_tickers)
    for t, picks in rebalance_picks.items():
        valid_picks = [p for p in picks if p in all_tickers]
        if not valid_picks:
            continue
        w = 1.0 / len(valid_picks)
        sparse_weights.loc[t, valid_picks] = w

    full = sparse_weights.reindex(index=all_dates, method="ffill").fillna(0.0)
    return full


# ── 收益计算 ──────────────────────────────────────────────────


def portfolio_returns(
    scores: pd.DataFrame,
    close: pd.DataFrame,
    *,
    n: int = 50,
    cost: float = 0.002,
    tradeable_mask: pd.DataFrame | None = None,
) -> tuple[pd.Series, pd.DataFrame]:
    """
    按"每周一 T+1 调仓 Top N 等权"策略，计算日策略收益序列。

    Args:
      scores: dates × tickers 预测分数 panel
      close: 复权收盘价 panel
      n: Top N 选股数
      cost: 单边成本
      tradeable_mask: dates × tickers 布尔 mask（来自 data_loader.compute_tradeable_mask）。
        非可交易股在调仓时被剔除（防涨跌停 / 停牌 / 次新股）。

    时序:
      d: scores 在 d 日盘后可见
      d+1: 用 d 的 scores 计算下周的目标持仓
      from d+2: 收到该周持仓的收益

    简化: 假设 scores 在 d 日下午就能拿到，d+1 开盘按等权买入。
    daily_return[d+1] = sum(weight_held_on_d * close.pct_change()[d+1])

    Returns:
      daily_return: pd.Series, 净值变化率（每日）
      holdings: pd.DataFrame, 日度持仓权重 dates × tickers
    """
    if scores.empty or close.empty:
        raise ValueError("scores 或 close 为空")

    scores, close = scores.align(close, join="inner")
    all_dates = scores.index
    all_tickers = scores.columns

    daily_ret = close.pct_change()

    # 调仓日
    rebal_dates = weekly_rebalance_dates(all_dates)

    # 在每个调仓日用上一交易日的 scores 选 Top N（避免未来）
    score_lag1 = scores.shift(1)
    # 对齐 tradeable_mask：调仓日 d 用 d-1 日的 mask（与 score 同 lag）
    if tradeable_mask is not None:
        mask_lag1 = tradeable_mask.reindex(index=all_dates, columns=all_tickers).shift(1).fillna(False)
    else:
        mask_lag1 = None
    # 去重 index：若 predictions 有 duplicate dates（walk-forward 重叠时），保留最后
    if not score_lag1.index.is_unique:
        score_lag1 = score_lag1[~score_lag1.index.duplicated(keep="last")]
    if mask_lag1 is not None and not mask_lag1.index.is_unique:
        mask_lag1 = mask_lag1[~mask_lag1.index.duplicated(keep="last")]

    picks = {}
    for d in rebal_dates:
        if d in score_lag1.index:
            row = score_lag1.loc[d]
            # 防御性：若 loc 返回 DataFrame（异常情况），取第一行
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            if mask_lag1 is not None and d in mask_lag1.index:
                mask_row = mask_lag1.loc[d]
                if isinstance(mask_row, pd.DataFrame):
                    mask_row = mask_row.iloc[0]
                row = row.where(mask_row)
            if int(row.notna().sum()) >= n:
                picks[d] = row.nlargest(n).index.tolist()
            else:
                picks[d] = row.dropna().index.tolist()

    # 日度持仓
    holdings = _equal_weight_holdings(picks, all_dates, all_tickers)

    # 策略日收益: position_yesterday * return_today
    pos_yest = holdings.shift(1).fillna(0.0)
    pnl = (pos_yest * daily_ret).sum(axis=1)

    # 成本：每个调仓日的权重变化 |Δw| × cost
    weight_change = holdings.diff().fillna(holdings)  # 第一天的权重全是新建仓
    daily_cost = weight_change.abs().sum(axis=1) * cost
    pnl_after_cost = pnl - daily_cost

    return pnl_after_cost.fillna(0.0), holdings


# ── 多空诊断 ──────────────────────────────────────────────────


def long_short_returns(
    scores: pd.DataFrame,
    close: pd.DataFrame,
    *,
    n: int = 50,
    cost: float = 0.002,
    tradeable_mask: pd.DataFrame | None = None,
) -> pd.Series:
    """
    Top N 多 - Bottom N 空，dollar-neutral 等权。仅用于因子纯度诊断（A 股个股
    无法裸卖空，回测里假装可以）。
    """
    long_ret, _ = portfolio_returns(scores, close, n=n, cost=cost, tradeable_mask=tradeable_mask)
    # bottom：分数反向取 Top N，等价于做空
    inv_scores = -scores
    short_ret, _ = portfolio_returns(inv_scores, close, n=n, cost=cost, tradeable_mask=tradeable_mask)
    # 多空：long - short
    return (long_ret - short_ret).fillna(0.0)


# ── 指标计算 ──────────────────────────────────────────────────


def _max_drawdown(equity: pd.Series) -> float:
    """从净值曲线计算最大回撤（负数）。"""
    cummax = equity.cummax()
    dd = equity / cummax - 1
    return float(dd.min())


def compute_metrics(
    strategy_returns: pd.Series,
    benchmark_returns: pd.Series | None = None,
    *,
    annualize_factor: float = 252.0,
) -> dict:
    """
    计算回测核心指标。
    """
    r = strategy_returns.dropna()
    if len(r) < 20:
        return {"n_days": len(r), "error": "too few obs"}
    mean_d = float(r.mean())
    std_d = float(r.std())
    sharpe = (mean_d / std_d * np.sqrt(annualize_factor)) if std_d > 0 else np.nan
    annual_ret = (1 + r).prod() ** (annualize_factor / len(r)) - 1
    equity = (1 + r).cumprod()
    max_dd = _max_drawdown(equity)
    calmar = annual_ret / abs(max_dd) if max_dd < 0 else np.nan

    # 月度胜率
    monthly = (1 + r).resample("ME").prod() - 1
    monthly_win = float((monthly > 0).sum() / len(monthly)) if len(monthly) > 0 else np.nan

    out = {
        "n_days": len(r),
        "annual_return": float(annual_ret),
        "annual_vol": float(std_d * np.sqrt(annualize_factor)),
        "sharpe": float(sharpe) if pd.notna(sharpe) else None,
        "max_drawdown": float(max_dd),
        "calmar": float(calmar) if pd.notna(calmar) else None,
        "monthly_win_rate": monthly_win,
        "total_return": float(equity.iloc[-1] - 1),
    }

    if benchmark_returns is not None:
        b = benchmark_returns.dropna().reindex(r.index).dropna()
        common = r.index.intersection(b.index)
        if len(common) > 20:
            excess = r.loc[common] - b.loc[common]
            ex_mean = float(excess.mean())
            ex_std = float(excess.std())
            ir = (ex_mean / ex_std * np.sqrt(annualize_factor)) if ex_std > 0 else np.nan
            bench_annual = (1 + b.loc[common]).prod() ** (annualize_factor / len(common)) - 1
            out.update({
                "benchmark_annual_return": float(bench_annual),
                "alpha_annual": float(annual_ret - bench_annual),
                "ir_vs_benchmark": float(ir) if pd.notna(ir) else None,
            })

    return out


# ── 完整回测报告 ─────────────────────────────────────────────


@dataclass
class BacktestReport:
    daily_returns: pd.Series
    equity_curve: pd.Series
    holdings: pd.DataFrame
    long_short_returns: pd.Series | None
    metrics: dict
    benchmark_equity: pd.Series | None

    def to_dict(self) -> dict:
        """JSON-friendly 序列化（不含 DataFrame）。"""
        d = asdict(self)
        d.pop("daily_returns", None)
        d.pop("equity_curve", None)
        d.pop("holdings", None)
        d.pop("long_short_returns", None)
        d.pop("benchmark_equity", None)
        return d


def run_backtest(
    scores: pd.DataFrame,
    close: pd.DataFrame,
    benchmark_close: pd.Series | None = None,
    *,
    top_n: int = 50,
    cost: float = 0.002,
    include_long_short_diagnostic: bool = True,
    tradeable_mask: pd.DataFrame | None = None,
) -> BacktestReport:
    """
    端到端回测。

    Args:
      scores: ML 预测分数 panel (dates × tickers)
      close: 已复权收盘价 panel
      benchmark_close: 基准指数 close（HS300 等），可选
      top_n: 持仓只数
      cost: 单边交易成本
      include_long_short_diagnostic: 是否同时跑多空诊断

    Returns:
      BacktestReport
    """
    strat_ret, holdings = portfolio_returns(scores, close, n=top_n, cost=cost,
                                            tradeable_mask=tradeable_mask)
    equity = (1 + strat_ret).cumprod()

    bench_ret = None
    bench_eq = None
    if benchmark_close is not None:
        bench_ret = benchmark_close.pct_change().reindex(strat_ret.index).fillna(0.0)
        bench_eq = (1 + bench_ret).cumprod()

    ls_ret = None
    if include_long_short_diagnostic:
        ls_ret = long_short_returns(scores, close, n=top_n, cost=cost,
                                    tradeable_mask=tradeable_mask)

    metrics = compute_metrics(strat_ret, bench_ret)
    metrics["top_n"] = top_n
    metrics["cost"] = cost
    metrics["start_date"] = str(strat_ret.index.min().date())
    metrics["end_date"] = str(strat_ret.index.max().date())
    metrics["turnover_annual"] = float(holdings.diff().abs().sum().sum() / len(holdings) * 252 / 2)

    if ls_ret is not None and len(ls_ret.dropna()) > 20:
        ls_metrics = compute_metrics(ls_ret)
        metrics["long_short_sharpe"] = ls_metrics.get("sharpe")
        metrics["long_short_annual"] = ls_metrics.get("annual_return")
        metrics["long_short_max_dd"] = ls_metrics.get("max_drawdown")

    metrics["has_tradeable_mask"] = tradeable_mask is not None
    return BacktestReport(
        daily_returns=strat_ret,
        equity_curve=equity,
        holdings=holdings,
        long_short_returns=ls_ret,
        metrics=metrics,
        benchmark_equity=bench_eq,
    )


# ── 多 Top-N 切片回测 ────────────────────────────────────────


def run_multi_topn(
    scores: pd.DataFrame,
    close: pd.DataFrame,
    benchmark_close: pd.Series | None = None,
    *,
    top_ns: tuple = (20, 50, 100, 200),
    cost: float = 0.002,
    tradeable_mask: pd.DataFrame | None = None,
) -> dict[int, BacktestReport]:
    """
    跑多个 Top-N 切片对比（20 / 50 / 100 / 200 票），便于挑组合规模。

    Returns:
      {top_n: BacktestReport}
    """
    out: dict[int, BacktestReport] = {}
    for n in top_ns:
        out[n] = run_backtest(
            scores, close, benchmark_close,
            top_n=n, cost=cost,
            include_long_short_diagnostic=False,
            tradeable_mask=tradeable_mask,
        )
    return out


def summarize_multi_topn(reports: dict[int, BacktestReport]) -> pd.DataFrame:
    """把多 top-N 回测结果汇总成对比表。"""
    rows = []
    for n, rep in sorted(reports.items()):
        m = rep.metrics
        rows.append({
            "top_n": n,
            "annual_return": m.get("annual_return"),
            "sharpe": m.get("sharpe"),
            "max_drawdown": m.get("max_drawdown"),
            "calmar": m.get("calmar"),
            "alpha_annual": m.get("alpha_annual"),
            "ir_vs_benchmark": m.get("ir_vs_benchmark"),
            "turnover_annual": m.get("turnover_annual"),
            "monthly_win_rate": m.get("monthly_win_rate"),
        })
    return pd.DataFrame(rows)
