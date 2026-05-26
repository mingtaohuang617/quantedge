"""mining_alpha.operators 单元测试 — 25 个算子的数值正确性。"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from mining_alpha.operators import (  # noqa: E402
    ABS,
    CORR,
    COUNT,
    COVIANCE,
    DECAYLINEAR,
    DELAY,
    DELTA,
    HIGHDAY,
    IF,
    LOG,
    LOWDAY,
    MAX,
    MEAN,
    MIN,
    PROD,
    RANK,
    REGBETA,
    SEQUENCE,
    SIGN,
    SMA,
    STD,
    SUM_,
    SUMAC,
    SUMIF,
    TSMAX,
    TSMIN,
    TSRANK,
    WMA,
)

# ── 测试 fixtures ────────────────────────────────────────────


@pytest.fixture
def panel_5x4():
    """5 天 × 4 票，便于手算。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    tickers = ["A", "B", "C", "D"]
    data = np.array([
        [1.0, 2.0, 3.0, 4.0],
        [2.0, 3.0, 4.0, 5.0],
        [3.0, 4.0, 5.0, 6.0],
        [4.0, 5.0, 6.0, 7.0],
        [5.0, 6.0, 7.0, 8.0],
    ])
    return pd.DataFrame(data, index=dates, columns=tickers)


@pytest.fixture
def panel_with_neg():
    """含负值，用于 SIGN / ABS / LOG 测试。"""
    dates = pd.date_range("2024-01-01", periods=3, freq="D")
    return pd.DataFrame(
        [[-2.0, -1.0, 0.0, 1.0],
         [-1.0, 0.0, 1.0, 2.0],
         [0.0, 1.0, 2.0, 3.0]],
        index=dates,
        columns=["A", "B", "C", "D"],
    )


# ── 横截面算子 ────────────────────────────────────────────────


def test_rank_basic():
    """RANK 应该返回 0-1 的横截面分位。"""
    df = pd.DataFrame([[10, 20, 30, 40]], index=[0], columns=list("ABCD"))
    r = RANK(df)
    # pandas pct=True: rank/N, 此处 N=4
    np.testing.assert_allclose(r.iloc[0].values, [0.25, 0.50, 0.75, 1.00])


def test_rank_with_ties():
    """有并列值时 method='average' 给平均排名。"""
    df = pd.DataFrame([[10, 10, 30, 40]], index=[0], columns=list("ABCD"))
    r = RANK(df)
    # A=B 并列 1-2 → avg rank 1.5 → 1.5/4 = 0.375
    np.testing.assert_allclose(r.iloc[0].values, [0.375, 0.375, 0.75, 1.00])


def test_sign(panel_with_neg):
    """SIGN(-2)=-1, SIGN(0)=0, SIGN(2)=1。"""
    r = SIGN(panel_with_neg)
    expected = np.array([
        [-1, -1, 0, 1],
        [-1, 0, 1, 1],
        [0, 1, 1, 1],
    ])
    np.testing.assert_array_equal(r.values, expected)


# ── 时序基础算子 ──────────────────────────────────────────────


def test_delay(panel_5x4):
    """DELAY(x, 2) 把每个 ts 下移 2 行。"""
    r = DELAY(panel_5x4, 2)
    assert r.iloc[0].isna().all()
    assert r.iloc[1].isna().all()
    np.testing.assert_array_equal(r.iloc[2].values, [1.0, 2.0, 3.0, 4.0])
    np.testing.assert_array_equal(r.iloc[4].values, [3.0, 4.0, 5.0, 6.0])


def test_delta(panel_5x4):
    """DELTA(x, 1) = x_t - x_{t-1}; 此 panel 每天每股都 +1，所以 DELTA=1。"""
    r = DELTA(panel_5x4, 1)
    assert r.iloc[0].isna().all()
    np.testing.assert_array_equal(r.iloc[1:].values, np.ones((4, 4)))


