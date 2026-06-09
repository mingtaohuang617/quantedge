"""
scoring.py — 双轨横截面评分引擎（P2）
========================================================================
把评分从"硬阈值揉一个综合分"改成：

  综合分 = 质量分 × 0.6 + 时机分 × 0.4

- 质量分(慢，值不值得持有)：个股在「市场×GICS行业」内做横截面分位
    估值(便宜) 35% + 盈利质量 35% + 成长 30%
- 时机分(快，现在是不是买点)：
    动量(多周期·市场内真分位) 50% + 趋势(MA) 30% + RSI(极端扣分) 20%
- ETF 按 4 类(宽基/行业/国家/杠杆)专属质量分；杠杆 ETF 质量封顶 + 波动磨损入分

两遍法：pass1 算每个标的的裸指标 → pass2 在同类组内转百分位、加权。
组内样本不足 MIN_PEERS 时按 行业→市场 回退，保证分位稳健。

入口：score_universe(stocks, bars_by_ticker) —— 原地写 score / qualityScore /
timingScore / subScores。bars_by_ticker: {ticker: [{'close':..}, ...]}（升序）。
"""
from __future__ import annotations

from collections import defaultdict

from factors import calc_rsi, calc_leverage_decay, parse_aum_to_usd, parse_leverage
import pandas as pd

MIN_PEERS = 8  # 同类组少于此数 → 回退到更宽的分组

# 权重
QW = {"valuation": 0.35, "profitability": 0.35, "growth": 0.30}
TW = {"momentum": 0.50, "trend": 0.30, "rsi": 0.20}
COMPOSITE = {"quality": 0.6, "timing": 0.4}
ETF_QW = {"cost": 0.35, "liquidity": 0.30, "diversification": 0.35}
LEV_QUALITY_CAP = 60.0  # 杠杆 ETF 质量分封顶
ANCHOR_W = 0.30  # 个股质量分：分位为主(0.7) + 绝对锚为辅(0.3)，让真正优秀的能冲 90+


# ── 绝对锚：市场无关的硬标尺（0-100），只占 30% 权重 ──
def _val_abs(ey, by) -> float:
    """估值绝对分（便宜=高）。ey=1/PE 盈利收益率, by=1/PB 账面收益率。"""
    s = []
    if ey is not None:
        s.append(85 if ey >= 0.08 else 70 if ey >= 0.05 else 55 if ey >= 0.033 else 40 if ey >= 0.0125 else 25)
    if by is not None:
        s.append(80 if by >= 0.67 else 65 if by >= 0.4 else 50 if by >= 0.2 else 35)
    return sum(s) / len(s) if s else 50.0


def _prof_abs(roe, margin) -> float:
    s = []
    if roe is not None:
        s.append(90 if roe >= 25 else 72 if roe >= 15 else 55 if roe >= 8 else 40 if roe >= 0 else 20)
    if margin is not None:
        s.append(88 if margin >= 25 else 70 if margin >= 12 else 52 if margin >= 5 else 38 if margin >= 0 else 18)
    return sum(s) / len(s) if s else 50.0


def _growth_abs(g) -> float:
    if g is None:
        return 50.0
    return 90.0 if g >= 30 else 72.0 if g >= 15 else 55.0 if g >= 5 else 40.0 if g >= 0 else 25.0


# ── 时机：纯函数（从 close 序列算）─────────────────────
def blended_momentum(closes: list[float]) -> float | None:
    """多周期动量裸值（收益率）：0.5×3M + 0.5×(6M跳过最近1M, 即 12-1 风味)。
    数据不足时退化到更短周期；太短返回 None。"""
    n = len(closes)
    if n < 25 or closes[-1] is None:
        return None
    last = closes[-1]
    comps = []
    if n > 63 and closes[-64] > 0:
        comps.append(last / closes[-64] - 1)             # ~3M
    if n > 126 and closes[-127] > 0 and closes[-22] > 0:
        comps.append(closes[-22] / closes[-127] - 1)     # 6M→1M（跳过最近1M）
    if comps:
        return sum(comps) / len(comps)
    if n > 21 and closes[-22] > 0:
        return last / closes[-22] - 1                    # 退化：1M
    return None


def trend_score(closes: list[float]) -> float:
    """趋势分 0-100：价格 vs MA50/MA200 + 均线多头排列。数据不足→50 中性。"""
    n = len(closes)
    if n < 50:
        return 50.0
    price = closes[-1]
    ma50 = sum(closes[-50:]) / 50
    ma200 = sum(closes[-200:]) / 200 if n >= 200 else sum(closes) / n
    s = 50.0
    s += 17 if price > ma50 else -17
    s += 17 if price > ma200 else -17
    s += 16 if ma50 > ma200 else -16
    return max(0.0, min(100.0, s))


