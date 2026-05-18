"""
value_gene — 价值健康度评估器
================================

按 6 个长期价值特征对股票打分（每个 0/1 = 不达标/达标）：

  V1  估值合理            — PE ≤ 25 且 PB ≤ 5
  V2  ROE 优秀            — ROE ≥ 15%
  V3  毛利率健康          — 毛利率 ≥ 30%
  V4  自由现金流健康       — FCF > 0 且 FCF/营收 ≥ 5%
  V5  负债可控            — D/E ≤ 1.0
  V6  盈利质量稳健         — 净利率 ≥ 10%

阈值取自 Graham/Buffett 派的传统价值过滤：
  - PE 25 / PB 5：合理偏宽，避免漏掉成长性价值股
  - ROE 15%、毛利 30%、净利 10%：稳健盈利公司的下限
  - FCF/营收 5%：自由现金流"造血"能力
  - D/E 1.0：资本结构安全

输出结构与 stock_gene.score_stock 对齐，便于前端复用 ScoreDetail 组件。

数据源：yfinance .info；部分字段缺失时单项标记 available=False，不影响其他项。
"""
from __future__ import annotations

from datetime import datetime


# ── 各特征计算 ──────────────────────────────────────────
def _feature_valuation(info: dict) -> dict:
    pe = info.get("trailingPE")
    pb = info.get("priceToBook")
    if pe is None and pb is None:
        return {
            "id": "valuation",
            "label": "估值合理（PE/PB）",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "yfinance 未提供 PE / PB",
            "available": False,
        }
    parts = []
    pe_ok = True
    pb_ok = True
    if pe is not None:
        pe_f = float(pe)
        # 负 PE（亏损）→ 直接不合格
        if pe_f < 0:
            pe_ok = False
            parts.append(f"PE {pe_f:.1f}（亏损）")
        else:
            pe_ok = pe_f <= 25
            parts.append(f"PE {pe_f:.1f}")
    else:
        parts.append("PE —")
    if pb is not None:
        pb_f = float(pb)
        pb_ok = pb_f <= 5 and pb_f > 0
        parts.append(f"PB {pb_f:.2f}")
    else:
        parts.append("PB —")
    passed = pe_ok and pb_ok
    detail = ("估值在 Graham 安全边际之内" if passed
              else "估值偏高，需要更高的成长预期来撑住")
    return {
        "id": "valuation",
        "label": "估值合理（PE/PB）",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": " · ".join(parts),
        "detail": detail,
        "available": True,
    }


def _feature_roe(info: dict) -> dict:
    roe = info.get("returnOnEquity")
    if roe is None:
        return {
            "id": "roe",
            "label": "ROE 优秀",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "yfinance 未提供 ROE",
            "available": False,
        }
    roe_f = float(roe)
    passed = roe_f >= 0.15
    return {
        "id": "roe",
        "label": "ROE 优秀",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"ROE {roe_f * 100:.1f}%",
        "detail": ("资本回报率优秀，股东权益持续放大"
                   if passed else "ROE 低于 15%，资本运用效率不足"),
        "available": True,
    }


def _feature_gross_margin(info: dict) -> dict:
    gm = info.get("grossMargins")
    if gm is None:
        return {
            "id": "gross_margin",
            "label": "毛利率健康",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "yfinance 未提供毛利率",
            "available": False,
        }
    gm_f = float(gm)
    passed = gm_f >= 0.30
    return {
        "id": "gross_margin",
        "label": "毛利率健康",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"毛利率 {gm_f * 100:.1f}%",
        "detail": ("产品/服务有定价权，护城河信号"
                   if passed else "毛利率偏低，价格竞争激烈或缺乏壁垒"),
        "available": True,
    }


def _feature_free_cashflow(info: dict) -> dict:
    fcf = info.get("freeCashflow")
    rev = info.get("totalRevenue")
    if fcf is None or rev is None or rev <= 0:
        return {
            "id": "free_cashflow",
            "label": "自由现金流健康",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "yfinance 未提供 FCF 或营收",
            "available": False,
        }
    fcf_f = float(fcf)
    rev_f = float(rev)
    ratio = fcf_f / rev_f
    passed = fcf_f > 0 and ratio >= 0.05
    # 简单 human 格式
    def _humanize(n):
        a = abs(n)
        if a >= 1e9: return f"{n / 1e9:.2f}B"
        if a >= 1e6: return f"{n / 1e6:.1f}M"
        return f"{n:.0f}"
    return {
        "id": "free_cashflow",
        "label": "自由现金流健康",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"FCF {_humanize(fcf_f)} · FCF/营收 {ratio * 100:.1f}%",
        "detail": ("自由现金流为正且占营收比健康，造血能力强"
                   if passed else "现金流转化不足，依赖外部融资风险高"),
        "available": True,
    }


def _feature_debt(info: dict) -> dict:
    de = info.get("debtToEquity")
    if de is None:
        return {
            "id": "debt",
            "label": "负债可控",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "yfinance 未提供 D/E",
            "available": False,
        }
    de_f = float(de)
    # yfinance 的 debtToEquity 单位是 % (如 65.4 = 0.654)
    # 但有些 ticker 直接给 0.65 的小数。判断方式：> 5 时视为百分比
    de_ratio = de_f / 100 if de_f > 5 else de_f
    passed = de_ratio <= 1.0 and de_ratio >= 0
    return {
        "id": "debt",
        "label": "负债可控",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"D/E {de_ratio:.2f}",
        "detail": ("资本结构健康，抗风险能力强"
                   if passed else "负债率偏高，利率上升时压力大"),
        "available": True,
    }


