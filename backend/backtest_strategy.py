#!/usr/bin/env python3
"""评分驱动策略回测 —— 走式分位组合。
========================================================================
把综合分变成可交易策略并量化收益：每 21 交易日(月度)按 as-of-T 评分选 top 分位、
等权持有、走式滚动到今，链成净值曲线，算 年化/夏普/最大回撤/超额。

对照：综合分 top / 质量分 top / 时机分 top / 底分位 / 全体等权(基准) / 多空(top−bottom)。

⚠️ 口径：point-in-time(每期 K线截断到 T，无前视)；质量分用**当前**基本面(轻度 look-ahead，
   与 IC 回测同 caveat)；**未计交易成本/冲击**(v1)；数据约 2 年→窗口有限，看方向而非精确数。

用法：
  python backtest_strategy.py                  # 月度再平衡, top 20%
  python backtest_strategy.py --top 0.1        # top 10%
  python backtest_strategy.py --market US      # 只美股
"""
from __future__ import annotations

import argparse
import copy
import statistics
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import db
from refresh_data_js import parse_data_js
from scoring import score_universe

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"
H = 21  # 再平衡/持有周期（交易日）


def _basket_ret(rows, key, top_frac, bottom=False):
    """rows=[(score_dict, fwd_ret)]；按 key 排序取 top/bottom 分位，等权平均前向收益。"""
    n = max(1, int(len(rows) * top_frac))
    srt = sorted(rows, key=lambda r: r[0][key])
    sel = srt[:n] if bottom else srt[-n:]
    return statistics.mean(r[1] for r in sel)


def run(stocks, bars_all, top_frac: float):
    """走式回测：返回各策略的逐期收益序列 {名: [r,...]} + 期数。"""
    series = {k: [] for k in ["综合top", "质量top", "时机top", "底分位", "基准等权", "多空"]}
    # 期：k = 21, 42, ... 每期非重叠、连续；最老的需 as-of-T 仍有≥130根
    max_bars = max((len(b) for b in bars_all.values()), default=0)
    ks = list(range(H, max_bars - 130, H))
    for k in sorted(ks, reverse=True):  # 老→新
        trunc, rows = {}, []
        fwd = {}
        for s in stocks:
            b = bars_all.get(s["ticker"]) or []
            if len(b) < k + 1 + 130 or (-k - 1 + H) > -1:
                continue
            cT, cF = b[-k - 1].get("close"), b[-k - 1 + H].get("close")
            if not cT or cT <= 0 or not cF:
                continue
            trunc[s["ticker"]] = b[:len(b) - k]
            fwd[s["ticker"]] = cF / cT - 1
        if len(trunc) < 30:
            continue
        work = copy.deepcopy([s for s in stocks if s["ticker"] in trunc])
        score_universe(work, trunc)
        rows = [({"score": s["score"], "qualityScore": s["qualityScore"],
                  "timingScore": s["timingScore"]}, fwd[s["ticker"]]) for s in work]
        series["综合top"].append(_basket_ret(rows, "score", top_frac))
        series["质量top"].append(_basket_ret(rows, "qualityScore", top_frac))
        series["时机top"].append(_basket_ret(rows, "timingScore", top_frac))
        series["底分位"].append(_basket_ret(rows, "score", top_frac, bottom=True))
        series["基准等权"].append(statistics.mean(r[1] for r in rows))
        series["多空"].append(series["综合top"][-1] - series["底分位"][-1])
    return series


def metrics(rets: list[float]) -> dict:
    """逐期收益 → 累计/年化/年化波动/夏普/最大回撤。"""
    if len(rets) < 3:
        return {}
    eq = [1.0]
    for r in rets:
        eq.append(eq[-1] * (1 + r))
    cum = eq[-1] - 1
    years = len(rets) * H / 252
    ann = (eq[-1]) ** (1 / years) - 1 if years > 0 and eq[-1] > 0 else float("nan")
    vol = statistics.pstdev(rets) * (252 / H) ** 0.5
    sharpe = ann / vol if vol else float("nan")
    peak, mdd = eq[0], 0.0
    for v in eq:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return {"cum": cum, "ann": ann, "vol": vol, "sharpe": sharpe, "mdd": mdd}


def _report(series, label, top_frac):
    npd = len(series["基准等权"])
    print(f"\n[{label}] {npd} 期 · 月度(21日)再平衡 · top {int(top_frac*100)}% · 未计成本")
    print("   策略        累计      年化      年化波动   夏普    最大回撤")
    base = metrics(series["基准等权"])
    for name in ["综合top", "质量top", "时机top", "底分位", "基准等权", "多空"]:
        m = metrics(series[name])
        if not m:
            print(f"   {name:9s} 样本不足"); continue
        exc = "" if name == "基准等权" else f"  超额{(m['ann']-base['ann'])*100:+.1f}%"
        print(f"   {name:9s} {m['cum']*100:+6.1f}%  {m['ann']*100:+6.1f}%  {m['vol']*100:5.1f}%   "
              f"{m['sharpe']:+.2f}   {m['mdd']*100:6.1f}%{exc}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=float, default=0.2, help="选取分位(0.2=top20%)")
    ap.add_argument("--market", default=None, help="只看某市场(如 US)")
    ap.add_argument("--input", default=str(DATA_JS))
    args = ap.parse_args()

    db.init_db()
    st, _ = parse_data_js(Path(args.input))
    bars_all = {s["ticker"]: db.get_bars(s["ticker"]) for s in st}
    stocks = [s for s in st if not s.get("isETF")]
    if args.market:
        stocks = [s for s in stocks if s["market"] == args.market.upper()]
        _report(run(stocks, bars_all, args.top), f"{args.market.upper()} 个股", args.top)
    else:
        _report(run(stocks, bars_all, args.top), "全体个股", args.top)
        us = [s for s in stocks if s["market"] == "US"]
        _report(run(us, bars_all, args.top), "美股个股", args.top)


if __name__ == "__main__":
    main()
