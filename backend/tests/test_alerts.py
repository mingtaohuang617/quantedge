"""regime/alerts.py 单测 — L5 双重确认告警引擎.

每条规则的触发 / 不触发 / 级别都需要被锁定，否则后续调整阈值时容易引入静默 regression.
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from regime.alerts import compute_alerts  # noqa: E402


def _composite(
    *,
    temp: float | None = 50.0,
    val_score: float | None = 50.0,
    liq_score: float | None = 50.0,
    sent_score: float | None = 50.0,
    breadth_score: float | None = 50.0,
    val_factors: list[dict] | None = None,
    breadth_factors: list[dict] | None = None,
    hy_pct: float | None = None,
    baa_pct: float | None = None,
    vix_pct: float | None = None,
):
    """构造一个最小可用的 composite dict 用于 alerts 测试。"""
    by_cat = {
        "valuation": {"score": val_score, "factors": val_factors or []},
        "liquidity": {"score": liq_score, "factors": []},
        "sentiment": {"score": sent_score, "factors": []},
        "breadth": {"score": breadth_score, "factors": breadth_factors or []},
    }
    # 把信用 / VIX 因子注入到对应 category（alerts.py 通过 factor_id 全局查找）
    if hy_pct is not None:
        by_cat["sentiment"]["factors"].append({
            "factor_id": "US_CREDIT_SPREAD_HY", "name": "HY OAS",
            "raw_value": 4.0, "percentile": hy_pct, "directional_score": 50,
        })
    if baa_pct is not None:
        by_cat["sentiment"]["factors"].append({
            "factor_id": "US_CREDIT_SPREAD_BAA", "name": "Baa Spread",
            "raw_value": 1.5, "percentile": baa_pct, "directional_score": 50,
        })
    if vix_pct is not None:
        by_cat["sentiment"]["factors"].append({
            "factor_id": "US_VIX", "name": "VIX",
            "raw_value": 25, "percentile": vix_pct, "directional_score": 50,
        })
    return {"market_temperature": temp, "by_category": by_cat}


def _val_factor(fid: str, pct: float) -> dict:
    return {"factor_id": fid, "name": fid, "raw_value": 1.0,
            "percentile": pct, "directional_score": 50 - (pct - 50)}


def _breadth_factor(fid: str, ds: float) -> dict:
    return {"factor_id": fid, "name": fid, "raw_value": 1.0,
            "percentile": 50, "directional_score": ds}


# ── 规则 1: 估值历史性极端 ───────────────────────────────
def test_alert_valuation_extreme_triggers():
    """估值子分 ≤ 20 + 2+ 估值因子 ≥ 90 percentile → critical top."""
    c = _composite(
        val_score=10,
        val_factors=[_val_factor("US_SPX_PE", 95), _val_factor("US_CAPE", 99)],
    )
    alerts = compute_alerts(c)
    ids = [a["id"] for a in alerts]
    assert "top_valuation_extreme" in ids
    a = next(a for a in alerts if a["id"] == "top_valuation_extreme")
    assert a["level"] == "critical"
    assert a["kind"] == "top"
    assert len(a["evidence"]) >= 2


def test_alert_valuation_extreme_score_too_high():
    """估值子分 > 20 → 不触发."""
    c = _composite(
        val_score=25,
        val_factors=[_val_factor("US_SPX_PE", 95), _val_factor("US_CAPE", 99)],
    )
    alerts = compute_alerts(c)
    assert "top_valuation_extreme" not in [a["id"] for a in alerts]


def test_alert_valuation_extreme_only_one_extreme_factor():
    """少于 2 个 ≥90 percentile 的估值因子 → 不触发."""
    c = _composite(
        val_score=10,
        val_factors=[_val_factor("US_SPX_PE", 95), _val_factor("US_CAPE", 80)],
    )
    alerts = compute_alerts(c)
    assert "top_valuation_extreme" not in [a["id"] for a in alerts]


# ── 规则 2: 信用极度乐观 + 估值贵 ─────────────────────────
def test_alert_credit_complacency_triggers():
    """HY pct ≤ 20 + val_score ≤ 30 → warning top."""
    c = _composite(val_score=25, hy_pct=15)
    alerts = compute_alerts(c)
    ids = [a["id"] for a in alerts]
    assert "top_credit_complacency" in ids
    a = next(a for a in alerts if a["id"] == "top_credit_complacency")
    assert a["level"] == "warning"


def test_alert_credit_complacency_no_credit_extreme():
    """信用利差 percentile 在 50 → 不触发."""
    c = _composite(val_score=25, hy_pct=50)
    alerts = compute_alerts(c)
    assert "top_credit_complacency" not in [a["id"] for a in alerts]


def test_alert_credit_complacency_val_too_cheap():
    """估值子分 > 30 → 不触发即使 HY pct ≤ 20."""
    c = _composite(val_score=40, hy_pct=10)
    alerts = compute_alerts(c)
    assert "top_credit_complacency" not in [a["id"] for a in alerts]


# ── 规则 3: 温度高 + 宽度低（顶背离）─────────────────────
def test_alert_breadth_divergence_triggers():
    """温度 ≥ 55 + breadth_score ≤ 40 → warning top."""
    c = _composite(
        temp=70, breadth_score=35,
        breadth_factors=[_breadth_factor("US_BREADTH_200MA", 25)],
    )
    alerts = compute_alerts(c)
    ids = [a["id"] for a in alerts]
    assert "top_breadth_divergence" in ids


def test_alert_breadth_divergence_no_trigger_strong_breadth():
    """温度高但宽度也强 → 不触发."""
    c = _composite(temp=70, breadth_score=70)
    alerts = compute_alerts(c)
    assert "top_breadth_divergence" not in [a["id"] for a in alerts]


# ── 规则 4: 信用 panic + 温度极低 ─────────────────────────
def test_alert_credit_panic_bottom_triggers():
    """HY pct ≥ 90 + temp ≤ 35 → critical bottom."""
    c = _composite(temp=20, hy_pct=95)
    alerts = compute_alerts(c)
    ids = [a["id"] for a in alerts]
    assert "bottom_credit_panic" in ids
    a = next(a for a in alerts if a["id"] == "bottom_credit_panic")
    assert a["level"] == "critical"
    assert a["kind"] == "bottom"


def test_alert_credit_panic_temp_too_high():
    """温度 > 35 → 不触发."""
    c = _composite(temp=50, hy_pct=95)
    alerts = compute_alerts(c)
    assert "bottom_credit_panic" not in [a["id"] for a in alerts]


# ── 规则 5: VIX 恐慌 ──────────────────────────────────────
def test_alert_vix_panic_triggers():
    """VIX percentile ≥ 90 → warning bottom."""
    c = _composite(temp=30, vix_pct=92)
    alerts = compute_alerts(c)
    ids = [a["id"] for a in alerts]
    assert "bottom_vix_panic" in ids


def test_alert_vix_panic_no_trigger_when_calm():
    """VIX percentile 50 → 不触发."""
    c = _composite(vix_pct=50)
    alerts = compute_alerts(c)
    assert "bottom_vix_panic" not in [a["id"] for a in alerts]


# ── 规则 6: 中性区间 info ─────────────────────────────────
def test_alert_neutral_zone_in_middle():
    """温度 35-65 且无 critical → info."""
    c = _composite(temp=50)
    alerts = compute_alerts(c)
    ids = [a["id"] for a in alerts]
    assert "info_neutral_zone" in ids
    a = next(a for a in alerts if a["id"] == "info_neutral_zone")
    assert a["level"] == "info"


def test_alert_neutral_zone_suppressed_by_critical():
    """有 critical alert → 不再发 neutral info."""
    c = _composite(
        temp=50,
        val_score=10,
        val_factors=[_val_factor("US_SPX_PE", 95), _val_factor("US_CAPE", 99)],
    )
    alerts = compute_alerts(c)
    ids = [a["id"] for a in alerts]
    # 估值 critical 触发
    assert "top_valuation_extreme" in ids
    # 但温度 50 在中性区间，按规则被 critical 抑制
    assert "info_neutral_zone" not in ids


def test_alert_neutral_zone_outside_band():
    """温度 70 — 超出中性带 → 不发 neutral."""
    c = _composite(temp=70)
    alerts = compute_alerts(c)
    assert "info_neutral_zone" not in [a["id"] for a in alerts]


# ── 综合 ──────────────────────────────────────────────────
def test_alert_empty_composite_returns_empty():
    """完全空 composite 不应崩."""
    alerts = compute_alerts({})
    assert isinstance(alerts, list)


def test_alert_evidence_format():
    """evidence 项应有 factor_id / name / raw_value / percentile 4 字段."""
    c = _composite(
        val_score=10,
        val_factors=[_val_factor("US_SPX_PE", 95), _val_factor("US_CAPE", 99)],
    )
    alerts = compute_alerts(c)
    a = next(a for a in alerts if a["id"] == "top_valuation_extreme")
    for e in a["evidence"]:
        assert set(e.keys()) >= {"factor_id", "name", "raw_value", "percentile"}
