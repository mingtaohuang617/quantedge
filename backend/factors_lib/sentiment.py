"""
情绪资金面因子（W5）。
VIX / SKEW 都是 CBOE 指数，yfinance ^VIX / ^SKEW 拉日收盘即可。
AAII / Put-Call 没有 yfinance ticker，需要爬虫，留 W5 后期。
"""
from __future__ import annotations

from datetime import date as Date

import pandas as pd

from . import read_series_history, register_factor


@register_factor(
    factor_id="US_VIX",
    name="VIX 恐慌指数",
    category="sentiment",
    markets=["US"],
    freq="daily",
    description="CBOE 标普 500 30 天隐含波动率指数。"
                "高位（>30）=恐慌、潜在底部；低位（<15）=贪婪/复杂感、潜在顶部信号。"
                "对比分位比绝对值更稳定。原始来源：yfinance ^VIX。",
)
def calc_us_vix(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_VIX_RAW", as_of)


@register_factor(
    factor_id="US_SKEW",
    name="SKEW 期权偏斜",
    category="sentiment",
    markets=["US"],
    freq="daily",
    description="CBOE SKEW 指数，反映标普 500 期权深度虚值看跌（OTM put）的相对定价，"
                "代表机构对尾部风险的对冲成本。一般在 100-150 区间。"
                "高位（>140）=机构对尾部担忧加重，比 VIX 更敏锐的领先指标。"
                "原始来源：yfinance ^SKEW。",
)
def calc_us_skew(as_of: Date | str | None = None) -> pd.Series:
    return read_series_history("US_SKEW_RAW", as_of)
