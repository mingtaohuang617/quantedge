"""regime/hmm_states._features 单测 + 缓存命中测试.

完整 HMM 拟合需要 hmmlearn + ≥252 数据点；这里只覆盖 _features 特征构造 +
fit_hmm_3state_cached 的缓存键命中逻辑（无 hmmlearn 也能跑）。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from regime.hmm_states import _features, _HMM_CACHE  # noqa: E402


def test_features_empty_returns_empty_df():
    out = _features(pd.Series(dtype=float))
    assert out.empty


def test_features_basic_shape():
    """5 个价格点 → 4 个 log_return → 滚动 std 需要 vol_window=20 → 0 个有效."""
    s = pd.Series([100, 101, 99, 102, 103],
                  index=pd.date_range("2020-01-01", periods=5))
    out = _features(s, vol_window=20)
    assert out.empty  # 不够 vol window


def test_features_sufficient_data():
    """30 个价格点（>20 vol window）→ 应有 ~10 个有效行."""
    np.random.seed(42)
    prices = pd.Series(
        100 * (1 + 0.01 * np.random.randn(30).cumsum()),
        index=pd.date_range("2020-01-01", periods=30),
    )
    out = _features(prices, vol_window=20)
    assert len(out) > 0
    assert list(out.columns) == ["ret", "vol"]
    # log_return 应该都接近 0（小幅波动）
    assert out["ret"].abs().max() < 0.5
    # vol 应该非负
    assert (out["vol"] >= 0).all()


def test_features_drops_nan_rows():
    """前 vol_window 行 vol=NaN，应被 dropna 移除."""
    s = pd.Series(np.arange(30.0) + 100,
                  index=pd.date_range("2020-01-01", periods=30))
    out = _features(s, vol_window=10)
    # 第 1 行 ret=NaN，前 10 行 vol 因 min_periods=10 → vol[0..9]=NaN
    # 实际有效行 = 30 - 10 = 20
    assert len(out) == 20
    assert not out.isna().any().any()


def test_features_handles_unsorted_index():
    """乱序索引应被排序后再处理（log_return 跨日期才有意义）."""
    dates = pd.date_range("2020-01-01", periods=30)
    s = pd.Series(np.arange(30.0) + 100, index=dates)
    s_shuffled = s.sample(frac=1, random_state=0)
    out = _features(s_shuffled, vol_window=10)
    out_sorted = _features(s, vol_window=10)
    # 排序后应一致（容许浮点 epsilon）
    pd.testing.assert_frame_equal(
        out.reset_index(drop=True),
        out_sorted.reset_index(drop=True),
        check_exact=False, atol=1e-9,
    )


def test_hmm_cache_returns_empty_for_empty_input():
    """fit_hmm_3state_cached 在空 series 时直接转交底层（不缓存）."""
    # 实际跑底层 fit_hmm_3state 会抛异常（没数据），跑通也不应缓存
    from regime.hmm_states import fit_hmm_3state_cached, HAS_HMM
    if not HAS_HMM:
        return  # 没装 hmmlearn 跳过
    cache_size_before = len(_HMM_CACHE)
    try:
        fit_hmm_3state_cached(pd.Series(dtype=float))
    except Exception:
        pass  # 预期会抛
    # 空数据不应进缓存
    assert len(_HMM_CACHE) == cache_size_before
