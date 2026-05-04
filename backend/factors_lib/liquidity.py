"""
流动性宏观因子（美股 W3 主力）。
单序列因子：直接读 read_series_history 切片。
组合因子：在函数内对齐两条序列再做 transform。
PMI 不在 FRED（2017 起 ISM 取消授权）；W4+ 考虑 OECD BCI / Conference Board 替代。
"""
from __future__ import annotations

from datetime import date as Date

import pandas as pd

from . import read_series_history, register_factor


# ── 期限利差 ─────────────────────────────────────────────
@register_factor(
    factor_id="US_YIELD_CURVE_10_2",
    name="美国期限利差 (10Y-2Y)",
    category="liquidity",
    markets=["US"],
    freq="daily",
    direction="higher_bullish",
    description="美国 10Y-2Y 国债期限利差。负值=收益率曲线倒挂（衰退预警）。"
                "原始来源：FRED T10Y2Y。低分位=高度倒挂=高熊市概率。",
)
def calc_us_yield_curve_10_2(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_T10Y2Y", as_of)


# ── M2 同比 ─────────────────────────────────────────────
@register_factor(
    factor_id="US_M2_YOY",
    name="美国 M2 同比",
    category="liquidity",
    markets=["US"],
    freq="monthly",
    direction="higher_bullish",
    description="美国 M2 货币供应同比增速（%）。FRED M2SL pct_change(12)。"
                "高位=流动性宽松；2020 年疫情后曾达 25%+。",
)
def calc_us_m2_yoy(as_of: Date | str | None = None) -> pd.Series:
    m2 = read_series_history("US_M2SL", as_of)
    if len(m2) < 13:
        return pd.Series(dtype=float)
    return (m2.pct_change(periods=12) * 100).dropna()


# ── 高收益债 OAS（信用利差，恐慌指标）──────────────────
@register_factor(
    factor_id="US_CREDIT_SPREAD_HY",
    name="美国高收益债利差 (HY OAS)",
    category="liquidity",
    markets=["US"],
    freq="daily",
    direction="lower_bullish",
    contrarian_at_extremes=True,
    description="ICE BofA 美国高收益债期权调整利差（OAS, %）。FRED BAMLH0A0HYM2。"
                "高位=信用风险定价上升=熊市信号；2020 年疫情曾 >10%。"
                "极端区反向：极端低=信用过热（顶预警），极端高=panic 底=反向看牛。",
)
def calc_us_credit_spread_hy(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_HY_OAS", as_of)


# ── 投资级利差代理（Baa - 10Y）─────────────────────────
@register_factor(
    factor_id="US_CREDIT_SPREAD_BAA",
    name="美国 Baa 投资级利差",
    category="liquidity",
    markets=["US"],
    freq="daily",
    direction="lower_bullish",
    contrarian_at_extremes=True,
    description="Moody's Baa 公司债收益率 - 10Y 国债（百分点）。FRED BAA10Y。"
                "投资级信用利差代理；HY 之外的二次确认。极端区反向。",
)
def calc_us_credit_spread_baa(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_BAA10Y", as_of)


# ── Fed 资产负债表同比 ──────────────────────────────────
@register_factor(
    factor_id="US_FED_BS_YOY",
    name="美联储资产负债表同比",
    category="liquidity",
    markets=["US"],
    freq="weekly",
    direction="higher_bullish",
    description="美联储资产负债表同比变化（%）。FRED WALCL pct_change(52)。"
                "正=扩表（QE）；负=缩表（QT）。",
)
def calc_us_fed_bs_yoy(as_of: Date | str | None = None) -> pd.Series:
    bs = read_series_history("US_WALCL", as_of)
    if len(bs) < 53:
        return pd.Series(dtype=float)
    return (bs.pct_change(periods=52) * 100).dropna()


# ── 剩余流动性（M2 - CPI 同比）──────────────────────────
@register_factor(
    factor_id="US_REAL_M2",
    name="美国剩余流动性 (M2-CPI)",
    category="liquidity",
    markets=["US"],
    freq="monthly",
    direction="higher_bullish",
    description="美国剩余流动性 = M2 同比 - CPI 同比（百分点）。"
                "正=货币增速跑赢通胀，资产价格友好；负=实际紧缩。",
)
def calc_us_real_m2(as_of: Date | str | None = None) -> pd.Series:
    m2 = read_series_history("US_M2SL", as_of)
    cpi = read_series_history("US_CPI", as_of)
    if len(m2) < 13 or len(cpi) < 13:
        return pd.Series(dtype=float)
    m2_yoy = m2.pct_change(periods=12) * 100
    cpi_yoy = cpi.pct_change(periods=12) * 100
    df = pd.DataFrame({"m2": m2_yoy, "cpi": cpi_yoy}).dropna()
    return df["m2"] - df["cpi"]


# ── 美元指数（贸易加权）────────────────────────────────
@register_factor(
    factor_id="US_DOLLAR_BROAD",
    name="贸易加权美元指数",
    category="liquidity",
    markets=["US"],
    freq="daily",
    direction="lower_bullish",
    description="美联储贸易加权美元指数（广义）。FRED DTWEXBGS。"
                "强势美元=新兴市场承压、大宗商品逆风。",
)
def calc_us_dollar_broad(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_DXY_TWB", as_of)
