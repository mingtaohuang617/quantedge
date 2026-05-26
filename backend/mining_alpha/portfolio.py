"""
mining_alpha.portfolio — 组合构建 (约束优化 + 动态杠杆)
======================================================

提供三种 weight 生成策略，比"Top-N 等权"更可控：

1. **等权 Top-N** (baseline，已在 backtest.py)
2. **约束 Top-N** (constrained_topn_weights):
   - 单票 ≤ 5%
   - 单行业 ≤ 30%
   - 总权重 = 1.0
   - 最大化 sum(score * weight)
3. **动态杠杆** (dynamic_leverage):
   - 信号离散度大（横截面 score std 高）→ 上 1.0-1.5x 杠杆
   - 信号离散度小 → 降到 0.5-1.0x（保留现金）

公开接口:
  - constrained_topn_weights(scores_today, industry, top_n=50, max_per_stock=0.05,
                              max_per_industry=0.3) → Series[ticker → weight]
  - dynamic_leverage_factor(scores_today, base_leverage=1.0,
                             min_lev=0.5, max_lev=1.5) → float
  - holdings_with_constraints(scores, industry, top_n=50, ...) → dict[date, Series]
"""
from __future__ import annotations

import numpy as np
import pandas as pd

try:
    from scipy.optimize import linprog  # noqa: F401
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


# ── 约束 Top-N 权重 ────────────────────────────────────────────


def constrained_topn_weights(
    scores_today: pd.Series,
    industry_map: pd.Series | None = None,
    *,
    top_n: int = 50,
    max_per_stock: float = 0.05,
    max_per_industry: float = 0.30,
) -> pd.Series:
    """
    给单日 score Series，输出满足约束的权重 Series（和 = 1）。

    算法（贪心 + 行业约束）：
      1. 按 score 降序排序
      2. 依次选股，每选一只票 → weight = min(剩余空间, max_per_stock)
      3. 若所在行业累计 > max_per_industry → 跳过
      4. 选满 top_n 或权重和达 1 时停止

    Args:
      scores_today: index=ticker, value=预测分数
      industry_map: Series[ticker → industry_str]，None 时不做行业约束
      top_n: 最多持仓只数
      max_per_stock: 单票最大权重
      max_per_industry: 单行业最大累计权重

    Returns:
      pd.Series[ticker → weight]，未持仓的 ticker 不在 index 里
    """
    scores_today = scores_today.dropna().sort_values(ascending=False)
    if scores_today.empty:
        return pd.Series(dtype=float)

    weights = pd.Series(0.0, index=scores_today.index, dtype=float)
    industry_weight: dict[str, float] = {}
    total = 0.0
    n_picked = 0

    for ticker in scores_today.index:
        if n_picked >= top_n or total >= 1.0 - 1e-6:
            break

        # 行业约束
        if industry_map is not None and ticker in industry_map.index:
            ind = str(industry_map.loc[ticker])
            curr = industry_weight.get(ind, 0.0)
            available_industry = max(0.0, max_per_industry - curr)
        else:
            ind = None
            available_industry = float("inf")

        # 单票约束 + 总额约束
        available_total = max(0.0, 1.0 - total)
        max_w = min(max_per_stock, available_industry, available_total)
        if max_w < 1e-4:
            continue
        weights.loc[ticker] = max_w
        if ind is not None:
            industry_weight[ind] = industry_weight.get(ind, 0.0) + max_w
        total += max_w
        n_picked += 1

    # 若总权重 < 1（行业打满或票数不够），按比例放大到 1
    if 0 < total < 1.0:
        weights = weights / total
    return weights[weights > 0]


# ── 动态杠杆 ───────────────────────────────────────────────────


def dynamic_leverage_factor(
    scores_today: pd.Series,
    *,
    base_leverage: float = 1.0,
    min_lev: float = 0.5,
    max_lev: float = 1.5,
    high_dispersion_pct: float = 0.7,
    low_dispersion_pct: float = 0.3,
    lookback_dispersion: list | None = None,
) -> float:
    """
    根据横截面 score 离散度（z-score 后的 std）动态调整杠杆。

    逻辑:
      dispersion = std(scores_today) （越大说明信号越分化，机会越好）
      若 dispersion 大于历史 high_dispersion_pct 分位 → 加杠杆到 max_lev
      若 dispersion 小于历史 low_dispersion_pct 分位 → 降杠杆到 min_lev
      其余 → base_leverage

    Args:
      scores_today: 单日横截面 score
      lookback_dispersion: 历史 dispersion 序列（用于分位）。None 则只返回 base。

    Returns:
      杠杆系数 (float)
    """
    s = scores_today.dropna()
    if len(s) < 10:
        return base_leverage
    today_dispersion = float(s.std())

    if not lookback_dispersion:
        return base_leverage

    lb = np.asarray(lookback_dispersion, dtype=float)
    lb = lb[~np.isnan(lb)]
    if len(lb) < 20:
        return base_leverage

    pct = (lb < today_dispersion).sum() / len(lb)
    if pct > high_dispersion_pct:
        return max_lev
    if pct < low_dispersion_pct:
        return min_lev
    return base_leverage


