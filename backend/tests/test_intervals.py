"""
测试 yfinance_period_for 阶梯映射
================================
锁定 days → period 映射，避免回归到只返回 "6mo" 的 bug
（曾导致 Smart Beta 回测拿不到 ≥ 3 年数据）。
"""
import pytest

from data_sources._intervals import Interval, yfinance_period_for


@pytest.mark.parametrize("days,expected", [
    # 边界 + 典型用例
    (1, "3mo"),
    (30, "3mo"),
    (90, "3mo"),       # ≤ 90 → 3mo
    (91, "6mo"),
    (180, "6mo"),      # ≤ 180 → 6mo
    (181, "1y"),
    (280, "1y"),       # smart-beta snapshot 用 280
    (365, "1y"),       # ≤ 365 → 1y
    (366, "2y"),
    (730, "2y"),       # ≤ 730 → 2y
    (731, "5y"),
    (1500, "5y"),
    (1825, "5y"),      # ≤ 1825 → 5y
    (1826, "10y"),
    (1861, "10y"),     # smart-beta backtest 3 年 ≈ 1611 + 250 lookback
    (3650, "10y"),     # ≤ 3650 → 10y
    (3651, "max"),
    (10000, "max"),
])
def test_yfinance_period_for_daily(days, expected):
    """日 K 按 days 阶梯映射，覆盖所有阶梯边界。"""
    assert yfinance_period_for(Interval.DAY_1, days) == expected


def test_smart_beta_backtest_3y_gets_long_enough_period():
    """关键回归 case：Smart Beta 3 年回测的 days 必须映射到 ≥ 1y 的 period
    （之前的 bug 是只返回 6mo，导致只拿 ~126 bars，回测直接拒绝）。"""
    # 3 年 + 250 天 lookback ≈ 1361 days
    period = yfinance_period_for(Interval.DAY_1, 1361)
    assert period in ("2y", "5y", "10y", "max"), \
        f"期望长周期，实际 {period} — 可能 cap 在 6mo bug 回归"


def test_intraday_intervals_unchanged():
    """分钟级 interval 保持原行为不受影响。"""
    # 都是常量映射，days 参数对分钟级不影响选择
    assert yfinance_period_for(Interval.MIN_1, 7) == "7d"
    assert yfinance_period_for(Interval.HOUR_1, 100) == "730d"
