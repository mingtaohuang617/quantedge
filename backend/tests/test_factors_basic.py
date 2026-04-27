"""factors 模块基础测试 — 纯函数，零网络依赖。"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from factors import (  # noqa: E402
    calc_etf_score,
    calc_leverage_decay,
    calc_momentum,
    calc_rsi,
    calc_stock_score,
    parse_leverage,
)


# ── parse_leverage ──────────────────────────────────────
def test_parse_leverage_string_forms():
    assert parse_leverage("2x") == 2.0
    assert parse_leverage("-2x") == -2.0
    assert parse_leverage("3X") == 3.0


def test_parse_leverage_no_leverage():
    assert parse_leverage(None) is None
    assert parse_leverage("") is None
    assert parse_leverage("None") is None
    assert parse_leverage("1x") is None  # 1x 视作非杠杆
    assert parse_leverage("-1x") is None  # |L|=1 也视作非杠杆


def test_parse_leverage_numeric():
    assert parse_leverage(2) == 2.0
    assert parse_leverage(2.5) == 2.5


# ── calc_rsi ─────────────────────────────────────────────
def test_rsi_insufficient_data_returns_neutral():
    prices = pd.Series([100, 101, 102])
    assert calc_rsi(prices, period=14) == 50.0


def test_rsi_mostly_up_high():
    # 大多数上涨日，少量回撤 → RSI 应高
    prices = pd.Series([100, 102, 104, 103, 106, 108, 110, 109, 113,
                        115, 117, 120, 119, 122, 125, 128, 130, 129, 132, 135, 138])
    rsi = calc_rsi(prices, period=14)
    assert rsi >= 70


def test_rsi_mostly_down_low():
    prices = pd.Series([100, 98, 95, 96, 92, 90, 88, 89, 85,
                        82, 80, 78, 79, 75, 72, 70, 68, 70, 65, 62, 60])
    rsi = calc_rsi(prices, period=14)
    assert rsi <= 30


# ── calc_momentum ────────────────────────────────────────
def test_momentum_clipped():
    # 极端涨幅 → 100
    prices = pd.Series([10] * 21 + [100])
    assert calc_momentum(prices, period=20) == 100.0


def test_momentum_neutral_short_data():
    prices = pd.Series([100] * 5)
    assert calc_momentum(prices, period=20) == 50.0


# ── calc_stock_score ─────────────────────────────────────
def test_stock_score_all_excellent():
    score = calc_stock_score(
        pe=12, roe=35, revenue_growth=60, profit_margin=35,
        momentum=80, rsi=55,
    )
    assert score >= 80


def test_stock_score_all_missing_returns_baseline():
    score = calc_stock_score(
        pe=None, roe=None, revenue_growth=None, profit_margin=None,
        momentum=50, rsi=50,
    )
    assert 0 <= score <= 100


def test_stock_score_detailed_returns_breakdown():
    score, parts = calc_stock_score(
        pe=20, roe=15, revenue_growth=15, profit_margin=10,
        momentum=60, rsi=55, detailed=True,
    )
    assert set(parts.keys()) == {"fundamental", "technical", "growth"}


# ── calc_etf_score ───────────────────────────────────────
def test_etf_leverage_penalty_applied():
    no_lev = calc_etf_score(
        expense_ratio=0.5, premium_discount=0.2, aum_usd=5e8,
        momentum=70, concentration_top3=40, leverage=None,
    )
    with_lev = calc_etf_score(
        expense_ratio=0.5, premium_discount=0.2, aum_usd=5e8,
        momentum=70, concentration_top3=40, leverage="2x",
    )
    assert no_lev - with_lev == 15  # 杠杆扣 15 分


# ── calc_leverage_decay ──────────────────────────────────
def test_leverage_decay_no_leverage_returns_none():
    prices = pd.Series(np.linspace(100, 110, 60))
    assert calc_leverage_decay(prices, None) is None


def test_leverage_decay_short_series_returns_none():
    prices = pd.Series([100, 101, 102])
    assert calc_leverage_decay(prices, "2x") is None


def test_leverage_decay_positive_for_volatile_2x():
    rng = np.random.default_rng(42)
    rets = rng.normal(0, 0.02, 200)
    prices = pd.Series(100 * np.exp(np.cumsum(rets)))
    drag = calc_leverage_decay(prices, "2x")
    assert drag is not None and drag > 0
