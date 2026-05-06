"""
value.score — 5 维加权评分 + DCF 简化版
==========================================
输入：fetcher.fetch_value_metrics 的输出 + 同行 peers 的指标列表 + 权重字典
输出：{value_score, sub_scores, drivers}

5 维：
  moat       — 毛利率/净利率行业分位（LLM 增强部分由 V3 端点合并）
  financial  — ROE + FCF 5y CAGR + 负债率
  mgmt       — 分红连续年数 + 5 年回购占比
  valuation  — DCF 简化版（固定 10% 折现 + 5y CAGR + 永续 2.5%）
  compound   — 5 年净利润 CAGR

权重预设（前端可切换）：
  buffett:        moat 40 / financial 30 / mgmt 15 / valuation 10 / compound 5
  user_default:   moat 30 / financial 25 / mgmt 15 / valuation 20 / compound 10
  balanced:       20/20/20/20/20
"""
from __future__ import annotations

import math
from typing import Any

from .industry_peers import industry_pctile

WEIGHT_PRESETS: dict[str, dict[str, int]] = {
    "buffett":      {"moat": 40, "financial": 30, "mgmt": 15, "valuation": 10, "compound":  5},
    "user_default": {"moat": 30, "financial": 25, "mgmt": 15, "valuation": 20, "compound": 10},
    "balanced":     {"moat": 20, "financial": 20, "mgmt": 20, "valuation": 20, "compound": 20},
}

DEFAULT_WEIGHTS = WEIGHT_PRESETS["user_default"]


# ── 工具：线性映射 ────────────────────────────────────
def _linear(value: float | None, low: float, high: float, *, reverse: bool = False) -> float | None:
    """value 在 [low, high] 线性映射到 [0, 100]。reverse=True 时反向（low→100, high→0）。
    缺失返回 None。"""
    if value is None:
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    if high == low:
        return 50.0
    if reverse:
        score = (high - value) / (high - low) * 100
    else:
        score = (value - low) / (high - low) * 100
    return max(0.0, min(100.0, score))


# ── DCF 简化模型 ──────────────────────────────────────
def dcf_value(
    fcf_ttm: float,
    g_5y: float | None,
    *,
    discount: float = 0.10,
    years: int = 5,
    terminal_growth: float = 0.025,
    g_cap: float = 0.15,
    g_floor: float = -0.05,
) -> float | None:
    """
    简化两阶段 DCF：未来 N 年 FCF 按 g 增长，第 N+1 年起永续 terminal_growth。

    参数:
      fcf_ttm: 当前 TTM 自由现金流（单位元；负值 / None → 返回 None）
      g_5y: 5 年历史 FCF CAGR（None → 用 0% 保守估计）
      discount: 折现率（默认 10%）
      years: 显式预测年数
      terminal_growth: 永续增长率（默认 2.5%）
      g_cap: g 上限（防止高增长股算出天价）
      g_floor: g 下限
    返回: 内在价值（市值口径）；fcf_ttm <= 0 时返回 None
    """
    if fcf_ttm is None or fcf_ttm <= 0:
        return None
    g = g_5y if g_5y is not None else 0.0
    g = max(min(g, g_cap), g_floor)
    if discount <= terminal_growth:
        return None  # 防数学错误

    pv_explicit = sum(
        fcf_ttm * (1 + g) ** y / (1 + discount) ** y
        for y in range(1, years + 1)
    )
    terminal_fcf = fcf_ttm * (1 + g) ** years * (1 + terminal_growth)
    pv_terminal = terminal_fcf / (discount - terminal_growth) / (1 + discount) ** years
    return pv_explicit + pv_terminal


