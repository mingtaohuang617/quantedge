"""
value.score 单测 — 5 维评分 + DCF + 加权总分
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from value.score import (  # noqa: E402
    _linear,
    dcf_value,
    score_moat,
    score_financial,
    score_mgmt,
    score_valuation,
    score_compound,
    compute_value_score,
    WEIGHT_PRESETS,
)


# ── _linear ─────────────────────────────────────────────
class TestLinear:
    def test_normal(self):
        assert _linear(7.5, 5, 10) == 50.0
        assert _linear(5, 5, 10) == 0.0
        assert _linear(10, 5, 10) == 100.0

    def test_clip_low(self):
        assert _linear(2, 5, 10) == 0.0

    def test_clip_high(self):
        assert _linear(15, 5, 10) == 100.0

    def test_reverse(self):
        # PE 越低分越高：10 → 100, 30 → 0
        assert _linear(10, 10, 30, reverse=True) == 100.0
        assert _linear(30, 10, 30, reverse=True) == 0.0
        assert _linear(20, 10, 30, reverse=True) == 50.0

    def test_none(self):
        assert _linear(None, 0, 10) is None


# ── dcf_value ───────────────────────────────────────────
class TestDcf:
    def test_basic(self):
        # FCF 100B, 10% growth, 10% discount → 内在价值 ≈ FCF * (5 explicit + terminal value)
        v = dcf_value(100e9, 0.10, discount=0.10, years=5, terminal_growth=0.025)
        assert v is not None
        # 大致 1.5T - 2.5T
        assert 1e12 < v < 3e12

    def test_negative_fcf_returns_none(self):
        assert dcf_value(-100e9, 0.10) is None

    def test_zero_fcf_returns_none(self):
        assert dcf_value(0, 0.10) is None

    def test_g_clamp_high(self):
        # g=80% 应被截到 g_cap=15%，不应算出天价
        v_capped = dcf_value(100e9, 0.80, g_cap=0.15)
        v_natural = dcf_value(100e9, 0.15, g_cap=0.15)
        assert v_capped == v_natural

    def test_g_clamp_low(self):
        v_floored = dcf_value(100e9, -0.50, g_floor=-0.05)
        v_natural = dcf_value(100e9, -0.05, g_floor=-0.05)
        assert v_floored == v_natural

    def test_g_none_uses_zero(self):
        v_none = dcf_value(100e9, None)
        v_zero = dcf_value(100e9, 0.0)
        assert v_none == v_zero

    def test_discount_below_terminal_returns_none(self):
        assert dcf_value(100e9, 0.05, discount=0.02, terminal_growth=0.025) is None


# ── score_moat ──────────────────────────────────────────
class TestMoat:
    def test_with_peers_high_pctile(self):
        m = {"gross_margin": 0.50, "profit_margin": 0.20}
        peers = [
            {"gross_margin": 0.20, "profit_margin": 0.05},
            {"gross_margin": 0.30, "profit_margin": 0.10},
            {"gross_margin": 0.35, "profit_margin": 0.12},
            {"gross_margin": 0.40, "profit_margin": 0.15},
        ]
        s, drv = score_moat(m, peers)
        # AAPL-like 数据应该很高分
        assert s is not None
        assert s > 70

    def test_no_peers_falls_back_to_abs(self):
        m = {"gross_margin": 0.60, "profit_margin": 0.25}
        s, drv = score_moat(m, peer_metrics=None)
        assert s is not None
        assert s > 80

    def test_missing_metrics_returns_none(self):
        s, _ = score_moat({}, peer_metrics=None)
        assert s is None


# ── score_financial ─────────────────────────────────────
class TestFinancial:
    def test_strong_company(self):
        m = {
            "roe_ttm": 0.25,
            "fcf_5y_cagr": 0.12,
            "debt_to_equity": 30,
        }
        s, drv = score_financial(m)
        assert s is not None
        assert s > 80

    def test_weak_company(self):
        m = {
            "roe_ttm": 0.03,
            "fcf_5y_cagr": -0.05,
            "debt_to_equity": 250,
        }
        s, _ = score_financial(m)
        assert s is not None
        assert s < 20

    def test_partial(self):
        m = {"roe_ttm": 0.20}
        s, _ = score_financial(m)
        assert s is not None  # 仅 ROE 也能算


# ── score_mgmt ──────────────────────────────────────────
class TestMgmt:
    def test_buyback_dividend_strong(self):
        m = {"dividend_streak_years": 12, "shares_change_5y_pct": -0.15}
        s, _ = score_mgmt(m)
        assert s is not None
        assert s == 100.0

    def test_no_dividend_dilutive(self):
        m = {"dividend_streak_years": 0, "shares_change_5y_pct": 0.20}
        s, _ = score_mgmt(m)
        assert s is not None
        assert s == 0.0

    def test_only_dividend(self):
        m = {"dividend_streak_years": 5}
        s, _ = score_mgmt(m)
        assert s == 50.0  # 5/10 = 50


# ── score_valuation ─────────────────────────────────────
class TestValuation:
    def test_undervalued(self):
        # market_cap 50B / intrinsic ~150B → 深度低估
        m = {"fcf_ttm": 10e9, "fcf_5y_cagr": 0.05, "market_cap": 50e9}
        s, drv = score_valuation(m)
        assert s is not None
        assert s > 80
        assert drv["intrinsic_value"] is not None
        assert drv["mkt_to_intrinsic"] < 0.7

    def test_overvalued(self):
        m = {"fcf_ttm": 10e9, "fcf_5y_cagr": 0.05, "market_cap": 500e9}
        s, _ = score_valuation(m)
        assert s == 0.0

    def test_negative_fcf_returns_none(self):
        m = {"fcf_ttm": -1e9, "fcf_5y_cagr": 0.05, "market_cap": 50e9}
        s, _ = score_valuation(m)
        assert s is None


# ── score_compound ──────────────────────────────────────
class TestCompound:
    def test_strong_growth(self):
        m = {"profit_5y_cagr": 0.20, "revenue_5y_cagr": 0.18}
        s, _ = score_compound(m)
        assert s == 100.0

    def test_weak_growth(self):
        m = {"profit_5y_cagr": 0.02, "revenue_5y_cagr": -0.05}
        s, _ = score_compound(m)
        assert s == 0.0


# ── compute_value_score (integration) ───────────────────
class TestComputeValueScore:
    def test_full_data(self):
        m = {
            "gross_margin": 0.55,
            "profit_margin": 0.25,
            "roe_ttm": 0.30,
            "fcf_5y_cagr": 0.10,
            "debt_to_equity": 50,
            "fcf_ttm": 100e9,
            "market_cap": 1e12,
            "dividend_streak_years": 10,
            "shares_change_5y_pct": -0.10,
            "profit_5y_cagr": 0.12,
            "revenue_5y_cagr": 0.08,
        }
        result = compute_value_score(m)
        assert result["value_score"] is not None
        assert 50 < result["value_score"] < 100
        assert result["coverage"] == "full"
        for k in ("moat", "financial", "mgmt", "valuation", "compound"):
            assert k in result["sub_scores"]
            assert k in result["drivers"]

    def test_minimal_data(self):
        result = compute_value_score({"roe_ttm": 0.15})
        # 只有 financial 维度有分
        assert result["coverage"] in ("minimal", "partial")
        assert result["sub_scores"]["financial"] is not None
        assert result["sub_scores"]["moat"] is None

    def test_weights_buffett_emphasizes_moat(self):
        m = {
            "gross_margin": 0.60, "profit_margin": 0.30,  # 高 moat
            "roe_ttm": 0.05, "fcf_5y_cagr": -0.05, "debt_to_equity": 200,  # 低 financial
            "dividend_streak_years": 0, "shares_change_5y_pct": 0.10,      # 低 mgmt
            "fcf_ttm": 1e9, "fcf_5y_cagr": -0.05, "market_cap": 100e9,     # 估值差
            "profit_5y_cagr": 0.0,
        }
        r_buffett = compute_value_score(m, weights=WEIGHT_PRESETS["buffett"])
        r_balanced = compute_value_score(m, weights=WEIGHT_PRESETS["balanced"])
        # buffett 偏重 moat（40%）→ 总分应高于 balanced（20%）
        assert r_buffett["value_score"] > r_balanced["value_score"]

    def test_moat_llm_merge(self):
        m = {"gross_margin": 0.30, "profit_margin": 0.10}
        r_no_llm = compute_value_score(m, peer_metrics=None)
        r_with_llm = compute_value_score(m, peer_metrics=None, moat_llm_score=90.0)
        # LLM 给 90 分应拉高总分
        assert r_with_llm["sub_scores"]["moat"] > r_no_llm["sub_scores"]["moat"]
