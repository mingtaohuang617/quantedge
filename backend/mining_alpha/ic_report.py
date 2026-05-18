"""
mining_alpha.ic_report — 单因子 IC 诊断
=================================

对每个因子，计算：
  - IC (Information Coefficient): 每日横截面 Spearman 相关性
       corr(factor_t, forward_return_{t+h})
  - IC_mean, IC_std, ICIR = mean/std × sqrt(252)（年化）
  - IC_t_stat ≈ ICIR
  - Turnover: 因子排名的日均变化幅度
  - Top decile excess return: Top 10% 票池组合 vs 等权全市场的超额收益

输出:
  - DataFrame summary 表（按 ICIR 降序）
  - 可选 CSV / HTML 导出

公开接口:
  - compute_forward_return(close, horizon=5) → 前瞻收益
  - daily_ic(factor, fwd_ret, method='spearman') → pd.Series 日 IC
  - ic_stats(ic_series) → dict 含 mean/std/ICIR/t/IR
  - factor_turnover(factor, window=1) → 日均横截面 Spearman 排名相关性的负值 / 等价换手率
  - top_decile_excess(factor, fwd_ret, decile=10) → pd.Series 日超额
  - run_ic_report(factors: dict, close, horizon=5) → DataFrame 汇总
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ── 前瞻收益 ──────────────────────────────────────────────────


def compute_forward_return(close: pd.DataFrame, horizon: int = 5) -> pd.DataFrame:
    """
    前瞻 h 日收益: r_t = close_{t+h} / close_t - 1
    用 close（已复权）。最后 h 行为 NaN（无未来数据）。
    """
    return close.shift(-horizon) / close - 1


# ── IC 时间序列 ───────────────────────────────────────────────


def daily_ic(
    factor: pd.DataFrame, fwd_ret: pd.DataFrame, method: str = "spearman",
) -> pd.Series:
    """
    按日横截面计算 factor 与 fwd_ret 的相关性，返回日 IC 序列。

    method: 'spearman'（默认，对单调变换鲁棒）或 'pearson'。
    """
    # 对齐
    f, r = factor.align(fwd_ret, join="inner")
    out = pd.Series(np.nan, index=f.index, dtype=float)
    for t in f.index:
        fa = f.loc[t]
        ra = r.loc[t]
        mask = fa.notna() & ra.notna()
        if mask.sum() < 10:  # 少于 10 票就不算
            continue
        if method == "spearman":
            ic = fa[mask].rank().corr(ra[mask].rank())
        else:
            ic = fa[mask].corr(ra[mask])
        out.loc[t] = ic
    return out


def ic_stats(ic_series: pd.Series, annualize_factor: float = 252.0) -> dict:
    """
    汇总 IC 统计量。
    ICIR = mean/std × sqrt(252)（年化）；t_stat ≈ ICIR。
    """
    ic = ic_series.dropna()
    n = len(ic)
    if n < 5:
        return {"n": n, "ic_mean": np.nan, "ic_std": np.nan, "ic_ir": np.nan,
                "ic_t": np.nan, "ic_pos_rate": np.nan}
    mean = float(ic.mean())
    std = float(ic.std())
    ir = mean / std * np.sqrt(annualize_factor) if std > 0 else np.nan
    t = mean / (std / np.sqrt(n)) if std > 0 else np.nan
    pos_rate = float((ic > 0).sum() / n)
    return {
        "n": n,
        "ic_mean": mean,
        "ic_std": std,
        "ic_ir": ir,
        "ic_t": t,
        "ic_pos_rate": pos_rate,
    }


# ── 换手率 ────────────────────────────────────────────────────


def factor_turnover(factor: pd.DataFrame, window: int = 1) -> float:
    """
    用因子排名的日间变化估算换手率：
      turnover_t = 1 - Spearman(rank_t, rank_{t-window})
    返回时间序列均值（0=完全稳定，~1=完全随机）。
    """
    ranks = factor.rank(axis=1)
    n_tickers = ranks.shape[1]
    if n_tickers < 2:
        return np.nan
    # 滚动行对 Spearman ~ Pearson of ranks
    a = ranks
    b = ranks.shift(window)
    corr_series = a.apply(
        lambda row: row.corr(b.loc[row.name]) if row.name in b.index else np.nan,
        axis=1,
    )
    avg_corr = corr_series.mean()
    return float(1 - avg_corr) if pd.notna(avg_corr) else np.nan


# ── 分组超额收益 ─────────────────────────────────────────────


def top_decile_excess(
    factor: pd.DataFrame, fwd_ret: pd.DataFrame, decile: int = 10,
) -> pd.Series:
    """
    每日把因子按 decile 分组（默认 10 组），取 Top 组的等权 fwd_ret 减去全 universe 等权
    fwd_ret，返回日超额序列。

    decile=10 → Top 10% vs market
    """
    f, r = factor.align(fwd_ret, join="inner")
    out = pd.Series(np.nan, index=f.index, dtype=float)
    for t in f.index:
        fa = f.loc[t]
        ra = r.loc[t]
        mask = fa.notna() & ra.notna()
        if mask.sum() < decile * 2:
            continue
        fv = fa[mask]
        rv = ra[mask]
        thresh = fv.quantile(1 - 1.0 / decile)
        top = fv >= thresh
        if top.sum() == 0:
            continue
        out.loc[t] = rv[top].mean() - rv.mean()
    return out


# ── 汇总报告 ──────────────────────────────────────────────────


def compute_ic_history(
    factors: dict[int, pd.DataFrame],
    close: pd.DataFrame,
    *,
    horizon: int = 5,
) -> pd.DataFrame:
    """
    计算每个因子的逐日 IC 时间序列，返回 wide-format DataFrame。

    用于 IC 热力图、IC 衰减监控、自适应权重等场景。

    Returns:
      DataFrame, index=date, columns=alpha_num, value=daily Spearman IC
    """
    fwd_ret = compute_forward_return(close, horizon=horizon)
    series_list = []
    for num, fdf in factors.items():
        ic = daily_ic(fdf, fwd_ret, method="spearman")
        ic.name = num
        series_list.append(ic)
    if not series_list:
        return pd.DataFrame()
    return pd.concat(series_list, axis=1)


def run_ic_report(
    factors: dict[int, pd.DataFrame],
    close: pd.DataFrame,
    *,
    horizon: int = 5,
    decile: int = 10,
) -> pd.DataFrame:
    """
    对每个因子计算完整 IC 指标，返回 DataFrame。

    Args:
      factors: {alpha_num: factor_df (已 preprocess)}
      close: 复权收盘价 panel
      horizon: 前瞻收益天数（默认 5）
      decile: 分组数（默认 10）

    Returns:
      DataFrame，列 = [alpha_num, ic_mean, ic_std, ic_ir, ic_t, ic_pos_rate,
                       top_excess_mean, top_excess_ir, turnover, n_obs]。
      按 |ic_ir| 降序排列。
    """
    fwd_ret = compute_forward_return(close, horizon=horizon)
    rows = []
    for num, fdf in factors.items():
        ic = daily_ic(fdf, fwd_ret, method="spearman")
        stat = ic_stats(ic)
        excess = top_decile_excess(fdf, fwd_ret, decile=decile)
        excess_mean = float(excess.mean()) if excess.notna().any() else np.nan
        excess_std = float(excess.std()) if excess.notna().any() else np.nan
        excess_ir = (
            excess_mean / excess_std * np.sqrt(252)
            if (pd.notna(excess_std) and excess_std > 0)
            else np.nan
        )
        turnover = factor_turnover(fdf, window=1)
        rows.append({
            "alpha": num,
            "ic_mean": stat["ic_mean"],
            "ic_std": stat["ic_std"],
            "ic_ir": stat["ic_ir"],
            "ic_t": stat["ic_t"],
            "ic_pos_rate": stat["ic_pos_rate"],
            "top_excess_mean": excess_mean,
            "top_excess_ir": excess_ir,
            "turnover": turnover,
            "n_obs": stat["n"],
        })
    df = pd.DataFrame(rows)
    return df.sort_values("ic_ir", key=lambda s: s.abs(), ascending=False).reset_index(drop=True)


def filter_alphas_by_ic(
    report: pd.DataFrame, *, min_abs_ic_mean: float = 0.02, min_abs_ic_ir: float = 0.3,
) -> list[int]:
    """从 IC 报告里筛出"好因子"列表。"""
    mask = (
        (report["ic_mean"].abs() >= min_abs_ic_mean)
        & (report["ic_ir"].abs() >= min_abs_ic_ir)
        & report["ic_ir"].notna()
    )
    return report.loc[mask, "alpha"].astype(int).tolist()


# ── 因子相关性 / 冗余剔除 ─────────────────────────────────────


def factor_correlation_matrix(
    factor_panel: dict[int, pd.DataFrame],
    *,
    method: str = "spearman",
    sample_dates: int | None = None,
) -> pd.DataFrame:
    """
    计算因子两两相关性矩阵（每日横截面相关性的时间均值）。

    Args:
      factor_panel: {alpha_num: factor_df}
      method: 'spearman' (默认，对非线性鲁棒) 或 'pearson'
      sample_dates: 若给定，从日期序列随机采样 N 个日期算（提速）

    Returns:
      pd.DataFrame, index/columns = alpha_num，cells = 平均横截面相关性。
    """
    nums = sorted(factor_panel.keys())
    if not nums:
        return pd.DataFrame()
    long_frames = []
    for num in nums:
        s = factor_panel[num].stack().rename(f"alpha_{num}")
        long_frames.append(s)
    df = pd.concat(long_frames, axis=1)

    if sample_dates is not None:
        date_set = sorted(set(df.index.get_level_values(0)))
        if len(date_set) > sample_dates:
            import random
            random.seed(0)
            sampled = set(random.sample(date_set, sample_dates))
            df = df[df.index.get_level_values(0).isin(sampled)]

    by_date_corr = df.groupby(level=0).apply(lambda g: g.corr(method=method))
    avg_corr = by_date_corr.groupby(level=1).mean()
    avg_corr.index = [int(c.replace("alpha_", "")) for c in avg_corr.index]
    avg_corr.columns = [int(c.replace("alpha_", "")) for c in avg_corr.columns]
    return avg_corr.loc[nums, nums]


def factor_ic_monthly_heatmap(
    factor_panel: dict[int, pd.DataFrame],
    close: pd.DataFrame,
    *,
    horizon: int = 5,
) -> pd.DataFrame:
    """
    生成 (alpha × month) 月度 IC 矩阵，用于前端热力图。

    每个 cell = 该因子在该月所有交易日横截面 IC 的平均。

    Returns:
      pd.DataFrame, index=alpha_num, columns='YYYY-MM' 字符串, value=月均 IC
    """
    fwd_ret = compute_forward_return(close, horizon=horizon)
    rows = []
    for num, fdf in factor_panel.items():
        ic = daily_ic(fdf, fwd_ret, method="spearman")
        ic.index = pd.to_datetime(ic.index)
        monthly = ic.resample("ME").mean()
        monthly.name = num
        rows.append(monthly)
    df = pd.concat(rows, axis=1).T  # rows=alpha, cols=month_end
    df.columns = [c.strftime("%Y-%m") for c in df.columns]
    return df


def filter_redundant_alphas(
    report: pd.DataFrame,
    corr_matrix: pd.DataFrame,
    *,
    corr_threshold: float = 0.85,
    quality_metric: str = "ic_ir",
) -> list[int]:
    """
    基于因子相关性贪心剔除冗余因子。

    算法:
      1. 按 |quality_metric| 降序排列因子
      2. 从最强因子开始，依次加入"保留集"
      3. 若新因子与保留集任一因子 |corr| > threshold，剔除

    Args:
      report: run_ic_report 输出
      corr_matrix: factor_correlation_matrix 输出
      corr_threshold: 相关性阈值（建议 0.7-0.85）
      quality_metric: 'ic_ir' / 'ic_mean' / 'top_excess_ir'

    Returns:
      保留的 alpha 编号列表（按 quality 降序）。
    """
    if report.empty or corr_matrix.empty:
        return []
    sorted_alphas = report.sort_values(quality_metric, key=lambda s: s.abs(), ascending=False)
    sorted_alphas = sorted_alphas[sorted_alphas[quality_metric].notna()]

    kept: list[int] = []
    for _, row in sorted_alphas.iterrows():
        num = int(row["alpha"])
        if num not in corr_matrix.index:
            continue
        too_similar = False
        for k in kept:
            if k not in corr_matrix.columns:
                continue
            c = corr_matrix.loc[num, k]
            if pd.notna(c) and abs(c) > corr_threshold:
                too_similar = True
                break
        if not too_similar:
            kept.append(num)
    return kept
