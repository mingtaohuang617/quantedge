"""
Lunde-Timmermann (2004) 牛熊机械标注
=====================================
对一只价格序列做二元 regime 标注：牛市 / 熊市。

规则：
  - 起始假设 bull
  - bull 期：跟踪历史最高价；当前价相对历史最高跌 ≥ threshold → 标记前高为 peak,
    切到 bear
  - bear 期：跟踪历史最低价；当前价相对历史最低涨 ≥ threshold → 标记前低为 trough,
    切到 bull
  - threshold 默认 0.20（20% 是 SPX 牛熊的传统阈值）

输出：每个 trading day 对应一个 regime 标签。
"""
from __future__ import annotations

from typing import Iterable

import pandas as pd


def label_bull_bear(
    prices: pd.Series,
    threshold: float = 0.20,
) -> pd.DataFrame:
    """
    输入：日频价格 series（index = 日期，可以是 DatetimeIndex 或字符串）
    输出：DataFrame(index=同原 series，columns=['regime', 'peak_or_trough'])
       regime ∈ {'bull','bear'}
       peak_or_trough ∈ {'P','T',None}：在转折日标 P/T，否则 None
    """
    s = prices.dropna().astype(float)
    if len(s) < 2:
        return pd.DataFrame(columns=["regime", "peak_or_trough"])

    n = len(s)
    state = "bull"
    extreme_idx = 0
    extreme_val = float(s.iloc[0])

    regimes = ["bull"] * n
    pt = [None] * n

    for i in range(1, n):
        v = float(s.iloc[i])
        if state == "bull":
            if v > extreme_val:
                extreme_val = v
                extreme_idx = i
            elif v <= extreme_val * (1 - threshold):
                pt[extreme_idx] = "P"
                # 从 extreme_idx+1 起标 bear
                for j in range(extreme_idx + 1, i + 1):
                    regimes[j] = "bear"
                state = "bear"
                extreme_idx = i
                extreme_val = v
            # 否则 regime 跟随 state 已经默认
            else:
                regimes[i] = "bull"
        else:  # bear
            if v < extreme_val:
                extreme_val = v
                extreme_idx = i
                regimes[i] = "bear"
            elif v >= extreme_val * (1 + threshold):
                pt[extreme_idx] = "T"
                for j in range(extreme_idx + 1, i + 1):
                    regimes[j] = "bull"
                state = "bull"
                extreme_idx = i
                extreme_val = v
            else:
                regimes[i] = "bear"

    return pd.DataFrame({"regime": regimes, "peak_or_trough": pt}, index=s.index)


def regime_segments(labeled: pd.DataFrame) -> list[dict]:
    """
    把按日 regime 标签压缩成连续段：
      [{start: '2020-02-19', end: '2020-03-23', regime: 'bear', days: 23, ret_pct: -34.0}, ...]
    """
    if labeled.empty:
        return []
    segs = []
    cur_state = labeled["regime"].iloc[0]
    cur_start = labeled.index[0]
    cur_start_idx = 0

    def _close(end_idx, end_label):
        start_str = str(cur_start) if not hasattr(cur_start, "strftime") else cur_start.strftime("%Y-%m-%d")
        end_str = str(end_label) if not hasattr(end_label, "strftime") else end_label.strftime("%Y-%m-%d")
        segs.append({
            "start": start_str,
            "end": end_str,
            "regime": cur_state,
            "days": end_idx - cur_start_idx + 1,
        })

    for i in range(1, len(labeled)):
        st = labeled["regime"].iloc[i]
        if st != cur_state:
            _close(i - 1, labeled.index[i - 1])
            cur_state = st
            cur_start = labeled.index[i]
            cur_start_idx = i
    _close(len(labeled) - 1, labeled.index[-1])
    return segs


def annotate_returns(prices: pd.Series, segments: list[dict]) -> list[dict]:
    """补每段的回报率（从段起到段终）。原地修改 + 返回。"""
    p = prices.dropna()
    p_idx = pd.to_datetime(p.index) if not isinstance(p.index, pd.DatetimeIndex) else p.index
    p = pd.Series(p.values, index=p_idx)
    for seg in segments:
        try:
            start_p = float(p.loc[:seg["start"]].iloc[-1]) if seg["start"] in p.index or len(p.loc[:seg["start"]]) > 0 else None
            end_p = float(p.loc[:seg["end"]].iloc[-1]) if seg["end"] in p.index or len(p.loc[:seg["end"]]) > 0 else None
            if start_p and end_p:
                seg["ret_pct"] = round((end_p / start_p - 1) * 100, 2)
            else:
                seg["ret_pct"] = None
        except Exception:
            seg["ret_pct"] = None
    return segments
