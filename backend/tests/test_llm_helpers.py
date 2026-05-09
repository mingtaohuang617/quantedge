"""
LLM 模块内的纯函数 helpers 测试。
不依赖 DEEPSEEK_API_KEY，不会发任何网络请求。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from llm import _clamp_int  # noqa: E402


# ── _clamp_int（10x thesis 结构化数字字段容错） ──────────
def test_clamp_int_valid():
    assert _clamp_int(1, 1, 5, 3) == 1
    assert _clamp_int(5, 1, 5, 3) == 5


def test_clamp_int_below_range_returns_default():
    assert _clamp_int(0, 1, 5, 3) == 3


def test_clamp_int_above_range_returns_default():
    assert _clamp_int(10, 1, 5, 3) == 3


def test_clamp_int_string_digit_coerced():
    assert _clamp_int("4", 1, 5, 3) == 4


def test_clamp_int_string_garbage_returns_default():
    assert _clamp_int("not a number", 1, 5, 3) == 3


def test_clamp_int_none_returns_default():
    assert _clamp_int(None, 1, 5, 3) == 3


def test_clamp_int_float_truncated():
    # int(2.7) = 2，仍在范围内
    assert _clamp_int(2.7, 1, 5, 3) == 2