def test_sum_(panel_5x4):
    """SUM_(x, 3) 滚动求和。最后一行 = [3+4+5, 4+5+6, 5+6+7, 6+7+8] = [12,15,18,21]。"""
    r = SUM_(panel_5x4, 3)
    assert r.iloc[0].isna().all()
    assert r.iloc[1].isna().all()
    np.testing.assert_array_equal(r.iloc[2].values, [6.0, 9.0, 12.0, 15.0])
    np.testing.assert_array_equal(r.iloc[4].values, [12.0, 15.0, 18.0, 21.0])


def test_mean(panel_5x4):
    """MEAN(x, 3) 滚动均值。最后一行 = [4,5,6,7]。"""
    r = MEAN(panel_5x4, 3)
    np.testing.assert_allclose(r.iloc[4].values, [4.0, 5.0, 6.0, 7.0])


def test_std(panel_5x4):
    """STD(x, 3) 滚动样本标准差; [3,4,5] 的样本 std = 1.0。"""
    r = STD(panel_5x4, 3)
    np.testing.assert_allclose(r.iloc[4].values, [1.0, 1.0, 1.0, 1.0])


def test_tsmax_tsmin(panel_5x4):
    """TSMAX/TSMIN 滚动 max/min。"""
    rmax = TSMAX(panel_5x4, 3)
    rmin = TSMIN(panel_5x4, 3)
    np.testing.assert_allclose(rmax.iloc[4].values, [5.0, 6.0, 7.0, 8.0])
    np.testing.assert_allclose(rmin.iloc[4].values, [3.0, 4.0, 5.0, 6.0])


def test_tsrank(panel_5x4):
    """TSRANK：每个 ts 单调递增，最后一个永远是窗口里最大 → rank=n。"""
    r = TSRANK(panel_5x4, 3)
    np.testing.assert_allclose(r.iloc[4].values, [3, 3, 3, 3])


def test_highday():
    """HIGHDAY: max 位置离 t 的天数。"""
    # 列 0: [1,2,3,4,5] 严格递增，max 在最后 → HIGHDAY=0
    # 列 1: [5,4,3,2,1] 严格递减，max 在最远 → HIGHDAY=4
    # 列 2: [1,5,2,3,4] max=5 在 idx=1 (倒数第 4 天) → HIGHDAY=3
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    df = pd.DataFrame(
        [[1, 5, 1], [2, 4, 5], [3, 3, 2], [4, 2, 3], [5, 1, 4]],
        index=dates, columns=["A", "B", "C"],
    )
    r = HIGHDAY(df, 5)
    np.testing.assert_array_equal(r.iloc[4].values, [0, 4, 3])


def test_lowday():
    """LOWDAY: min 位置离 t 的天数。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    df = pd.DataFrame(
        [[1, 5, 1], [2, 4, 5], [3, 3, 2], [4, 2, 3], [5, 1, 4]],
        index=dates, columns=["A", "B", "C"],
    )
    r = LOWDAY(df, 5)
    # 列 0: min=1 在 idx=0 → LOWDAY=4
    # 列 1: min=1 在最后 → LOWDAY=0
    # 列 2: min=1 在 idx=0 → LOWDAY=4
    np.testing.assert_array_equal(r.iloc[4].values, [4, 0, 4])


def test_count():
    """COUNT(cond, n) 数 True 出现次数。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    cond = pd.DataFrame(
        [[True, False], [True, True], [False, True], [True, False], [True, True]],
        index=dates, columns=["A", "B"],
    )
    r = COUNT(cond, 3)
    # 最后 3 行 A: [F,T,T] = 2; B: [T,F,T] = 2
    np.testing.assert_array_equal(r.iloc[4].values, [2, 2])


