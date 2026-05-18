"""
mining_alpha.alpha101_factors — WorldQuant 101 Alphas（精选 30 个）
===================================================================

来源: Kakushadze 2016 "101 Formulaic Alphas" (arXiv 1601.00991)。

挑选标准:
  - 公式清晰、与 Alpha191 重合度低
  - 不依赖外部 SECTOR/INDUSTRY（IndNeutralize 系列暂跳过）
  - 短/中周期为主（与 Alpha191 短周期偏向一致）

注册到独立的 _ALPHA101_REGISTRY，使用方式:
  from mining_alpha.alpha101_factors import list_alpha101, compute_alpha101

CLI / 主流程暂未集成；用户可在 Python 中按需调用。
未来如要并入主 train/backtest，把 _ALPHA101_REGISTRY 合并到 _ALPHA_REGISTRY 即可。
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from .operators import (
    ABS,
    CORR,
    COVIANCE,
    DECAYLINEAR,
    DELAY,
    DELTA,
    IF,
    LOG,
    MAX,
    MEAN,
    MIN,
    PROD,
    RANK,
    SIGN,
    STD,
    SUM_,
    TSMAX,
    TSMIN,
    TSRANK,
)


# ── 注册器 ───────────────────────────────────────────────────


FactorFunc = Callable[[dict[str, pd.DataFrame]], pd.DataFrame]
_ALPHA101_REGISTRY: dict[int, dict] = {}


def alpha101(num: int, *, desc: str = ""):
    def deco(fn: FactorFunc) -> FactorFunc:
        _ALPHA101_REGISTRY[num] = {"func": fn, "desc": desc, "name": fn.__name__}
        return fn
    return deco


def list_alpha101() -> list[int]:
    return sorted(_ALPHA101_REGISTRY.keys())


def compute_alpha101(num: int, data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    if num not in _ALPHA101_REGISTRY:
        raise KeyError(f"WQ Alpha{num} 未注册")
    return _ALPHA101_REGISTRY[num]["func"](data)


# ── 辅助算子 ──────────────────────────────────────────────────


def _signed_power(x: pd.DataFrame, p: float) -> pd.DataFrame:
    """sign(x) * |x|^p — 符号保留的幂。"""
    return SIGN(x) * (ABS(x) ** p)


def _ts_argmax(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """Ts_ArgMax(x, n): max 出现在窗口内的索引位置 (0..n-1)。"""
    arr = x.to_numpy(dtype=float)
    from numpy.lib.stride_tricks import sliding_window_view
    T, N = arr.shape
    out = np.full((T, N), np.nan, dtype=float)
    if T < n:
        return pd.DataFrame(out, index=x.index, columns=x.columns)
    win = sliding_window_view(arr, window_shape=n, axis=0)
    out[n - 1:] = np.argmax(win, axis=-1)
    return pd.DataFrame(out, index=x.index, columns=x.columns)


def _ts_argmin(x: pd.DataFrame, n: int) -> pd.DataFrame:
    """Ts_ArgMin(x, n): min 出现在窗口内的索引位置。"""
    arr = x.to_numpy(dtype=float)
    from numpy.lib.stride_tricks import sliding_window_view
    T, N = arr.shape
    out = np.full((T, N), np.nan, dtype=float)
    if T < n:
        return pd.DataFrame(out, index=x.index, columns=x.columns)
    win = sliding_window_view(arr, window_shape=n, axis=0)
    out[n - 1:] = np.argmin(win, axis=-1)
    return pd.DataFrame(out, index=x.index, columns=x.columns)


def _adv(volume: pd.DataFrame, n: int) -> pd.DataFrame:
    """adv{n} = MEAN(volume, n)。"""
    return MEAN(volume, n)


# ── WQ Alpha 精选 30 个 ───────────────────────────────────────


@alpha101(1, desc="rank(Ts_ArgMax(SignedPower((ret<0 ? std(ret,20) : close), 2), 5)) - 0.5")
def wq_alpha_1(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close = data["close"]
    ret = data["ret"]
    cond = ret < 0
    base = IF(cond, STD(ret, 20), close)
    return RANK(_ts_argmax(_signed_power(base, 2.0), 5)) - 0.5


@alpha101(2, desc="-corr(rank(delta(log(vol),2)), rank((c-o)/o), 6)")
def wq_alpha_2(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    open_, close, volume = data["open"], data["close"], data["volume"]
    return -1 * CORR(RANK(DELTA(LOG(volume), 2)),
                     RANK((close - open_) / open_), 6)


@alpha101(3, desc="-corr(rank(open), rank(volume), 10)")
def wq_alpha_3(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * CORR(RANK(data["open"]), RANK(data["volume"]), 10)


@alpha101(4, desc="-Ts_Rank(rank(low), 9)")
def wq_alpha_4(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * TSRANK(RANK(data["low"]), 9)


@alpha101(5, desc="rank(open - sum(vwap,10)/10) * (-abs(rank(close-vwap)))")
def wq_alpha_5(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    open_, close, vwap = data["open"], data["close"], data["vwap"]
    return RANK(open_ - SUM_(vwap, 10) / 10) * (-1 * ABS(RANK(close - vwap)))


@alpha101(6, desc="-corr(open, volume, 10)")
def wq_alpha_6(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * CORR(data["open"], data["volume"], 10)


@alpha101(7, desc="放量日: -Ts_Rank(|ΔC(7)|,60)*sign(ΔC(7)); 缩量日: -1")
def wq_alpha_7(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close, volume = data["close"], data["volume"]
    adv20 = _adv(volume, 20)
    delta_c7 = DELTA(close, 7)
    neg_one = pd.DataFrame(-1.0, index=close.index, columns=close.columns)
    case_high_vol = -1 * TSRANK(ABS(delta_c7), 60) * SIGN(delta_c7)
    return IF(adv20 < volume, case_high_vol, neg_one)


@alpha101(8, desc="-rank((sum(O,5)*sum(RET,5)) - delay(sum(O,5)*sum(RET,5), 10))")
def wq_alpha_8(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    open_, ret = data["open"], data["ret"]
    combo = SUM_(open_, 5) * SUM_(ret, 5)
    return -1 * RANK(combo - DELAY(combo, 10))


@alpha101(9, desc="ΔC 在 5 日窗口内全正→ΔC; 全负→ΔC; 否则→-ΔC")
def wq_alpha_9(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close = data["close"]
    d = DELTA(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    cond1 = zero < TSMIN(d, 5)  # 全正
    cond2 = TSMAX(d, 5) < zero  # 全负
    return IF(cond1, d, IF(cond2, d, -1 * d))


@alpha101(12, desc="sign(ΔV(1)) * -ΔC(1)")
def wq_alpha_12(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return SIGN(DELTA(data["volume"], 1)) * (-1 * DELTA(data["close"], 1))


@alpha101(13, desc="-rank(cov(rank(C), rank(V), 5))")
def wq_alpha_13(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * RANK(COVIANCE(RANK(data["close"]), RANK(data["volume"]), 5))


@alpha101(14, desc="-rank(ΔRET,3) * corr(O,V,10)")
def wq_alpha_14(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * RANK(DELTA(data["ret"], 3)) * CORR(data["open"], data["volume"], 10)


@alpha101(15, desc="-sum(rank(corr(rank(H), rank(V), 3)), 3)")
def wq_alpha_15(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * SUM_(RANK(CORR(RANK(data["high"]), RANK(data["volume"]), 3)), 3)


@alpha101(16, desc="-rank(cov(rank(H), rank(V), 5))")
def wq_alpha_16(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * RANK(COVIANCE(RANK(data["high"]), RANK(data["volume"]), 5))


@alpha101(17, desc="-rank(Ts_Rank(C,10)) * rank(Δ(ΔC,1)) * rank(Ts_Rank(V/adv20,5))")
def wq_alpha_17(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close, volume = data["close"], data["volume"]
    return (-1 * RANK(TSRANK(close, 10))
            * RANK(DELTA(DELTA(close, 1), 1))
            * RANK(TSRANK(volume / _adv(volume, 20), 5)))


@alpha101(18, desc="-rank(std(|C-O|,5) + (C-O) + corr(C,O,10))")
def wq_alpha_18(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close, open_ = data["close"], data["open"]
    return -1 * RANK(STD(ABS(close - open_), 5) + (close - open_)
                     + CORR(close, open_, 10))


@alpha101(19, desc="-sign(C - delay(C,7) + Δ(C,7)) * (1 + rank(1 + sum(ret,250)))")
def wq_alpha_19(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close, ret = data["close"], data["ret"]
    s = SIGN((close - DELAY(close, 7)) + DELTA(close, 7))
    return -1 * s * (1 + RANK(1 + SUM_(ret, 250)))


@alpha101(22, desc="-(Δ(corr(H,V,5),5) * rank(std(C,20)))")
def wq_alpha_22(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * (DELTA(CORR(data["high"], data["volume"], 5), 5)
                 * RANK(STD(data["close"], 20)))


@alpha101(23, desc="MA20(H) < H → -Δ(H,2)，否则 0")
def wq_alpha_23(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    high = data["high"]
    cond = MEAN(high, 20) < high
    zero = pd.DataFrame(0.0, index=high.index, columns=high.columns)
    return IF(cond, -1 * DELTA(high, 2), zero)


@alpha101(24, desc="MA100 变化率 <= 0.05 → -(C - TsMin(C,100))，否则 -ΔC(3)")
def wq_alpha_24(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close = data["close"]
    ma100 = SUM_(close, 100) / 100
    cond = (DELTA(ma100, 100) / DELAY(close, 100)) <= 0.05
    return IF(cond, -1 * (close - TSMIN(close, 100)), -1 * DELTA(close, 3))


@alpha101(25, desc="rank(-RET * adv20 * VWAP * (H-C))")
def wq_alpha_25(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return RANK(-1 * data["ret"] * _adv(data["volume"], 20)
                * data["vwap"] * (data["high"] - data["close"]))


@alpha101(26, desc="-Ts_Max(corr(Ts_Rank(V,5), Ts_Rank(H,5), 5), 3)")
def wq_alpha_26(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return -1 * TSMAX(CORR(TSRANK(data["volume"], 5),
                           TSRANK(data["high"], 5), 5), 3)


@alpha101(28, desc="(corr(adv20, L, 5) + (H+L)/2 - C)")
def wq_alpha_28(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return (CORR(_adv(data["volume"], 20), data["low"], 5)
            + (data["high"] + data["low"]) / 2 - data["close"])


@alpha101(32, desc="(rank(sum(C,7)/7-C) + 20*rank(corr(VWAP, delay(C,5), 230)))")
def wq_alpha_32(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close, vwap = data["close"], data["vwap"]
    return (RANK(SUM_(close, 7) / 7 - close)
            + 20 * RANK(CORR(vwap, DELAY(close, 5), 230)))


@alpha101(33, desc="rank(-1 * (1 - O/C)^1)")
def wq_alpha_33(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return RANK(-1 * (1 - data["open"] / data["close"]))


@alpha101(34, desc="rank((1 - rank(std(ret,2)/std(ret,5))) + (1 - rank(ΔC(1))))")
def wq_alpha_34(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close, ret = data["close"], data["ret"]
    return RANK((1 - RANK(STD(ret, 2) / STD(ret, 5))) + (1 - RANK(DELTA(close, 1))))


@alpha101(35, desc="Ts_Rank(V,32) * (1 - Ts_Rank(C+H-L, 16)) * (1 - Ts_Rank(RET, 32))")
def wq_alpha_35(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return (TSRANK(data["volume"], 32)
            * (1 - TSRANK(data["close"] + data["high"] - data["low"], 16))
            * (1 - TSRANK(data["ret"], 32)))


@alpha101(37, desc="rank(corr(delay(O-C,1), C, 200)) + rank(O-C)")
def wq_alpha_37(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return (RANK(CORR(DELAY(data["open"] - data["close"], 1), data["close"], 200))
            + RANK(data["open"] - data["close"]))


@alpha101(38, desc="-1 * rank(Ts_Rank(C, 10)) * rank(C/O)")
def wq_alpha_38(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close, open_ = data["close"], data["open"]
    return -1 * RANK(TSRANK(close, 10)) * RANK(close / open_)


@alpha101(41, desc="sqrt(H*L) - VWAP")
def wq_alpha_41(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return (data["high"] * data["low"]) ** 0.5 - data["vwap"]


@alpha101(42, desc="rank(VWAP - C) / rank(VWAP + C)")
def wq_alpha_42(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    vwap, close = data["vwap"], data["close"]
    return RANK(vwap - close) / RANK(vwap + close)


@alpha101(43, desc="Ts_Rank(V/adv20, 20) * Ts_Rank(-ΔC(7), 8)")
def wq_alpha_43(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    volume, close = data["volume"], data["close"]
    return (TSRANK(volume / _adv(volume, 20), 20)
            * TSRANK(-1 * DELTA(close, 7), 8))


@alpha101(46, desc="基于 close 二阶差分阈值的三分类")
def wq_alpha_46(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    close = data["close"]
    a = (DELAY(close, 20) - DELAY(close, 10)) / 10
    b = (DELAY(close, 10) - close) / 10
    diff = a - b
    one = pd.DataFrame(1.0, index=close.index, columns=close.columns)
    neg_one = -one
    default = -1 * (close - DELAY(close, 1))
    middle = IF(diff < 0, one, default)
    return IF(diff > 0.25, neg_one, middle)


@alpha101(53, desc="-Δ(((C-L)-(H-C))/(C-L), 9)")
def wq_alpha_53(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    h, l, c = data["high"], data["low"], data["close"]
    return -1 * DELTA(((c - l) - (h - c)) / (c - l), 9)


@alpha101(54, desc="-((L-C) * O^5) / ((L-H) * C^5)")
def wq_alpha_54(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    h, l, c, o = data["high"], data["low"], data["close"], data["open"]
    return -1 * ((l - c) * (o ** 5)) / ((l - h) * (c ** 5))


@alpha101(101, desc="(C - O) / ((H - L) + 0.001) 经典 Doji 反向因子")
def wq_alpha_101(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return (data["close"] - data["open"]) / ((data["high"] - data["low"]) + 0.001)
