"""
scoring.py — 双轨横截面评分引擎（P2）
========================================================================
把评分从"硬阈值揉一个综合分"改成：

  股票综合分 = 质量分 × 0.6 + 趋势分 × 0.4

- 质量分(基本面相对评价)：个股在「市场×GICS行业」内做横截面分位，缺失数据不补分
    估值(便宜) 35% + 盈利质量 35% + 成长 30%
- 趋势分(多月趋势描述，非买点)：
    动量(多周期·市场内真分位) 50% + 趋势(MA) 30% + RSI(极端扣分) 20%
- ETF 产品质量、底层资产与趋势分别展示，不合成买入评分。

两遍法：pass1 算每个标的的裸指标 → pass2 在同类组内转百分位、加权。
组内有效样本不足 MIN_PEERS 时使用绝对锚；无绝对锚的因子暂缺。

入口：score_universe(stocks, bars_by_ticker) —— 原地写 score / qualityScore /
timingScore / subScores。bars_by_ticker: {ticker: [{'close':..}, ...]}（升序）。
"""
from __future__ import annotations

import math
from collections import defaultdict

from factors import calc_rsi, calc_leverage_decay, parse_leverage
import pandas as pd

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
    """趋势分 0-100：价格 vs MA50/MA200 + 均线多头排列，按「偏离强度」连续给分。
    旧版是 ±17/±17/±16 三段阶跃(全宇宙仅 6 个离散档)，把"勉强站上均线"和"暴力多头"
    都给满分、丢失趋势强弱。改用 tanh(相对差/5%) 软压成连续：±5% 偏离≈0.76，强多头仍 ~100、
    强空头仍 ~0，中间平滑可分。数据不足→50 中性。"""
    n = len(closes)
    if n < 50:
        return 50.0
    price = closes[-1]
    ma50 = sum(closes[-50:]) / 50
    ma200 = sum(closes[-200:]) / 200 if n >= 200 else sum(closes) / n

    def _lean(a: float, b: float) -> float:  # 相对差经 tanh 软压到 [-1,1]
        return math.tanh((a / b - 1.0) / 0.05) if b > 0 else 0.0

    s = 50.0 + 17 * _lean(price, ma50) + 17 * _lean(price, ma200) + 16 * _lean(ma50, ma200)
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
        return None if not math.isfinite(f) else f
    except (TypeError, ValueError):
        return None


def _sane(v, lo: float, hi: float):
    """基本面健全性钳制：超出合理区间视作坏数据 → None。
    yfinance 偶尔返回不可能值（如净利率 808%、PB 1453），会污染横截面分位排名，
    在评分入口剔除（视作缺失），比让坏值参与排名更稳。"""
    f = _num(v)
    return f if (f is not None and lo <= f <= hi) else None


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


# v3: the browser and Python share a versioned policy and parity fixtures.
import json
import re
from pathlib import Path
from datetime import UTC

POLICY = json.loads((Path(__file__).resolve().parents[1] / "frontend/src/lib/scoring-policy.json").read_text(encoding="utf-8"))
MODEL_VERSION = POLICY["version"]
QW, TW = POLICY["quality"], POLICY["timing"]


def score_round(value, places=1):
    if value is None:
        return None
    return math.floor(value * 10 ** places + .5 + 1e-9) / 10 ** places