def test_sumif():
    """SUMIF: 在窗口内、cond 为 True 处求和。"""
    dates = pd.date_range("2024-01-01", periods=3, freq="D")
    x = pd.DataFrame([[10, 10], [20, 20], [30, 30]], index=dates, columns=["A", "B"])
    cond = pd.DataFrame([[True, False], [False, True], [True, True]], index=dates, columns=["A", "B"])
    r = SUMIF(x, 3, cond)
    # A: 10+0+30=40; B: 0+20+30=50
    np.testing.assert_array_equal(r.iloc[2].values, [40, 50])


def test_prod():
    """PROD(x, n) 滚动乘积。"""
    dates = pd.date_range("2024-01-01", periods=4, freq="D")
    df = pd.DataFrame(
        [[1, 2], [2, 2], [3, 2], [4, 2]],
        index=dates, columns=["A", "B"],
    )
    r = PROD(df, 3)
    # A 最后: 2*3*4=24; B: 2*2*2=8
    np.testing.assert_allclose(r.iloc[3].values, [24, 8])


def test_sumac():
    """SUMAC 累计求和。"""
    dates = pd.date_range("2024-01-01", periods=4, freq="D")
    df = pd.DataFrame([[1, 1], [2, 2], [3, 3], [4, 4]], index=dates, columns=["A", "B"])
    r = SUMAC(df)
    np.testing.assert_allclose(r.iloc[3].values, [10, 10])  # 1+2+3+4
    np.testing.assert_allclose(r.iloc[1].values, [3, 3])    # 1+2


# ── 平滑算子 ──────────────────────────────────────────────────


def test_sma_n2_m1():
    """SMA(x, 2, 1)：EWMA alpha=0.5；y[t]=(1·x[t]+1·y[t-1])/2。"""
    dates = pd.date_range("2024-01-01", periods=4, freq="D")
    df = pd.DataFrame([[2.0], [4.0], [8.0], [16.0]], index=dates, columns=["A"])
    r = SMA(df, n=2, m=1)
    # y0=2
    # y1=(1*4+1*2)/2 = 3
    # y2=(1*8+1*3)/2 = 5.5
    # y3=(1*16+1*5.5)/2 = 10.75
    np.testing.assert_allclose(r["A"].values, [2.0, 3.0, 5.5, 10.75])


def test_sma_n3_m2():
    """SMA(x, 3, 2)：alpha=2/3。y[t]=(2·x[t]+1·y[t-1])/3。"""
    dates = pd.date_range("2024-01-01", periods=3, freq="D")
    df = pd.DataFrame([[3.0], [6.0], [9.0]], index=dates, columns=["A"])
    r = SMA(df, n=3, m=2)
    # y0=3
    # y1=(2*6+1*3)/3 = 15/3 = 5
    # y2=(2*9+1*5)/3 = 23/3 ≈ 7.6667
    np.testing.assert_allclose(r["A"].values, [3.0, 5.0, 23 / 3])


def test_wma_n3():
    """WMA(x, 3)：权重 [1,2,3]/6；窗口 [a,b,c] → (a+2b+3c)/6。"""
    dates = pd.date_range("2024-01-01", periods=4, freq="D")
    df = pd.DataFrame([[1.0], [2.0], [3.0], [4.0]], index=dates, columns=["A"])
    r = WMA(df, 3)
    # idx=2: (1+2*2+3*3)/6 = (1+4+9)/6 = 14/6
    # idx=3: (2+2*3+3*4)/6 = (2+6+12)/6 = 20/6
    assert pd.isna(r.iloc[0, 0])
    assert pd.isna(r.iloc[1, 0])
    np.testing.assert_allclose(r.iloc[2, 0], 14 / 6)
    np.testing.assert_allclose(r.iloc[3, 0], 20 / 6)


