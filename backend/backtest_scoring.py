#!/usr/bin/env python3
"""Deprecated historical evaluator. Use validate_scoring.py.

The old CLI mixed current fundamentals and unequal calendar dates. It is disabled.
Spearman and undated synthetic window helpers remain only for regression tests.
"""
from __future__ import annotations

import statistics
import sys
import copy
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from scoring import score_universe

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """秩相关系数：对两列排名后求 Pearson（含并列取平均秩）。样本<8 → None。"""
    n = len(xs)
    if n < 8 or n != len(ys):
        return None

    def rank(a):
        order = sorted(range(n), key=lambda i: a[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and a[order[j + 1]] == a[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return r

    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    vx = sum((rx[i] - mx) ** 2 for i in range(n)) ** 0.5
    vy = sum((ry[i] - my) ** 2 for i in range(n)) ** 0.5
    return cov / (vx * vy) if vx and vy else None


def window_ic(stocks, bars_all, k: int, H: int) -> dict | None:
    """单窗口：T=倒数第 k+1 根。as-of-T 评分 vs T→T+H 前向收益的 IC。
    返回 {综合,质量,时机,动量} 的 IC，样本不足返回 None。"""
    if any(b.get("date") or b.get("trade_date") for rows in bars_all.values() for b in rows):
        raise ValueError("Dated history requires validate_scoring.py; legacy offsets are not calendar aligned")
    trunc, keep = {}, []
    for s in stocks:
        b = bars_all.get(s["ticker"]) or []
        if len(b) < k + 1 + 130 or (-k - 1 + H) > -1:
            continue
        cT = b[-k - 1].get("close")
        cF = b[-k - 1 + H].get("close")
        if not cT or cT <= 0 or not cF:
            continue
        trunc[s["ticker"]] = b[:len(b) - k]
        keep.append((s["ticker"], cF / cT - 1))
    if len(keep) < 30:
        return None
    work = copy.deepcopy([s for s in stocks if s["ticker"] in trunc])
    for stock in work:
        for key in ("pe", "pb", "roe", "profitMargin", "revenueGrowth", "marketCap", "revenue"):
            stock.pop(key, None)
    score_universe(work, trunc)
    by = {s["ticker"]: s for s in work}
    fwd = [r[1] for r in keep]
    out = {}
    for key, name in [("score", "综合"), ("qualityScore", "质量"), ("timingScore", "时机")]:
        valid = [(by[t][key], ret) for t, ret in keep if by[t][key] is not None]
        out[name] = spearman([v for v, _ in valid], [r for _, r in valid])
    valid = [(by[t]["subScores"].get("momentum"), ret) for t, ret in keep if by[t]["subScores"].get("momentum") is not None]
    out["动量"] = spearman([v for v, _ in valid], [r for _, r in valid])
    return out


def rolling(stocks, bars_all, horizon: int, ks: range) -> dict:
    """跨多个窗口收集 IC，返回 {维度: [ic,...]} 与窗口数。"""
    series = {n: [] for n in ["综合", "质量", "时机", "动量"]}
    nwin = 0
    for k in ks:
        r = window_ic(stocks, bars_all, k, horizon)
        if not r:
            continue
        nwin += 1
        for n, values in series.items():
            if r[n] is not None:
                values.append(r[n])
    series["_nwin"] = nwin
    return series


def _print_report(series: dict, label: str, horizon: int):
    print(f"\n[{label}] {series['_nwin']} 个滚动窗口 · 前向 {horizon} 日")
    print("   维度    IC均值   IC_IR    胜率(IC>0)")
    for n in ["综合", "质量", "时机", "动量"]:
        a = series[n]
        if len(a) < 3:
            print(f"   {n:5s}  样本不足")
            continue
        mean = statistics.mean(a)
        sd = statistics.pstdev(a) or 1e-9
        win = sum(1 for x in a if x > 0) / len(a)
        print(f"   {n:5s}  {mean:+.3f}   {mean / sd:+.2f}    {win * 100:.0f}%")


def main():
    raise SystemExit("旧回测已停用：当前基本面与倒序窗口不能验证历史评分。请运行 backend/validate_scoring.py --help")


if __name__ == "__main__":
    main()
