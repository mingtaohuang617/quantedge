"""
市场宽度因子（W4）。
基于 breadth_snapshot 表（每日 SP500 全成分股聚合统计）。
McClellan / MACD 扩散 留 W4 后期。
"""
from __future__ import annotations

from datetime import date as Date

import pandas as pd

import db

from . import register_factor


def _read_breadth_column(column: str, market: str = "US") -> pd.Series:
    """从 breadth_snapshot 表读一列；index=snapshot_date 字符串。"""
    conn = db._get_conn()
    rows = conn.execute(
        f"SELECT snapshot_date, {column} FROM breadth_snapshot "
        f"WHERE market=? AND {column} IS NOT NULL ORDER BY snapshot_date",
        (market,),
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float)
    return pd.Series(
        [float(r[column]) for r in rows],
        index=[r["snapshot_date"] for r in rows],
        dtype=float,
    )


@register_factor(
    factor_id="US_BREADTH_200MA",
    name="SP500 200日均线之上比例",
    category="breadth",
    markets=["US"],
    freq="daily",
    direction="higher_bullish",
    description="SP500 成分股中收盘价高于 200 日均线的比例（%）。"
                "经典宽度指标：>70% 强势/接近顶部，<30% 弱势/接近底部。"
                "高分位=多数股票仍在上升趋势；低分位=多数已跌破长期均线。",
)
def calc_us_breadth_200ma(as_of: Date | str | None = None) -> pd.Series:
    return _read_breadth_column("pct_above_200ma")


@register_factor(
    factor_id="US_BREADTH_50MA",
    name="SP500 50日均线之上比例",
    category="breadth",
    markets=["US"],
    freq="daily",
    direction="higher_bullish",
    description="SP500 成分股中收盘价高于 50 日均线的比例（%）。比 200MA 更短期、更敏感。"
                "与 200MA 背离时常预警趋势转折。",
)
def calc_us_breadth_50ma(as_of: Date | str | None = None) -> pd.Series:
    return _read_breadth_column("pct_above_50ma")


@register_factor(
    factor_id="US_NEW_HIGH_LOW_RATIO",
    name="SP500 净新高 (52周)",
    category="breadth",
    markets=["US"],
    freq="daily",
    direction="higher_bullish",
    description="(52周新高家数 - 52周新低家数) / universe_size × 100。"
                "正值=多数股票创新高（健康趋势）；持续负值=熊市基础。"
                "顶部背离信号：指数创新高但本因子下降。",
)
def calc_us_new_high_low_ratio(as_of: Date | str | None = None) -> pd.Series:
    conn = db._get_conn()
    rows = conn.execute(
        "SELECT snapshot_date, new_highs_52w, new_lows_52w, universe_size "
        "FROM breadth_snapshot WHERE market='US' AND universe_size > 0 "
        "ORDER BY snapshot_date"
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float)
    return pd.Series(
        [(r["new_highs_52w"] - r["new_lows_52w"]) / r["universe_size"] * 100 for r in rows],
        index=[r["snapshot_date"] for r in rows],
        dtype=float,
    )


@register_factor(
    factor_id="US_AD_RATIO_5D",
    name="SP500 5日涨跌家数比",
    category="breadth",
    markets=["US"],
    freq="daily",
    direction="higher_bullish",
    description="过去 5 个交易日累计 advancing / (advancing+declining) × 100。"
                "短期资金扩散度；>60% 持续=强势加宽，<40% 持续=弱势收敛。",
)
def calc_us_ad_ratio_5d(as_of: Date | str | None = None) -> pd.Series:
    conn = db._get_conn()
    rows = conn.execute(
        "SELECT snapshot_date, advancing, declining FROM breadth_snapshot "
        "WHERE market='US' ORDER BY snapshot_date"
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows, columns=["snapshot_date", "advancing", "declining"])
    df = df.set_index("snapshot_date")
    adv5 = df["advancing"].rolling(5, min_periods=3).sum()
    dec5 = df["declining"].rolling(5, min_periods=3).sum()
    ratio = adv5 / (adv5 + dec5).replace(0, float("nan")) * 100
    return ratio.dropna().astype(float)
