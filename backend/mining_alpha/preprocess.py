"""
mining_alpha.preprocess — 因子预处理（横截面）
==========================================

提供工业标准的因子清洗流水线:
  1. winsorize  — MAD 3σ 缩尾（按日横截面，剔除极端值）
  2. fillna     — 用横截面中位数填充缺失
  3. neutralize — 行业 / 市值中性化（OLS 残差），可选
  4. zscore     — 横截面标准化

公开接口:
  - winsorize_xs(df, k=3.0) — 缩尾
  - fillna_xs(df, method='median') — 按行填充
  - zscore_xs(df) — 横截面 z-score
  - neutralize_xs(df, exposures: dict[str, df]) — 多元线性回归取残差
  - preprocess_pipeline(df, ...) — 一站式默认管道

所有函数输入/输出都是 dates × tickers DataFrame；操作沿 axis=1（每日横截面）。
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ── 缩尾 ──────────────────────────────────────────────────────


def winsorize_xs(df: pd.DataFrame, k: float = 3.0) -> pd.DataFrame:
    """
    MAD-based 缩尾：每日横截面计算中位数 m 和 MAD = median(|x - m|)，
    把 [m - k*1.4826*MAD, m + k*1.4826*MAD] 之外的值截到边界。
    1.4826 是 MAD → σ 的转换系数（假设正态分布）。
    """
    median = df.median(axis=1)
    mad = (df.sub(median, axis=0)).abs().median(axis=1)
    sigma_proxy = 1.4826 * mad
    upper = median + k * sigma_proxy
    lower = median - k * sigma_proxy
    return df.clip(lower=lower, upper=upper, axis=0)


# ── 缺失填充 ──────────────────────────────────────────────────


def fillna_xs(df: pd.DataFrame, method: str = "median") -> pd.DataFrame:
    """按日横截面用中位数 / 均值 / 0 填充缺失。"""
    if method == "median":
        return df.apply(lambda row: row.fillna(row.median()), axis=1)
    if method == "mean":
        return df.apply(lambda row: row.fillna(row.mean()), axis=1)
    if method == "zero":
        return df.fillna(0.0)
    raise ValueError(f"unknown fillna method: {method}")


# ── 标准化 ────────────────────────────────────────────────────


def zscore_xs(df: pd.DataFrame) -> pd.DataFrame:
    """横截面 z-score: (x - row_mean) / row_std。row_std=0 时输出 0。"""
    mean = df.mean(axis=1)
    std = df.std(axis=1)
    z = df.sub(mean, axis=0).div(std.replace(0, np.nan), axis=0)
    return z.fillna(0.0)


# ── 中性化（OLS 残差）────────────────────────────────────────


def _xs_ols_residual(y_row: np.ndarray, X_row: np.ndarray) -> np.ndarray:
    """
    单日横截面 OLS y ~ X，返回残差。X 已含常数列。
    """
    mask = ~(np.isnan(y_row) | np.isnan(X_row).any(axis=1))
    if mask.sum() < X_row.shape[1] + 1:
        # 自由度不够，原值返回（不残差化）
        return y_row
    y = y_row[mask]
    X = X_row[mask]
    # 求解 beta = (X'X)^{-1} X'y，用 lstsq 更稳
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    y_hat = X @ beta
    residual = y - y_hat
    out = np.full_like(y_row, np.nan, dtype=float)
    out[mask] = residual
    return out


def neutralize_xs(
    df: pd.DataFrame,
    exposures: dict[str, pd.DataFrame] | None = None,
    industry: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """
    多元横截面中性化：每日 y ~ [1, exposures..., industry_dummies...]。
    返回残差作为新的因子值。

    Args:
      df: 因子值 dates × tickers
      exposures: dict[name, df]，每个值是 dates × tickers 的连续暴露因子（如 log_mktcap）
      industry: dates × tickers 行业代码 DataFrame（字符串如 'tech'）。会展开为 one-hot。

    Returns:
      残差 DataFrame，shape 与 df 同。
    """
    if exposures is None and industry is None:
        return df

    tickers = df.columns
    dates = df.index

    # 对齐所有 exposure
    exp_arrs: list[pd.DataFrame] = []
    if exposures:
        for _, e in exposures.items():
            e_aligned = e.reindex(index=dates, columns=tickers)
            exp_arrs.append(e_aligned)

    # 行业 one-hot：每日单独算行业 dummies，因为行业可能变
    out = df.copy().astype(float)
    n_exp = len(exp_arrs)

    for t in dates:
        y = df.loc[t].values.astype(float)
        # 构造设计矩阵
        cols = [np.ones(len(tickers))]
        for e in exp_arrs:
            cols.append(e.loc[t].values.astype(float))
        if industry is not None:
            ind_row = industry.loc[t].astype(str).values
            uniq = sorted({i for i in ind_row if i and i != "nan"})
            for u in uniq[1:]:  # k-1 dummy（避免共线性）
                cols.append((ind_row == u).astype(float))
        X = np.column_stack(cols)
        residual = _xs_ols_residual(y, X)
        out.loc[t] = residual
    return out


# ── 默认管道 ──────────────────────────────────────────────────


def preprocess_pipeline(
    df: pd.DataFrame,
    *,
    winsorize_k: float = 3.0,
    fillna_method: str = "median",
    do_zscore: bool = True,
    log_mktcap: pd.DataFrame | None = None,
    industry: pd.DataFrame | None = None,
    vol_scale_window: int | None = None,
) -> pd.DataFrame:
    """
    默认预处理管道: (vol_scale) → winsorize → fillna → (neutralize) → zscore。

    Args:
      df: 原始因子值
      winsorize_k: MAD 倍数，建议 3.0
      fillna_method: 'median' / 'mean' / 'zero'
      do_zscore: 是否做横截面标准化
      log_mktcap: 对数市值，用于市值中性化（None 跳过）
      industry: 行业代码，用于行业中性化（None 跳过）
      vol_scale_window: 若给定，先做时序波动率归一化（window 日 std）；
        建议 20-60。对高波动期主导的因子（动量、量价）很有效。

    Returns:
      处理后的 DataFrame，shape 不变。
    """
    out = df
    if vol_scale_window:
        rolling_std = out.rolling(vol_scale_window, min_periods=max(vol_scale_window // 2, 1)).std()
        safe_std = rolling_std.where(rolling_std > 1e-12)
        out = out / safe_std
    out = winsorize_xs(out, k=winsorize_k)
    out = fillna_xs(out, method=fillna_method)
    if log_mktcap is not None or industry is not None:
        exposures = {"log_mktcap": log_mktcap} if log_mktcap is not None else {}
        out = neutralize_xs(out, exposures=exposures or None, industry=industry)
        # 中性化后再 fillna 一次（行业 missing 等可能产生 NaN）
        out = fillna_xs(out, method="zero")
    if do_zscore:
        out = zscore_xs(out)
    return out
