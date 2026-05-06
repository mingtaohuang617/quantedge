"""
value.fetcher / industry_peers 单测
====================================
fetcher 大量逻辑依赖 yfinance 网络调用，单测以 mock 为主，
仅留 1-2 个 integration 测试可手动跑（marked slow）。
"""
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from value.fetcher import (  # noqa: E402
    _yf_symbol,
    _safe_float,
    _cagr,
    _series_from_financials,
    _dividend_streak,
    _dividend_5y_growth,
)
from value.industry_peers import industry_pctile  # noqa: E402


# ── _yf_symbol ──────────────────────────────────────────
class TestYfSymbol:
    def test_us_stock_unchanged(self):
        assert _yf_symbol("AAPL") == "AAPL"
        assert _yf_symbol("nvda") == "NVDA"

    def test_hk_5digit_strips_leading_zero(self):
        assert _yf_symbol("00700.HK") == "0700.HK"

    def test_hk_4digit_unchanged(self):
        assert _yf_symbol("0700.HK") == "0700.HK"

    def test_hk_short_pads_to_4(self):
        # 0005.HK 是汇丰控股
        assert _yf_symbol("0005.HK") == "0005.HK"
        assert _yf_symbol("00005.HK") == "0005.HK"

    def test_a_share_unchanged(self):
        assert _yf_symbol("600519.SS") == "600519.SS"
        assert _yf_symbol("000001.SZ") == "000001.SZ"


# ── _safe_float ─────────────────────────────────────────
class TestSafeFloat:
    def test_normal(self):
        assert _safe_float(3.14) == 3.14
        assert _safe_float("2.5") == 2.5
        assert _safe_float(0) == 0.0

    def test_none_returns_none(self):
        assert _safe_float(None) is None

    def test_nan_returns_none(self):
        assert _safe_float(float("nan")) is None

    def test_inf_returns_none(self):
        assert _safe_float(float("inf")) is None
        assert _safe_float(float("-inf")) is None

    def test_invalid_string(self):
        assert _safe_float("abc") is None


# ── _cagr ───────────────────────────────────────────────
class TestCagr:
    def test_normal_growth(self):
        # 100 → 161 in 5 years ≈ 10% CAGR
        assert abs(_cagr(100, 161.05, 5) - 0.10) < 0.001

    def test_zero_first_returns_none(self):
        assert _cagr(0, 100, 5) is None

    def test_negative_first_returns_none(self):
        assert _cagr(-100, 200, 5) is None

    def test_none_returns_none(self):
        assert _cagr(None, 100, 5) is None
        assert _cagr(100, None, 5) is None

    def test_zero_years(self):
        assert _cagr(100, 200, 0) is None


# ── _series_from_financials ─────────────────────────────
class TestSeriesFromFinancials:
    def test_finds_first_match(self):
        df = pd.DataFrame(
            {
                pd.Timestamp("2024-12-31"): {"Net Income": 100, "Revenue": 1000},
                pd.Timestamp("2023-12-31"): {"Net Income": 80, "Revenue": 900},
            }
        )
        s = _series_from_financials(df, "Net Income", "Net Income Common Stockholders")
        assert s is not None
        # 排序后最新在前
        assert s.iloc[0] == 100

    def test_falls_through_to_alt(self):
        df = pd.DataFrame(
            {
                pd.Timestamp("2024-12-31"): {"Net Income Common Stockholders": 50},
            }
        )
        s = _series_from_financials(df, "Net Income", "Net Income Common Stockholders")
        assert s is not None
        assert s.iloc[0] == 50

    def test_empty_df_returns_none(self):
        assert _series_from_financials(pd.DataFrame(), "Net Income") is None

    def test_no_match_returns_none(self):
        df = pd.DataFrame(
            {pd.Timestamp("2024-12-31"): {"Other Field": 100}}
        )
        assert _series_from_financials(df, "Net Income") is None


# ── _dividend_streak ────────────────────────────────────
class TestDividendStreak:
    def test_continuous_streak(self):
        idx = pd.to_datetime(["2020-05-01", "2021-05-01", "2022-05-01", "2023-05-01", "2024-05-01"])
        divs = pd.Series([1.0, 1.1, 1.2, 1.3, 1.5], index=idx)
        assert _dividend_streak(divs, ref_year=2024) == 5

    def test_broken_streak(self):
        # 2022 没分红 → streak 从 2024 数到 2023 = 2
        idx = pd.to_datetime(["2020-05-01", "2021-05-01", "2023-05-01", "2024-05-01"])
        divs = pd.Series([1.0, 1.1, 1.3, 1.5], index=idx)
        assert _dividend_streak(divs, ref_year=2024) == 2

    def test_empty_returns_zero(self):
        assert _dividend_streak(pd.Series(dtype=float)) == 0
        assert _dividend_streak(None) == 0


# ── _dividend_5y_growth ─────────────────────────────────
class TestDividend5yGrowth:
    def test_growth(self):
        idx = pd.to_datetime(["2020-05-01", "2021-05-01", "2022-05-01", "2023-05-01", "2024-05-01"])
        # 1.0 → 1.5 in 4 years ≈ 10.67% CAGR
        divs = pd.Series([1.0, 1.1, 1.2, 1.3, 1.5], index=idx)
        g = _dividend_5y_growth(divs)
        assert g is not None
        assert 0.10 < g < 0.11

    def test_single_year_returns_none(self):
        divs = pd.Series([1.0], index=pd.to_datetime(["2024-05-01"]))
        assert _dividend_5y_growth(divs) is None


# ── industry_pctile ─────────────────────────────────────
class TestIndustryPctile:
    def test_higher_better(self):
        # ROE 0.30 在 [0.10, 0.15, 0.20, 0.25, 0.40] 中第 4 高 → ~80%
        pct = industry_pctile(0.30, [0.10, 0.15, 0.20, 0.25, 0.40], higher_is_better=True)
        assert 70 <= pct <= 95

    def test_lower_better(self):
        # PE 20 在 [25, 30, 35, 40, 50, 60] 都比它大 → 100% (lower better, all higher)
        pct = industry_pctile(20, [25, 30, 35, 40, 50, 60], higher_is_better=False)
        assert pct >= 90

    def test_too_few_peers(self):
        assert industry_pctile(10, [5], higher_is_better=True) is None
        assert industry_pctile(10, [], higher_is_better=True) is None

    def test_value_none(self):
        assert industry_pctile(None, [1, 2, 3, 4, 5]) is None


# ── integration test (slow, 网络) ────────────────────────
@pytest.mark.skip(reason="网络依赖，手动开启")
def test_fetch_aapl_integration():
    from value.fetcher import fetch_value_metrics
    m = fetch_value_metrics("AAPL")
    assert m["data_quality"] == "good"
    assert m["industry"] == "Consumer Electronics"
    assert m["market_cap"] > 1e12