# ── 5 个子维度评分 ────────────────────────────────────
def score_moat(metrics: dict, peer_metrics: list[dict] | None = None) -> tuple[float | None, dict]:
    """
    护城河量化部分（LLM 增强部分由 V3 单独算后合并）。
    用 gross_margin / profit_margin 在行业内分位作量化代理。
    返回 (score 0-100, drivers)。drivers 含子项详情。
    """
    drivers: dict[str, Any] = {}
    gm = metrics.get("gross_margin")
    pm = metrics.get("profit_margin")

    if peer_metrics:
        peer_gm = [p.get("gross_margin") for p in peer_metrics]
        peer_pm = [p.get("profit_margin") for p in peer_metrics]
        gm_pct = industry_pctile(gm, peer_gm, higher_is_better=True)
        pm_pct = industry_pctile(pm, peer_pm, higher_is_better=True)
        drivers["gross_margin_pctile"] = gm_pct
        drivers["profit_margin_pctile"] = pm_pct
        if gm_pct is not None and pm_pct is not None:
            score = gm_pct * 0.5 + pm_pct * 0.5
            return score, drivers

    # peer 不足时退回绝对阈值（毛利率 > 50% / 净利率 > 20% 算护城河强）
    gm_score = _linear(gm, 0.20, 0.60)
    pm_score = _linear(pm, 0.05, 0.25)
    drivers["gross_margin_abs_score"] = gm_score
    drivers["profit_margin_abs_score"] = pm_score
    if gm_score is None and pm_score is None:
        return None, drivers
    parts = [s for s in (gm_score, pm_score) if s is not None]
    return sum(parts) / len(parts), drivers


def score_financial(metrics: dict) -> tuple[float | None, dict]:
    """
    财务造血能力。ROE + FCF 5y CAGR + 负债率。
    yfinance debt_to_equity 是百分比数（如 79.5 表示 79.5%）。
    """
    drivers: dict[str, Any] = {}

    roe = metrics.get("roe_ttm")  # 小数，0.20 = 20%
    roe_score = _linear(roe, 0.05, 0.20)  # 5%-20% 线性
    drivers["roe_score"] = roe_score

    fcf_g = metrics.get("fcf_5y_cagr")
    fcf_score = _linear(fcf_g, 0.0, 0.15)  # 0-15% CAGR
    drivers["fcf_5y_cagr_score"] = fcf_score

    dte = metrics.get("debt_to_equity")  # yfinance 百分比格式 79.5
    debt_score = _linear(dte, 50, 200, reverse=True)  # 50→满分 / 200→0
    drivers["debt_to_equity_score"] = debt_score

    parts = [(roe_score, 0.40), (fcf_score, 0.30), (debt_score, 0.30)]
    valid = [(s, w) for s, w in parts if s is not None]
    if not valid:
        return None, drivers
    total_w = sum(w for _, w in valid)
    score = sum(s * w for s, w in valid) / total_w
    return score, drivers


def score_mgmt(metrics: dict) -> tuple[float | None, dict]:
    """
    管理层资本配置。分红连续 + 5 年股本变化（负=回购）。
    """
    drivers: dict[str, Any] = {}

    streak = metrics.get("dividend_streak_years")
    if streak is not None:
        div_score = _linear(float(streak), 0, 10)  # 10 年以上 = 100
        drivers["dividend_streak_score"] = div_score
    else:
        div_score = None

    shares_chg = metrics.get("shares_change_5y_pct")  # 负=回购，期望 <= -0.10
    if shares_chg is not None:
        # -10% 或更低 → 100；0 → 0；正值（增发） → 0
        bb_score = _linear(shares_chg, -0.10, 0.0, reverse=True)
        if shares_chg > 0:
            bb_score = 0.0
        drivers["buyback_score"] = bb_score
    else:
        bb_score = None

    parts = [s for s in (div_score, bb_score) if s is not None]
    if not parts:
        return None, drivers
    return sum(parts) / len(parts), drivers


def score_valuation(metrics: dict, *, discount: float = 0.10) -> tuple[float | None, dict]:
    """
    DCF 估值评分。市值 / 内在价值 比例：
      <= 0.7  → 100 分（深度低估）
      == 1.0  → 50 分（合理）
      >= 1.3  → 0 分（高估）
    """
    drivers: dict[str, Any] = {}

    fcf = metrics.get("fcf_ttm")
    g = metrics.get("fcf_5y_cagr")
    mc = metrics.get("market_cap")

    intrinsic = dcf_value(fcf, g, discount=discount)
    drivers["intrinsic_value"] = intrinsic
    drivers["market_cap"] = mc
    drivers["fcf_ttm"] = fcf
    drivers["fcf_5y_cagr"] = g

    if intrinsic is None or mc is None or mc <= 0:
        return None, drivers

    ratio = mc / intrinsic
    drivers["mkt_to_intrinsic"] = ratio
    score = _linear(ratio, 0.7, 1.3, reverse=True)
    return score, drivers


