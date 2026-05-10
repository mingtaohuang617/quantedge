"""factors_lib.core 纯函数测试 — directional_score / to_percentile / to_percentile_series.

这是 L3/L4 计算的基础。用了一个意外的方向定义 / 分位算法都会让所有因子分歪。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from factors_lib.core import (  # noqa: E402
    directional_score,
    to_percentile,
    to_percentile_series,
)


# ── directional_score ──────────────────────────────────
def test_directional_score_none_returns_none():
    assert directional_score(None, "higher_bullish") is None
    assert directional_score(None, "lower_bullish", contrarian_at_extremes=True) is None


def test_directional_score_higher_bullish_passthrough():
    """higher_bullish 直接返回 percentile."""
    assert directional_score(75, "higher_bullish") == 75.0
    assert directional_score(20, "higher_bullish") == 20.0


def test_directional_score_lower_bullish_inverted():
    """lower_bullish: 高 percentile → 低分."""
    assert directional_score(20, "lower_bullish") == 80.0
    assert directional_score(80, "lower_bullish") == 20.0
    assert directional_score(50, "lower_bullish") == 50.0


def test_directional_score_neutral_passthrough():
    assert directional_score(60, "neutral") == 60.0


def test_directional_score_contrarian_extremes_low():
    """contrarian: pct < 10 (panic 区) → 翻转 lower_bullish 的解读."""
    # lower_bullish + pct=5 → base=95，但 5 < 10 → 100-95 = 5 (反向)
    assert directional_score(5, "lower_bullish", contrarian_at_extremes=True) == 5.0


def test_directional_score_contrarian_extremes_high():
    """contrarian: pct > 90 (complacency 区) → 翻转."""
    # lower_bullish + pct=95 → base=5，95 > 90 → 100-5 = 95
    assert directional_score(95, "lower_bullish", contrarian_at_extremes=True) == 95.0


def test_directional_score_contrarian_middle_unchanged():
    """contrarian: 10 ≤ pct ≤ 90 不翻转."""
    # lower_bullish + pct=50 → 50；不进入 extreme → 还是 50
    assert directional_score(50, "lower_bullish", contrarian_at_extremes=True) == 50.0
    # lower_bullish + pct=80 → 20；不进入 extreme → 还是 20
    assert directional_score(80, "lower_bullish", contrarian_at_extremes=True) == 20.0


# ── to_percentile ──────────────────────────────────────
def test_to_percentile_empty_or_none():
    assert to_percentile(pd.Series(dtype=float)) is None
    assert to_percentile(None) is None


def test_to_percentile_insufficient_samples():
    s = pd.Series([1, 2, 3], dtype=float)
    # min_periods 默认 252
    assert to_percentile(s) is None


def test_to_percentile_minimum_with_min_periods():
    """传入 min_periods=3 + 3 个样本，最大值应在 ~83 percentile（含 +0.5/+0.5n 边界平滑）."""
    s = pd.Series([1.0, 2.0, 3.0])
    p = to_percentile(s, min_periods=3)
    # last=3, n=3, rank=(2 + 0.5*1 + 0.5)/3*100 = 100% ... 实际是 (2+0.5+0.5)/3=1.0=100
    assert p == 100.0


def test_to_percentile_middle_value():
    """中值 — 一半上一半下."""
    s = pd.Series(list(range(1, 11)), dtype=float)  # 1..10
    # last=10, n=10, rank=(9+0.5*1+0.5)/10*100 = 100
    assert to_percentile(s, min_periods=10) == 100.0
    # 用 [1..10, 5] last=5, n=11
    s2 = pd.Series(list(range(1, 11)) + [5], dtype=float)
    p = to_percentile(s2, min_periods=11)
    # last=5, less than 5 = {1,2,3,4} = 4, equal=2, rank=(4+1+0.5)/11*100=50%
    assert abs(p - 50.0) < 1.0


def test_to_percentile_window_truncation():
    """window 参数限制只取最后 N 个样本."""
    s = pd.Series(list(range(1, 100)), dtype=float)
    # window=10 + min_periods=10 → 只看 [90..99]，last=99 是最大值
    p = to_percentile(s, window=10, min_periods=10)
    assert p == 100.0


def test_to_percentile_window_too_short():
    """window > 长度，但样本数仍 < min_periods → None."""
    s = pd.Series([1, 2, 3], dtype=float)
    assert to_percentile(s, window=10, min_periods=5) is None


# ── to_percentile_series ──────────────────────────────
def test_to_percentile_series_empty():
    out = to_percentile_series(pd.Series(dtype=float))
    assert out.empty


def test_to_percentile_series_insufficient_samples():
    out = to_percentile_series(pd.Series([1, 2, 3], dtype=float), min_periods=10)
    assert out.empty


def test_to_percentile_series_basic_expanding():
    """全样本 expanding rank — 单调上升序列 → percentile 都接近 100."""
    s = pd.Series(list(range(1, 11)), dtype=float)
    out = to_percentile_series(s, window=None, min_periods=3)
    # 第 1 个 NaN（少于 min_periods）— 实际看 pandas behavior：expanding 在达到 min_periods
    # 后开始返回值。out.dropna() 后最后一个应是 100
    valid = out.dropna()
    assert len(valid) > 0
    assert valid.iloc[-1] == 100.0


def test_to_percentile_series_window_limits_history():
    """rolling window=5 → 只看最近 5 个值；单调上升时窗末在窗内最高."""
    s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
    out = to_percentile_series(s, window=5, min_periods=5)
    valid = out.dropna()
    # 倒数第 1 个：window=[6,7,8,9,10]，10 是最大 → pandas rank pct=True 给 1.0=100%
    assert valid.iloc[-1] == 100.0
    # 倒数第 5 个 (idx=5)：window=[2,3,4,5,6]，last=6 是最大 → 100%
    assert valid.iloc[-5] == 100.0


def test_to_percentile_series_window_all_equal():
    """全相等的窗口 — pandas rank pct=True 用平均秩 (3/5=60%)."""
    s = pd.Series([1.0] * 10)
    out = to_percentile_series(s, window=5, min_periods=5)
    valid = out.dropna()
    # 全等：平均秩 = (1+2+3+4+5)/5/5 = 3/5 = 0.6
    assert valid.iloc[-1] == 60.0


def test_to_percentile_consistency_with_series():
    """to_percentile(s).iloc[-1] should match to_percentile_series(s).iloc[-1] within 边界平滑差异."""
    s = pd.Series(np.linspace(1, 100, 100), dtype=float)
    p = to_percentile(s, window=None, min_periods=10)
    series_p = to_percentile_series(s, window=None, min_periods=10).iloc[-1]
    # 两者算法不同：to_percentile 用 +0.5 边界平滑，series 用 pandas pct=True
    # 但末值在单调序列中应都接近 100
    assert p > 95
    assert series_p > 95
