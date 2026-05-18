"""
risk_gene — 风险画像评估器
============================

针对下行风险量化，6 个风险维度（每个 0/1，达标 = 风险低）：

  R1  历史最大回撤可控    — 近 1 年 MDD ≤ 30%
  R2  波动率偏低          — 年化日收益波动率 ≤ 35%
  R3  Beta 温和           — |Beta vs 基准| ≤ 1.3
  R4  流动性充足          — 近 20D 平均成交额 ≥ $5M（US 等价）
  R5  极端事件抗跌        — 近 1 年最差连续 5 日累计跌幅 ≤ 15%
  R6  基本面无雷区        — 净利率 > 0 且毛利率 > 20%

输出结构与其它引擎对齐。verdict 分级：
  5-6 → 低风险（绿） · 4 → 风险可控（黄） · 3 → 中等风险（灰） · ≤2 → 高风险（红）

数据：复用 stock_gene._load_bars / value_gene._fetch_info（双兜底）。
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

from stock_gene import _load_bars

# US 流动性阈值 USD；港股 / A 股按市值大小弱化检查
LIQUIDITY_USD = 5e6
# RS 用基准（与 stock_gene 保持一致）
RISK_BENCHMARK = {
    "US": "SPY",
    "HK": "^HSI",
    "CN": "000300.SH",
    "SH": "000300.SH",
    "SZ": "000300.SH",
}


# ── 工具 ────────────────────────────────────────────────
def _na(id_: str, label: str, why: str) -> dict:
    return {
        "id": id_,
        "label": label,
        "pass": False, "score": 0,
        "value": "—",
        "detail": why,
        "available": False,
    }


def _verdict(score: int, available: int) -> dict:
    if available == 0:
        return {"level": "unknown", "label": "数据不足", "color": "gray"}
    pct = score / available
    if score >= 5 or (available < 6 and pct >= 0.83):
        return {"level": "strong", "label": "低风险", "color": "emerald"}
    if score >= 4 or pct >= 0.66:
        return {"level": "moderate", "label": "风险可控", "color": "amber"}
    if score >= 3 or pct >= 0.5:
        return {"level": "neutral", "label": "中等风险", "color": "slate"}
    return {"level": "weak", "label": "高风险", "color": "rose"}


# ── 各特征 ─────────────────────────────────────────────
def _feature_max_drawdown(df: pd.DataFrame) -> dict:
    if len(df) < 220:
        return _na("max_drawdown", "历史最大回撤可控", "数据不足 1 年（≈252 天）")
    close = df["close"].astype(float).iloc[-252:]
    running_max = close.cummax()
    dd = (close - running_max) / running_max
    mdd = float(dd.min()) * 100  # 负数（如 -42.5）
    passed = mdd >= -30
    return {
        "id": "max_drawdown",
        "label": "历史最大回撤可控",
        "pass": bool(passed),
        "score": 1 if passed else 0,
        "value": f"1Y MDD {mdd:.1f}%",
        "detail": ("回撤幅度可控，下行风险有限"
                   if passed else "历史回撤超 30%，需注意尾部风险"),
        "available": True,
    }


def _feature_volatility(df: pd.DataFrame) -> dict:
    if len(df) < 60:
        return _na("volatility", "波动率偏低", "数据不足 60 个交易日")
    close = df["close"].astype(float)
    rets = close.pct_change().dropna().iloc[-252:]
    if len(rets) < 30:
        return _na("volatility", "波动率偏低", "样本不足")
    vol = float(rets.std()) * np.sqrt(252) * 100
    passed = vol <= 35
    return {
        "id": "volatility",
        "label": "波动率偏低（年化）",
        "pass": bool(passed),
        "score": 1 if passed else 0,
        "value": f"年化波动 {vol:.1f}%",
        "detail": ("波动温和，持有体验稳定"
                   if passed else "波动率偏高，仓位需轻"),
        "available": True,
    }


def _feature_beta(df: pd.DataFrame, bench_df: pd.DataFrame | None) -> dict:
    if bench_df is None or len(df) < 130 or len(bench_df) < 130:
        return _na("beta", "Beta 温和", "数据或基准不足 6 个月")
    close = df["close"].astype(float).iloc[-252:]
    bclose = bench_df["close"].astype(float).iloc[-252:]
    # 对齐长度（截断到较短的）
    n = min(len(close), len(bclose))
    rs = close.iloc[-n:].pct_change().dropna()
    bs = bclose.iloc[-n:].pct_change().dropna()
    n2 = min(len(rs), len(bs))
    rs = rs.iloc[-n2:].reset_index(drop=True)
    bs = bs.iloc[-n2:].reset_index(drop=True)
    if n2 < 30 or bs.var() == 0:
        return _na("beta", "Beta 温和", "样本或基准方差不足")
    beta = float(np.cov(rs, bs)[0, 1] / np.var(bs))
    passed = abs(beta) <= 1.3
    return {
        "id": "beta",
        "label": "Beta 温和",
        "pass": bool(passed),
        "score": 1 if passed else 0,
        "value": f"Beta {beta:+.2f}",
        "detail": ("跟随市场温和，无放大效应"
                   if passed else "Beta 偏高，市场下跌时跌幅放大"),
        "available": True,
    }


def _feature_liquidity(df: pd.DataFrame, market: str) -> dict:
    vol = df.get("volume")
    if vol is None or len(df) < 21 or vol.dropna().empty:
        return _na("liquidity", "流动性充足", "成交量数据不足")
    last20 = df.iloc[-20:]
    close_avg = float(last20["close"].astype(float).mean())
    vol_avg = float(last20["volume"].astype(float).mean())
    turnover = close_avg * vol_avg  # USD 等价（HK 时为 HKD、A 股为 CNY）
    # 按市场调整阈值（粗略）
    threshold = LIQUIDITY_USD
    if market == "HK":
        threshold = LIQUIDITY_USD * 7.8  # HKD ≈ USD/7.8
    elif market in ("CN", "SH", "SZ"):
        threshold = LIQUIDITY_USD * 7.0  # CNY ≈ USD/7
    passed = turnover >= threshold
    # 友好展示
    def _h(x):
        a = abs(x)
        if a >= 1e9: return f"{x / 1e9:.2f}B"
        if a >= 1e6: return f"{x / 1e6:.1f}M"
        return f"{x:.0f}"
    cur = "$" if market == "US" else ("HK$" if market == "HK" else "¥")
    return {
        "id": "liquidity",
        "label": "流动性充足",
        "pass": bool(passed),
        "score": 1 if passed else 0,
        "value": f"20D 均成交额 {cur}{_h(turnover)}",
        "detail": ("流动性充足，进出无显著冲击成本"
                   if passed else "流动性偏弱，大单可能滑点"),
        "available": True,
    }


def _feature_worst_5d(df: pd.DataFrame) -> dict:
    if len(df) < 60:
        return _na("worst_5d", "极端事件抗跌", "数据不足 60 个交易日")
    close = df["close"].astype(float).iloc[-252:]
    if len(close) < 30:
        return _na("worst_5d", "极端事件抗跌", "样本不足")
    rets = close.pct_change().dropna()
    # 连续 5 日累计跌幅最差
    rolling5 = (1 + rets).rolling(5).apply(np.prod, raw=True) - 1
    worst = float(rolling5.min()) * 100
    passed = worst >= -15
    return {
        "id": "worst_5d",
        "label": "极端事件抗跌（最差 5 日）",
        "pass": bool(passed),
        "score": 1 if passed else 0,
        "value": f"最差 5D 累计 {worst:.1f}%",
        "detail": ("极端跌幅可控"
                   if passed else "曾出现连续 5 日深跌 >15%"),
        "available": True,
    }


def _feature_fundamentals(ticker: str, market: str,
                          cached_stock: dict | None) -> dict:
    """净利率 > 0 且 毛利率 > 20% — 财务雷区检查。"""
    try:
        import value_gene
        info, _err = value_gene._fetch_info(ticker, cached_stock=cached_stock)
    except Exception:
        info = {}
    pm = info.get("profitMargins")
    gm = info.get("grossMargins")
    if pm is None and gm is None:
        return _na("fundamentals", "基本面无雷区", "净利率 / 毛利率均缺失")
    pm_f = float(pm) if pm is not None else None
    gm_f = float(gm) if gm is not None else None
    parts = []
    pm_ok = pm_f is not None and pm_f > 0
    gm_ok = gm_f is not None and gm_f >= 0.20
    if pm_f is not None:
        parts.append(f"净利率 {pm_f * 100:.1f}%")
    else:
        parts.append("净利率 —")
    if gm_f is not None:
        parts.append(f"毛利率 {gm_f * 100:.1f}%")
    else:
        parts.append("毛利率 —")
    # 任一字段缺失时只判断已有的
    if pm_f is None:
        passed = gm_ok
    elif gm_f is None:
        passed = pm_ok
    else:
        passed = pm_ok and gm_ok
    return {
        "id": "fundamentals",
        "label": "基本面无雷区",
        "pass": bool(passed),
        "score": 1 if passed else 0,
        "value": " · ".join(parts),
        "detail": ("盈利能力健康，无明显财务隐患"
                   if passed else "净利或毛利偏弱，警惕基本面恶化"),
        "available": True,
    }


# ── 综合入口 ────────────────────────────────────────────
def score_risk(ticker: str, name: str = "", market: str = "US",
               sector: str = "", cached_stock: dict | None = None) -> dict:
    """对单只股票跑完 6 个风险画像特征。"""
    ticker = ticker.strip().upper()
    warnings: list[str] = []
    df = _load_bars(ticker, days=280)
    if df is None or df.empty:
        return {
            "ticker": ticker,
            "name": name,
            "market": market,
            "sector": sector,
            "engine": "risk",
            "score": 0,
            "max_score": 6,
            "available": 0,
            "verdict": _verdict(0, 0),
            "checked_at": datetime.utcnow().isoformat() + "Z",
            "features": [],
            "warnings": [f"无法获取 {ticker} 的历史 K 线"],
        }
    # 基准（Beta 用）
    bench_ticker = RISK_BENCHMARK.get(market, "SPY")
    bench_df = _load_bars(bench_ticker, days=280)
    if bench_df is None or len(bench_df) < 130:
        warnings.append(f"基准 {bench_ticker} 数据缺失，Beta 改为 N/A")
        bench_df = None

    features = [
        _feature_max_drawdown(df),
        _feature_volatility(df),
        _feature_beta(df, bench_df),
        _feature_liquidity(df, market),
        _feature_worst_5d(df),
        _feature_fundamentals(ticker, market, cached_stock),
    ]

    available = sum(1 for f in features if f.get("available"))
    score = sum(1 for f in features if f.get("pass"))

    return {
        "ticker": ticker,
        "name": name,
        "market": market,
        "sector": sector,
        "engine": "risk",
        "score": score,
        "max_score": 6,
        "available": available,
        "verdict": _verdict(score, available),
        "checked_at": datetime.utcnow().isoformat() + "Z",
        "features": features,
        "warnings": warnings,
    }


def compare_peers_risk(tickers: list[str], sector: str = "",
                       market: str = "US") -> dict:
    """风险横向对比。"""
    rows = []
    for t in tickers:
        try:
            rows.append(score_risk(t, market=market, sector=sector))
        except Exception as e:
            rows.append({"ticker": t, "error": str(e)})
    return {
        "engine": "risk",
        "sector": sector,
        "market": market,
        "count": len(rows),
        "items": rows,
    }