def score_compound(metrics: dict) -> tuple[float | None, dict]:
    """
    复利能力。5 年净利润 CAGR 主，5 年营收 CAGR 辅。
    """
    drivers: dict[str, Any] = {}

    profit_g = metrics.get("profit_5y_cagr")
    profit_score = _linear(profit_g, 0.05, 0.15)  # 5%-15% CAGR
    drivers["profit_5y_cagr_score"] = profit_score

    revenue_g = metrics.get("revenue_5y_cagr")
    rev_score = _linear(revenue_g, 0.0, 0.15)
    drivers["revenue_5y_cagr_score"] = rev_score

    parts = [(profit_score, 0.7), (rev_score, 0.3)]
    valid = [(s, w) for s, w in parts if s is not None]
    if not valid:
        return None, drivers
    total_w = sum(w for _, w in valid)
    return sum(s * w for s, w in valid) / total_w, drivers


# ── 总分 ────────────────────────────────────────────────
def compute_value_score(
    metrics: dict,
    peer_metrics: list[dict] | None = None,
    weights: dict[str, int | float] | None = None,
    moat_llm_score: float | None = None,
) -> dict:
    """
    给定原始指标 + 行业 peers 计算 5 维加权总分。

    参数:
      metrics: fetcher.fetch_value_metrics 输出
      peer_metrics: 同行 fetch 列表（用于 industry_pctile，可空）
      weights: 5 维权重 dict (key: moat/financial/mgmt/valuation/compound)，
               缺省用 user_default
      moat_llm_score: V3 LLM 评估的护城河分（0-100）。提供时与量化 moat 50/50 加权。

    返回:
      {
        value_score: 0-100 或 None（数据不足）,
        sub_scores: {moat, financial, mgmt, valuation, compound},  # 每个 0-100 或 None
        drivers: {<sub>: {...}},                                    # 每子维度详细指标
        weights_used: {...},                                        # 实际归一化权重
        coverage: 'full'/'partial'/'minimal',                       # 数据覆盖度
      }
    """
    weights = weights or DEFAULT_WEIGHTS

    moat_quant, moat_drv = score_moat(metrics, peer_metrics)
    fin, fin_drv = score_financial(metrics)
    mgmt, mgmt_drv = score_mgmt(metrics)
    val, val_drv = score_valuation(metrics)
    comp, comp_drv = score_compound(metrics)

    # moat 与 LLM 合并：
    if moat_llm_score is not None and moat_quant is not None:
        moat = moat_quant * 0.5 + moat_llm_score * 0.5
        moat_drv["llm_score"] = moat_llm_score
        moat_drv["quant_score"] = moat_quant
    elif moat_llm_score is not None:
        moat = moat_llm_score
        moat_drv["llm_score"] = moat_llm_score
    else:
        moat = moat_quant

    sub_scores = {
        "moat":       moat,
        "financial":  fin,
        "mgmt":       mgmt,
        "valuation":  val,
        "compound":   comp,
    }

    # 加权汇总（缺失维度按比例剔除）
    valid_pairs = [(s, weights.get(k, 0)) for k, s in sub_scores.items() if s is not None]
    total_w = sum(w for _, w in valid_pairs)
    if total_w <= 0:
        value_score = None
    else:
        value_score = round(sum(s * w for s, w in valid_pairs) / total_w, 1)

    n_present = sum(1 for s in sub_scores.values() if s is not None)
    if n_present >= 4:
        coverage = "full"
    elif n_present >= 2:
        coverage = "partial"
    else:
        coverage = "minimal"

    return {
        "value_score": value_score,
        "sub_scores": sub_scores,
        "drivers": {
            "moat": moat_drv,
            "financial": fin_drv,
            "mgmt": mgmt_drv,
            "valuation": val_drv,
            "compound": comp_drv,
        },
        "weights_used": dict(weights),
        "coverage": coverage,
    }