def test_decaylinear_eq_wma():
    """DECAYLINEAR 与 WMA 等价。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    df = pd.DataFrame(np.random.RandomState(42).randn(5, 3), index=dates, columns=list("ABC"))
    a = WMA(df, 3)
    b = DECAYLINEAR(df, 3)
    pd.testing.assert_frame_equal(a, b)


# ── 相关 / 协方差 ─────────────────────────────────────────────


def test_corr_perfect_pos():
    """两个完全正相关序列，CORR=1。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    x = pd.DataFrame([[1.0], [2.0], [3.0], [4.0], [5.0]], index=dates, columns=["A"])
    y = pd.DataFrame([[2.0], [4.0], [6.0], [8.0], [10.0]], index=dates, columns=["A"])
    r = CORR(x, y, 5)
    np.testing.assert_allclose(r.iloc[4, 0], 1.0, atol=1e-10)


def test_corr_perfect_neg():
    """完全负相关，CORR=-1。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    x = pd.DataFrame([[1.0], [2.0], [3.0], [4.0], [5.0]], index=dates, columns=["A"])
    y = pd.DataFrame([[5.0], [4.0], [3.0], [2.0], [1.0]], index=dates, columns=["A"])
    r = CORR(x, y, 5)
    np.testing.assert_allclose(r.iloc[4, 0], -1.0, atol=1e-10)


def test_coviance():
    """COVIANCE 用 ddof=0 (总体)；x=[1..5], y=[2,4,6,8,10] → cov = mean((x-mx)(y-my))。
    mx=3, my=6; (x-mx)=[-2,-1,0,1,2]; (y-my)=[-4,-2,0,2,4]; product=[8,2,0,2,8] mean=4。
    """
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    x = pd.DataFrame([[1.0], [2.0], [3.0], [4.0], [5.0]], index=dates, columns=["A"])
    y = pd.DataFrame([[2.0], [4.0], [6.0], [8.0], [10.0]], index=dates, columns=["A"])
    r = COVIANCE(x, y, 5)
    np.testing.assert_allclose(r.iloc[4, 0], 4.0, atol=1e-10)


# ── 回归 ──────────────────────────────────────────────────────


def test_sequence():
    """SEQUENCE(5) = [1,2,3,4,5]。"""
    s = SEQUENCE(5)
    np.testing.assert_array_equal(s, [1, 2, 3, 4, 5])


def test_regbeta_trend():
    """REGBETA(y, SEQUENCE(n)) 是时间趋势斜率。y=2*t+1 → slope=2。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    # y = [3, 5, 7, 9, 11] = 2*t + 1 (t=1..5)
    y = pd.DataFrame([[3.0], [5.0], [7.0], [9.0], [11.0]], index=dates, columns=["A"])
    r = REGBETA(y, SEQUENCE(5), 5)
    np.testing.assert_allclose(r.iloc[4, 0], 2.0, atol=1e-10)


def test_regbeta_negative_trend():
    """y=-3*t+10 → slope=-3。"""
    dates = pd.date_range("2024-01-01", periods=5, freq="D")
    # t=1..5: y = [7, 4, 1, -2, -5]
    y = pd.DataFrame([[7.0], [4.0], [1.0], [-2.0], [-5.0]], index=dates, columns=["A"])
    r = REGBETA(y, SEQUENCE(5), 5)
    np.testing.assert_allclose(r.iloc[4, 0], -3.0, atol=1e-10)


# ── 元素级算子 ────────────────────────────────────────────────


def test_abs(panel_with_neg):
    r = ABS(panel_with_neg)
    expected = np.array([[2, 1, 0, 1], [1, 0, 1, 2], [0, 1, 2, 3]], dtype=float)
    np.testing.assert_array_equal(r.values, expected)


def test_log():
    """LOG: 正数取 ln，非正数返回 NaN。"""
    dates = pd.date_range("2024-01-01", periods=2, freq="D")
    df = pd.DataFrame([[1.0, np.e, 0.0, -1.0]], index=dates[:1], columns=list("ABCD"))
    r = LOG(df)
    np.testing.assert_allclose(r.iloc[0].values[:2], [0.0, 1.0], atol=1e-10)
    assert pd.isna(r.iloc[0, 2])  # log(0) → NaN
    assert pd.isna(r.iloc[0, 3])  # log(-1) → NaN