def _feature_profit_margin(info: dict) -> dict:
    pm = info.get("profitMargins")
    if pm is None:
        return {
            "id": "profit_margin",
            "label": "盈利质量稳健",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "yfinance 未提供净利率",
            "available": False,
        }
    pm_f = float(pm)
    passed = pm_f >= 0.10
    return {
        "id": "profit_margin",
        "label": "盈利质量稳健",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"净利率 {pm_f * 100:.1f}%",
        "detail": ("盈利转化效率稳健"
                   if passed else "净利率偏薄，承压能力弱"),
        "available": True,
    }


# ── 综合评分 ────────────────────────────────────────────
def _verdict(score: int, available: int) -> dict:
    """根据满足条件数给评价。"""
    if available == 0:
        return {"level": "unknown", "label": "数据不足", "color": "gray"}
    pct = score / available
    if score >= 5 or (available < 6 and pct >= 0.83):
        return {"level": "strong", "label": "优质标的", "color": "emerald"}
    if score >= 4 or pct >= 0.66:
        return {"level": "moderate", "label": "质量合格", "color": "amber"}
    if score >= 3 or pct >= 0.5:
        return {"level": "neutral", "label": "中性", "color": "slate"}
    return {"level": "weak", "label": "不推荐", "color": "rose"}


def _fetch_info(ticker: str, cached_stock: dict | None = None) -> tuple[dict, str | None]:
    """
    优先 yfinance .info；失败时回退到 server cache.stocks 里已有的字段
    （pe / roe / profitMargin / marketCap）+ data_sources.fetch_fundamentals
    取 PB / D/E。返回 (info_dict, error_msg_or_None)。
    """
    info: dict = {}
    err: str | None = None
    # 1) 主路径：yfinance .info（全字段）
    try:
        import yfinance as yf
        tk = yf.Ticker(ticker)
        info = dict(tk.info or {})
    except Exception as e:
        err = f"yfinance .info 失败: {e}"
        info = {}

    # 2) 兜底：cache.stocks（pe / roe / profitMargin 已 pipeline 缓存）
    if cached_stock:
        # pipeline 缓存里 roe / profitMargin 已 *100 取百分位（如 25.5 = 25.5%）
        # yfinance .info 是小数（0.255）；归一到小数
        if "trailingPE" not in info and cached_stock.get("pe") is not None:
            info["trailingPE"] = cached_stock["pe"]
        if "returnOnEquity" not in info and cached_stock.get("roe") is not None:
            info["returnOnEquity"] = cached_stock["roe"] / 100.0
        if "profitMargins" not in info and cached_stock.get("profitMargin") is not None:
            info["profitMargins"] = cached_stock["profitMargin"] / 100.0

    # 3) 第二兜底：fetch_fundamentals（PB / D/E）
    if "priceToBook" not in info or "debtToEquity" not in info:
        try:
            from data_sources.yfinance_source import fetch_fundamentals
            f = fetch_fundamentals(ticker)
            if "trailingPE" not in info and f.get("pe") is not None:
                info["trailingPE"] = f["pe"]
            if "priceToBook" not in info and f.get("pb") is not None:
                info["priceToBook"] = f["pb"]
            if "returnOnEquity" not in info and f.get("roe") is not None:
                info["returnOnEquity"] = f["roe"]
            if "debtToEquity" not in info and f.get("debt_to_equity") is not None:
                # fetch_fundamentals 已把 yfinance 的百分数除 100，这里乘回避免 _feature_debt 二次除
                info["debtToEquity"] = f["debt_to_equity"] * 100
        except Exception:
            pass  # 兜底失败不致命

    return info, err if not info else None


def score_value(ticker: str, name: str = "", market: str = "US",
                sector: str = "", cached_stock: dict | None = None) -> dict:
    """对单只股票跑完 6 个价值特征评分。

    cached_stock: 可选的 server.cache.stocks 条目，作为 yfinance 失败时的兜底数据源。
    """
    ticker = ticker.strip().upper()
    warnings: list[str] = []
    info, err = _fetch_info(ticker, cached_stock=cached_stock)
    if err:
        warnings.append(err)

    features = [
        _feature_valuation(info),
        _feature_roe(info),
        _feature_gross_margin(info),
        _feature_free_cashflow(info),
        _feature_debt(info),
        _feature_profit_margin(info),
    ]

    available = sum(1 for f in features if f.get("available"))
    score = sum(1 for f in features if f.get("pass"))

    if available < 6:
        warnings.append(f"部分基本面字段缺失（{6 - available}/6 项），评分仅基于 {available} 项")

    return {
        "ticker": ticker,
        "name": name,
        "market": market,
        "sector": sector,
        "engine": "value",
        "score": score,
        "max_score": 6,
        "available": available,
        "verdict": _verdict(score, available),
        "checked_at": datetime.utcnow().isoformat() + "Z",
        "features": features,
        "warnings": warnings,
    }


def compare_peers_value(tickers: list[str], sector: str = "",
                        market: str = "US") -> dict:
    """横向对比同行业的多只股票（价值维度）。"""
    rows = []
    for t in tickers:
        try:
            rows.append(score_value(t, market=market, sector=sector))
        except Exception as e:
            rows.append({"ticker": t, "error": str(e)})
    return {
        "engine": "value",
        "sector": sector,
        "market": market,
        "count": len(rows),
        "items": rows,
    }
