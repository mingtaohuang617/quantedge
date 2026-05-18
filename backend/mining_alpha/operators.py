"""
mining_alpha.operators — Panel-data 算子库
======================================

约定:
  - 所有算子的输入/输出都是 pd.DataFrame，index=trade_date (升序)，columns=ts_code
  - 时序算子统一 min_periods=window，保证不前视
  - 横截面算子（RANK/SIGN）沿 axis=1 操作
  - 单 Series 输入（如 SEQUENCE）会广播到与目标 DataFrame 兼容的形状

参考国君研报《基于短周期价量特征的多因子选股体系》(2017.06) 的算子定义。
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view


# ── 横截面算子 ────────────────────────────────────────────────
def RANK(x: pd.DataFrame) -> pd.DataFrame:
    """横截面分位排名 (0-1)。每个交易日内部对所有股票排序，转 percentile。"""
    return x.rank(axis=1, pct=True, method="average")


def SIGN(x: pd.DataFrame) -> pd.DataFrame:
    """符号函数: 正→1, 负→-1, 零→0。"""
    return np.sign(x)


# ── 时序基础算子 ──────────────────────────────────────────────
def DELAY(x: pd.DataFrame, d: int) -> pd.DataFrame:
    """滞后 d 期。等价于 x.shift(d)。"""
    return x.shift(d)


def DELTA(x: pd.DataFrame, d: int) -> pd.DataFrame:
    """差分: x_t - x_{t-d}。"""
    return x.diff(d)


def SUM_(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期求和。命名加下划线避免与 Python 内置 sum 冲突。"""
    return x.rolling(window=n, min_periods=n).sum()