def test_max_df_df():
    a = pd.DataFrame([[1, 5], [3, 2]], columns=["A", "B"])
    b = pd.DataFrame([[2, 4], [3, 7]], columns=["A", "B"])
    r = MAX(a, b)
    np.testing.assert_array_equal(r.values, [[2, 5], [3, 7]])


def test_max_df_scalar():
    a = pd.DataFrame([[1, 5], [3, 2]], columns=["A", "B"])
    r = MAX(a, 3)
    np.testing.assert_array_equal(r.values, [[3, 5], [3, 3]])


def test_min_df_df():
    a = pd.DataFrame([[1, 5], [3, 2]], columns=["A", "B"])
    b = pd.DataFrame([[2, 4], [3, 7]], columns=["A", "B"])
    r = MIN(a, b)
    np.testing.assert_array_equal(r.values, [[1, 4], [3, 2]])


def test_if_basic():
    """IF(cond, x, y): cond True 用 x，False 用 y。"""
    cond = pd.DataFrame([[True, False], [False, True]], columns=["A", "B"])
    x = pd.DataFrame([[1, 2], [3, 4]], columns=["A", "B"])
    y = pd.DataFrame([[10, 20], [30, 40]], columns=["A", "B"])
    r = IF(cond, x, y)
    np.testing.assert_array_equal(r.values, [[1, 20], [30, 4]])


def test_if_scalar_branches():
    """IF(cond, scalar, scalar) 也工作。"""
    cond = pd.DataFrame([[True, False], [False, True]], columns=["A", "B"])
    r = IF(cond, 1, -1)
    np.testing.assert_array_equal(r.values, [[1, -1], [-1, 1]])


# ── 无前视性验证 ──────────────────────────────────────────────


def test_no_lookahead_rolling_ops():
    """所有滚动算子在 t 日的输出不能依赖 t+1 之后的数据。"""
    rng = np.random.RandomState(0)
    full = pd.DataFrame(rng.randn(20, 3), columns=list("ABC"),
                        index=pd.date_range("2024-01-01", periods=20))
    truncated = full.iloc[:15]

    for op, _ in [
        (lambda x: SUM_(x, 5), {}),
        (lambda x: MEAN(x, 5), {}),
        (lambda x: STD(x, 5), {}),
        (lambda x: TSMAX(x, 5), {}),
        (lambda x: TSMIN(x, 5), {}),
        (lambda x: TSRANK(x, 5), {}),
        (lambda x: DELTA(x, 3), {}),
        (lambda x: WMA(x, 5), {}),
    ]:
        a = op(full).iloc[:15]
        b = op(truncated)
        pd.testing.assert_frame_equal(a, b, check_dtype=False, atol=1e-10)


def test_no_lookahead_sma():
    """SMA 是 EWMA，无前视。"""
    rng = np.random.RandomState(1)
    full = pd.DataFrame(rng.randn(20, 3), columns=list("ABC"),
                        index=pd.date_range("2024-01-01", periods=20))
    truncated = full.iloc[:15]
    a = SMA(full, n=5, m=2).iloc[:15]
    b = SMA(truncated, n=5, m=2)
    pd.testing.assert_frame_equal(a, b, check_dtype=False, atol=1e-10)


def test_no_lookahead_corr():
    """CORR 无前视。"""
    rng = np.random.RandomState(2)
    x_full = pd.DataFrame(rng.randn(20, 3), columns=list("ABC"),
                          index=pd.date_range("2024-01-01", periods=20))
    y_full = pd.DataFrame(rng.randn(20, 3), columns=list("ABC"),
                          index=pd.date_range("2024-01-01", periods=20))
    a = CORR(x_full, y_full, 5).iloc[:15]
    b = CORR(x_full.iloc[:15], y_full.iloc[:15], 5)
    pd.testing.assert_frame_equal(a, b, check_dtype=False, atol=1e-10)
