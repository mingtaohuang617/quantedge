"""
持续期预测（Kaplan-Meier 生存分析）
=====================================
用历史 bull/bear 周期长度估计 当前 regime 还能持续 N 天的条件概率。

数据：regime_segments() 输出。最后一段是 current（censored = 进行中）。

Phase 2 v1 用 KM；后续要加协变量（温度/估值/信用利差）时升级到 Cox PH。
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def kaplan_meier(durations: list[int], censored: list[bool]) -> dict:
    """
    KM step function。
    durations: regime 持续天数
    censored:  True=尚在进行（右截尾，不计为 event），False=已完成（event）
    返回 {times, survival}：均按 times 升序，survival 为对应阶梯值。
    """
    if not durations:
        return {"times": [], "survival": []}
    df = pd.DataFrame({"d": durations, "c": censored}).sort_values("d")
    n = len(df)
    s = 1.0
    at_risk = n
    times: list[int] = []
    survival: list[float] = []

    for t, g in df.groupby("d", sort=True):
        events = int((~g["c"]).sum())  # 完成（非 censored）= events
        leaving = len(g)
        if events > 0 and at_risk > 0:
            s *= (1.0 - events / at_risk)
        times.append(int(t))
        survival.append(round(s, 4))
        at_risk -= leaving
    return {"times": times, "survival": survival}


def _s_at(km: dict, t: int) -> float:
    """KM 阶梯函数在 t 的取值（最大不超过 t 的 time 对应的 S）。"""
    times = km["times"]
    surv = km["survival"]
    if not times:
        return 1.0
    if t < times[0]:
        return 1.0
    # 找最大的 time ≤ t
    for i in range(len(times) - 1, -1, -1):
        if times[i] <= t:
            return surv[i]
    return 1.0


def conditional_prob_survive(km: dict, current: int, additional: int) -> float | None:
    """P(T > current + additional | T > current) = S(current+additional) / S(current)"""
    s_now = _s_at(km, current)
    if s_now <= 0:
        return None
    s_future = _s_at(km, current + additional)
    return round(s_future / s_now, 4)


def compute_survival_summary(
    segments: list[dict],
    current_regime: str,
    current_duration_days: int,
) -> dict:
    """
    用历史同类型 regime 的持续天数 + 当前 censored 拟合 KM，返回当前 regime
    再持续 3/6/12 个月的条件概率 + 同类历史持续期分位。
    """
    if not segments or current_regime not in ("bull", "bear"):
        return {"error": "no segments or unknown regime"}

    # 排除最后一段（即 current 本身），过去同类型的已完成段
    past_same = [s for s in segments[:-1] if s["regime"] == current_regime]
    past_other = [s for s in segments[:-1] if s["regime"] != current_regime]
    if len(past_same) < 2:
        return {"error": "insufficient history (<2 past segments)"}

    completed = [int(s["days"]) for s in past_same]
    durations = completed + [int(current_duration_days)]
    censored = [False] * len(completed) + [True]

    km = kaplan_meier(durations, censored)
    median_past = float(np.median(completed))

    # 当前持续天数在历史同类型分位（多少 % 的历史段比当前短）
    pct_rank = round(float(np.mean([d <= current_duration_days for d in completed]) * 100), 1)

    # 3/6/12 月 ≈ 63/126/252 交易日
    horizons = {"3M": 63, "6M": 126, "12M": 252}
    prob_continue = {h: conditional_prob_survive(km, current_duration_days, days)
                     for h, days in horizons.items()}

    return {
        "current_regime": current_regime,
        "current_duration_days": int(current_duration_days),
        "n_past_same_segments": len(past_same),
        "n_past_other_segments": len(past_other),
        "median_past_days": median_past,
        "max_past_days": int(max(completed)),
        "current_duration_pct_rank": pct_rank,
        "prob_continue": prob_continue,
        "km_curve": km,
    }
