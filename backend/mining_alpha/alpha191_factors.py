"""
mining_alpha.alpha191_factors — Alpha191 因子函数集 + 注册器
================================================

约定:
  - 因子签名: `def alpha_N(data: dict[str, pd.DataFrame]) -> pd.DataFrame`
  - data 字典必须含 keys: 'open', 'high', 'low', 'close', 'volume', 'amount', 'vwap', 'ret'
    其中 vwap = amount / volume, ret = close.pct_change()
  - 返回 DataFrame index=date, columns=ticker，与输入同形状
  - 公式有 typo 的因子在 docstring 标注原始公式 + 实现修正

注册器:
  - `_ALPHA_REGISTRY` 是 {alpha_number: {func, desc, category}}
  - 用 @alpha(N, desc=...) 装饰器自动注册
  - 取列表用 `list_alphas()`、计算用 `compute_alpha(N, data)`

PR1 仅实现 30 个最简单的因子（仅依赖 OHLCV/Amount/VWAP/RET）；
其余 ~150 个因子在 PR2 中分批添加，可能需要 universe 行业 / mktcap / benchmark。
"""
from __future__ import annotations

from collections.abc import Callable

import pandas as pd

from .operators import (
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
import numpy as np

# ── 注册器 ────────────────────────────────────────────────────
FactorFunc = Callable[[dict[str, pd.DataFrame]], pd.DataFrame]

_ALPHA_REGISTRY: dict[int, dict] = {}


def alpha(num: int, *, desc: str = "", category: str = "price-volume"):
    """因子装饰器：自动注册到 _ALPHA_REGISTRY。"""
    def deco(fn: FactorFunc) -> FactorFunc:
        _ALPHA_REGISTRY[num] = {
            "func": fn,
            "desc": desc,
            "category": category,
            "name": fn.__name__,
        }
        return fn
    return deco


def list_alphas() -> list[int]:
    """返回已注册的因子编号列表（升序）。"""
    return sorted(_ALPHA_REGISTRY.keys())


def compute_alpha(num: int, data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """按编号计算因子。"""
    if num not in _ALPHA_REGISTRY:
        raise KeyError(f"Alpha{num} 未注册（已注册: {list_alphas()[:10]}...）")
    return _ALPHA_REGISTRY[num]["func"](data)


def get_alpha_info(num: int) -> dict:
    """返回因子的元信息（func/desc/category/name）。"""
    if num not in _ALPHA_REGISTRY:
        raise KeyError(f"Alpha{num} 未注册")
    return _ALPHA_REGISTRY[num]


# ── 因子定义（PR1 首批 30 个）─────────────────────────────────


@alpha(1, desc="-CORR(RANK(ΔLOG(VOL)), RANK((C-O)/O), 6) 量价反转")
def alpha_1(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha1: 量价反转。成交量变化排名 与 当日实体收益率排名 的 6 日相关性取负。"""
    open_ = data["open"]
    close = data["close"]
    volume = data["volume"]
    return -1 * CORR(
        RANK(DELTA(LOG(volume), 1)),
        RANK((close - open_) / open_),
        6,
    )


@alpha(2, desc="-Δ(((C-L)-(H-C))/(H-L), 1) 当日收盘位置变化反向")
def alpha_2(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha2: 当日收盘在高低区间的位置一阶差分取负。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    return -1 * DELTA(((close - low) - (high - close)) / (high - low), 1)


@alpha(3, desc="6 日累计资金流向（带前日收盘上/下穿条件）")
def alpha_3(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha3: SUM(IF(C=DELAY(C,1), 0,
                   C - IF(C>DELAY(C,1), MIN(L, DELAY(C,1)), MAX(H, DELAY(C,1)))), 6)
    """
    high = data["high"]
    low = data["low"]
    close = data["close"]
    prev_close = DELAY(close, 1)
    cond_up = close > prev_close
    # 上涨日: 距离 max(L, prev_close)=min(L, prev_close) 的距离
    # 下跌日: 距离 min(H, prev_close)=max(H, prev_close) 的距离
    ref = IF(cond_up, MIN(low, prev_close), MAX(high, prev_close))
    diff = close - ref
    # 当日平盘则贡献 0
    masked = IF(close == prev_close, pd.DataFrame(0.0, index=close.index, columns=close.columns), diff)
    return SUM_(masked, 6)


@alpha(14, desc="C - DELAY(C, 5) 5 日动量绝对值")
def alpha_14(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha14: 收盘价 5 日变化（绝对）。"""
    close = data["close"]
    return close - DELAY(close, 5)


@alpha(15, desc="OPEN/DELAY(CLOSE,1) - 1 隔夜跳空")
def alpha_15(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha15: 隔夜收益率（开盘 vs 昨收）。"""
    open_ = data["open"]
    close = data["close"]
    return open_ / DELAY(close, 1) - 1


@alpha(18, desc="C/DELAY(C, 5) 5 日累计涨幅 ratio")
def alpha_18(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha18: 收盘价 5 日比值（相对动量）。"""
    close = data["close"]
    return close / DELAY(close, 5)


@alpha(20, desc="(C-DELAY(C,6))/DELAY(C,6)*100 6 日涨幅%")
def alpha_20(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha20: 6 日累计收益率（%）。"""
    close = data["close"]
    prev = DELAY(close, 6)
    return (close - prev) / prev * 100


@alpha(24, desc="SMA(C - DELAY(C,5), 5, 1) 平滑后的 5 日动量")
def alpha_24(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha24: 5 日动量经 EWMA(α=0.2) 平滑。"""
    close = data["close"]
    return SMA(close - DELAY(close, 5), 5, 1)


@alpha(29, desc="(C-DELAY(C,6))/DELAY(C,6)*VOL 量加权 6 日动量")
def alpha_29(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha29: 6 日涨幅 × 当日量。"""
    close = data["close"]
    volume = data["volume"]
    prev = DELAY(close, 6)
    return (close - prev) / prev * volume


@alpha(31, desc="(C - MEAN(C,12))/MEAN(C,12)*100 12 日均线偏离%")
def alpha_31(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha31: 与 12 日均线的偏离（%）。反转因子。"""
    close = data["close"]
    ma = MEAN(close, 12)
    return (close - ma) / ma * 100


@alpha(34, desc="MEAN(C, 12) / C  12 日均线/当前价 比值")
def alpha_34(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha34: 12 日均线 / 现价。>1 表示价格在均线之下。"""
    close = data["close"]
    return MEAN(close, 12) / close


@alpha(40, desc="26 日上涨量/下跌量 比值 × 100")
def alpha_40(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha40: 26 日内上涨日成交量 / 下跌或平盘日成交量。"""
    close = data["close"]
    volume = data["volume"]
    prev_close = DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up_vol = IF(close > prev_close, volume, zero)
    down_vol = IF(close <= prev_close, volume, zero)
    return SUM_(up_vol, 26) / SUM_(down_vol, 26) * 100


@alpha(46, desc="(MA3+MA6+MA12+MA24)/(4*C) 多周期均线/现价")
def alpha_46(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha46: 多周期均线的归一化平均。"""
    close = data["close"]
    return (MEAN(close, 3) + MEAN(close, 6) + MEAN(close, 12) + MEAN(close, 24)) / (4 * close)


@alpha(53, desc="COUNT(C>DELAY(C,1), 12)/12*100 12 日上涨天数比例")
def alpha_53(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha53: 过去 12 日中上涨天数占比（%）。"""
    close = data["close"]
    return COUNT(close > DELAY(close, 1), 12) / 12 * 100


@alpha(57, desc="SMA(KDJ-K, 3, 1) 经典 KDJ K 值")
def alpha_57(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha57: 9 日 KDJ 的 K 值（SMA(RSV, 3, 1)）。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tsmin_low = TSMIN(low, 9)
    tsmax_high = TSMAX(high, 9)
    rsv = (close - tsmin_low) / (tsmax_high - tsmin_low) * 100
    return SMA(rsv, 3, 1)


@alpha(58, desc="COUNT(C>DELAY(C,1), 20)/20*100 20 日上涨天数比例")
def alpha_58(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha58: 过去 20 日中上涨天数占比（%）。"""
    close = data["close"]
    return COUNT(close > DELAY(close, 1), 20) / 20 * 100


@alpha(63, desc="6 日 RSI 类指标（上涨幅度 SMA / 总变动 SMA × 100）")
def alpha_63(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha63: 6 日 RSI 形式因子。"""
    close = data["close"]
    chg = close - DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up = MAX(chg, zero)
    return SMA(up, 6, 1) / SMA(ABS(chg), 6, 1) * 100


@alpha(65, desc="MEAN(C, 6) / C  6 日均线 / 现价")
def alpha_65(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha65: 6 日均线 / 当前价。"""
    close = data["close"]
    return MEAN(close, 6) / close


@alpha(66, desc="(C-MEAN(C,6))/MEAN(C,6)*100 6 日均线偏离%")
def alpha_66(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha66: 6 日均线偏离（%）。"""
    close = data["close"]
    ma = MEAN(close, 6)
    return (close - ma) / ma * 100


@alpha(71, desc="(C-MEAN(C,24))/MEAN(C,24)*100 24 日均线偏离%")
def alpha_71(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha71: 24 日均线偏离（%）。"""
    close = data["close"]
    ma = MEAN(close, 24)
    return (close - ma) / ma * 100


@alpha(79, desc="12 日 RSI 类指标 (SMA up / SMA abs × 100)")
def alpha_79(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha79: 12 日 RSI 形式因子。"""
    close = data["close"]
    chg = close - DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up = MAX(chg, zero)
    return SMA(up, 12, 1) / SMA(ABS(chg), 12, 1) * 100


@alpha(80, desc="(VOL - DELAY(VOL,5))/DELAY(VOL,5)*100 5 日量变化%")
def alpha_80(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha80: 成交量 5 日变化率（%）。"""
    volume = data["volume"]
    prev = DELAY(volume, 5)
    return (volume - prev) / prev * 100


@alpha(81, desc="SMA(VOL, 21, 2) 量的 EWMA(α=2/21)")
def alpha_81(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha81: 成交量经 SMA(21,2) 平滑。"""
    return SMA(data["volume"], 21, 2)


@alpha(82, desc="SMA(((TSMAX(H,6)-C)/(TSMAX(H,6)-TSMIN(L,6)))*100, 20, 1) WR 平滑")
def alpha_82(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha82: 6 日威廉指标的 SMA(20,1) 平滑。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tsmax_h = TSMAX(high, 6)
    tsmin_l = TSMIN(low, 6)
    wr = (tsmax_h - close) / (tsmax_h - tsmin_l) * 100
    return SMA(wr, 20, 1)


@alpha(88, desc="(C-DELAY(C,20))/DELAY(C,20)*100 20 日动量%")
def alpha_88(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha88: 20 日累计收益率（%）。"""
    close = data["close"]
    prev = DELAY(close, 20)
    return (close - prev) / prev * 100


@alpha(96, desc="SMA(SMA(KDJ-RSV, 3, 1), 3, 1) KDJ D 值类")
def alpha_96(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha96: 9 日 KDJ 的 D 值（两层 SMA）。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tsmin_low = TSMIN(low, 9)
    tsmax_high = TSMAX(high, 9)
    rsv = (close - tsmin_low) / (tsmax_high - tsmin_low) * 100
    return SMA(SMA(rsv, 3, 1), 3, 1)


@alpha(100, desc="STD(VOL, 20) 20 日量波动")
def alpha_100(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha100: 20 日成交量标准差。"""
    return STD(data["volume"], 20)


@alpha(106, desc="C - DELAY(C, 20) 20 日动量绝对值")
def alpha_106(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha106: 收盘价 20 日变化（绝对）。"""
    close = data["close"]
    return close - DELAY(close, 20)


@alpha(109, desc="SMA(H-L, 10, 2) / SMA(SMA(H-L, 10, 2), 10, 2) 波幅平滑比")
def alpha_109(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha109: 振幅的两层 SMA 之比。"""
    rng = data["high"] - data["low"]
    s1 = SMA(rng, 10, 2)
    return s1 / SMA(s1, 10, 2)


@alpha(118, desc="SUM(H-O, 20)/SUM(O-L, 20)*100 上下影线相对强度")
def alpha_118(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha118: 20 日上影线总和 / 下影线总和 × 100。"""
    return SUM_(data["high"] - data["open"], 20) / SUM_(data["open"] - data["low"], 20) * 100


@alpha(126, desc="(C+H+L)/3 当日典型价")
def alpha_126(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha126: 典型价 (Typical Price)。"""
    return (data["close"] + data["high"] + data["low"]) / 3


@alpha(132, desc="MEAN(AMOUNT, 20) 20 日均成交额")
def alpha_132(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha132: 20 日平均成交额。规模/流动性因子。"""
    return MEAN(data["amount"], 20)


@alpha(150, desc="(C+H+L)/3 * VOL 当日资金流")
def alpha_150(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha150: 典型价 × 成交量（当日资金流量）。"""
    return (data["close"] + data["high"] + data["low"]) / 3 * data["volume"]


@alpha(153, desc="(MA3+MA6+MA12+MA24)/4 多周期均线平均")
def alpha_153(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha153: 多周期均线简单平均（Alpha46 的分子）。"""
    close = data["close"]
    return (MEAN(close, 3) + MEAN(close, 6) + MEAN(close, 12) + MEAN(close, 24)) / 4


# ── 辅助函数（DTM/DBM/TR/LD/HD）─────────────────────────────


def _dtm(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """DTM (Demand Trend Mover): (OPEN <= DELAY(OPEN,1)) ? 0 : MAX(H-O, O-DELAY(O,1))。"""
    open_ = data["open"]
    high = data["high"]
    zero = pd.DataFrame(0.0, index=open_.index, columns=open_.columns)
    delay_open = DELAY(open_, 1)
    val = MAX(high - open_, open_ - delay_open)
    return IF(open_ <= delay_open, zero, val)


def _dbm(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """DBM (Supply Trend Mover): (OPEN >= DELAY(OPEN,1)) ? 0 : MAX(O-L, O-DELAY(O,1))。"""
    open_ = data["open"]
    low = data["low"]
    zero = pd.DataFrame(0.0, index=open_.index, columns=open_.columns)
    delay_open = DELAY(open_, 1)
    val = MAX(open_ - low, open_ - delay_open)
    return IF(open_ >= delay_open, zero, val)


def _tr(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """True Range: MAX(MAX(H-L, |DELAY(C,1)-H|), |DELAY(C,1)-L|)。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    prev_close = DELAY(close, 1)
    return MAX(MAX(high - low, ABS(prev_close - high)), ABS(prev_close - low))


def _ld(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Low directional movement: DELAY(LOW,1) - LOW。"""
    low = data["low"]
    return DELAY(low, 1) - low


def _hd(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """High directional movement: HIGH - DELAY(HIGH,1)。"""
    high = data["high"]
    return high - DELAY(high, 1)


# ── 第二批因子 (PR2 扩展) ────────────────────────────────────


@alpha(4, desc="复杂条件：均线+STD+量能比")
def alpha_4(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha4: 三层嵌套条件，组合了 8 日均线 / 2 日均线 / STD / 量能比。"""
    close = data["close"]
    volume = data["volume"]
    sum8 = SUM_(close, 8) / 8
    sum2 = SUM_(close, 2) / 2
    std8 = STD(close, 8)
    vol_ratio = volume / MEAN(volume, 20)
    cond_a = (sum8 + std8) < sum2  # 强势放量
    cond_b = sum2 < (sum8 - std8)  # 弱势缩量
    cond_c = vol_ratio >= 1.0       # 量能至少持平
    one = pd.DataFrame(1.0, index=close.index, columns=close.columns)
    neg_one = -one
    inner = IF(cond_c, one, neg_one)
    middle = IF(cond_b, one, inner)
    return IF(cond_a, neg_one, middle)


@alpha(5, desc="-TSMAX(CORR(TSRANK(V,5), TSRANK(H,5), 5), 3)")
def alpha_5(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha5: 量价时序排名相关性的近 3 日最大值取负。"""
    return -1 * TSMAX(CORR(TSRANK(data["volume"], 5), TSRANK(data["high"], 5), 5), 3)


@alpha(6, desc="-RANK(SIGN(DELTA(0.85*O+0.15*H, 4)))")
def alpha_6(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha6: 加权价格 4 日符号差分横截面排名取负。"""
    return -1 * RANK(SIGN(DELTA(data["open"] * 0.85 + data["high"] * 0.15, 4)))


@alpha(7, desc="(RANK(MAX(VWAP-CLOSE,3))+RANK(MIN(VWAP-CLOSE,3)))*RANK(ΔVOL,3)")
def alpha_7(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha7: VWAP-CLOSE 极值排名 × 成交量差分排名。"""
    vwap = data["vwap"]
    close = data["close"]
    return (RANK(TSMAX(vwap - close, 3)) + RANK(TSMIN(vwap - close, 3))) * RANK(DELTA(data["volume"], 3))


@alpha(8, desc="RANK(ΔP*-1)  P=0.2*(H+L)/2+0.8*VWAP")
def alpha_8(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha8: VWAP+中价加权 4 日变化排名取负。"""
    p = 0.2 * (data["high"] + data["low"]) / 2 + 0.8 * data["vwap"]
    return RANK(-1 * DELTA(p, 4))


@alpha(9, desc="SMA(((H+L)/2 - DELAY((H+L)/2,1)) * (H-L)/V, 7, 2)")
def alpha_9(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha9: 量价综合因子（A/D 类）。"""
    high = data["high"]
    low = data["low"]
    volume = data["volume"]
    mid = (high + low) / 2
    delta_mid = mid - DELAY(mid, 1)
    return SMA(delta_mid * (high - low) / volume, 7, 2)


@alpha(10, desc="RANK(MAX((RET<0?STD(RET,20):CLOSE)^2, 5))")
def alpha_10(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha10: 负收益日用 STD(RET,20) 替换 CLOSE，平方后 5 日最大值取横截面排名。"""
    ret = data["ret"]
    close = data["close"]
    std20 = STD(ret, 20)
    val = IF(ret < 0, std20, close)
    return RANK(TSMAX(val * val, 5))


@alpha(11, desc="SUM(((C-L)-(H-C))/(H-L) * V, 6) 6 日资金流向")
def alpha_11(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha11: 6 日资金流向（带方向）。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    return SUM_(((close - low) - (high - close)) / (high - low) * data["volume"], 6)


@alpha(12, desc="RANK(O-MEAN(VWAP,10)) * -RANK(ABS(C-VWAP))")
def alpha_12(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha12: 开盘相对 VWAP 偏离 vs 收盘与 VWAP 偏离的乘积。"""
    return RANK(data["open"] - MEAN(data["vwap"], 10)) * (-1 * RANK(ABS(data["close"] - data["vwap"])))


@alpha(13, desc="sqrt(H*L) - VWAP 几何均价 vs VWAP")
def alpha_13(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha13: 高低几何均价与 VWAP 之差。"""
    return (data["high"] * data["low"]) ** 0.5 - data["vwap"]


@alpha(16, desc="-TSMAX(RANK(CORR(RANK(V), RANK(VWAP), 5)), 5)")
def alpha_16(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha16: 量价排名相关性 5 日最大值取负。"""
    return -1 * TSMAX(RANK(CORR(RANK(data["volume"]), RANK(data["vwap"]), 5)), 5)


@alpha(17, desc="RANK(VWAP - MAX(VWAP, 15)) ^ DELTA(C, 5)")
def alpha_17(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha17: VWAP 偏离 15 日最大值的排名取 close 5 日变化次方。"""
    vwap = data["vwap"]
    base = RANK(vwap - TSMAX(vwap, 15))
    exp_ = DELTA(data["close"], 5)
    # 用 sign(base)*|base|^exp 避免负底数小数次方报错
    sign = SIGN(base)
    abs_pow = ABS(base) ** exp_
    return sign * abs_pow


@alpha(19, desc="3-way: C<DELAY(C,5)/C=DELAY(C,5)/C>DELAY(C,5) 归一化")
def alpha_19(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha19: 5 日动量但按"上 / 平 / 下"三种情况归一化（分母不同）。"""
    close = data["close"]
    prev5 = DELAY(close, 5)
    diff = close - prev5
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    case_down = diff / prev5         # 跌：除前价
    case_up = diff / close           # 涨：除现价
    case_eq = zero
    return IF(close < prev5, case_down, IF(close == prev5, case_eq, case_up))


@alpha(21, desc="REGBETA(MEAN(C,6), SEQUENCE(6)) 6 日均线趋势斜率")
def alpha_21(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha21: 6 日均线对时间序列的回归斜率。"""
    return REGBETA(MEAN(data["close"], 6), SEQUENCE(6), 6)


@alpha(22, desc="SMA((C/MA6 - DELAY(C/MA6, 3)), 12, 1) 偏离变化平滑")
def alpha_22(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha22: 6 日均线偏离的 3 日变化经 SMA(12,1) 平滑。"""
    close = data["close"]
    ma6 = MEAN(close, 6)
    deviation = (close - ma6) / ma6
    return SMA(deviation - DELAY(deviation, 3), 12, 1)


@alpha(25, desc="-RANK(ΔC*((1-RANK(DECAY))) * (1+RANK(SUM(RET,250))))")
def alpha_25(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha25: 量能衰减 + 长周期动量调节的反转因子。"""
    close = data["close"]
    volume = data["volume"]
    ret = data["ret"]
    decay_part = 1 - RANK(DECAYLINEAR(volume / MEAN(volume, 20), 9))
    long_mom = 1 + RANK(SUM_(ret, 250))
    return -1 * RANK(DELTA(close, 7) * decay_part) * long_mom


@alpha(26, desc="(SUM(C,7)/7 - C) + CORR(VWAP, DELAY(C,5), 230)")
def alpha_26(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha26: 7 日均线偏离 + VWAP 与滞后收盘的长周期相关性。"""
    close = data["close"]
    return (SUM_(close, 7) / 7 - close) + CORR(data["vwap"], DELAY(close, 5), 230)


@alpha(28, desc="3*SMA(KDJ_K, 3, 1) - 2*SMA(SMA(KDJ_K, 3, 1), 3, 1) KDJ J 值")
def alpha_28(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha28: 经典 KDJ J 值 = 3K - 2D。论文里的 ``MAX(HIGH,9) - TSMAX(LOW,9)``
    判断为 typo，改回 ``TSMAX(HIGH,9) - TSMIN(LOW,9)``。
    """
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tsmin_low = TSMIN(low, 9)
    tsmax_high = TSMAX(high, 9)
    rsv = (close - tsmin_low) / (tsmax_high - tsmin_low) * 100
    k = SMA(rsv, 3, 1)
    d = SMA(k, 3, 1)
    return 3 * k - 2 * d


@alpha(32, desc="-SUM(RANK(CORR(RANK(H), RANK(V), 3)), 3)")
def alpha_32(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha32: 高价/量排名相关性 3 日累加横截面排名取负。"""
    return -1 * SUM_(RANK(CORR(RANK(data["high"]), RANK(data["volume"]), 3)), 3)


@alpha(35, desc="MIN(RANK(DECAY(ΔO,15)), RANK(DECAY(CORR(V, O*混合, 17), 7))) * -1")
def alpha_35(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha35: 两个 DECAYLINEAR 横截面排名的最小值取负。"""
    open_ = data["open"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR(DELTA(open_, 1), 15))
    # 论文公式 "(OPEN * 0.65) + (OPEN * 0.35)" = 1.0 * OPEN，等价于 open。但常规理解为
    # OPEN*0.65 + CLOSE*0.35，这里按原始公式实现（结果就是 open）。
    p2 = RANK(DECAYLINEAR(CORR(volume, open_, 17), 7))
    return MIN(p1, p2) * -1


@alpha(36, desc="RANK(SUM(CORR(RANK(V), RANK(VWAP), 6), 2))")
def alpha_36(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha36: 量价排名相关性 2 日累加横截面排名。"""
    return RANK(SUM_(CORR(RANK(data["volume"]), RANK(data["vwap"]), 6), 2))


@alpha(37, desc="-RANK(SUM(O,5)*SUM(RET,5) - DELAY(SUM(O,5)*SUM(RET,5), 10))")
def alpha_37(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha37: 开盘累加×收益累加的 10 日变化横截面排名取负。"""
    open_ = data["open"]
    ret = data["ret"]
    combo = SUM_(open_, 5) * SUM_(ret, 5)
    return -1 * RANK(combo - DELAY(combo, 10))


@alpha(38, desc="IF(MEAN(H,20)<H, -ΔH(2), 0) 突破均线的反转")
def alpha_38(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha38: 高位时取 H 的 2 日变化取负，未突破 20 日均价时为 0。"""
    high = data["high"]
    cond = MEAN(high, 20) < high
    zero = pd.DataFrame(0.0, index=high.index, columns=high.columns)
    return IF(cond, -1 * DELTA(high, 2), zero)


@alpha(41, desc="-RANK(MAX(ΔVWAP, 3, 5)) VWAP 短期跳变")
def alpha_41(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha41: VWAP 3 日差分的 5 日最大值横截面排名取负。"""
    return -1 * RANK(TSMAX(DELTA(data["vwap"], 3), 5))


@alpha(42, desc="-RANK(STD(H, 10)) * CORR(H, V, 10)")
def alpha_42(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha42: 高价 10 日波动率 × 量价相关性的负向因子。"""
    return -1 * RANK(STD(data["high"], 10)) * CORR(data["high"], data["volume"], 10)


@alpha(43, desc="SUM(IF(C>DELAY(C,1), V, IF(C<DELAY(C,1), -V, 0)), 6) 6 日净量")
def alpha_43(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha43: 6 日符号成交量累加（OBV 缩短版）。"""
    close = data["close"]
    volume = data["volume"]
    prev_close = DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    signed = IF(close > prev_close, volume, IF(close < prev_close, -volume, zero))
    return SUM_(signed, 6)


@alpha(47, desc="SMA(WR(6), 9, 1) 威廉指标平滑")
def alpha_47(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha47: 6 日威廉指标的 SMA(9,1) 平滑。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tsmax = TSMAX(high, 6)
    tsmin = TSMIN(low, 6)
    return SMA((tsmax - close) / (tsmax - tsmin) * 100, 9, 1)


@alpha(48, desc="-(RANK(sign-sum 3 日) * SUM(V,5)/SUM(V,20))")
def alpha_48(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha48: 近 3 日方向连续性 × 量能比率取负。"""
    close = data["close"]
    volume = data["volume"]
    s = (SIGN(close - DELAY(close, 1))
         + SIGN(DELAY(close, 1) - DELAY(close, 2))
         + SIGN(DELAY(close, 2) - DELAY(close, 3)))
    return -1 * RANK(s) * SUM_(volume, 5) / SUM_(volume, 20)


@alpha(52, desc="MFI-like: 12 日上向资金流 / 下向资金流 × 100")
def alpha_52(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha52: 简化版资金流量指标（基于 typical price）。

    论文公式末尾 ``DELAY(...) - L`` 的 ``L`` 推断为 ``LOW``（typo 修正）。
    使用 ``MEAN`` 替代 ``SUM/SUM`` 比率以避免分母为零。
    """
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tp = (high + low + close) / 3
    prev_tp = DELAY(tp, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up = MAX(high - prev_tp, zero)
    dn = MAX(prev_tp - low, zero)
    return SUM_(up, 26) / SUM_(dn, 26) * 100


@alpha(54, desc="-RANK(STD(|C-O|) + (C-O) + CORR(C,O,10))")
def alpha_54(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha54: 实体波动 + 当日实体 + 开收相关性的横截面排名取负。"""
    close = data["close"]
    open_ = data["open"]
    return -1 * RANK(STD(ABS(close - open_), 10) + (close - open_) + CORR(close, open_, 10))


@alpha(60, desc="SUM(((C-L)-(H-C))/(H-L)*V, 20) 20 日资金流向")
def alpha_60(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha60: 20 日资金流向（带方向，Alpha11 的 20 日版本）。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    return SUM_(((close - low) - (high - close)) / (high - low) * data["volume"], 20)


@alpha(62, desc="-CORR(HIGH, RANK(V), 5)")
def alpha_62(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha62: 高价与量排名 5 日相关性取负。"""
    return -1 * CORR(data["high"], RANK(data["volume"]), 5)


@alpha(67, desc="24 日 RSI 类指标")
def alpha_67(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha67: 24 日 RSI 形式。"""
    close = data["close"]
    chg = close - DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up = MAX(chg, zero)
    return SMA(up, 24, 1) / SMA(ABS(chg), 24, 1) * 100


@alpha(68, desc="SMA(((H+L)/2 - prev(H+L)/2) * (H-L)/V, 15, 2) Alpha9 的 15 日版本")
def alpha_68(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha68: Alpha9 的 15 日 SMA 版本。"""
    high = data["high"]
    low = data["low"]
    volume = data["volume"]
    mid = (high + low) / 2
    delta_mid = mid - DELAY(mid, 1)
    return SMA(delta_mid * (high - low) / volume, 15, 2)


@alpha(69, desc="DTM/DBM 比率（多空压力相对强度）")
def alpha_69(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha69: 20 日 DTM 与 DBM 累加比率（多空动量指标）。"""
    dtm = _dtm(data)
    dbm = _dbm(data)
    sum_dtm = SUM_(dtm, 20)
    sum_dbm = SUM_(dbm, 20)
    zero = pd.DataFrame(0.0, index=dtm.index, columns=dtm.columns)
    case_gt = (sum_dtm - sum_dbm) / sum_dtm
    case_lt = (sum_dtm - sum_dbm) / sum_dbm
    inner = IF(sum_dtm == sum_dbm, zero, case_lt)
    return IF(sum_dtm > sum_dbm, case_gt, inner)


@alpha(70, desc="STD(AMOUNT, 6) 6 日成交额波动")
def alpha_70(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha70: 6 日成交额标准差。"""
    return STD(data["amount"], 6)


@alpha(72, desc="SMA(WR(6), 15, 1)")
def alpha_72(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha72: 6 日威廉指标的 SMA(15,1) 平滑。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tsmax = TSMAX(high, 6)
    tsmin = TSMIN(low, 6)
    return SMA((tsmax - close) / (tsmax - tsmin) * 100, 15, 1)


@alpha(78, desc="CCI-like: ((H+L+C)/3 - MA12) / (0.015 * MAD)")
def alpha_78(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha78: 12 日 CCI 指标。"""
    tp = (data["high"] + data["low"] + data["close"]) / 3
    ma12 = MEAN(tp, 12)
    mad = MEAN(ABS(data["close"] - ma12), 12)
    return (tp - ma12) / (0.015 * mad)


@alpha(83, desc="-RANK(COV(RANK(H), RANK(V), 5))")
def alpha_83(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha83: 高价/量排名 5 日协方差横截面排名取负。"""
    return -1 * RANK(COVIANCE(RANK(data["high"]), RANK(data["volume"]), 5))


@alpha(84, desc="SUM(signed_volume, 20) 20 日 OBV")
def alpha_84(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha84: 20 日符号成交量累加（同 Alpha43 但窗口 20）。"""
    close = data["close"]
    volume = data["volume"]
    prev_close = DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    signed = IF(close > prev_close, volume, IF(close < prev_close, -volume, zero))
    return SUM_(signed, 20)


@alpha(85, desc="TSRANK(V/MEAN(V,20), 20) * TSRANK(-ΔC(7), 8)")
def alpha_85(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha85: 量能时序排名 × 收益反向时序排名（量能突破+回撤选股）。"""
    volume = data["volume"]
    close = data["close"]
    return TSRANK(volume / MEAN(volume, 20), 20) * TSRANK(-1 * DELTA(close, 7), 8)


@alpha(89, desc="DMA-MACD: 2*(SMA13 - SMA27 - SMA(SMA13-SMA27, 10))")
def alpha_89(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha89: 类 MACD（α=2/13 vs α=2/27）。"""
    close = data["close"]
    ema_short = SMA(close, 13, 2)
    ema_long = SMA(close, 27, 2)
    dif = ema_short - ema_long
    dea = SMA(dif, 10, 2)
    return 2 * (dif - dea)


@alpha(90, desc="-RANK(CORR(RANK(VWAP), RANK(V), 5))")
def alpha_90(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha90: VWAP/量排名相关性横截面排名取负。"""
    return -1 * RANK(CORR(RANK(data["vwap"]), RANK(data["volume"]), 5))


@alpha(93, desc="SUM(IF(O>=DELAY(O,1), 0, MAX(O-L, O-DELAY(O,1))), 20) DBM 累加")
def alpha_93(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha93: 20 日 DBM 累加（下行能量）。"""
    return SUM_(_dbm(data), 20)


@alpha(94, desc="SUM(signed_volume, 30) 30 日 OBV")
def alpha_94(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha94: 30 日符号成交量累加。"""
    close = data["close"]
    volume = data["volume"]
    prev_close = DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    signed = IF(close > prev_close, volume, IF(close < prev_close, -volume, zero))
    return SUM_(signed, 30)


@alpha(95, desc="STD(AMOUNT, 20) 20 日成交额波动")
def alpha_95(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha95: 20 日成交额标准差。"""
    return STD(data["amount"], 20)


@alpha(97, desc="STD(VOLUME, 10) 10 日量波动")
def alpha_97(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha97: 10 日成交量标准差。"""
    return STD(data["volume"], 10)


@alpha(99, desc="-RANK(COV(RANK(C), RANK(V), 5))")
def alpha_99(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha99: 收盘/量排名 5 日协方差横截面排名取负。"""
    return -1 * RANK(COVIANCE(RANK(data["close"]), RANK(data["volume"]), 5))


@alpha(102, desc="SMA(MAX(ΔV,0), 6, 1) / SMA(|ΔV|, 6, 1) × 100  量能 VR")
def alpha_102(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha102: 量能版 RSI（量增/量变绝对值比）。"""
    volume = data["volume"]
    chg = volume - DELAY(volume, 1)
    zero = pd.DataFrame(0.0, index=volume.index, columns=volume.columns)
    up = MAX(chg, zero)
    return SMA(up, 6, 1) / SMA(ABS(chg), 6, 1) * 100


@alpha(103, desc="((20-LOWDAY(LOW,20))/20)*100 低点位置位次")
def alpha_103(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha103: 20 日内最低价位置（越近权重越大）。"""
    return (20 - LOWDAY(data["low"], 20)) / 20 * 100


@alpha(105, desc="-CORR(RANK(O), RANK(V), 10)")
def alpha_105(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha105: 开盘/量排名 10 日相关性取负。"""
    return -1 * CORR(RANK(data["open"]), RANK(data["volume"]), 10)


@alpha(107, desc="-RANK(O-DELAY(H,1)) * RANK(O-DELAY(C,1)) * RANK(O-DELAY(L,1))")
def alpha_107(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha107: 开盘与昨日 OHL 偏离的三重排名乘积取负。"""
    open_ = data["open"]
    return (-1 * RANK(open_ - DELAY(data["high"], 1))
            * RANK(open_ - DELAY(data["close"], 1))
            * RANK(open_ - DELAY(data["low"], 1)))


@alpha(110, desc="SUM(MAX(0,H-DELAY(C,1)), 20) / SUM(MAX(0,DELAY(C,1)-L), 20) × 100")
def alpha_110(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha110: 上行真空间 vs 下行真空间比率（×100）。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    prev_close = DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up = MAX(high - prev_close, zero)
    dn = MAX(prev_close - low, zero)
    return SUM_(up, 20) / SUM_(dn, 20) * 100


@alpha(111, desc="SMA(V*((C-L)-(H-C))/(H-L), 11, 2) - SMA(同, 4, 2)  (论文 VOL→VOLUME 修正)")
def alpha_111(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha111: 资金流向的快慢 SMA 之差。论文里 ``VOL`` 视为 ``VOLUME`` typo 修正。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    volume = data["volume"]
    flow = volume * ((close - low) - (high - close)) / (high - low)
    return SMA(flow, 11, 2) - SMA(flow, 4, 2)


@alpha(112, desc="12 日 RSI 形式（涨跌幅累加比）")
def alpha_112(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha112: 12 日内涨跌幅累加比例（×100）。"""
    close = data["close"]
    chg = close - DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up = IF(chg > 0, chg, zero)
    dn = IF(chg < 0, ABS(chg), zero)
    sum_up = SUM_(up, 12)
    sum_dn = SUM_(dn, 12)
    return (sum_up - sum_dn) / (sum_up + sum_dn) * 100


@alpha(116, desc="REGBETA(C, SEQUENCE, 20) 20 日 close 时间趋势斜率")
def alpha_116(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha116: 收盘价对时间序列的 20 日回归斜率。"""
    return REGBETA(data["close"], SEQUENCE(20), 20)


@alpha(117, desc="TSRANK(V,32) * (1-TSRANK(H+C-L,16)) * (1-TSRANK(RET,32))")
def alpha_117(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha117: 量能时序排名 × 价格范围反向 × 收益反向（量能放大但价格未跟上的反转）。"""
    volume = data["volume"]
    high = data["high"]
    low = data["low"]
    close = data["close"]
    ret = data["ret"]
    return (TSRANK(volume, 32)
            * (1 - TSRANK(close + high - low, 16))
            * (1 - TSRANK(ret, 32)))


@alpha(119, desc="复合 DECAY+TSRANK: RANK(DECAY(CORR(VWAP, SUM(MEAN(V,5),26), 5),7)) - RANK(DECAY(TSRANK(MIN(CORR),9),7),8)")
def alpha_119(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha119: 长短量价相关性的 DECAYLINEAR 差。"""
    vwap = data["vwap"]
    volume = data["volume"]
    open_ = data["open"]
    p1 = RANK(DECAYLINEAR(CORR(vwap, SUM_(MEAN(volume, 5), 26), 5), 7))
    inner_corr = CORR(RANK(open_), RANK(MEAN(volume, 15)), 21)
    p2 = RANK(DECAYLINEAR(TSRANK(TSMIN(inner_corr, 9), 7), 8))
    return p1 - p2


@alpha(120, desc="RANK(VWAP-C) / RANK(VWAP+C)")
def alpha_120(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha120: VWAP 与 close 偏离的横截面排名比。"""
    return RANK(data["vwap"] - data["close"]) / RANK(data["vwap"] + data["close"])


@alpha(122, desc="3 层 SMA log 的 1 日变化率")
def alpha_122(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha122: log(C) 经三层 SMA(13,2) 平滑后的 1 日变化率。"""
    triple = SMA(SMA(SMA(LOG(data["close"]), 13, 2), 13, 2), 13, 2)
    return (triple - DELAY(triple, 1)) / DELAY(triple, 1)


@alpha(124, desc="(C-VWAP) / DECAY(RANK(TSMAX(C,30)), 2)")
def alpha_124(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha124: 收盘 vs VWAP 偏离 / 30 日最高价位置 DECAYLINEAR。"""
    close = data["close"]
    return (close - data["vwap"]) / DECAYLINEAR(RANK(TSMAX(close, 30)), 2)


@alpha(127, desc="sqrt(mean((100*(C-MAX(C,12))/MAX(C,12))^2))")
def alpha_127(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha127: 12 日内 close 与最大值偏离平方均的开方（论文公式简化，仅取最后值）。

    论文公式没明确给出窗口长度，按 12 实现。
    """
    close = data["close"]
    tsmax = TSMAX(close, 12)
    deviation = 100 * (close - tsmax) / tsmax
    return MEAN(deviation * deviation, 12) ** 0.5


@alpha(128, desc="MFI: 100 - 100/(1+upflow/downflow)")
def alpha_128(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha128: 14 日资金流量指标。"""
    tp = (data["high"] + data["low"] + data["close"]) / 3
    volume = data["volume"]
    prev_tp = DELAY(tp, 1)
    zero = pd.DataFrame(0.0, index=tp.index, columns=tp.columns)
    up = IF(tp > prev_tp, tp * volume, zero)
    dn = IF(tp < prev_tp, tp * volume, zero)
    ratio = SUM_(up, 14) / SUM_(dn, 14)
    one = pd.DataFrame(1.0, index=tp.index, columns=tp.columns)
    return 100 - 100 / (one + ratio)


@alpha(129, desc="SUM(|negative ΔC|, 12)")
def alpha_129(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha129: 12 日下跌幅度累加。"""
    close = data["close"]
    chg = close - DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    neg = IF(chg < 0, ABS(chg), zero)
    return SUM_(neg, 12)


@alpha(133, desc="((20-HIGHDAY)/20 - (20-LOWDAY)/20) * 100 高低点位置差")
def alpha_133(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha133: 20 日内最高点与最低点位置之差（×100）。"""
    high_pos = (20 - HIGHDAY(data["high"], 20)) / 20 * 100
    low_pos = (20 - LOWDAY(data["low"], 20)) / 20 * 100
    return high_pos - low_pos


@alpha(134, desc="(C-DELAY(C,12))/DELAY(C,12)*V 12 日量加权动量")
def alpha_134(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha134: 12 日动量 × 当日量。"""
    close = data["close"]
    prev = DELAY(close, 12)
    return (close - prev) / prev * data["volume"]


@alpha(135, desc="SMA(DELAY(C/DELAY(C,20),1), 20, 1) 滞后 20 日动量平滑")
def alpha_135(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha135: 20 日动量比的滞后 SMA。"""
    close = data["close"]
    ratio = close / DELAY(close, 20)
    return SMA(DELAY(ratio, 1), 20, 1)


@alpha(139, desc="-CORR(O, V, 10) 开盘/量 10 日相关性取负")
def alpha_139(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha139: 开盘与成交量 10 日相关性取负。"""
    return -1 * CORR(data["open"], data["volume"], 10)


@alpha(141, desc="-RANK(CORR(RANK(H), RANK(MEAN(V,15)), 9))")
def alpha_141(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha141: 高价/15 日均量排名 9 日相关性横截面排名取负。"""
    return -1 * RANK(CORR(RANK(data["high"]), RANK(MEAN(data["volume"], 15)), 9))


@alpha(142, desc="-RANK(TSRANK(C,10)) * RANK(Δ(ΔC,1)) * RANK(TSRANK(V/MEAN(V,20),5))")
def alpha_142(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha142: 三因子乘积（动量时序排名 × 加速度 × 量能时序排名）取负。"""
    close = data["close"]
    volume = data["volume"]
    return (-1 * RANK(TSRANK(close, 10))
            * RANK(DELTA(DELTA(close, 1), 1))
            * RANK(TSRANK(volume / MEAN(volume, 20), 5)))


@alpha(144, desc="SUMIF(|ΔC/C|/AMOUNT, 20, C<DELAY(C,1)) / COUNT(C<DELAY(C,1), 20)")
def alpha_144(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha144: 下跌日单位成交额对应的涨跌幅平均（资金效率反向）。"""
    close = data["close"]
    amount = data["amount"]
    prev_close = DELAY(close, 1)
    abs_ret = ABS(close / prev_close - 1) / amount
    cond = close < prev_close
    cnt = COUNT(cond, 20)
    return SUMIF(abs_ret, 20, cond) / cnt


@alpha(145, desc="(MEAN(V,9) - MEAN(V,26)) / MEAN(V,12) * 100")
def alpha_145(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha145: 短中量均线之差归一化（量能 MACD 变形）。"""
    volume = data["volume"]
    return (MEAN(volume, 9) - MEAN(volume, 26)) / MEAN(volume, 12) * 100


@alpha(147, desc="REGBETA(MEAN(C,12), SEQUENCE(12)) 12 日均线趋势斜率")
def alpha_147(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha147: 12 日均线对时间的回归斜率。"""
    return REGBETA(MEAN(data["close"], 12), SEQUENCE(12), 12)


@alpha(148, desc="RANK(CORR(O, SUM(MEAN(V,60),9), 6)) < RANK(O-TSMIN(O,14))  * -1")
def alpha_148(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha148: 量价相关性与开盘价位置的横截面比较。"""
    open_ = data["open"]
    volume = data["volume"]
    p1 = RANK(CORR(open_, SUM_(MEAN(volume, 60), 9), 6))
    p2 = RANK(open_ - TSMIN(open_, 14))
    cond = p1 < p2
    one = pd.DataFrame(1.0, index=open_.index, columns=open_.columns)
    zero = pd.DataFrame(0.0, index=open_.index, columns=open_.columns)
    return IF(cond, one, zero) * -1


@alpha(151, desc="SMA(C - DELAY(C,20), 20, 1) 20 日动量平滑")
def alpha_151(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha151: 20 日动量的 SMA(20,1) 平滑。"""
    close = data["close"]
    return SMA(close - DELAY(close, 20), 20, 1)


@alpha(152, desc="SMA(MEAN(DELAY(SMA(DELAY(C/DELAY(C,9),1),9,1),1),12) - MEAN(...,26), 9, 1)")
def alpha_152(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha152: 长链路 SMA 嵌套（9 日动量 → SMA → 滞后 → 长短均线之差 → SMA）。"""
    close = data["close"]
    base = SMA(DELAY(close / DELAY(close, 9), 1), 9, 1)
    delayed_base = DELAY(base, 1)
    return SMA(MEAN(delayed_base, 12) - MEAN(delayed_base, 26), 9, 1)


@alpha(155, desc="量版 MACD: SMA(V,13,2) - SMA(V,27,2) - SMA(SMA(V,13,2)-SMA(V,27,2),10,2)")
def alpha_155(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha155: 量能 MACD 柱（与 Alpha89 同形但用 V）。"""
    volume = data["volume"]
    ema_s = SMA(volume, 13, 2)
    ema_l = SMA(volume, 27, 2)
    dif = ema_s - ema_l
    dea = SMA(dif, 10, 2)
    return dif - dea


@alpha(158, desc="(H - SMA(C,15,2) - (L - SMA(C,15,2))) / C 振幅相对收盘价")
def alpha_158(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha158: 振幅(H-L) / C。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    ema = SMA(close, 15, 2)
    return ((high - ema) - (low - ema)) / close


@alpha(160, desc="SMA(IF(C<=DELAY(C,1), STD(C,20), 0), 20, 1)")
def alpha_160(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha160: 下跌或平盘日的 20 日波动 SMA 平滑。"""
    close = data["close"]
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    val = IF(close <= DELAY(close, 1), STD(close, 20), zero)
    return SMA(val, 20, 1)


@alpha(161, desc="MEAN(TR, 12) 12 日 ATR")
def alpha_161(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha161: 12 日 ATR（True Range 均值）。"""
    return MEAN(_tr(data), 12)


@alpha(167, desc="SUM(MAX(C-DELAY(C,1),0), 12) 12 日上涨幅度累加")
def alpha_167(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha167: 12 日上涨幅度累加（RSI 分子）。"""
    close = data["close"]
    chg = close - DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    return SUM_(MAX(chg, zero), 12)


@alpha(168, desc="-V / MEAN(V, 20) 当日量相对 20 日均量取负")
def alpha_168(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha168: 量能比率取负（缩量更高分）。"""
    volume = data["volume"]
    return -1 * volume / MEAN(volume, 20)


@alpha(169, desc="SMA(MEAN(DELAY(SMA(ΔC,9,1),1),12) - MEAN(...,26), 10, 1)")
def alpha_169(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha169: 类 Alpha152 但基于 ΔC 而非动量比。"""
    close = data["close"]
    base = SMA(close - DELAY(close, 1), 9, 1)
    delayed = DELAY(base, 1)
    return SMA(MEAN(delayed, 12) - MEAN(delayed, 26), 10, 1)


@alpha(170, desc="复合: RANK(1/C)*V/MEAN(V,20) * H*RANK(H-C)/(SUM(H,5)/5) - RANK(VWAP-DELAY(VWAP,5))")
def alpha_170(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha170: 量价复合因子。"""
    close = data["close"]
    high = data["high"]
    volume = data["volume"]
    vwap = data["vwap"]
    p1 = (RANK(1 / close) * volume / MEAN(volume, 20)
          * (high * RANK(high - close) / (SUM_(high, 5) / 5)))
    return p1 - RANK(vwap - DELAY(vwap, 5))


@alpha(171, desc="-((L-C)*O^5) / ((C-H)*C^5)")
def alpha_171(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha171: 量价非线性形态因子。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    open_ = data["open"]
    return -1 * ((low - close) * (open_ ** 5)) / ((close - high) * (close ** 5))


@alpha(173, desc="3*SMA(C,13,2) - 2*SMA(SMA(C,13,2),13,2) + SMA(SMA(SMA(log(C),13,2),13,2),13,2)")
def alpha_173(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha173: TRIX 类的三层 SMA 组合。"""
    close = data["close"]
    s1 = SMA(close, 13, 2)
    s2 = SMA(s1, 13, 2)
    s3 = SMA(SMA(SMA(LOG(close), 13, 2), 13, 2), 13, 2)
    return 3 * s1 - 2 * s2 + s3


@alpha(174, desc="SMA(IF(C>DELAY(C,1), STD(C,20), 0), 20, 1)")
def alpha_174(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha174: 上涨日 20 日波动的 SMA 平滑。"""
    close = data["close"]
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    val = IF(close > DELAY(close, 1), STD(close, 20), zero)
    return SMA(val, 20, 1)


@alpha(175, desc="MEAN(TR, 6) 6 日 ATR")
def alpha_175(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha175: 6 日 ATR。"""
    return MEAN(_tr(data), 6)


@alpha(176, desc="CORR(RANK((C-TSMIN(L,12))/(TSMAX(H,12)-TSMIN(L,12))), RANK(V), 6)")
def alpha_176(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha176: KDJ-RSV 排名与量排名 6 日相关性。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    tsmin_l = TSMIN(low, 12)
    tsmax_h = TSMAX(high, 12)
    rsv = (close - tsmin_l) / (tsmax_h - tsmin_l)
    return CORR(RANK(rsv), RANK(data["volume"]), 6)


@alpha(177, desc="((20-HIGHDAY(HIGH,20))/20)*100 高点位置位次")
def alpha_177(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha177: 20 日内最高点位置（越近越高分）。"""
    return (20 - HIGHDAY(data["high"], 20)) / 20 * 100


@alpha(178, desc="(C-DELAY(C,1))/DELAY(C,1) * V 当日涨跌幅 × 量")
def alpha_178(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha178: 当日收益率 × 量。"""
    close = data["close"]
    prev = DELAY(close, 1)
    return (close - prev) / prev * data["volume"]


@alpha(179, desc="RANK(CORR(VWAP, V, 4)) * RANK(CORR(RANK(L), RANK(MEAN(V,50)), 12))")
def alpha_179(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha179: 双层量价相关性排名乘积。"""
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(CORR(vwap, volume, 4))
    p2 = RANK(CORR(RANK(data["low"]), RANK(MEAN(volume, 50)), 12))
    return p1 * p2


@alpha(184, desc="RANK(CORR(DELAY(O-C,1), C, 200)) + RANK(O-C)")
def alpha_184(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha184: 长周期开收差与收盘相关性 + 当日开收差排名。"""
    open_ = data["open"]
    close = data["close"]
    return RANK(CORR(DELAY(open_ - close, 1), close, 200)) + RANK(open_ - close)


@alpha(185, desc="RANK(-(1-O/C)^2) 开收比平方反向排名")
def alpha_185(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha185: 开盘/收盘偏离平方取负的横截面排名。"""
    open_ = data["open"]
    close = data["close"]
    return RANK(-1 * (1 - open_ / close) ** 2)


@alpha(187, desc="SUM(IF(O<=DELAY(O,1), 0, MAX(H-O, O-DELAY(O,1))), 20) DTM 累加")
def alpha_187(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha187: 20 日 DTM 累加（上行能量）。"""
    return SUM_(_dtm(data), 20)


@alpha(188, desc="((H-L - SMA(H-L,11,2)) / SMA(H-L,11,2)) * 100 (论文 em-dash 修正)")
def alpha_188(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha188: 振幅与其 SMA 偏离百分比。论文公式中的 em-dash 视为减号修正。"""
    rng = data["high"] - data["low"]
    smoothed = SMA(rng, 11, 2)
    return (rng - smoothed) / smoothed * 100


@alpha(189, desc="MEAN(|C-MEAN(C,6)|, 6) 收盘偏离 6 日均线的 MAD")
def alpha_189(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha189: 收盘相对 6 日均线的 6 日平均绝对偏离。"""
    close = data["close"]
    return MEAN(ABS(close - MEAN(close, 6)), 6)


@alpha(191, desc="CORR(MEAN(V,20), L, 5) + (H+L)/2 - C")
def alpha_191(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha191: 量价相关性 + 当日收盘位置反向。"""
    high = data["high"]
    low = data["low"]
    return CORR(MEAN(data["volume"], 20), low, 5) + (high + low) / 2 - data["close"]


# ════════════════════════════════════════════════════════════════════
# ═══ 第三批：补齐剩余可计算因子（51 个）— DECAY/CORR 复合 + 复杂条件 ═══
# ════════════════════════════════════════════════════════════════════


@alpha(27, desc="WMA(ROC3 + ROC6, 12) 双周期 ROC 加权")
def alpha_27(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha27: 3 日 ROC + 6 日 ROC 的 WMA(12) 平滑。"""
    close = data["close"]
    roc3 = (close - DELAY(close, 3)) / DELAY(close, 3) * 100
    roc6 = (close - DELAY(close, 6)) / DELAY(close, 6) * 100
    return WMA(roc3 + roc6, 12)


@alpha(33, desc="(-TSMIN(L,5)+DELAY(TSMIN(L,5),5)) * RANK((SUM(RET,240)-SUM(RET,20))/220) * TSRANK(V,5)")
def alpha_33(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha33: 多周期组合 — 低位变化 × 中长期超额 × 量能时序排名。"""
    low = data["low"]
    ret = data["ret"]
    volume = data["volume"]
    tsmin_low = TSMIN(low, 5)
    excess = (SUM_(ret, 240) - SUM_(ret, 20)) / 220
    return ((-1 * tsmin_low) + DELAY(tsmin_low, 5)) * RANK(excess) * TSRANK(volume, 5)


@alpha(44, desc="TSRANK(DECAY(CORR(L, MEAN(V,10),7),6),4) + TSRANK(DECAY(ΔVWAP,3),10),15)")
def alpha_44(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha44: 量价相关性 + VWAP 差分的双重 DECAY+TSRANK 组合。"""
    low = data["low"]
    volume = data["volume"]
    vwap = data["vwap"]
    p1 = TSRANK(DECAYLINEAR(CORR(low, MEAN(volume, 10), 7), 6), 4)
    p2 = TSRANK(DECAYLINEAR(DELTA(vwap, 3), 10), 15)
    return p1 + p2


@alpha(45, desc="RANK(Δ(0.6C+0.4O,1)) * RANK(CORR(VWAP, MEAN(V,150), 15))")
def alpha_45(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha45: 价格变化排名 × 长周期量价相关性排名。"""
    close = data["close"]
    open_ = data["open"]
    vwap = data["vwap"]
    volume = data["volume"]
    return RANK(DELTA(close * 0.6 + open_ * 0.4, 1)) * RANK(CORR(vwap, MEAN(volume, 150), 15))


@alpha(56, desc="RANK(O-TSMIN(O,12)) < RANK(RANK(CORR(SUM((H+L)/2,19), SUM(MEAN(V,40),19),13))^5)")
def alpha_56(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha56: 横截面比较 — 开盘位置 vs 量价相关性 5 次方。返回 0/1。"""
    open_ = data["open"]
    high = data["high"]
    low = data["low"]
    volume = data["volume"]
    p1 = RANK(open_ - TSMIN(open_, 12))
    inner = CORR(SUM_((high + low) / 2, 19), SUM_(MEAN(volume, 40), 19), 13)
    p2 = RANK(RANK(inner) ** 5)
    one = pd.DataFrame(1.0, index=open_.index, columns=open_.columns)
    zero = pd.DataFrame(0.0, index=open_.index, columns=open_.columns)
    return IF(p1 < p2, one, zero)


@alpha(59, desc="20 日累计资金流向（Alpha3 的 20 日版本）")
def alpha_59(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha59: Alpha3 的 20 日窗口版本。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    prev_close = DELAY(close, 1)
    ref = IF(close > prev_close, MIN(low, prev_close), MAX(high, prev_close))
    diff = close - ref
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    masked = IF(close == prev_close, zero, diff)
    return SUM_(masked, 20)


@alpha(61, desc="MAX(RANK(DECAY(ΔVWAP,12)), RANK(DECAY(RANK(CORR(L,MEAN(V,80),8)),17))) * -1")
def alpha_61(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha61: 两个 DECAY 排名取最大值再取负。"""
    low = data["low"]
    volume = data["volume"]
    vwap = data["vwap"]
    p1 = RANK(DECAYLINEAR(DELTA(vwap, 1), 12))
    p2 = RANK(DECAYLINEAR(RANK(CORR(low, MEAN(volume, 80), 8)), 17))
    return MAX(p1, p2) * -1


@alpha(64, desc="MAX(RANK(DECAY(CORR(RANK(VWAP),RANK(V),4),4)), RANK(DECAY(MAX(CORR(RANK(C),RANK(MEAN(V,60)),4),13),14))) * -1")
def alpha_64(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha64: 双重 RANK+DECAY+CORR 组合。"""
    close = data["close"]
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR(CORR(RANK(vwap), RANK(volume), 4), 4))
    inner = CORR(RANK(close), RANK(MEAN(volume, 60)), 4)
    p2 = RANK(DECAYLINEAR(TSMAX(inner, 13), 14))
    return MAX(p1, p2) * -1


@alpha(73, desc="(TSRANK(DECAY(DECAY(CORR(C,V,10),16),4),5) - RANK(DECAY(CORR(VWAP,MEAN(V,30),4),3))) * -1")
def alpha_73(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha73: 嵌套 DECAY + TSRANK 与单层 DECAY+RANK 之差取负。"""
    close = data["close"]
    volume = data["volume"]
    vwap = data["vwap"]
    p1 = TSRANK(DECAYLINEAR(DECAYLINEAR(CORR(close, volume, 10), 16), 4), 5)
    p2 = RANK(DECAYLINEAR(CORR(vwap, MEAN(volume, 30), 4), 3))
    return (p1 - p2) * -1


@alpha(74, desc="RANK(CORR(SUM(0.35L+0.65VWAP,20), SUM(MEAN(V,40),20),7)) + RANK(CORR(RANK(VWAP),RANK(V),6))")
def alpha_74(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha74: 长短量价相关性的双重排名之和。"""
    low = data["low"]
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(CORR(SUM_(low * 0.35 + vwap * 0.65, 20), SUM_(MEAN(volume, 40), 20), 7))
    p2 = RANK(CORR(RANK(vwap), RANK(volume), 6))
    return p1 + p2


@alpha(76, desc="STD(|ret|/V, 20) / MEAN(|ret|/V, 20) 单位量振幅的离散系数")
def alpha_76(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha76: 单位量收益绝对值的离散系数 (CV)。"""
    close = data["close"]
    volume = data["volume"]
    abs_ret_per_vol = ABS(close / DELAY(close, 1) - 1) / volume
    return STD(abs_ret_per_vol, 20) / MEAN(abs_ret_per_vol, 20)


@alpha(77, desc="MIN(RANK(DECAY(((H+L)/2+H-(VWAP+H)),20)), RANK(DECAY(CORR((H+L)/2,MEAN(V,40),3),6)))")
def alpha_77(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha77: 两个 DECAY 排名取最小值。"""
    high = data["high"]
    low = data["low"]
    vwap = data["vwap"]
    volume = data["volume"]
    mid = (high + low) / 2
    p1 = RANK(DECAYLINEAR((mid + high) - (vwap + high), 20))
    p2 = RANK(DECAYLINEAR(CORR(mid, MEAN(volume, 40), 3), 6))
    return MIN(p1, p2)


@alpha(87, desc="RANK(DECAY(ΔVWAP,7)) + TSRANK(DECAY(影线相对位置,11),7)) * -1")
def alpha_87(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha87: VWAP 差分 DECAY 排名 + 影线相对位置 TSRANK，取负。"""
    high = data["high"]
    low = data["low"]
    open_ = data["open"]
    vwap = data["vwap"]
    p1 = RANK(DECAYLINEAR(DELTA(vwap, 4), 7))
    # (LOW*0.9 + LOW*0.1) = LOW（论文公式如此，应该是 LOW vs HIGH 笔误，按字面实现）
    inner = ((low * 0.9 + low * 0.1) - vwap) / (open_ - (high + low) / 2)
    p2 = TSRANK(DECAYLINEAR(inner, 11), 7)
    return (p1 + p2) * -1


@alpha(91, desc="RANK(C-MAX(C,5)) * RANK(CORR(MEAN(V,40),L,5)) * -1")
def alpha_91(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha91: 近期下跌 × 长量与低价相关性 取负。"""
    close = data["close"]
    low = data["low"]
    volume = data["volume"]
    return RANK(close - TSMAX(close, 5)) * RANK(CORR(MEAN(volume, 40), low, 5)) * -1


@alpha(92, desc="MAX(RANK(DECAY(Δ(0.35C+0.65VWAP,2),3)), TSRANK(DECAY(|CORR(MEAN(V,180),C,13)|,5),15)) * -1")
def alpha_92(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha92: 量价混合差分 DECAY vs 长周期相关性 TSRANK，取最大并取负。"""
    close = data["close"]
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR(DELTA(close * 0.35 + vwap * 0.65, 2), 3))
    p2 = TSRANK(DECAYLINEAR(ABS(CORR(MEAN(volume, 180), close, 13)), 5), 15)
    return MAX(p1, p2) * -1


@alpha(101, desc="(RANK(CORR(C, SUM(MEAN(V,30),37), 15)) < RANK(CORR(RANK(0.1H+0.9VWAP), RANK(V), 11))) * -1")
def alpha_101(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha101: 量价长周期 vs 短周期相关性的横截面比较。"""
    close = data["close"]
    high = data["high"]
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(CORR(close, SUM_(MEAN(volume, 30), 37), 15))
    p2 = RANK(CORR(RANK(high * 0.1 + vwap * 0.9), RANK(volume), 11))
    one = pd.DataFrame(1.0, index=close.index, columns=close.columns)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    return IF(p1 < p2, one, zero) * -1


@alpha(104, desc="-ΔCORR(H,V,5)(5) * RANK(STD(C,20))")
def alpha_104(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha104: 量价相关性 5 日变化 × 收盘波动横截面排名 取负。"""
    high = data["high"]
    volume = data["volume"]
    close = data["close"]
    return -1 * DELTA(CORR(high, volume, 5), 5) * RANK(STD(close, 20))


@alpha(108, desc="(RANK(H-MIN(H,2))^RANK(CORR(VWAP,MEAN(V,120),6))) * -1")
def alpha_108(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha108: 高价 2 日下跌排名 ^ 长周期量价相关性排名 取负。"""
    high = data["high"]
    vwap = data["vwap"]
    volume = data["volume"]
    base = RANK(high - TSMIN(high, 2))
    exp_ = RANK(CORR(vwap, MEAN(volume, 120), 6))
    sign = SIGN(base)
    return sign * ABS(base) ** exp_ * -1


@alpha(113, desc="-RANK(SUM(DELAY(C,5),20)/20) * CORR(C,V,2) * RANK(CORR(SUM(C,5),SUM(C,20),2))")
def alpha_113(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha113: 长期均值排名 × 短期量价相关 × 长短均线相关性排名 取负。"""
    close = data["close"]
    volume = data["volume"]
    p1 = RANK(SUM_(DELAY(close, 5), 20) / 20)
    p2 = CORR(close, volume, 2)
    p3 = RANK(CORR(SUM_(close, 5), SUM_(close, 20), 2))
    return -1 * p1 * p2 * p3


@alpha(114, desc="(RANK(DELAY(振幅率,2)) * RANK(RANK(V))) / (振幅率 / (VWAP-C))")
def alpha_114(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha114: 复杂量价比率因子（振幅 / 5 日均价 × VWAP 偏离）。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    volume = data["volume"]
    vwap = data["vwap"]
    amp_rate = (high - low) / (SUM_(close, 5) / 5)
    num = RANK(DELAY(amp_rate, 2)) * RANK(RANK(volume))
    den = amp_rate / (vwap - close)
    return num / den


@alpha(115, desc="RANK(CORR(0.9H+0.1C, MEAN(V,30), 10)) ^ RANK(CORR(TSRANK((H+L)/2,4), TSRANK(V,10), 7))")
def alpha_115(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha115: 量价相关性的指数组合。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    volume = data["volume"]
    base = RANK(CORR(high * 0.9 + close * 0.1, MEAN(volume, 30), 10))
    exp_ = RANK(CORR(TSRANK((high + low) / 2, 4), TSRANK(volume, 10), 7))
    return SIGN(base) * ABS(base) ** exp_


@alpha(121, desc="(RANK(VWAP-MIN(VWAP,12)) ^ TSRANK(CORR(TSRANK(VWAP,20), TSRANK(MEAN(V,60),2), 18), 3)) * -1")
def alpha_121(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha121: VWAP 短期下跌 ^ 长周期量价时序相关性 取负。"""
    vwap = data["vwap"]
    volume = data["volume"]
    base = RANK(vwap - TSMIN(vwap, 12))
    inner = CORR(TSRANK(vwap, 20), TSRANK(MEAN(volume, 60), 2), 18)
    exp_ = TSRANK(inner, 3)
    return SIGN(base) * ABS(base) ** exp_ * -1


@alpha(123, desc="(RANK(CORR(SUM((H+L)/2,20), SUM(MEAN(V,60),20), 9)) < RANK(CORR(L,V,6))) * -1")
def alpha_123(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha123: 长周期量价相关性 vs 短周期低价/量相关性的横截面比较。"""
    high = data["high"]
    low = data["low"]
    volume = data["volume"]
    p1 = RANK(CORR(SUM_((high + low) / 2, 20), SUM_(MEAN(volume, 60), 20), 9))
    p2 = RANK(CORR(low, volume, 6))
    one = pd.DataFrame(1.0, index=high.index, columns=high.columns)
    zero = pd.DataFrame(0.0, index=high.index, columns=high.columns)
    return IF(p1 < p2, one, zero) * -1


@alpha(125, desc="RANK(DECAY(CORR(VWAP,MEAN(V,80),17),20)) / RANK(DECAY(Δ(0.5C+0.5VWAP,3),16))")
def alpha_125(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha125: 量价相关性 DECAY 排名 / 价格变化 DECAY 排名。"""
    close = data["close"]
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR(CORR(vwap, MEAN(volume, 80), 17), 20))
    p2 = RANK(DECAYLINEAR(DELTA(close * 0.5 + vwap * 0.5, 3), 16))
    return p1 / p2


@alpha(130, desc="RANK(DECAY(CORR((H+L)/2, MEAN(V,40), 9), 10)) / RANK(DECAY(CORR(RANK(VWAP),RANK(V),7),3))")
def alpha_130(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha130: 中价/长量相关性 DECAY 排名 / VWAP/量排名相关性 DECAY 排名。"""
    high = data["high"]
    low = data["low"]
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR(CORR((high + low) / 2, MEAN(volume, 40), 9), 10))
    p2 = RANK(DECAYLINEAR(CORR(RANK(vwap), RANK(volume), 7), 3))
    return p1 / p2


@alpha(131, desc="RANK(ΔVWAP,1) ^ TSRANK(CORR(C, MEAN(V,50), 18), 18) (DELAT→DELTA typo 修正)")
def alpha_131(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha131: VWAP 差分排名 ^ 量价相关性时序排名。论文 ``DELAT`` 修正为 ``DELTA``。"""
    close = data["close"]
    vwap = data["vwap"]
    volume = data["volume"]
    base = RANK(DELTA(vwap, 1))
    exp_ = TSRANK(CORR(close, MEAN(volume, 50), 18), 18)
    return SIGN(base) * ABS(base) ** exp_


@alpha(136, desc="-RANK(Δ(RET,3)) * CORR(O,V,10)")
def alpha_136(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha136: 收益加速度排名 × 开盘/量相关性 取负。"""
    ret = data["ret"]
    open_ = data["open"]
    volume = data["volume"]
    return -1 * RANK(DELTA(ret, 3)) * CORR(open_, volume, 10)


@alpha(138, desc="(RANK(DECAY(Δ(0.7L+0.3VWAP,3),20)) - TSRANK(DECAY(TSRANK(CORR(TSRANK(L,8),TSRANK(MEAN(V,60),17),5),19),16),7)) * -1")
def alpha_138(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha138: 多层 TSRANK + DECAY + CORR 嵌套，取负。"""
    low = data["low"]
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR(DELTA(low * 0.7 + vwap * 0.3, 3), 20))
    inner_corr = CORR(TSRANK(low, 8), TSRANK(MEAN(volume, 60), 17), 5)
    p2 = TSRANK(DECAYLINEAR(TSRANK(inner_corr, 19), 16), 7)
    return (p1 - p2) * -1


@alpha(140, desc="MIN(RANK(DECAY((RANK(O)+RANK(L))-(RANK(H)+RANK(C)),8)), TSRANK(DECAY(CORR(TSRANK(C,8),TSRANK(MEAN(V,60),20),8),7),3))")
def alpha_140(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha140: 排名组合 DECAY 与 TSRANK+DECAY+CORR 之最小值。"""
    open_ = data["open"]
    low = data["low"]
    high = data["high"]
    close = data["close"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR((RANK(open_) + RANK(low)) - (RANK(high) + RANK(close)), 8))
    p2 = TSRANK(DECAYLINEAR(CORR(TSRANK(close, 8), TSRANK(MEAN(volume, 60), 20), 8), 7), 3)
    return MIN(p1, p2)


@alpha(154, desc="(VWAP-MIN(VWAP,16)) < CORR(VWAP, MEAN(V,180), 18)  返回 0/1")
def alpha_154(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha154: 短期 VWAP 位置 vs 长周期量价相关性的横截面比较。"""
    vwap = data["vwap"]
    volume = data["volume"]
    p1 = vwap - TSMIN(vwap, 16)
    p2 = CORR(vwap, MEAN(volume, 180), 18)
    one = pd.DataFrame(1.0, index=vwap.index, columns=vwap.columns)
    zero = pd.DataFrame(0.0, index=vwap.index, columns=vwap.columns)
    return IF(p1 < p2, one, zero)


@alpha(156, desc="MAX(RANK(DECAY(ΔVWAP,5),3), RANK(DECAY(-Δ(0.15O+0.85L,2)/...),3)) * -1")
def alpha_156(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha156: VWAP 差分 DECAY vs 加权 OL 变化率 DECAY，取最大并取负。"""
    open_ = data["open"]
    low = data["low"]
    vwap = data["vwap"]
    base = open_ * 0.15 + low * 0.85
    p1 = RANK(DECAYLINEAR(DELTA(vwap, 5), 3))
    p2 = RANK(DECAYLINEAR((DELTA(base, 2) / base) * -1, 3))
    return MAX(p1, p2) * -1


@alpha(159, desc="加权三周期 MFI: 6/12/24 日窗口加权（HGIH→HIGH typo 修正）")
def alpha_159(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha159: 三周期 MFI 加权平均。论文 ``HGIH`` 修正为 ``HIGH``。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    prev_close = DELAY(close, 1)
    min_lc = MIN(low, prev_close)
    max_hc = MAX(high, prev_close)
    range_ = max_hc - min_lc

    def _period(n: int) -> pd.DataFrame:
        return (close - SUM_(min_lc, n)) / SUM_(range_, n)

    a6 = _period(6) * 12 * 24
    a12 = _period(12) * 6 * 24
    a24 = _period(24) * 6 * 24
    return (a6 + a12 + a24) * 100 / (6 * 12 + 6 * 24 + 12 * 24)


@alpha(162, desc="标准化 RSI: (RSI - TSMIN(RSI,12)) / (TSMAX(RSI,12) - TSMIN(RSI,12))")
def alpha_162(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha162: 12 日 RSI 在过去 12 日内的归一化位置。"""
    close = data["close"]
    chg = close - DELAY(close, 1)
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    up = MAX(chg, zero)
    rsi = SMA(up, 12, 1) / SMA(ABS(chg), 12, 1) * 100
    return (rsi - TSMIN(rsi, 12)) / (TSMAX(rsi, 12) - TSMIN(rsi, 12))


@alpha(163, desc="RANK(-RET * MEAN(V,20) * VWAP * (H-C))")
def alpha_163(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha163: 收益反向 × 长量 × VWAP × 影线，取横截面排名。"""
    ret = data["ret"]
    volume = data["volume"]
    vwap = data["vwap"]
    high = data["high"]
    close = data["close"]
    return RANK(-1 * ret * MEAN(volume, 20) * vwap * (high - close))


@alpha(164, desc="SMA(条件化倒数差分 / (H-L) × 100, 13, 2)")
def alpha_164(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha164: 上涨日 1/ΔC 与其 12 日最小值之差 / 振幅，平滑。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    prev = DELAY(close, 1)
    diff = close - prev
    one = pd.DataFrame(1.0, index=close.index, columns=close.columns)
    # 1/ΔC if C>DELAY(C,1) else 1
    inv = IF(close > prev, one / diff.where(diff != 0, np.nan), one)
    return SMA((inv - TSMIN(inv, 12)) / (high - low) * 100, 13, 2)


@alpha(180, desc="放量日: -TSRANK(|ΔC(7)|,60)*SIGN(ΔC(7))；其他: -V")
def alpha_180(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha180: 放量日反转 vs 缩量日量能反向。"""
    close = data["close"]
    volume = data["volume"]
    delta_c7 = DELTA(close, 7)
    case_high_vol = -1 * TSRANK(ABS(delta_c7), 60) * SIGN(delta_c7)
    case_low_vol = -1 * volume
    return IF(MEAN(volume, 20) < volume, case_high_vol, case_low_vol)


# ── ADX 辅助函数 (Alpha172/186 用) ──────────────────────────


def _ldhd_pos(data: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """计算 +DI / -DI 的分子: (LD>0 & LD>HD)? LD : 0 和 (HD>0 & HD>LD)? HD : 0。"""
    ld = _ld(data)   # DELAY(L,1) - L
    hd = _hd(data)   # H - DELAY(H,1)
    zero = pd.DataFrame(0.0, index=ld.index, columns=ld.columns)
    minus_dm = IF((ld > 0) & (ld > hd), ld, zero)
    plus_dm = IF((hd > 0) & (hd > ld), hd, zero)
    return plus_dm, minus_dm


def _adx_inner(data: dict[str, pd.DataFrame], n: int = 14) -> pd.DataFrame:
    """
    返回 ADX 的核心: |+DI - -DI| / (+DI + -DI) × 100，未做最终平滑。
    +DI = SUM(plus_dm, n) × 100 / SUM(TR, n)
    -DI = SUM(minus_dm, n) × 100 / SUM(TR, n)
    """
    plus_dm, minus_dm = _ldhd_pos(data)
    tr = _tr(data)
    sum_tr = SUM_(tr, n)
    plus_di = SUM_(plus_dm, n) * 100 / sum_tr
    minus_di = SUM_(minus_dm, n) * 100 / sum_tr
    return ABS(plus_di - minus_di) / (plus_di + minus_di) * 100


@alpha(172, desc="MEAN(ADX, 6) 6 日 ADX 平均")
def alpha_172(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha172: 14 日 ADX 的 6 日均值。"""
    return MEAN(_adx_inner(data, n=14), 6)


@alpha(186, desc="(MEAN(ADX,6) + DELAY(MEAN(ADX,6), 6)) / 2  双周期 ADX")
def alpha_186(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha186: ADX 6 日均值 + 其 6 日滞后的平均。"""
    base = MEAN(_adx_inner(data, n=14), 6)
    return (base + DELAY(base, 6)) / 2


# ── Alpha23: 上涨 vs 下跌日波动占比 (typo 修正) ─────────────


@alpha(23, desc="20 日上涨日波动占总波动比例 (论文 STD(CLOSE:20),0 视为 STD(CLOSE,20) typo 修正)")
def alpha_23(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha23: 上涨日 STD 与上涨+下跌日 STD 之比，× 100。

    论文公式中 ``STD(CLOSE:20),0`` 视为 ``STD(CLOSE,20)`` typo 修正。
    """
    close = data["close"]
    zero = pd.DataFrame(0.0, index=close.index, columns=close.columns)
    std20 = STD(close, 20)
    up_std = IF(close > DELAY(close, 1), std20, zero)
    dn_std = IF(close <= DELAY(close, 1), std20, zero)
    sma_up = SMA(up_std, 20, 1)
    sma_dn = SMA(dn_std, 20, 1)
    return sma_up / (sma_up + sma_dn) * 100


# ── Alpha49/50/51: 中点上行/下行能量 ────────────────────────


def _alpha49_a(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """中点下降日(H+L < prev) 的最大单边振幅。"""
    high = data["high"]
    low = data["low"]
    mid_now = high + low
    mid_prev = DELAY(high, 1) + DELAY(low, 1)
    zero = pd.DataFrame(0.0, index=high.index, columns=high.columns)
    val = MAX(ABS(high - DELAY(high, 1)), ABS(low - DELAY(low, 1)))
    return IF(mid_now >= mid_prev, zero, val)


def _alpha49_b(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """中点上升日(H+L > prev) 的最大单边振幅。"""
    high = data["high"]
    low = data["low"]
    mid_now = high + low
    mid_prev = DELAY(high, 1) + DELAY(low, 1)
    zero = pd.DataFrame(0.0, index=high.index, columns=high.columns)
    val = MAX(ABS(high - DELAY(high, 1)), ABS(low - DELAY(low, 1)))
    return IF(mid_now <= mid_prev, zero, val)


@alpha(49, desc="SUM(下降能量, 12) / (SUM(下降能量,12) + SUM(上升能量,12))")
def alpha_49(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha49: 12 日中点下降能量占总能量比例。"""
    a = SUM_(_alpha49_a(data), 12)
    b = SUM_(_alpha49_b(data), 12)
    return a / (a + b)


@alpha(50, desc="(SUM(上升能量,12) - SUM(下降能量,12)) / (SUM(上升,12) + SUM(下降,12))")
def alpha_50(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha50: 中点能量净流入比例（=1-2*Alpha49）。"""
    a = SUM_(_alpha49_a(data), 12)
    b = SUM_(_alpha49_b(data), 12)
    return (b - a) / (a + b)


@alpha(51, desc="SUM(上升能量,12) / (SUM(上升,12) + SUM(下降,12))  与 Alpha49 互补")
def alpha_51(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha51: 12 日中点上升能量占总能量比例（=1-Alpha49）。"""
    a = SUM_(_alpha49_a(data), 12)
    b = SUM_(_alpha49_b(data), 12)
    return b / (a + b)


# ── Alpha86: 二阶差分阈值条件 ───────────────────────────────


@alpha(86, desc="二阶差分: 0.25 < (DELAY(C,20)-DELAY(C,10))/10 - (DELAY(C,10)-C)/10 → -1; <0 → +1; 其他 → -ΔC")
def alpha_86(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha86: 中长期趋势二阶差分的三分类逻辑。"""
    close = data["close"]
    seg1 = (DELAY(close, 20) - DELAY(close, 10)) / 10
    seg2 = (DELAY(close, 10) - close) / 10
    diff = seg1 - seg2
    one = pd.DataFrame(1.0, index=close.index, columns=close.columns)
    neg_one = -one
    case_default = -1 * (close - DELAY(close, 1))
    middle = IF(diff < 0, one, case_default)
    return IF(diff > 0.25, neg_one, middle)


# ── Alpha98: 长周期均线漂移率条件 ───────────────────────────


@alpha(98, desc="长周期(100日)均线漂移 < 5%: -(C-TSMIN(C,100)); 否则: -ΔC(3)")
def alpha_98(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha98: 100 日均线漂移幅度阈值切换的因子。"""
    close = data["close"]
    delta_ma = DELTA(SUM_(close, 100) / 100, 100) / DELAY(close, 100)
    cond = delta_ma <= 0.05
    case_a = -1 * (close - TSMIN(close, 100))
    case_b = -1 * DELTA(close, 3)
    return IF(cond, case_a, case_b)


# ── Alpha39: 复杂 DECAYLINEAR + CORR ────────────────────────


@alpha(39, desc="(RANK(DECAY(ΔC,2),8)) - RANK(DECAY(CORR(0.3VWAP+0.7O, SUM(MEAN(V,180),37), 14),12))) * -1")
def alpha_39(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha39: 收盘差分 DECAY vs 长周期量价相关性 DECAY 之差取负。"""
    close = data["close"]
    vwap = data["vwap"]
    open_ = data["open"]
    volume = data["volume"]
    p1 = RANK(DECAYLINEAR(DELTA(close, 2), 8))
    inner = CORR(vwap * 0.3 + open_ * 0.7, SUM_(MEAN(volume, 180), 37), 14)
    p2 = RANK(DECAYLINEAR(inner, 12))
    return (p1 - p2) * -1


# ── Alpha55/137: 复杂动量调和因子 ────────────────────────────


def _alpha55_mfm(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha55/137 共用的复杂动量分子分母：MFM (Money Flow Multiplier) 类。"""
    high = data["high"]
    low = data["low"]
    close = data["close"]
    open_ = data["open"]
    prev_c = DELAY(close, 1)
    prev_o = DELAY(open_, 1)
    prev_l = DELAY(low, 1)

    abs_hc = ABS(high - prev_c)
    abs_lc = ABS(low - prev_c)
    abs_hl_prev = ABS(high - prev_l)
    abs_co = ABS(prev_c - prev_o)

    # 三分支 case
    # case1: |H-prevC|>|L-prevC| & |H-prevC|>|H-prevL| → |H-prevC| + |L-prevC|/2 + |prevC-prevO|/4
    # case2: |L-prevC|>|H-prevL| & |L-prevC|>|H-prevC| → |L-prevC| + |H-prevC|/2 + |prevC-prevO|/4
    # case3 (else): |H-prevL| + |prevC-prevO|/4
    case1 = (abs_hc > abs_lc) & (abs_hc > abs_hl_prev)
    case2 = (abs_lc > abs_hl_prev) & (abs_lc > abs_hc)
    val1 = abs_hc + abs_lc / 2 + abs_co / 4
    val2 = abs_lc + abs_hc / 2 + abs_co / 4
    val3 = abs_hl_prev + abs_co / 4
    denom = IF(case1, val1, IF(case2, val2, val3))

    numerator = 16 * (close - prev_c + (close - open_) / 2 + prev_c - prev_o)
    multiplier = MAX(abs_hc, abs_lc)
    return numerator / denom * multiplier


@alpha(55, desc="SUM(MFM, 20) 20 日复杂动量累加")
def alpha_55(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha55: 复杂 MFM 公式的 20 日累加。"""
    return SUM_(_alpha55_mfm(data), 20)


@alpha(137, desc="MFM 当日值（Alpha55 的非累加版本）")
def alpha_137(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha137: 与 Alpha55 同分子分母，仅取当日值不做累加。"""
    return _alpha55_mfm(data)


# ── Alpha146: 收益相对长 EMA 偏离 ─────────────────────────


@alpha(146, desc="MEAN(ret-EMA61(ret),20) × (ret-EMA61(ret)) / SMA(EMA61(ret)^2,60)")
def alpha_146(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha146: 收益相对长 EMA 的偏离指标。

    论文公式：MEAN(x-m,20) * (x-m) / SMA((x-(x-m))^2, 60)
    其中 x = ret, m = SMA(x, 61, 2)
    化简后分母 = SMA(m^2, 60)
    """
    close = data["close"]
    x = close / DELAY(close, 1) - 1
    m = SMA(x, 61, 2)
    a = x - m
    return MEAN(a, 20) * a / SMA(m * m, 60)


# ── Alpha157: 复杂嵌套 LOG + RANK + PROD ────────────────────


@alpha(157, desc="MIN(PROD(RANK(RANK(LOG(SUM(TSMIN(RANK^3(-ΔC,5)),2),1))),1),5) + TSRANK(DELAY(-RET,6),5)")
def alpha_157(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha157: 多层 RANK + LOG + PROD 嵌套，再加上滞后收益时序排名。"""
    close = data["close"]
    ret = data["ret"]
    inner = -1 * RANK(DELTA(close - 1, 5))
    triple_rank = RANK(RANK(inner))
    log_part = LOG(SUM_(TSMIN(triple_rank, 2), 1))
    prod_part = PROD(RANK(RANK(log_part)), 1)
    five = pd.DataFrame(5.0, index=close.index, columns=close.columns)
    part_a = MIN(prod_part, five)
    part_b = TSRANK(DELAY(-1 * ret, 6), 5)
    return part_a + part_b


# ── Alpha165/183: SUMAC range 标准化 ────────────────────────


@alpha(165, desc="TSMAX(SUMAC(C-MEAN(C,48)),48) - TSMIN(SUMAC(...),48) / STD(C,48)")
def alpha_165(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha165: 收盘相对 48 日均价的累计偏离的极值范围 / 48 日波动。

    论文 MAX/MIN 未指定窗口，按内层窗口 48 实现为 TSMAX/TSMIN(...,48)。
    """
    close = data["close"]
    cum_dev = SUMAC(close - MEAN(close, 48))
    return TSMAX(cum_dev, 48) - TSMIN(cum_dev, 48) / STD(close, 48)


@alpha(183, desc="TSMAX(SUMAC(C-MEAN(C,24)),24) - TSMIN(SUMAC(...),24) / STD(C,24)")
def alpha_183(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha183: Alpha165 的 24 日窗口版本。"""
    close = data["close"]
    cum_dev = SUMAC(close - MEAN(close, 24))
    return TSMAX(cum_dev, 24) - TSMIN(cum_dev, 24) / STD(close, 24)


# ════════════════════════════════════════════════════════════════════
# ═══ 第四批：基准依赖因子（需 data['bench_open/high/low/close']）═══
# ════════════════════════════════════════════════════════════════════


def _require_bench(data: dict[str, pd.DataFrame]) -> None:
    """所有基准因子的前置检查 — 若 panel 没载入 bench_* 字段则给出明确错误。"""
    required = ["bench_open", "bench_close"]
    missing = [k for k in required if k not in data]
    if missing:
        raise KeyError(
            f"基准因子需要 {missing}，请用 load_panel(..., benchmark_symbol='000300.SH')"
            f"\n当前 data keys: {sorted(data.keys())}"
        )


@alpha(75, desc="COUNT(C>O & BENCH_C<BENCH_O, 50) / COUNT(BENCH_C<BENCH_O, 50) 大盘下跌日个股逆势涨频率")
def alpha_75(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha75: 大盘下跌日个股阳线的频率（逆势抗跌因子）。"""
    _require_bench(data)
    close = data["close"]
    open_ = data["open"]
    bench_close = data["bench_close"]
    bench_open = data["bench_open"]
    bench_down = bench_close < bench_open
    both_cond = (close > open_) & bench_down
    return COUNT(both_cond, 50) / COUNT(bench_down, 50)


@alpha(149, desc="REGBETA(下跌日 stock_ret, 下跌日 bench_ret, 252) 下行 beta")
def alpha_149(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha149: 252 日下行 beta — 仅在大盘下跌日做 stock_ret vs bench_ret 回归。

    论文公式 FILTER 函数：仅在条件为 True 的日子里取值。
    实现：在大盘下跌日才计 stock_ret 和 bench_ret，其他日填 NaN，
    再用 REGBETA 计算滚动 252 日斜率（rolling.cov / rolling.var）。
    """
    _require_bench(data)
    close = data["close"]
    bench_close = data["bench_close"]
    stock_ret = close / DELAY(close, 1) - 1
    bench_ret = bench_close / DELAY(bench_close, 1) - 1
    bench_down = bench_close < DELAY(bench_close, 1)
    # 仅大盘下跌日保留收益，其他设 NaN
    filtered_stock = stock_ret.where(bench_down)
    filtered_bench = bench_ret.where(bench_down)
    # 252 日滚动 OLS slope = cov(stock, bench) / var(bench)
    # 用 column-wise rolling 计算
    return REGBETA(filtered_stock, filtered_bench, 252)


@alpha(181, desc="20 日个股超额收益偏离 vs 大盘偏离平方的累计 / 大盘偏离三次方累计")
def alpha_181(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha181: 20 日个股相对大盘的超额偏离指标（含三阶矩）。

    论文公式相对复杂，按字面实现：
      分子 = SUM((stock_ret - MEAN(stock_ret,20)) - (BENCH - MEAN(BENCH,20))^2, 20)
      分母 = SUM((BENCH - MEAN(BENCH,20))^3, 20)  ← 论文写 SUM(...) 无窗口，按 20 实现
    """
    _require_bench(data)
    close = data["close"]
    bench_close = data["bench_close"]
    stock_ret = close / DELAY(close, 1) - 1
    bench_dev = bench_close - MEAN(bench_close, 20)
    num = SUM_((stock_ret - MEAN(stock_ret, 20)) - bench_dev * bench_dev, 20)
    den = SUM_(bench_dev * bench_dev * bench_dev, 20)
    return num / den


@alpha(182, desc="COUNT((C>O & BENCH_C>BENCH_O) | (C<O & BENCH_C<BENCH_O), 20) / 20 同向涨跌频率")
def alpha_182(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Alpha182: 20 日内个股与大盘同向涨跌的频率（共振因子）。"""
    _require_bench(data)
    close = data["close"]
    open_ = data["open"]
    bench_close = data["bench_close"]
    bench_open = data["bench_open"]
    both_up = (close > open_) & (bench_close > bench_open)
    both_down = (close < open_) & (bench_close < bench_open)
    same_direction = both_up | both_down
    return COUNT(same_direction, 20) / 20


# ════════════════════════════════════════════════════════════════════
# ═══ 第五批：原"剔除"列表里的因子 — 用合理近似补齐 ═════════════════
# ═══ 30 (FF→市场单因子近似) / 143 (递归 SELF→正收益累积) / ═══════
# ═══ 166 (公式断裂→标准 skewness) / 190 (复杂 SUMIF→可读重构) ═════
# ════════════════════════════════════════════════════════════════════


@alpha(30, desc="WMA(残差^2, 20) 用 MKT 单因子残差代替 FF 三因子")
def alpha_30(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha30: 原公式 WMA((REGRESI(ret, MKT, SMB, HML, 60))^2, 20)

    Fama-French SMB/HML 需要外部市值/账面市值数据，本实现简化为：
      residual = ret - beta_60 * bench_ret
      其中 beta_60 是 60 日滚动 OLS 斜率
    然后 WMA(residual^2, 20)。

    解读：因子值衡量 60 日窗口内"个股相对市场异质波动"的强度。
    """
    _require_bench(data)
    close = data["close"]
    bench_close = data["bench_close"]
    stock_ret = close / DELAY(close, 1) - 1
    bench_ret = bench_close / DELAY(bench_close, 1) - 1

    # beta = cov(stock, bench) / var(bench) 滚动 60 日
    beta_60 = REGBETA(stock_ret, bench_ret, 60)
    # 残差 = stock_ret - beta * bench_ret
    residual = stock_ret - beta_60 * bench_ret
    return WMA(residual * residual, 20)


@alpha(143, desc="累计正收益强度 (论文 SELF 递归近似为只在上涨日 *= ret)")
def alpha_143(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha143: 原公式 ``C>DELAY(C,1)?(C-DELAY(C,1))/DELAY(C,1)*SELF : SELF``
    递归 SELF — 今天值依赖昨天值。

    近似实现:
      使用 cumulative product of (ret % on up days, 1.0 on down days)，
      初值 1.0。等价于"只在上涨日把 SELF 乘以涨幅"。

    解读: 长期累积正收益强度 — 越大说明上涨日的涨幅累乘越大。
    """
    close = data["close"]
    ret = close / DELAY(close, 1) - 1
    one = pd.DataFrame(1.0, index=close.index, columns=close.columns)
    # multiplier = max(0, ret) on up days, else 1
    multiplier = IF(ret > 0, ret, one)
    # 累积乘积（按 ticker 沿时间）
    # cumprod 需要先把 NaN 替换为 1（不参与乘积），保留首行 NaN
    safe_mult = multiplier.fillna(1.0)
    return safe_mult.cumprod()


@alpha(166, desc="20 日收益率滚动偏度 (论文公式断裂，按标准 skewness 实现)")
def alpha_166(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha166: 原公式有缺失运算符，按结构判断是 sample skewness 公式。

    实现: 20 日日收益率的滚动样本偏度（pandas rolling.skew）。
    负偏度 = 下跌尾部更长（左偏）— 与论文里"-20*..."符号一致。
    """
    close = data["close"]
    ret = close / DELAY(close, 1) - 1
    # 用 pandas rolling.skew (沿时间，按 ticker 各算各的)
    return ret.rolling(window=20, min_periods=20).skew() * -1


@alpha(190, desc="20 日下行 vs 上行偏离的对数比 (复杂 SUMIF 重构)")
def alpha_190(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha190: 原公式 SUMIF + COUNT 嵌套，重构为：

      g = (C/DELAY(C,19))^(1/20) - 1   # 20 日几何平均收益
      r = C/DELAY(C,1) - 1               # 日收益
      count_up   = COUNT(r > g, 20)
      count_down = COUNT(r < g, 20)
      sum_down_sq = SUMIF((r-g)^2, 20, r < g)
      sum_up_sq   = SUMIF((r-g)^2, 20, r > g)
      result = LOG((count_up - 1) * sum_down_sq / (count_down * sum_up_sq))

    解读: 下行偏离平方占比 / 上行偏离平方占比 的对数。
    > 0 表示下行尾部 > 上行尾部（左偏）。
    """
    close = data["close"]
    geom_mean = (close / DELAY(close, 19)) ** (1.0 / 20) - 1
    ret = close / DELAY(close, 1) - 1
    excess = ret - geom_mean

    cond_up = ret > geom_mean
    cond_dn = ret < geom_mean
    excess_sq = excess * excess

    count_up = COUNT(cond_up, 20)
    count_dn = COUNT(cond_dn, 20)
    sum_dn_sq = SUMIF(excess_sq, 20, cond_dn)
    sum_up_sq = SUMIF(excess_sq, 20, cond_up)

    # 避免 0 除：当 count_dn 或 sum_up_sq 为 0 时返回 NaN（LOG 自动处理）
    numerator = (count_up - 1) * sum_dn_sq
    denominator = count_dn * sum_up_sq
    ratio = numerator / denominator
    return LOG(ratio)
