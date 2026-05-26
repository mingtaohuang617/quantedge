"""
Smart Beta 三层策略核心
========================
L1 风险层：VIX + 趋势 + 信用利差 + 实际利率 → risk_score → core_weight
L2 Core 层：core_preset (balanced/simple/factor) → core 内部权重
L3 Sector 层：行业 ETF 5 维评分 → 缓冲带 top-K → sector 权重

最终 weights = core_weight·core_alloc + (1-core_weight)·sector_alloc
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

# ─── 路径 ────────────────────────────────────────────────
ETF_UNIVERSE = Path(__file__).parent / "universe" / "etf_us.json"


def load_universe() -> dict:
    """读取 etf_us.json。"""
    with open(ETF_UNIVERSE, encoding="utf-8") as f:
        return json.load(f)


# ─── L1 风险层 ───────────────────────────────────────────
def compute_risk_score(
    vix: float | None,
    spy_prices: pd.Series,
    hy_spread: float | None,
    real_rate_chg: float | None,
) -> dict:
    """4 个信号合成 risk_score ∈ [0,1]。

    高分 = 风险偏好高 → core 权重低、sector 权重高。
    任何缺数据的信号给 0.5 中性值。
    """
    # VIX: <15 → 1, >25 → 0, 区间线性
    if vix is None or (isinstance(vix, float) and np.isnan(vix)):
        vix_score = 0.5
    elif vix < 15:
        vix_score = 1.0
    elif vix > 25:
        vix_score = 0.0
    else:
        vix_score = (25 - float(vix)) / 10.0

    # 50/200 均线趋势 + 斜率
    if len(spy_prices) < 200:
        trend_score = 0.5
    else:
        ma50 = float(spy_prices.tail(50).mean())
        ma200 = float(spy_prices.tail(200).mean())
        # 30 天前的 ma50 估值（看斜率方向）
        if len(spy_prices) > 80:
            ma50_prev = float(spy_prices.iloc[-80:-30].mean())
        else:
            ma50_prev = ma50
        slope_up = ma50 > ma50_prev
        if ma50 > ma200 and slope_up:
            trend_score = 1.0
        elif ma50 > ma200:
            trend_score = 0.7
        elif ma50_prev > ma200 and ma50 < ma200:  # 死叉
            trend_score = 0.0
        else:
            trend_score = 0.3

    # HY 信用利差：<4% 宽松、>6% 紧张
    if hy_spread is None or (isinstance(hy_spread, float) and np.isnan(hy_spread)):
        credit_score = 0.5
    elif hy_spread < 4:
        credit_score = 1.0
    elif hy_spread > 6:
        credit_score = 0.0
    else:
        credit_score = (6.0 - float(hy_spread)) / 2.0

    # 10Y TIPS 实际利率变化（百分点，近月）
    if real_rate_chg is None or (isinstance(real_rate_chg, float) and np.isnan(real_rate_chg)):
        rate_score = 0.5
    elif real_rate_chg < -0.2:
        rate_score = 1.0
    elif real_rate_chg > 0.3:
        rate_score = 0.0
    else:
        rate_score = (0.3 - float(real_rate_chg)) / 0.5
        rate_score = max(0.0, min(1.0, rate_score))

    risk_score = (
        vix_score * 0.30
        + trend_score * 0.30
        + credit_score * 0.20
        + rate_score * 0.20
    )

    return {
        "risk_score": round(float(risk_score), 3),
        "components": {
            "vix":       round(float(vix_score), 3),
            "trend":     round(float(trend_score), 3),
            "credit":    round(float(credit_score), 3),
            "real_rate": round(float(rate_score), 3),
        },
    }


def risk_score_to_core_weight(risk_score: float) -> float:
    """risk_score=1.0 → core=40%; risk_score=0.0 → core=90%。线性插值。"""
    return round(0.9 - 0.5 * float(risk_score), 3)


# ─── L2 Core 层 ──────────────────────────────────────────
def get_core_allocation(preset: str, universe: dict) -> dict:
    """从 universe['core'][preset] 取权重副本。"""
    if preset not in universe.get("core", {}):
        raise ValueError(f"unknown core_preset: {preset}")
    return dict(universe["core"][preset]["weights"])


# ─── L3 Sector 层 ────────────────────────────────────────
def score_sector_etf(
    prices: pd.Series,
    spy_prices: pd.Series,
    volumes: pd.Series | None = None,
) -> dict:
    """单只行业 ETF 的 5 维评分。

    返回 {score, components: {trend, relative, flow, sharpe, rsi}}
    """
    empty = {"score": 0.0, "components": {"trend": 0, "relative": 0,
                                          "flow": 0, "sharpe": 0, "rsi": 50}}
    # yfinance period="6mo" 实际返回 ~120-126 交易日；用 120 而非 130 兜底，
    # 保证够算 r_3m + RSI + 短 sharpe；r_6m 在 ≥127 时自动启用（见下方）。
    if len(prices) < 120:
        return empty

    # 趋势动量：1M*0.3 + 3M*0.5 + 6M*0.2
    # 外层已保证 n >= 120，r_1m / r_3m 永远可算。
    # r_6m 优先 iloc[-126]；数据 120-126 时退化到 iloc[0]（实际能拿到的最远点
    # ≈ 6 个月），与原意接近 — 避免 r_6m=0 系统性拉低 trend 分。
    n = len(prices)
    r_1m = float(prices.iloc[-1] / prices.iloc[-21] - 1)
    r_3m = float(prices.iloc[-1] / prices.iloc[-63] - 1)
    r_6m_idx = -126 if n >= 127 else 0
    r_6m = float(prices.iloc[-1] / prices.iloc[r_6m_idx] - 1)
    trend_pct = r_1m * 0.3 + r_3m * 0.5 + r_6m * 0.2
    # -10% → 0, 0% → 50, +10% → 100
    trend = max(0.0, min(100.0, 50.0 + trend_pct * 500.0))

    # 相对强度 vs SPY (3M)
    if len(spy_prices) >= 64:
        spy_3m = float(spy_prices.iloc[-1] / spy_prices.iloc[-63] - 1)
        rel = r_3m - spy_3m
    else:
        rel = 0.0
    relative = max(0.0, min(100.0, 50.0 + rel * 1000.0))

    # 资金流：30D 均量 / 90D 均量
    if volumes is not None and len(volumes) >= 90:
        v30 = float(volumes.tail(30).mean())
        v90 = float(volumes.tail(90).mean())
        flow_ratio = v30 / v90 if v90 > 0 else 1.0
    else:
        flow_ratio = 1.0
    flow = max(0.0, min(100.0, 50.0 + (flow_ratio - 1.0) * 100.0))

    # 夏普近 6M
    rets = prices.tail(126).pct_change().dropna()
    if len(rets) > 20:
        mean_ann = float(rets.mean()) * 252
        vol_ann = float(rets.std()) * np.sqrt(252)
        sharpe_raw = mean_ann / vol_ann if vol_ann > 0 else 0.0
        if sharpe_raw < -1:
            sharpe = 0.0
        elif sharpe_raw < 0:
            sharpe = 15.0 + sharpe_raw * 15.0
        elif sharpe_raw < 2:
            sharpe = 30.0 + sharpe_raw * 30.0
        else:
            sharpe = min(95.0, 60.0 + (sharpe_raw - 1.0) * 35.0)
    else:
        sharpe = 50.0

    # RSI (14D)
    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_g = float(gain.tail(14).mean())
    avg_l = float(loss.tail(14).mean())
    rsi = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1.0 + avg_g / avg_l)

    score = (
        trend * 0.35
        + relative * 0.25
        + flow * 0.15
        + sharpe * 0.15
    )
    # RSI > 75 过热惩罚 -15
    if rsi > 75:
        score -= 15.0

    return {
        "score": round(float(max(0.0, min(100.0, score))), 2),
        "components": {
            "trend":    round(float(trend), 1),
            "relative": round(float(relative), 1),
            "flow":     round(float(flow), 1),
            "sharpe":   round(float(sharpe), 1),
            "rsi":      round(float(rsi), 1),
        },
    }


def select_sector_top_k(
    ranked: list[dict],
    current_holdings: list[str] | None,
    k: int = 3,
    buffer: int = 2,
) -> list[str]:
    """缓冲带换仓：
    - 当前持仓只要仍在 top-(K+buffer) 内就保留
    - 不足 K 只时按排名顺序从 top-K 补足
    """
    if not ranked:
        return []
    sorted_tickers = [r["ticker"] for r in ranked]
    top_k = sorted_tickers[:k]
    if not current_holdings:
        return top_k

    buffered = set(sorted_tickers[:k + buffer])
    kept = [t for t in current_holdings if t in buffered]
    additions = [t for t in top_k if t not in kept]
    selected = (kept + additions)[:k]
    return selected


def allocate_sector_weights(
    selected: list[str],
    ranked: list[dict],
    mode: str = "equal",
) -> dict:
    """equal: 等权；momentum: 按 score 归一化。"""
    if not selected:
        return {}
    score_map = {r["ticker"]: r["score"] for r in ranked}
    if mode == "momentum":
        s = [max(0.0, float(score_map.get(t, 0))) for t in selected]
        total = sum(s)
        if total <= 0:
            return {t: round(1.0 / len(selected), 4) for t in selected}
        return {t: round(si / total, 4) for t, si in zip(selected, s, strict=False)}
    # equal
    return {t: round(1.0 / len(selected), 4) for t in selected}


# ─── 编排 ────────────────────────────────────────────────
def compose_weights(
    core_weight: float,
    core_alloc: dict,
    sector_alloc: dict,
) -> dict:
    """合成最终持仓权重（同一标的同时在 core 和 sector 时会相加）。"""
    sector_w = 1.0 - float(core_weight)
    out: dict = {}
    for t, w in core_alloc.items():
        out[t] = out.get(t, 0.0) + float(core_weight) * float(w)
    for t, w in sector_alloc.items():
        out[t] = out.get(t, 0.0) + sector_w * float(w)
    return {t: round(float(w), 4) for t, w in out.items()}


def build_snapshot(
    spy_prices: pd.Series,
    sector_data: dict,
    vix: float | None = None,
    hy_spread: float | None = None,
    real_rate_chg: float | None = None,
    core_preset: str = "balanced",
    k: int = 3,
    weight_mode: str = "equal",
    current_holdings: list[str] | None = None,
    universe: dict | None = None,
) -> dict:
    """端到端：原始数据 → 完整 snapshot dict。

    `sector_data` 形如：
      { "XLK": {"prices": Series, "volumes": Series|None, "name": "..."}, ... }
    """
    if universe is None:
        universe = load_universe()

    # L1
    risk = compute_risk_score(vix, spy_prices, hy_spread, real_rate_chg)
    core_weight = risk_score_to_core_weight(risk["risk_score"])

    # L2
    core_alloc = get_core_allocation(core_preset, universe)

    # L3
    sector_meta = {s["ticker"]: s for s in universe.get("sector", [])}
    ranked: list[dict] = []
    for ticker, payload in sector_data.items():
        prices = payload.get("prices")
        if prices is None or len(prices) < 120:
            continue
        sc = score_sector_etf(prices, spy_prices, payload.get("volumes"))
        meta = sector_meta.get(ticker, {})
        ranked.append({
            "ticker":        ticker,
            "name":          payload.get("name") or meta.get("name", ticker),
            "category":      meta.get("category", "sector"),
            "expense_ratio": meta.get("expense_ratio"),
            "score":         sc["score"],
            "components":    sc["components"],
        })
    ranked.sort(key=lambda r: r["score"], reverse=True)

    selected = select_sector_top_k(ranked, current_holdings, k=k, buffer=2)
    sector_alloc = allocate_sector_weights(selected, ranked, mode=weight_mode)
    weights = compose_weights(core_weight, core_alloc, sector_alloc)

    return {
        "as_of": pd.Timestamp.now().isoformat(),
        "config": {
            "core_preset":  core_preset,
            "k":            k,
            "weight_mode":  weight_mode,
            "buffer":       2,
        },
        "risk":             risk,
        "core_weight":      core_weight,
        "core_alloc":       core_alloc,
        "sector_alloc":     sector_alloc,
        "sector_ranked":    ranked,
        "sector_selected":  selected,
        "weights":          weights,
    }
