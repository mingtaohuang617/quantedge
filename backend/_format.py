"""
共享的轻量展示层格式化 helpers。

模块名前导下划线表示"内部 helper"，不通过 `__init__.py` 导出。
调用方直接 `from _format import fmt_big`。
"""
from __future__ import annotations


def fmt_big(val: float | int | None) -> str | None:
    """把大数字格式化为人类可读：T / B / M。

    >>> fmt_big(1.5e12)
    '1.50T'
    >>> fmt_big(2.3e9)
    '2.3B'
    >>> fmt_big(8e6)
    '8M'
    >>> fmt_big(1234)
    '1234'
    >>> fmt_big(None) is None
    True
    """
    if val is None:
        return None
    if abs(val) >= 1e12:
        return f"{val/1e12:.2f}T"
    if abs(val) >= 1e9:
        return f"{val/1e9:.1f}B"
    if abs(val) >= 1e6:
        return f"{val/1e6:.0f}M"
    return f"{val:.0f}"
