"""
估值因子（W2）。
- US_SPX_PE     : 标普 500 trailing PE 月度（multpl）
- US_CAPE       : Shiller 周期调整 PE 月度（multpl）—— 130+ 年历史
- US_BUFFETT    : Wilshire 5000 / GDP 比率（FRED 双序列组合）
- US_ERP        : 股权风险溢价 = 1/PE - 10Y Treasury（月度，对齐月末）

所有因子都用历史滚动分位标准化（默认 10Y）。
长历史（CAPE）样本足时分位窗口可拉到 30Y+。
"""
from __future__ import annotations

from datetime import date as Date

import pandas as pd

from . import read_series_history, register_factor


@register_factor(
    factor_id="US_SPX_PE",
    name="标普 500 PE (TTM)",
    category="valuation",
    markets=["US"],
    freq="monthly",
    description="标普 500 trailing 12 个月 PE。月度数据 (multpl.com)。"
                "高分位=贵；低分位=便宜。历史均值 ~16，>25 偏高，<12 偏低。",
)
def calc_us_spx_pe(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_SPX_PE_RAW", as_of)


@register_factor(
    factor_id="US_CAPE",
    name="Shiller CAPE (周期调整 PE)",
    category="valuation",
    markets=["US"],
    freq="monthly",
    rolling_window_days=10000,  # 40Y 窗口（CAPE 长历史）
    description="Robert Shiller 周期调整 PE = 价格 / 10年通胀调整后平均盈利。"
                "比 trailing PE 抗周期。历史均值 ~17，>30 极端高估（如 1929/2000/2021）。",
)
def calc_us_cape(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_CAPE_RAW", as_of)


@register_factor(
    factor_id="US_BUFFETT",
    name="巴菲特指标 (Wilshire/GDP)",
    category="valuation",
    markets=["US"],
    freq="monthly",
    rolling_window_days=10000,  # 40Y
    description="Wilshire 5000 全市值指数 / 名义 GDP（按 1pt≈1B 惯例 ~市值/GDP %）。"
                "巴菲特称为'最佳估值指标'。>150% 偏贵，>200% 极度高估。",
)
def calc_us_buffett(as_of: Date | str | None = None) -> pd.Series:
    wil = read_series_history("US_WILL5000", as_of)
    gdp = read_series_history("US_GDP", as_of)
    if wil.empty or gdp.empty:
        return pd.Series(dtype=float)
    # GDP 季频 → forward-fill 到 wil 的日频
    df = pd.DataFrame({"wil": wil})
    gdp_s = gdp.reindex(df.index, method=None)  # 先空
    df["gdp"] = gdp.reindex(df.index, method="ffill")
    # 对齐：先取 wil 与 gdp 都有 publish 的日子（gdp 第一次发布前 ratio 没意义）
    df = df.dropna()
    if df.empty:
        return pd.Series(dtype=float)
    return (df["wil"] / df["gdp"] * 100).astype(float)


@register_factor(
    factor_id="US_ERP",
    name="股权风险溢价 (ERP)",
    category="valuation",
    markets=["US"],
    freq="monthly",
    description="ERP = 1/PE - 10Y Treasury（百分点）。月度对齐月末。"
                "正=股票相对债券有溢价；负或低=股票相对昂贵（'TINA' 反转）。"
                "1999/2007 年顶部时 ERP 极低甚至为负。",
)
def calc_us_erp(as_of: Date | str | None = None) -> pd.Series:
    pe = read_series_history("US_SPX_PE_RAW", as_of)
    y10 = read_series_history("US_DGS10", as_of)
    if pe.empty or y10.empty:
        return pd.Series(dtype=float)
    # PE 月度，DGS10 日频 → 把 DGS10 重采样到月末
    y10.index = pd.to_datetime(y10.index)
    pe.index = pd.to_datetime(pe.index)
    y10_m = y10.resample("ME").last()
    df = pd.DataFrame({"pe": pe, "y10": y10_m}).dropna()
    if df.empty:
        return pd.Series(dtype=float)
    erp = 100.0 / df["pe"] - df["y10"]
    erp.index = erp.index.strftime("%Y-%m-%d")
    return erp.astype(float)