def MEAN(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期均值。等价于 MA(x, n)。"""
    return x.rolling(window=n, min_periods=n).mean()


def STD(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期标准差（样本标准差 ddof=1）。"""
    return x.rolling(window=n, min_periods=n).std()


def TSMAX(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期最大值。"""
    return x.rolling(window=n, min_periods=n).max()


def TSMIN(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期最小值。"""
    return x.rolling(window=n, min_periods=n).min()


def TSRANK(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """
    滚动 n 期时序排名：返回当前值在过去 n 期内的排名（1..n）。
    用 rolling.rank（pandas >= 1.4）一次性向量化。
    """
    return x.rolling(window=n, min_periods=n).rank(pct=False, ascending=True)


def HIGHDAY(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """
    最近 n 期内最大值距今天的天数。今天=0、最远=n-1。
    用于 Alpha133/177 等趋势位置类因子。
    """
    arr = x.to_numpy(dtype=float)
    T, N = arr.shape
    out = np.full_like(arr, np.nan, dtype=float)
    if T < n:
        return pd.DataFrame(out, index=x.index, columns=x.columns)
    # 滑动窗口: (T - n + 1, N, n)
    win = sliding_window_view(arr, window_shape=n, axis=0)
    # argmax 在 window 内，结果索引 0..n-1 (0=oldest)。转成"距今天数"= n - 1 - idx
    days_since_max = (n - 1) - np.argmax(win, axis=-1)
    out[n - 1:] = days_since_max
    return pd.DataFrame(out, index=x.index, columns=x.columns)


def LOWDAY(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """最近 n 期内最小值距今天的天数。今天=0、最远=n-1。"""
    arr = x.to_numpy(dtype=float)
    T, N = arr.shape
    out = np.full_like(arr, np.nan, dtype=float)
    if T < n:
        return pd.DataFrame(out, index=x.index, columns=x.columns)
    win = sliding_window_view(arr, window_shape=n, axis=0)
    days_since_min = (n - 1) - np.argmin(win, axis=-1)
    out[n - 1:] = days_since_min
    return pd.DataFrame(out, index=x.index, columns=x.columns)


def COUNT(cond: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期内 condition 为 True 的次数。cond 应该是 bool 或 0/1 DataFrame。"""
    return cond.astype(float).rolling(window=n, min_periods=n).sum()


def SUMIF(x: pd.DataFrame, n: int, cond: pd.DataFrame) -> pd.DataFrame:
    """滚动 n 期内、cond 为 True 时 x 的和；cond 为 False 处计 0。"""
    masked = x.where(cond, 0.0)
    return masked.rolling(window=n, min_periods=n).sum()


def PROD(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期乘积。"""
    return x.rolling(window=n, min_periods=n).apply(np.prod, raw=True)


def SUMAC(x: pd.DataFrame) -> pd.DataFrame:
    """累计求和（无窗口）。等价于 x.cumsum()。"""
    return x.cumsum()


# ── 平滑算子 ──────────────────────────────────────────────────
def SMA(x: pd.DataFrame, n: int, m: int = 1) -> pd.DataFrame:
    """
    Tushare 约定的加权移动平均: y_t = (m·x_t + (n-m)·y_{t-1}) / n
    等价于 EWMA(alpha = m/n, adjust=False)。
    初始值 y_0 = x_0（pandas ewm 默认）。
    """
    if n <= 0 or m <= 0 or m > n:
        raise ValueError(f"SMA 参数非法: n={n}, m={m}")
    alpha = m / n
    return x.ewm(alpha=alpha, adjust=False).mean()


def WMA(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """
    线性权重移动平均: 最新权重最大、最旧最小。
    weights = [1, 2, ..., n] / sum(1..n)，应用到 [x_{t-n+1}, ..., x_t]。
    """
    weights = np.arange(1, n + 1, dtype=float)
    weights = weights / weights.sum()
    arr = x.to_numpy(dtype=float)
    T, N = arr.shape
    out = np.full_like(arr, np.nan, dtype=float)
    if T < n:
        return pd.DataFrame(out, index=x.index, columns=x.columns)
    win = sliding_window_view(arr, window_shape=n, axis=0)  # (T-n+1, N, n)
    out[n - 1:] = np.einsum("tnw,w->tn", win, weights)
    return pd.DataFrame(out, index=x.index, columns=x.columns)


def DECAYLINEAR(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """线性衰减加权平均：与 WMA 同义。大窗口 (n ≥ 30) 走 Numba JIT 加速。"""
    try:
        from .operators_jit import decaylinear_jit_or_fallback
        jit_result = decaylinear_jit_or_fallback(x.to_numpy(dtype=float), n)
        if jit_result is not None:
            return pd.DataFrame(jit_result, index=x.index, columns=x.columns)
    except Exception:
        pass
    return WMA(x, n)


# ── 相关 / 协方差（按 ticker 沿时间滚动）──────────────────────
def _rolling_corr_cov(x: pd.DataFrame, y: pd.DataFrame, n: int, *, cov: bool) -> pd.DataFrame:
    """
    沿时间轴、按列做滚动 corr 或 cov。返回与 x 同形状的 DataFrame。

    用 numpy 一次性向量化：
      x_win, y_win shape = (T-n+1, N, n)
      mean_x, mean_y = win.mean(axis=-1)
      cov = ((x - mx)(y - my)).mean(axis=-1)   # 这里用 ddof=0 简化
      corr = cov / (std_x * std_y)
    """
    # 对齐 index/columns
    x_a, y_a = x.align(y, join="inner")
    arr_x = x_a.to_numpy(dtype=float)
    arr_y = y_a.to_numpy(dtype=float)
    T, N = arr_x.shape
    out = np.full((T, N), np.nan, dtype=float)
    if T < n:
        return pd.DataFrame(out, index=x_a.index, columns=x_a.columns)
    wx = sliding_window_view(arr_x, window_shape=n, axis=0)  # (T-n+1, N, n)
    wy = sliding_window_view(arr_y, window_shape=n, axis=0)
    mx = np.nanmean(wx, axis=-1, keepdims=True)
    my = np.nanmean(wy, axis=-1, keepdims=True)
    dx = wx - mx
    dy = wy - my
    cov_val = np.nanmean(dx * dy, axis=-1)  # (T-n+1, N)
    if cov:
        out[n - 1:] = cov_val
    else:
        std_x = np.sqrt(np.nanmean(dx * dx, axis=-1))
        std_y = np.sqrt(np.nanmean(dy * dy, axis=-1))
        denom = std_x * std_y
        # 避免除零
        with np.errstate(invalid="ignore", divide="ignore"):
            corr_val = np.where(denom > 1e-12, cov_val / denom, np.nan)
        out[n - 1:] = corr_val
    return pd.DataFrame(out, index=x_a.index, columns=x_a.columns)


def CORR(x: pd.DataFrame, y: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期相关系数（Pearson），按 ticker 沿时间。大窗口 (n ≥ 60) 走 JIT。"""
    if n >= 60:
        try:
            from .operators_jit import corr_jit_or_fallback
            x_a, y_a = x.align(y, join="inner")
            jit_result = corr_jit_or_fallback(x_a.to_numpy(dtype=float),
                                              y_a.to_numpy(dtype=float), n)
            if jit_result is not None:
                return pd.DataFrame(jit_result, index=x_a.index, columns=x_a.columns)
        except Exception:
            pass
    return _rolling_corr_cov(x, y, n, cov=False)


def COVIANCE(x: pd.DataFrame, y: pd.DataFrame, n: int) -> pd.DataFrame:
    """滚动 n 期协方差（保留论文里的 typo 'COVIANCE' 命名以方便对照公式）。"""
    return _rolling_corr_cov(x, y, n, cov=True)


# ── 回归 ──────────────────────────────────────────────────────
def SEQUENCE(n: int) -> np.ndarray:
    """生成 [1, 2, ..., n] 数组。用于 REGBETA(y, SEQUENCE(n))。"""
    return np.arange(1, n + 1, dtype=float)


def REGBETA(y: pd.DataFrame, x, n: int) -> pd.DataFrame:
    """
    滚动 n 期一元 OLS 斜率: slope = cov(x, y) / var(x)
    支持两种 x:
      - np.ndarray of shape (n,)        → 时间趋势（SEQUENCE(n)）
      - pd.DataFrame 同 y 形状           → 列对列回归

    返回与 y 同形状。
    """
    arr_y = y.to_numpy(dtype=float)
    T, N = arr_y.shape
    out = np.full_like(arr_y, np.nan, dtype=float)
    if T < n:
        return pd.DataFrame(out, index=y.index, columns=y.columns)
    wy = sliding_window_view(arr_y, window_shape=n, axis=0)  # (T-n+1, N, n)

    if isinstance(x, np.ndarray):
        # 时间趋势：x 是 1D 长度 n
        if x.shape != (n,):
            raise ValueError(f"SEQUENCE 长度需为 {n}，收到 {x.shape}")
        x_arr = x.astype(float)
        x_mean = x_arr.mean()
        x_dev = x_arr - x_mean              # (n,)
        x_var = (x_dev * x_dev).sum()       # 标量
        y_mean = wy.mean(axis=-1, keepdims=True)
        y_dev = wy - y_mean                 # (T-n+1, N, n)
        cov_xy = (y_dev * x_dev).sum(axis=-1)  # (T-n+1, N)
        with np.errstate(divide="ignore", invalid="ignore"):
            slope = np.where(x_var > 1e-12, cov_xy / x_var, np.nan)
        out[n - 1:] = slope
    elif isinstance(x, pd.DataFrame):
        x_aligned, y_aligned = x.align(y, join="inner")
        arr_x = x_aligned.to_numpy(dtype=float)
        arr_y = y_aligned.to_numpy(dtype=float)
        T2, N2 = arr_x.shape
        out = np.full_like(arr_y, np.nan, dtype=float)
        if T2 < n:
            return pd.DataFrame(out, index=x_aligned.index, columns=x_aligned.columns)
        wx = sliding_window_view(arr_x, window_shape=n, axis=0)
        wy = sliding_window_view(arr_y, window_shape=n, axis=0)
        mx = np.nanmean(wx, axis=-1, keepdims=True)
        my = np.nanmean(wy, axis=-1, keepdims=True)
        dx = wx - mx
        dy = wy - my
        cov = np.nansum(dx * dy, axis=-1)
        var = np.nansum(dx * dx, axis=-1)
        with np.errstate(divide="ignore", invalid="ignore"):
            slope = np.where(var > 1e-12, cov / var, np.nan)
        out[n - 1:] = slope
        return pd.DataFrame(out, index=y_aligned.index, columns=y_aligned.columns)
    else:
        raise TypeError(f"REGBETA 不支持的 x 类型: {type(x)}")

    return pd.DataFrame(out, index=y.index, columns=y.columns)


# ── 元素级算子 ────────────────────────────────────────────────
def ABS(x: pd.DataFrame) -> pd.DataFrame:
    """元素级绝对值。"""
    return x.abs()


def LOG(x: pd.DataFrame) -> pd.DataFrame:
    """自然对数。非正值返回 NaN（避免 -inf）。"""
    arr = x.to_numpy(dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(arr > 0, np.log(arr), np.nan)
    return pd.DataFrame(out, index=x.index, columns=x.columns)


def MAX(a, b):
    """元素级最大值。两个标量/DataFrame 均支持，结果保留 DataFrame 的 index/columns。"""
    if isinstance(a, pd.DataFrame) or isinstance(b, pd.DataFrame):
        ref = a if isinstance(a, pd.DataFrame) else b
        a_arr = a.to_numpy() if isinstance(a, pd.DataFrame) else a
        b_arr = b.to_numpy() if isinstance(b, pd.DataFrame) else b
        return pd.DataFrame(np.maximum(a_arr, b_arr), index=ref.index, columns=ref.columns)
    return np.maximum(a, b)


def MIN(a, b):
    """元素级最小值。"""
    if isinstance(a, pd.DataFrame) or isinstance(b, pd.DataFrame):
        ref = a if isinstance(a, pd.DataFrame) else b
        a_arr = a.to_numpy() if isinstance(a, pd.DataFrame) else a
        b_arr = b.to_numpy() if isinstance(b, pd.DataFrame) else b
        return pd.DataFrame(np.minimum(a_arr, b_arr), index=ref.index, columns=ref.columns)
    return np.minimum(a, b)


def IF(cond, x, y):
    """
    三元表达式 cond ? x : y 的向量化版本。
    cond 必须是 DataFrame (bool 或 0/1)；x / y 可以是标量或同形状 DataFrame。
    """
    if not isinstance(cond, pd.DataFrame):
        return x if cond else y
    cond_arr = cond.to_numpy(dtype=bool)
    x_arr = x.to_numpy() if isinstance(x, pd.DataFrame) else x
    y_arr = y.to_numpy() if isinstance(y, pd.DataFrame) else y
    out = np.where(cond_arr, x_arr, y_arr)
    return pd.DataFrame(out, index=cond.index, columns=cond.columns)
