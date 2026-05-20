"""
K 线周期枚举（intraday + daily）。
=================================

值用字符串 = yfinance 的 interval 参数原样：方便直接透传。

yfinance 1m 硬限制（已实测 SPY 2026-05-18 验证）：
  - 1m  仅最近 ~7 个交易日
  - 5m  最近 60 天
  - 15m 最近 60 天
  - 1h  最近 730 天
  - 1d  无限（受标的上市日限制）

分钟级数据在 yfinance 内部 tz 为 America/New_York（aware）。
本项目约定：fetcher 出口统一 tz_convert("UTC")，schema 永远 UTC。
"""
from __future__ import annotations

from enum import Enum


class Interval(str, Enum):
    MIN_1 = "1m"
    MIN_5 = "5m"
    MIN_15 = "15m"
    HOUR_1 = "1h"
    DAY_1 = "1d"

    @classmethod
    def from_str(cls, s: str | "Interval") -> "Interval":
        if isinstance(s, cls):
            return s
        try:
            return cls(s)
        except ValueError as e:
            valid = ", ".join(i.value for i in cls)
            raise ValueError(f"未知 interval={s!r}，可选: {valid}") from e

    @property
    def is_intraday(self) -> bool:
        return self != Interval.DAY_1


# yfinance period 映射（不带"接近上限"留 1d 缓冲）：
# 用户调用 fetch_history(days=N) 时，若 interval 是分钟级，按映射裁掉超出 yfinance 限制的部分。
# 元组：(yfinance period 字符串, 该 interval 允许的最大回溯自然日数)
_YFINANCE_PERIOD: dict[Interval, tuple[str, int]] = {
    Interval.MIN_1:  ("7d",   7),     # yfinance 实际 ~7 个交易日，按自然日给 7
    Interval.MIN_5:  ("60d",  60),
    Interval.MIN_15: ("60d",  60),
    Interval.HOUR_1: ("730d", 730),
    Interval.DAY_1:  ("6mo",  180),   # 与现有 yfinance_source 默认对齐
}


def yfinance_period_for(interval: Interval, days: int) -> str:
    """根据 interval + 用户请求 days，返回 yfinance 的 period 字符串。

    对日 K 保留原逻辑（≤90 天 → 3mo，否则 6mo）；
    对分钟级取该 interval 上限对应的 period 字符串。
    """
    if interval == Interval.DAY_1:
        return "6mo" if days > 90 else "3mo"
    return _YFINANCE_PERIOD[interval][0]


def max_lookback_days(interval: Interval) -> int:
    """该 interval 允许的最大自然日数。调用方可据此截断或拒绝。"""
    return _YFINANCE_PERIOD[interval][1]