# ── 多日构建持仓 ────────────────────────────────────────────


def build_constrained_holdings(
    scores: pd.DataFrame,
    industry_map: pd.Series | None = None,
    *,
    top_n: int = 50,
    max_per_stock: float = 0.05,
    max_per_industry: float = 0.30,
    use_dynamic_leverage: bool = False,
    base_leverage: float = 1.0,
    min_lev: float = 0.5,
    max_lev: float = 1.5,
) -> pd.DataFrame:
    """
    遍历 scores 每个调仓日，应用约束 + 可选动态杠杆，输出日度持仓矩阵。

    Args:
      scores: dates × tickers 预测分数 panel
      industry_map: Series[ticker → industry]，None 时跳过行业约束
      use_dynamic_leverage: 启用动态杠杆（基于历史 dispersion 分位）

    Returns:
      pd.DataFrame，dates × tickers，每行权重和 ≤ leverage_today
    """
    all_dates = scores.index
    all_tickers = scores.columns
    holdings = pd.DataFrame(0.0, index=all_dates, columns=all_tickers)

    # 计算每日横截面 std 作为 dispersion
    dispersions = scores.std(axis=1)

    for i, t in enumerate(all_dates):
        row = scores.loc[t]
        if row.notna().sum() == 0:
            continue
        w = constrained_topn_weights(
            row, industry_map,
            top_n=top_n, max_per_stock=max_per_stock,
            max_per_industry=max_per_industry,
        )
        if use_dynamic_leverage:
            # 用过去的 dispersion 做分位（避免前视）
            past_disp = dispersions.iloc[:i].dropna().tolist()
            lev = dynamic_leverage_factor(
                row, base_leverage=base_leverage,
                min_lev=min_lev, max_lev=max_lev,
                lookback_dispersion=past_disp,
            )
            w = w * lev
        # 写入 holdings
        for ticker, weight in w.items():
            if ticker in holdings.columns:
                holdings.at[t, ticker] = weight
    return holdings


# ── 与 backtest.py 集成 ──────────────────────────────────────


def portfolio_returns_constrained(
    scores: pd.DataFrame,
    close: pd.DataFrame,
    industry_map: pd.Series | None = None,
    *,
    top_n: int = 50,
    cost: float = 0.002,
    max_per_stock: float = 0.05,
    max_per_industry: float = 0.30,
    use_dynamic_leverage: bool = False,
    tradeable_mask: pd.DataFrame | None = None,
) -> tuple[pd.Series, pd.DataFrame]:
    """
    约束 Top-N 多头组合的日收益序列（替代 backtest.portfolio_returns）。

    Args:
      scores / close / cost / tradeable_mask: 与 portfolio_returns 同
      industry_map: Series[ticker → industry] 用于行业约束
      max_per_stock / max_per_industry: 单票/单行业上限
      use_dynamic_leverage: 启用动态杠杆

    Returns:
      (daily_returns, holdings) 与 portfolio_returns 同
    """
    from .backtest import weekly_rebalance_dates

    if scores.empty or close.empty:
        raise ValueError("scores 或 close 为空")
    scores, close = scores.align(close, join="inner")
    all_dates = scores.index
    all_tickers = scores.columns
    daily_ret = close.pct_change()

    rebal_dates = weekly_rebalance_dates(all_dates)
    score_lag1 = scores.shift(1)
    if tradeable_mask is not None:
        mask_lag1 = tradeable_mask.reindex(index=all_dates, columns=all_tickers).shift(1).fillna(False)
    else:
        mask_lag1 = None

    # 在每个调仓日生成稀疏权重，其他日 ffill
    sparse = pd.DataFrame(0.0, index=rebal_dates, columns=all_tickers)
    dispersions = score_lag1.std(axis=1)

    for _, d in enumerate(rebal_dates):
        if d not in score_lag1.index:
            continue
        row = score_lag1.loc[d]
        if mask_lag1 is not None and d in mask_lag1.index:
            row = row.where(mask_lag1.loc[d])
        if row.notna().sum() == 0:
            continue
        w = constrained_topn_weights(
            row, industry_map,
            top_n=top_n, max_per_stock=max_per_stock,
            max_per_industry=max_per_industry,
        )
        if use_dynamic_leverage:
            past_disp = dispersions.loc[:d].iloc[:-1].dropna().tolist()
            lev = dynamic_leverage_factor(
                row, lookback_dispersion=past_disp,
            )
            w = w * lev
        for ticker, weight in w.items():
            if ticker in sparse.columns:
                sparse.at[d, ticker] = weight

    holdings = sparse.reindex(index=all_dates, method="ffill").fillna(0.0)
    pos_yest = holdings.shift(1).fillna(0.0)
    pnl = (pos_yest * daily_ret).sum(axis=1)
    weight_change = holdings.diff().fillna(holdings)
    daily_cost = weight_change.abs().sum(axis=1) * cost
    return (pnl - daily_cost).fillna(0.0), holdings
