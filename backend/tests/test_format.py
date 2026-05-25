"""
backend/_format.py — fmt_big 单元测试

覆盖：T/B/M/裸数 4 个分支 + None 短路 + 负数 + 浮点精度 + 边界（1e6/1e9/1e12）
"""
from __future__ import annotations

import sys
from pathlib import Path

# 让 pytest 能 import backend._format（兼容 backend/ 作为 source root 的项目布局）
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from _format import fmt_big  # noqa: E402


class TestNoneShortCircuit:
    def test_none_returns_none(self):
        assert fmt_big(None) is None


class TestTrillion:
    """≥ 1e12 → 'X.XXT'（保留 2 位小数）"""

    def test_exact_trillion(self):
        assert fmt_big(1e12) == "1.00T"

    def test_apple_marketcap(self):
        # 3.5T (AAPL 量级)
        assert fmt_big(3.5e12) == "3.50T"

    def test_large_trillion(self):
        assert fmt_big(1.234e13) == "12.34T"

    def test_just_below_trillion_uses_billion(self):
        # 999.9B 应该用 B 不是 T
        assert fmt_big(9.99e11) == "999.0B"


class TestBillion:
    """1e9 ≤ x < 1e12 → 'X.XB'（保留 1 位小数）"""

    def test_exact_billion(self):
        assert fmt_big(1e9) == "1.0B"

    def test_typical_billion(self):
        assert fmt_big(2.3e9) == "2.3B"

    def test_large_billion(self):
        assert fmt_big(8.5e10) == "85.0B"

    def test_just_below_billion_uses_million(self):
        assert fmt_big(9.99e8) == "999M"


class TestMillion:
    """1e6 ≤ x < 1e9 → 'XM'（无小数）"""

    def test_exact_million(self):
        assert fmt_big(1e6) == "1M"

    def test_typical_million(self):
        assert fmt_big(8e6) == "8M"

    def test_rounded_million(self):
        # 8.5M 应该四舍五入为 "8M" 或 "9M"（Python 默认 banker's rounding）
        result = fmt_big(8.5e6)
        assert result in ("8M", "9M")

    def test_just_below_million_uses_plain(self):
        # 999_999 < 1e6 → 走 "{val:.0f}" 分支保留为原值
        assert fmt_big(999_999) == "999999"


class TestPlainNumber:
    """< 1e6 → 'X'（无单位，整数化）"""

    def test_small_int(self):
        assert fmt_big(1234) == "1234"

    def test_zero(self):
        assert fmt_big(0) == "0"

    def test_small_float_rounds_to_int(self):
        # 1234.5 → "1234" 或 "1235"（rounding 行为）
        result = fmt_big(1234.5)
        assert result in ("1234", "1235")

    def test_one(self):
        assert fmt_big(1) == "1"


class TestNegative:
    """负数也应正确分类（基于 abs 比较）"""

    def test_negative_trillion(self):
        # -1.5T → 取 abs 判断阈值，但格式化时保留符号
        # 注：当前实现 f"{val/1e12:.2f}T" 会输出 "-1.50T"
        assert fmt_big(-1.5e12) == "-1.50T"

    def test_negative_billion(self):
        assert fmt_big(-2.3e9) == "-2.3B"

    def test_negative_million(self):
        assert fmt_big(-8e6) == "-8M"

    def test_negative_plain(self):
        assert fmt_big(-1234) == "-1234"


class TestEdgeCases:
    """边界与异常值"""

    def test_int_input(self):
        # 输入 int 而非 float
        assert fmt_big(1_500_000_000_000) == "1.50T"

    def test_float_very_small(self):
        # 1.5 → "2" or "1" depending on rounding
        result = fmt_big(1.5)
        assert result in ("1", "2")

    def test_negative_zero(self):
        # -0 should behave like 0
        assert fmt_big(-0.0) == "-0"
