"""scoring 引擎测试 —— 纯函数 + 合成宇宙端到端。零网络。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from scoring import (  # noqa: E402
    blended_momentum, trend_score, rsi_timing_score, _pct_in,
    etf_class, score_universe,
)


# ── blended_momentum ─────────────────────────────────────
def test_momentum_uptrend_positive():
    closes = [100 + i for i in range(150)]  # 稳步上涨
    assert blended_momentum(closes) > 0


def test_momentum_downtrend_negative():
    closes = [300 - i for i in range(150)]
    assert blended_momentum(closes) < 0


def test_momentum_short_history_none():
    assert blended_momentum([100, 101, 102]) is None


# ── trend_score ──────────────────────────────────────────
def test_trend_strong_uptrend_high():
    closes = [100 + i for i in range(250)]  # price>MA50>MA200 全多头
    assert trend_score(closes) >= 90


def test_trend_downtrend_low():
    closes = [350 - i for i in range(250)]
    assert trend_score(closes) <= 10


def test_trend_insufficient_neutral():
    assert trend_score([100, 101]) == 50.0


# ── rsi_timing_score ─────────────────────────────────────
def test_rsi_healthy_peak():
    assert rsi_timing_score(55) == 100.0


def test_rsi_extremes_penalized():
    assert rsi_timing_score(90) < 30   # 超买
    assert rsi_timing_score(15) < 20   # 超卖
    assert rsi_timing_score(None) == 50.0


# ── _pct_in 横截面分位 ───────────────────────────────────
def test_pct_in_basic():
    pool = [10, 20, 30, 40, 50]
    assert _pct_in(50, pool) == 90.0   # 最高 → 90 (中位秩)
    assert _pct_in(10, pool) == 10.0   # 最低 → 10
    assert _pct_in(30, pool) == 50.0   # 居中
    assert _pct_in(30, pool, higher_better=False) == 50.0
    assert _pct_in(50, pool, higher_better=False) == 10.0


def test_pct_in_none_and_tiny():
    assert _pct_in(None, [1, 2, 3]) == 50.0
    assert _pct_in(5, [5]) == 50.0      # 样本≤1 → 中性


# ── etf_class ────────────────────────────────────────────
def test_etf_class():
    assert etf_class({"leverage": "3x", "etfType": "3倍杠杆ETF"}) == "杠杆"
    assert etf_class({"leverage": "-2x"}) == "杠杆"        # 反向也算杠杆
    assert etf_class({"etfType": "国家ETF"}) == "国家"
    assert etf_class({"etfType": "行业ETF"}) == "行业"
    assert etf_class({"etfType": "主题ETF"}) == "行业"


# ── 合成端到端 ───────────────────────────────────────────
def _stock(t, mkt, gics, pe, roe, growth, margin, mc=1e9, rev=1e8, pb=2.0):
    return {"ticker": t, "market": mkt, "gicsSector": gics, "isETF": False,
            "pe": pe, "roe": roe, "revenueGrowth": growth, "profitMargin": margin,
            "marketCap": mc, "revenue": rev, "pb": pb}


def test_score_universe_quality_ranks_within_sector():
    # 同行业(US 信息技术)：A 又便宜又高质量又高成长；B 全面差。A 质量分应明显高于 B。
    up = [100 + i for i in range(250)]
    stocks = [
        _stock("A", "US", "信息技术", pe=10, roe=40, growth=60, margin=35),
        _stock("B", "US", "信息技术", pe=90, roe=3, growth=-5, margin=2),
    ] + [_stock(f"F{i}", "US", "信息技术", pe=25, roe=15, growth=10, margin=12) for i in range(8)]
    bars = {s["ticker"]: [{"close": c} for c in up] for s in stocks}
    score_universe(stocks, bars)
    a = next(s for s in stocks if s["ticker"] == "A")
    b = next(s for s in stocks if s["ticker"] == "B")
    assert a["qualityScore"] > b["qualityScore"] + 20
    assert 0 <= a["score"] <= 100
    assert set(a["subScores"]) >= {"valuation", "profitability", "growth", "momentum", "trend", "rsi"}
    assert "qualityScore" in a and "timingScore" in a


def test_leveraged_etf_quality_capped():
    up = [100 * (1.01 ** i) for i in range(250)]  # 强涨但波动
    etf = {"ticker": "TQQQ", "market": "US", "isETF": True, "etfType": "3倍杠杆ETF",
           "leverage": "3x", "expenseRatio": 0.5, "premiumDiscount": 0, "aum": "30B"}
    peers = [_stock(f"S{i}", "US", "信息技术", 25, 15, 10, 12) for i in range(8)]
    bars = {"TQQQ": [{"close": c} for c in up]}
    for s in peers:
        bars[s["ticker"]] = [{"close": c} for c in [100 + i for i in range(250)]]
    score_universe([etf] + peers, bars)
    assert etf["qualityScore"] <= 60.0  # 杠杆封顶
