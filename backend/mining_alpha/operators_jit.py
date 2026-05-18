"""
mining_alpha.operators_jit — Numba JIT 加速版关键算子
====================================================

仅加速大窗口 (n >= 60) 的算子，因为小窗口 numpy 已经够快。
落地策略：在 operators.py 里检测窗口大小，超过阈值才走 JIT 版本。

依赖: numba (作为 catboost 间接依赖已装上)。

加速对象:
  - CORR (column-wise rolling Pearson)
  - DECAYLINEAR (linear-weighted moving average)

不加速:
  - SMA/EWMA (pandas.ewm 已经是 C 实现，足够快)
  - 横截面 RANK (cross-sectional 操作，沿 axis=1，pandas 已经够快)
"""
from __future__ import annotations

import numpy as np

try:
    from numba import njit, prange
    HAS_NUMBA = True
except ImportError:
    HAS_NUMBA = False

    def njit(*args, **kwargs):  # noqa: D401
        """no-op fallback"""
        if len(args) == 1 and callable(args[0]):
            return args[0]
        def deco(fn):
            return fn
        return deco

    def prange(*args, **kwargs):
        return range(*args, **kwargs)


@njit(cache=True, parallel=True)
def _corr_jit(x: np.ndarray, y: np.ndarray, n: int) -> np.ndarray:
    """
    并行计算 column-wise rolling Pearson correlation.

    x, y: shape (T, N) float64
    返回 shape (T, N)，前 n-1 行为 NaN。
    """
    T, N = x.shape
    out = np.full((T, N), np.nan, dtype=np.float64)
    if T < n:
        return out

    for col in prange(N):
        for t in range(n - 1, T):
            sx = 0.0; sy = 0.0
            for k in range(n):
                sx += x[t - n + 1 + k, col]
                sy += y[t - n + 1 + k, col]
            mx = sx / n
            my = sy / n
            cov = 0.0; vx = 0.0; vy = 0.0
            for k in range(n):
                dx = x[t - n + 1 + k, col] - mx
                dy = y[t - n + 1 + k, col] - my
                cov += dx * dy
                vx += dx * dx
                vy += dy * dy
            denom = np.sqrt(vx * vy)
            if denom > 1e-12:
                out[t, col] = cov / denom
    return out


@njit(cache=True, parallel=True)
def _decaylinear_jit(x: np.ndarray, n: int) -> np.ndarray:
    """
    线性衰减加权移动平均 (DECAYLINEAR / WMA)。
    weights = [1, 2, ..., n] / sum，最近权重最大。
    """
    T, N = x.shape
    out = np.full((T, N), np.nan, dtype=np.float64)
    if T < n:
        return out

    weight_sum = n * (n + 1) / 2.0
    for col in prange(N):
        for t in range(n - 1, T):
            acc = 0.0
            for k in range(n):
                w = (k + 1) / weight_sum
                acc += w * x[t - n + 1 + k, col]
            out[t, col] = acc
    return out


def corr_jit_or_fallback(x_arr: np.ndarray, y_arr: np.ndarray, n: int) -> np.ndarray:
    """供 operators.py 的 CORR 调用。numba 不可用时 fallback 走 numpy 实现。"""
    if HAS_NUMBA and n >= 60:
        # 大窗口走 JIT
        return _corr_jit(x_arr.astype(np.float64), y_arr.astype(np.float64), n)
    # 小窗口/没装 numba，让 caller 走原 numpy 实现
    return None


def decaylinear_jit_or_fallback(x_arr: np.ndarray, n: int) -> np.ndarray:
    """供 operators.py 的 DECAYLINEAR 调用。"""
    if HAS_NUMBA and n >= 30:
        return _decaylinear_jit(x_arr.astype(np.float64), n)
    return None
