#!/usr/bin/env python3
"""评分有效性回测 —— 滚动窗口 IC（信息系数）。
========================================================================
把双轨评分回算到历史时点 T（K线截断到 T，无前视泄漏），测 T→T+H 日前向收益的
横截面秩相关 IC，跨多个滚动窗口求 IC均值 / IC_IR(均值/标准差) / 胜率。

用途：改评分公式前先跑、确认综合分仍预测收益；监控因子衰减。
判读：IC均值 > 0.03 视作有效；|IC_IR| > 0.5 视作稳定；胜率 > 60% 视作方向可靠。

⚠️ 口径：质量分用**当前**基本面(慢变，轻度 look-ahead)；时机/动量纯 K 线，是干净的
   point-in-time 检验。要严格验证质量分需历史时点基本面（见记忆 module_scoring_overhaul）。

用法：
  python backtest_scoring.py                  # 前向21日, 窗口 k=40..460 step20, 全体个股+美股
  python backtest_scoring.py --horizon 63     # 前向3月
  python backtest_scoring.py --market US      # 只看美股
"""
from __future__ import annotations

import argparse
import statistics
import sys
import copy
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import db
from refresh_data_js import parse_data_js
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
    score_universe(work, trunc)
    by = {s["ticker"]: s for s in work}
    fwd = [r[1] for r in keep]
    out = {}
    for key, name in [("score", "综合"), ("qualityScore", "质量"), ("timingScore", "时机")]:
        out[name] = spearman([by[t][key] for t, _ in keep], fwd)
    out["动量"] = spearman([by[t]["subScores"].get("momentum", 50) for t, _ in keep], fwd)
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
        for n in series:
            if r[n] is not None:
                series[n].append(r[n])
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=21, help="前向持有交易日数(默认21≈1月)")
    ap.add_argument("--market", default=None, help="只看某市场(如 US)；默认全体个股 + 美股两组")
    ap.add_argument("--input", default=str(DATA_JS), help="data.js 路径")
    args = ap.parse_args()

    db.init_db()
    st, _ = parse_data_js(Path(args.input))
    bars_all = {s["ticker"]: db.get_bars(s["ticker"]) for s in st}
    stocks = [s for s in st if not s.get("isETF")]
    ks = range(40, 461, 20)

    if args.market:
        sub = [s for s in stocks if s["market"] == args.market.upper()]
        _print_report(rolling(sub, bars_all, args.horizon, ks), f"{args.market.upper()} 个股", args.horizon)
    else:
        _print_report(rolling(stocks, bars_all, args.horizon, ks), "全体个股", args.horizon)
        us = [s for s in stocks if s["market"] == "US"]
        _print_report(rolling(us, bars_all, args.horizon, ks), "美股个股(基本面最全)", args.horizon)


if __name__ == "__main__":
    main()