def rsi_timing_score(rsi: float | None) -> float:
    """RSI 时机分 0-100：健康动量区(~55)最高，超买/超卖两端扣分。"""
    if rsi is None:
        return 50.0
    return max(0.0, min(100.0, 100 - 2.2 * abs(rsi - 55)))


def _num(v):
    """安全转 float；None/空/非数/NaN/Inf → None。data.js 个别字段可能是字符串。"""
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return None if (f != f or f in (float("inf"), float("-inf"))) else f
    except (TypeError, ValueError):
        return None


def _pct_in(value, pool_values, higher_better: bool = True) -> float:
    """value 在 pool_values（含 None）中的横截面百分位 0-100（中位秩法）。
    value 为 None 或有效样本≤1 → 50 中性。"""
    if value is None:
        return 50.0
    vals = [v for v in pool_values if v is not None]
    if len(vals) <= 1:
        return 50.0
    less = sum(1 for u in vals if u < value)
    equal = sum(1 for u in vals if u == value)
    pct = (less + 0.5 * equal) / len(vals) * 100
    return pct if higher_better else 100 - pct


# ── ETF 子类与各维裸分 ────────────────────────────────
def etf_class(s: dict) -> str:
    if parse_leverage(s.get("leverage")) is not None:
        return "杠杆"
    et = s.get("etfType") or ""
    if "国家" in et:
        return "国家"
    if "宽基" in et or "宽" in et:
        return "宽基"
    return "行业"  # 行业 / 主题


def _etf_cost(s: dict) -> float:
    er = s.get("expenseRatio")
    er_score = 50.0 if er is None else (95 if er <= 0.3 else 75 if er <= 0.65 else 55 if er <= 1.0 else 30)
    pd_abs = abs(s.get("premiumDiscount") or 0)
    pd_score = 95 if pd_abs < 0.5 else 75 if pd_abs < 2 else 55 if pd_abs < 5 else 35 if pd_abs < 10 else 15
    return (er_score + pd_score) / 2


def _etf_liquidity(s: dict) -> float:
    aum = parse_aum_to_usd(s.get("aum"))
    if aum is None:
        return 40.0
    return 90.0 if aum > 1e9 else 70.0 if aum > 1e8 else 50.0 if aum > 1e7 else 30.0


def _etf_diversification(s: dict, cls: str) -> float:
    base = {"宽基": 90, "行业": 65, "国家": 55, "杠杆": 50}.get(cls, 60)
    c3 = s.get("concentrationTop3")
    if c3 is not None:  # 有持仓集中度数据则覆盖（越集中越低）
        return 90.0 if c3 < 50 else 60.0 if c3 < 70 else 35.0 if c3 < 90 else 15.0
    return float(base)


