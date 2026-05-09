"""
A 股宏观/资金面因子（W6 对照层）。
6 个因子：M2 同比 / 剩余流动性 / 北向 60D 累计 / 融资余额同比 / 新增开户 Z / 沪深 300 PE。
"""
from __future__ import annotations

from datetime import date as Date

import numpy as np
import pandas as pd

from . import read_series_history, register_factor


@register_factor(
    factor_id="CN_M2_YOY",
    name="中国 M2 同比",
    category="liquidity",
    markets=["CN"],
    freq="monthly",
    direction="higher_bullish",
    description="中国 M2 货币供应同比增速（%）。akshare macro_china_money_supply。"
                "高位=流动性宽松，资产价格友好。",
)
def calc_cn_m2_yoy(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("CN_M2_YOY", as_of)


@register_factor(
    factor_id="CN_REAL_M2",
    name="中国剩余流动性 (M2-CPI)",
    category="liquidity",
    markets=["CN"],
    freq="monthly",
    direction="higher_bullish",
    description="中国剩余流动性 = M2 同比 - CPI 同比。"
                "正=货币跑赢通胀利好资产；负=实际紧缩。A 股最经典的流动性指标。",
)
def calc_cn_real_m2(as_of: Date | str | None = None) -> pd.Series:
    m2 = read_series_history("CN_M2_YOY", as_of)
    cpi = read_series_history("CN_CPI_YOY", as_of)
    if m2.empty or cpi.empty:
        return pd.Series(dtype=float)
    m2.index = pd.to_datetime(m2.index)
    cpi.index = pd.to_datetime(cpi.index)
    df = pd.DataFrame({"m2": m2, "cpi": cpi}).dropna()
    if df.empty:
        return pd.Series(dtype=float)
    s = (df["m2"] - df["cpi"]).astype(float)
    s.index = s.index.strftime("%Y-%m-%d")
    return s


@register_factor(
    factor_id="CN_NORTHBOUND_60D",
    name="北向资金 60 日累计净流入",
    category="liquidity",
    markets=["CN"],
    freq="daily",
    direction="higher_bullish",
    description="沪深港通北向 60 日累计净流入（万元）。tushare moneyflow_hsgt。"
                "聪明钱情绪：持续正流入=外资看好；负流入=撤资。",
)
def calc_cn_northbound_60d(as_of: Date | str | None = None) -> pd.Series:
    daily = read_series_history("CN_NORTHBOUND_DAILY", as_of)
    if daily.empty:
        return pd.Series(dtype=float)
    daily.index = pd.to_datetime(daily.index)
    daily = daily.sort_index()
    cum60 = daily.rolling(60, min_periods=20).sum()
    cum60 = cum60.dropna()
    cum60.index = cum60.index.strftime("%Y-%m-%d")
    return cum60.astype(float)


@register_factor(
    factor_id="CN_MARGIN_YOY",
    name="沪市融资余额同比",
    category="sentiment",
    markets=["CN"],
    freq="daily",
    direction="higher_bullish",
    contrarian_at_extremes=True,
    description="沪市融资余额同比变化（%）。akshare stock_margin_sse。"
                "杠杆扩张代理：中间区高=牛市常态；极端高（>90 分位）"
                "=散户加杠杆过度=顶部反向。",
)
def calc_cn_margin_yoy(as_of: Date | str | None = None) -> pd.Series:
    bal = read_series_history("CN_MARGIN_BAL", as_of)
    if bal.empty:
        return pd.Series(dtype=float)
    bal.index = pd.to_datetime(bal.index)
    bal = bal.sort_index()
    yoy = (bal.pct_change(periods=252) * 100).dropna()
    yoy.index = yoy.index.strftime("%Y-%m-%d")
    return yoy.astype(float)


@register_factor(
    factor_id="CN_NEW_ACCOUNT_Z",
    name="新增开户 36 月 Z-score",
    category="sentiment",
    markets=["CN"],
    freq="monthly",
    direction="higher_bullish",
    contrarian_at_extremes=True,
    description="新增证券投资者月度 Z-score（36 月滚动）。akshare stock_account_statistics_em。"
                "散户情绪：极端高（>2σ）= FOMO 顶部反向。",
)
def calc_cn_new_account_z(as_of: Date | str | None = None) -> pd.Series:
    acc = read_series_history("CN_NEW_ACCOUNT", as_of)
    if acc.empty or len(acc) < 36:
        return pd.Series(dtype=float)
    acc.index = pd.to_datetime(acc.index)
    acc = acc.sort_index()
    mean = acc.rolling(36, min_periods=12).mean()
    std = acc.rolling(36, min_periods=12).std()
    z = ((acc - mean) / std.replace(0, np.nan)).dropna()
    z.index = z.index.strftime("%Y-%m-%d")
    return z.astype(float)


@register_factor(
    factor_id="CN_CSI300_PE",
    name="沪深 300 滚动 PE",
    category="valuation",
    markets=["CN"],
    freq="daily",
    rolling_window_days=5040,  # ~20Y
    direction="lower_bullish",
    description="沪深 300 指数滚动市盈率（TTM）。akshare stock_index_pe_lg。"
                "A 股大盘估值代理，低分位=便宜，高分位=贵。",
)
def calc_cn_csi300_pe(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("CN_CSI300_PE", as_of)
