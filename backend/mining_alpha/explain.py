"""
mining_alpha.explain — SHAP 可解释性
====================================

对最新一日预测 Top-N 股票，输出每只票的 Top-K 贡献因子（基于 SHAP TreeExplainer）。

公开接口:
  - top_contributions_for_holdings(booster, X_today, top_n_stocks, top_k_factors)
      → DataFrame[ticker, factor, shap_value, factor_value]
"""
from __future__ import annotations

import numpy as np
import pandas as pd

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False


def top_contributions_for_holdings(
    booster,
    X_today: pd.DataFrame,
    *,
    top_n_stocks: int = 20,
    top_k_factors: int = 3,
    model_kind: str = "lgb",
) -> pd.DataFrame:
    """
    给定训好的 booster + 今日 long-format X（index=(date, ticker), columns=alpha_N），
    输出 Top-N 股票每只的 Top-K 贡献因子。

    Args:
      booster: lightgbm/xgboost/catboost 模型
      X_today: 今日的特征矩阵
      top_n_stocks: 取预测最高的 N 只票
      top_k_factors: 每只票输出贡献最大的 K 个因子（按 |shap| 排序）
      model_kind: 'lgb' / 'xgb' / 'cb' — 决定如何构造 SHAP explainer

    Returns:
      pd.DataFrame[ticker, factor, shap_value, factor_value]，
      按 ticker 分组每组 K 行，按预测分数 ticker 排序。
    """
    if not HAS_SHAP:
        raise RuntimeError("shap 未安装")
    if X_today.empty:
        return pd.DataFrame()

    # 1) 用 booster 预测，挑 Top-N
    if model_kind == "lgb":
        scores = booster.predict(X_today.values)
    elif model_kind == "xgb":
        import xgboost as xgb
        dm = xgb.DMatrix(X_today.values, feature_names=list(X_today.columns))
        scores = booster.predict(dm)
    elif model_kind == "cb":
        scores = booster.predict(X_today.values)
    else:
        raise ValueError(f"unknown model_kind: {model_kind}")
    score_series = pd.Series(scores, index=X_today.index)
    top_idx = score_series.nlargest(top_n_stocks).index

    # 2) 计算 SHAP
    if model_kind == "lgb":
        explainer = shap.TreeExplainer(booster)
        shap_values = explainer.shap_values(X_today.loc[top_idx].values)
    elif model_kind == "xgb":
        explainer = shap.TreeExplainer(booster)
        shap_values = explainer.shap_values(X_today.loc[top_idx].values)
    elif model_kind == "cb":
        explainer = shap.TreeExplainer(booster)
        shap_values = explainer.shap_values(X_today.loc[top_idx].values)

    # 3) 每只票取 Top-K 因子
    rows = []
    feature_names = list(X_today.columns)
    for i, idx in enumerate(top_idx):
        if isinstance(idx, tuple):
            ticker = str(idx[1])
        else:
            ticker = str(idx)
        sv = shap_values[i]
        # 按 |shap| 降序
        top_k_idx = np.argsort(-np.abs(sv))[:top_k_factors]
        for _, fi in enumerate(top_k_idx):
            rows.append({
                "ticker": ticker,
                "rank": i + 1,
                "factor": feature_names[fi],
                "shap_value": float(sv[fi]),
                "factor_value": float(X_today.iloc[i, fi]) if i < len(top_idx) else None,
                "score": float(score_series.loc[idx]),
            })
    return pd.DataFrame(rows)