# ── 主入口 ────────────────────────────────────────────
def score_universe(stocks: list[dict], bars_by_ticker: dict[str, list[dict]]) -> None:
    """原地为所有标的写 score/qualityScore/timingScore/subScores。"""
    # ---- pass1：裸指标 ----
    for s in stocks:
        closes = [b["close"] for b in bars_by_ticker.get(s["ticker"], []) if b.get("close") is not None]
        s["_mom"] = blended_momentum(closes)
        s["_trend"] = trend_score(closes)
        rsi = calc_rsi(pd.Series(closes)) if len(closes) >= 15 else s.get("rsi")
        s["_rsiT"] = rsi_timing_score(rsi)
        s["_closes"] = closes
        if not s.get("isETF"):
            pe, pb = _num(s.get("pe")), _num(s.get("pb"))
            mc, rev = _num(s.get("marketCap")), _num(s.get("revenue"))
            s["_ey"] = (1.0 / pe) if (pe and pe > 0) else None       # 盈利收益率(越高越便宜)
            s["_by"] = (1.0 / pb) if (pb and pb > 0) else None       # 账面收益率
            s["_sy"] = (rev / mc) if (rev and mc and mc > 0) else None  # 营收/市值
            s["_roe"] = _num(s.get("roe"))
            s["_margin"] = _num(s.get("profitMargin"))
            s["_grow"] = _num(s.get("revenueGrowth"))

    non_etf = [s for s in stocks if not s.get("isETF")]

    # ---- 分组：质量(市场×GICS, 回退 GICS→市场) / 动量(市场) ----
    by_mg, by_g, by_m = defaultdict(list), defaultdict(list), defaultdict(list)
    for s in non_etf:
        mk, g = s["market"], s.get("gicsSector") or "其他"
        by_mg[(mk, g)].append(s); by_g[g].append(s); by_m[mk].append(s)

    def qpool(s):
        mk, g = s["market"], s.get("gicsSector") or "其他"
        if len(by_mg[(mk, g)]) >= MIN_PEERS:
            return by_mg[(mk, g)]
        if len(by_g[g]) >= MIN_PEERS:
            return by_g[g]
        return by_m[mk]

    mom_pool = defaultdict(list)  # 动量分位池：按市场（含 ETF）
    for s in stocks:
        mom_pool[s["market"]].append(s)

    # ---- pass2：个股质量分（分位为主 + 绝对锚为辅）----
    for s in non_etf:
        pool = qpool(s)
        val_p = _avg([
            _pct_in(s["_ey"], [p.get("_ey") for p in pool]),
            _pct_in(s["_by"], [p.get("_by") for p in pool]),
            _pct_in(s["_sy"], [p.get("_sy") for p in pool]),
        ], [s["_ey"], s["_by"], s["_sy"]])
        prof_p = _avg([
            _pct_in(s["_roe"], [p.get("_roe") for p in pool]),
            _pct_in(s["_margin"], [p.get("_margin") for p in pool]),
        ], [s["_roe"], s["_margin"]])
        grow_p = _pct_in(s["_grow"], [p.get("_grow") for p in pool])
        # 叠加绝对锚（每维 0.7 分位 + 0.3 绝对）
        val = (1 - ANCHOR_W) * val_p + ANCHOR_W * _val_abs(s["_ey"], s["_by"])
        prof = (1 - ANCHOR_W) * prof_p + ANCHOR_W * _prof_abs(s["_roe"], s["_margin"])
        grow = (1 - ANCHOR_W) * grow_p + ANCHOR_W * _growth_abs(s["_grow"])
        q = QW["valuation"] * val + QW["profitability"] * prof + QW["growth"] * grow
        s["_q"] = q
        s["_qsub"] = {"valuation": round(val, 1), "profitability": round(prof, 1), "growth": round(grow, 1)}

    # ---- pass2：ETF 质量分 ----
    for s in stocks:
        if not s.get("isETF"):
            continue
        cls = etf_class(s)
        cost = _etf_cost(s); liq = _etf_liquidity(s); div = _etf_diversification(s, cls)
        q = ETF_QW["cost"] * cost + ETF_QW["liquidity"] * liq + ETF_QW["diversification"] * div
        if cls == "杠杆":
            q = min(q, LEV_QUALITY_CAP)
            drag = calc_leverage_decay(pd.Series(s["_closes"]), s.get("leverage"))
            if drag:  # 年化磨损 %，每 1% 扣 1.2 分，最多扣 25
                q -= min(25.0, drag * 1.2)
            q = max(0.0, q)
        s["_q"] = q
        s["_qsub"] = {"cost": round(cost, 1), "liquidity": round(liq, 1),
                      "diversification": round(div, 1), "etfClass": cls}

    # ---- pass2：时机分（个股 + ETF 同框）----
    for s in stocks:
        mp = mom_pool[s["market"]]
        mom = _pct_in(s["_mom"], [p.get("_mom") for p in mp])
        t = TW["momentum"] * mom + TW["trend"] * s["_trend"] + TW["rsi"] * s["_rsiT"]
        s["_t"] = t
        s["_tsub"] = {"momentum": round(mom, 1), "trend": round(s["_trend"], 1), "rsi": round(s["_rsiT"], 1)}

    # ---- 合成 + 写回，清理临时键 ----
    for s in stocks:
        q = s.get("_q", 50.0); t = s.get("_t", 50.0)
        s["qualityScore"] = round(q, 1)
        s["timingScore"] = round(t, 1)
        s["score"] = round(COMPOSITE["quality"] * q + COMPOSITE["timing"] * t, 1)
        s["subScores"] = {**s["_qsub"], **s["_tsub"]}
        for k in ("_mom", "_trend", "_rsiT", "_closes", "_ey", "_by", "_sy",
                  "_roe", "_margin", "_grow", "_q", "_t", "_qsub", "_tsub"):
            s.pop(k, None)

    stocks.sort(key=lambda x: x.get("score", 0) or 0, reverse=True)
    for i, s in enumerate(stocks):
        s["rank"] = i + 1


def _avg(pcts: list[float], raws: list) -> float:
    """只对「原始值非 None」的维度求百分位均值；全缺 → 50。"""
    kept = [p for p, r in zip(pcts, raws) if r is not None]
    return sum(kept) / len(kept) if kept else 50.0