def number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", "")
        match = re.fullmatch(r"([-+]?(?:\d+(?:\.\d*)?|\.\d+))([KMBT])?", value.upper())
        if not match:
            return None
        return _num(match[1]) * {None: 1, "K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}[match[2]]
    return _num(value)


def asset_metadata(s):
    from product_data import product_enrichment
    verified = {**POLICY.get("verifiedAssets", {}).get(s.get("ticker"), {}), **product_enrichment(s)}
    s = {**s, **verified}
    quote = str(s.get("quoteType", "")).upper()
    explicit = s.get("assetType")
    crypto = explicit == "crypto" or quote == "CRYPTOCURRENCY" or s.get("market") == "CRYPTO" or str(s.get("ticker", "")).endswith(("-USD", "-USDT"))
    leverage = number(str(s.get("leverage", "")).lower().replace("x", ""))
    underlying = s.get("underlyingType")
    benchmark = str(s.get("benchmark") or "")
    if not underlying:
        if re.search(r"Gold|WTI|Crude|Silver|黄金|原油|白银", benchmark, re.I):
            underlying = "commodity"
        elif re.search(r"Index|指数", benchmark, re.I):
            underlying = "index"
        elif re.search(r"\([A-Z]+\)|KRX:", benchmark):
            underlying = "stock"
    leveraged = leverage is not None and leverage not in (0, 1)
    etf = not crypto and (bool(s.get("isETF")) or quote == "ETF")
    if crypto:
        kind = "crypto"
    elif etf and leveraged:
        kind = {"stock": "leveraged_stock_etf", "index": "leveraged_index_etf"}.get(underlying, "leveraged_other_etf")
    elif etf and (re.search(r"杠杆|反向|[23]倍", str(s.get("etfType") or "")) or (leverage is not None and leverage == 0)):
        kind = "unclassified_etf"
    elif etf:
        kind = "index_etf" if underlying == "index" else "other_etf"
    else:
        kind = "stock"
    return {**verified, "isETF": etf, "assetType": kind, "underlyingType": underlying, "underlyingSymbol": s.get("underlyingSymbol"),
            "leverageMultiple": leverage if leveraged else (None if kind == "unclassified_etf" else 1),
            "direction": "inverse" if leveraged and leverage < 0 else "long"}


def prepare_inputs(s, bars):
    # Reject malformed series rather than silently filling gaps or treating sampled charts as daily bars.
    valid = bool(bars) and all(number(b.get("close")) is not None and number(b.get("close")) > 0 for b in bars)
    dates = [b.get("date") or b.get("trade_date") for b in bars]
    if all(dates) and (dates != sorted(dates) or len(set(dates)) != len(dates)):
        valid = False
    closes = [number(b["close"]) for b in bars] if valid else []
    return {"version": MODEL_VERSION, "momentum": blended_momentum(closes),
            "trend": trend_score(closes) if len(closes) >= 200 else None,
            "rsi": rsi_timing_score(calc_rsi(pd.Series(closes))) if len(closes) >= 15 else None,
            "decay": calc_leverage_decay(pd.Series(closes, dtype=float), s.get("leverage")),
            "observations": len(closes), "priceAsOf": dates[-1] if valid and dates else None}


def weighted(values, weights):
    available = {k: w for k, w in weights.items() if values.get(k) is not None}
    coverage = sum(available.values())
    return (sum(values[k] * w for k, w in available.items()) / coverage if coverage else None), coverage


def score_universe(stocks, bars_by_ticker=None):
    """Versioned score contract. Missing / unsupported scores are null; no cross-asset z-score."""
    previous = {s["ticker"]: {k: s.get(k) for k in ("score", "scoreSmoothed", "scoreDelta5d", "scoreHistoryVersion")} for s in stocks}
    rows = []
    for s in stocks:
        meta = asset_metadata(s)
        s.update(meta)
        if bars_by_ticker is not None:
            s["scoringInputs"] = prepare_inputs(s, bars_by_ticker.get(s["ticker"], []))
        inp = s.get("scoringInputs") or {}
        if inp.get("version") != MODEL_VERSION:
            inp = {}
        pe, pb = _sane(number(s.get("pe")), .5, 1500), _sane(number(s.get("pb")), 0, 100)
        mc, rev = number(s.get("marketCap")), number(s.get("revenue"))
        currency_ok = bool(s.get("financialCurrency")) and s.get("financialCurrency") == s.get("marketCapCurrency")
        raw = {"ey": 1 / pe if pe else None, "by": 1 / pb if pb else None,
               "sy": rev / mc if mc and mc > 0 and rev is not None and rev >= 0 and currency_ok else None,
               "roe": _sane(number(s.get("roe")), -300, 500), "margin": _sane(number(s.get("profitMargin")), -200, 100),
               "grow": _sane(number(s.get("revenueGrowth")), -100, 2000)}
        rows.append((s, inp, raw))
    for s, inp, raw in rows:
        kind = s["assetType"]
        supported = (kind == "crypto" and s.get("cryptoCategory") in ("monetary", "network", "application")) or kind in ("stock", "index_etf", "other_etf", "leveraged_stock_etf", "leveraged_index_etf")
        group = s.get("gicsSector") or s.get("yfSector") or "unknown"
        same = [(p, r) for p, _, r in rows if group != "unknown" and p["assetType"] == kind and (p.get("gicsSector") or p.get("yfSector") or "unknown") == group and p.get("market") == s.get("market")]
        peers = {}; sub = {}; warnings = []; deduction = 0.0
        if kind == "stock":
            def factor(key, anchor, raw=raw, peers=peers, same=same):
                if raw[key] is None:
                    peers[key] = 0
                    return None
                candidates = [r[key] for p, r in same if r[key] is not None]
                peers[key] = len(candidates)
                # Too few comparable observations: disclose absolute anchor, never cross industries or markets.
                if len(candidates) < POLICY["minimumPeers"]:
                    return anchor
                return (1 - POLICY["anchorWeight"]) * _pct_in(raw[key], candidates) + POLICY["anchorWeight"] * anchor if anchor is not None else _pct_in(raw[key], candidates)
            vals = [factor("ey", _val_abs(raw["ey"], None)), factor("by", _val_abs(None, raw["by"])), factor("sy", None)]
            prof = [factor("roe", _prof_abs(raw["roe"], None)), factor("margin", _prof_abs(None, raw["margin"]))]
            mean = lambda v: sum(x for x in v if x is not None) / len([x for x in v if x is not None]) if any(x is not None for x in v) else None
            sub = {"valuation": mean(vals), "profitability": mean(prof), "growth": factor("grow", _growth_abs(raw["grow"]))}
            coverage = (sum(v is not None for v in vals + prof) + (sub["growth"] is not None)) / 6
            q, _ = weighted(sub, QW)
            if coverage + 1e-9 < POLICY["minimumCoverage"] or sum(v is not None for v in sub.values()) < 2:
                q = None
            if any(n < POLICY["minimumPeers"] for n in peers.values()):
                warnings.append("部分因子同类样本不足，使用绝对锚或暂缺")
            if not s.get("financialCurrency") or not s.get("marketCapCurrency"):
                warnings.append("财务币种未完整标注，营收／市值因子暂不参与")
        else:
            sub = {"cost": None, "liquidity": None, "diversification": None}
            q, coverage = None, 0

        mp = [i.get("momentum") for p, i, _ in rows if p["assetType"] == kind and p.get("market") == s.get("market") and p["direction"] == s["direction"] and (kind != "crypto" or p.get("cryptoCategory") == s.get("cryptoCategory")) and i.get("momentum") is not None]
        sub.update({"momentum": _pct_in(inp["momentum"], mp) if inp.get("momentum") is not None and len(mp) >= POLICY["minimumPeers"] else None,
                    "trend": inp.get("trend"), "rsi": inp.get("rsi")})
        t, tc = weighted(sub, TW)
        if tc + 1e-9 < POLICY["minimumCoverage"]: t = None
        if not supported:
            q = t = None
            sub = {k: None for k in sub}
            warnings.append("该资产类型尚未启用专属模型")
        q = score_round(q, 1) if q is not None else None
        t = score_round(t, 1) if t is not None else None
        s["qualityScore"], s["timingScore"] = q, t
        s["score"] = score_round(q * .6 + t * .4, 1) if q is not None and t is not None else None
        s["subScores"] = {k: score_round(v, 1) if v is not None else None for k, v in sub.items()}
        old = previous[s["ticker"]]
        same_history = old.get("scoreHistoryVersion") == MODEL_VERSION and old.get("score") == s["score"]
        s["scoreSmoothed"] = old.get("scoreSmoothed") if same_history else None
        s["scoreDelta5d"] = old.get("scoreDelta5d") if same_history else None
        s["scoreHistoryVersion"] = MODEL_VERSION if same_history else None
        s["scoring"] = {"version": MODEL_VERSION, "status": "ready" if s["score"] is not None else "insufficient_data" if supported else "unsupported",
                        "coverage": score_round(100 * (.6 * coverage + .4 * tc), 0) if supported else 0,
                        "qualityCoverage": score_round(100 * coverage, 0) if supported else 0, "timingCoverage": score_round(100 * tc, 0) if supported else 0,
                        "peerGroup": f"{s.get('market', 'unknown')} / {kind} / {group}", "factorPeerCounts": peers, "momentumPeers": len(mp),
                        "priceAsOf": inp.get("priceAsOf"), "financialPeriod": s.get("financialPeriod"),
                        "financialPublishedAt": s.get("financialPublishedAt"), "warnings": warnings,
                        "qualityDeduction": score_round(deduction, 1),
                        "weights": POLICY["composite"], "horizon": "多月趋势描述，非买点或上涨概率"}
    from asset_assessment import attach_assessments
    attach_assessments(stocks)
    stocks.sort(key=lambda x: x["score"] if x["score"] is not None else -1, reverse=True)
    counters = defaultdict(int)
    for s in stocks:
        key = (s["assetType"], s.get("market"), s["direction"])
        counters[key] += 1
        s["rank"] = counters[key] if s["score"] is not None else None


def attach_scoring(result, hist, info=None):
    """Prepare actual daily inputs at every fetch entry; final ranks are computed on the universe."""
    from datetime import datetime
    info = info or {}
    result["quoteType"] = info.get("quoteType")
    result["financialCurrency"] = info.get("financialCurrency")
    result["marketCapCurrency"] = info.get("currency") or result.get("currency")
    result["aumCurrency"] = info.get("currency") or result.get("currency")
    period = info.get("mostRecentQuarter")
    result["financialPeriod"] = datetime.fromtimestamp(period, UTC).date().isoformat() if isinstance(period, (int, float)) and period > 0 else None
    for name, field in (("marketCap", "marketCap"), ("revenue", "totalRevenue"), ("aum", "totalAssets"), ("pb", "priceToBook")):
        if number(info.get(field)) is not None:
            result[name] = number(info[field])
    bars = [{"date": idx.strftime("%Y-%m-%d"), "close": float(row["Close"])} for idx, row in hist.iterrows()]
    score_universe([result], {result["ticker"]: bars})
    return result


def record_score_history(stocks, path=None):
    """Keep v3 observations separate from legacy history; never backfill the old model."""
    import score_history
    history_path = Path(path) if path else Path(__file__).resolve().parent / "output" / f"score_history.v{MODEL_VERSION}.json"
    history = score_history.load_history(history_path)
    for s in stocks:
        as_of = (s.get("scoring") or {}).get("priceAsOf")
        day = score_history.date_from_price_as_of(as_of)
        if s.get("score") is None or not day:
            continue
        smoothed, delta = score_history.update_for_ticker(history, s["ticker"], s["score"], date_str=day)
        s.update(scoreSmoothed=smoothed, scoreDelta5d=delta, scoreHistoryVersion=MODEL_VERSION)
    history_path.parent.mkdir(parents=True, exist_ok=True)
    score_history.save_history(history, history_path)
