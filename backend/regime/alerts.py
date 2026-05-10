"""
顶底双重确认告警引擎（L5 计划落地）
=====================================
基于 compute_composite() 的当前快照（4 子分 + 因子级 percentile）
评估 ~6 条经典市场结构信号，输出活跃告警列表。

核心思想：单维度信号假信号率高，必须叠加 2+ 独立维度同向才可信。
"""
from __future__ import annotations

from typing import Any


# ── 工具：从 composite 结构里抓信息 ────────────────────────
def _flatten_factors(composite: dict) -> dict[str, dict]:
    """{factor_id: {name, percentile, directional_score, raw, category}}"""
    out: dict[str, dict] = {}
    for cat, info in (composite.get("by_category") or {}).items():
        for f in info.get("factors", []):
            out[f["factor_id"]] = {**f, "category": cat}
    return out


def _evidence(factors: list[dict]) -> list[dict]:
    return [
        {
            "factor_id": f["factor_id"],
            "name": f.get("name"),
            "raw_value": f.get("raw_value"),
            "percentile": f.get("percentile"),
        }
        for f in factors
    ]


# ── 规则评估 ─────────────────────────────────────────────
def compute_alerts(composite: dict) -> list[dict]:
    """
    输入：compute_composite() 的返回。
    输出：活跃告警列表。每条 {id, kind, level, title, summary, evidence, action}。
    """
    sub = {k: v.get("score") for k, v in (composite.get("by_category") or {}).items()}
    temp = composite.get("market_temperature")
    factors = _flatten_factors(composite)

    val_score = sub.get("valuation")
    liq_score = sub.get("liquidity")
    sent_score = sub.get("sentiment")
    breadth_score = sub.get("breadth")

    alerts: list[dict] = []

    # ── 顶部规则 ──
    # 1. 估值历史性极端（估值子分 ≤ 15 且至少 2 个估值因子 percentile ≥ 90）
    if val_score is not None and val_score <= 20:
        ex = [f for f in factors.values()
              if f["category"] == "valuation" and (f.get("percentile") or 0) >= 90]
        if len(ex) >= 2:
            alerts.append({
                "id": "top_valuation_extreme",
                "kind": "top",
                "level": "critical",
                "title": "顶部预警 · 估值历史性极端",
                "summary": f"估值子分 {val_score:.1f}/100，{len(ex)} 个核心估值指标 ≥ 90 分位",
                "evidence": _evidence(ex),
                "action": "强烈考虑减仓 / 止盈",
            })

    # 2. 信用极度乐观（HY OAS 或 Baa 利差 percentile ≤ 20，叠加估值子分 ≤ 30）
    hy = factors.get("US_CREDIT_SPREAD_HY") or {}
    baa = factors.get("US_CREDIT_SPREAD_BAA") or {}
    credit_extreme = []
    if (hy.get("percentile") or 100) <= 20:
        credit_extreme.append(hy)
    if (baa.get("percentile") or 100) <= 20:
        credit_extreme.append(baa)
    if credit_extreme and val_score is not None and val_score <= 30:
        alerts.append({
            "id": "top_credit_complacency",
            "kind": "top",
            "level": "warning",
            "title": "顶部预警 · 信用极度乐观 + 估值贵",
            "summary": "信用利差极低（投资者复杂感），同时估值偏贵——经典晚期周期组合",
            "evidence": _evidence(credit_extreme + [
                f for f in factors.values()
                if f["category"] == "valuation" and (f.get("percentile") or 0) >= 80
            ][:3]),
            "action": "降低风险敞口 / 缩短久期",
        })

    # 3. 温度偏牛 + 宽度走弱（顶背离）
    if temp is not None and temp >= 55 and breadth_score is not None and breadth_score <= 40:
        weak_breadth = [f for f in factors.values()
                        if f["category"] == "breadth" and (f.get("directional_score") or 100) <= 40]
        alerts.append({
            "id": "top_breadth_divergence",
            "kind": "top",
            "level": "warning",
            "title": "顶部预警 · 指数走高但宽度走弱（顶背离）",
            "summary": f"温度 {temp:.0f}/100 显示偏牛，但宽度子分仅 {breadth_score:.0f}——少数大票拖动指数",
            "evidence": _evidence(weak_breadth),
            "action": "警惕趋势反转，关注小盘 / 中位数股票",
        })

    # ── 底部规则 ──
    # 4. 信用大幅恶化 + 温度极低（panic 反向买点）
    if (hy.get("percentile") or 0) >= 90 or (baa.get("percentile") or 0) >= 90:
        ex = [f for f in [hy, baa] if (f.get("percentile") or 0) >= 90]
        if temp is not None and temp <= 35:
            alerts.append({
                "id": "bottom_credit_panic",
                "kind": "bottom",
                "level": "critical",
                "title": "底部反向 · 信用 panic + 温度极低",
                "summary": "信用利差冲到历史高分位、综合温度极低——经典反向买点组合",
                "evidence": _evidence(ex),
                "action": "考虑加仓 / 增加风险敞口",
            })

    # 5. VIX 恐慌（contrarian 极端区）
    vix = factors.get("US_VIX") or {}
    if (vix.get("percentile") or 0) >= 90:
        alerts.append({
            "id": "bottom_vix_panic",
            "kind": "bottom",
            "level": "warning",
            "title": "底部反向 · VIX 恐慌区",
            "summary": f"VIX 处于历史 {vix.get('percentile'):.0f}% 分位，极端恐慌区往往是中期底部信号",
            "evidence": _evidence([vix]),
            "action": "等待信用利差见顶回落确认 → 加仓",
        })

    # ── 中性 / 现状描述（始终活跃，level=info）──
    # 注：temp 为 None 时不进入此分支，避免 f-string 格式化 None 崩溃
    if temp is not None and 35 < temp < 65 and not any(
        a["kind"] in ("top", "bottom") and a["level"] == "critical"
        for a in alerts
    ):
        alerts.append({
            "id": "info_neutral_zone",
            "kind": "neutral",
            "level": "info",
            "title": "中性区间 · 等待方向确认",
            "summary": f"温度 {temp:.0f}/100，无极端信号；分子分项分歧时优先看温度趋势",
            "evidence": [],
            "action": "持仓不动 / 网格 / 中性对冲",
        })

    return alerts
