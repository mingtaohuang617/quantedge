"""scoring 引擎测试 —— 纯函数 + 合成宇宙端到端。零网络。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from scoring import (  # noqa: E402
    blended_momentum, trend_score, rsi_timing_score, _pct_in,
    etf_class, score_universe, _sane,
)


# ── _sane 基本面健全性钳制 ───────────────────────────────
def test_sane_rejects_impossible():
    assert _sane(808.8, -200, 100) is None    # 净利率 >100% 物理不可能
    assert _sane(1453.31, 0, 100) is None      # PB 1453（ASML 坏数据）
    assert _sane(-93.6, -100, 2000) == -93.6   # 营收 -93.6% 合法保留
    assert _sane(212.9, -300, 500) == 212.9    # ROE 212%（AppLovin 真实）保留
    assert _sane(None, 0, 100) is None
    assert _sane("48.0", -200, 100) == 48.0     # 字符串数值正常转


def test_sane_bad_margin_not_polluting_quality():
    # 一只坏数据股(margin 808%)与正常同行相比，质量分不应被其虚高利润率拉爆
    up = [100 + i for i in range(250)]
    bad = {"ticker": "BAD", "market": "US", "gicsSector": "公用事业", "isETF": False,
           "pe": 15, "pb": 2, "roe": 10, "profitMargin": 808.8, "revenueGrowth": 5,
           "marketCap": 1e10, "revenue": 1e9}
    peers = [{"ticker": f"U{i}", "market": "US", "gicsSector": "公用事业", "isETF": False,
              "pe": 15, "pb": 2, "roe": 10, "profitMargin": 12, "revenueGrowth": 5,
              "marketCap": 1e10, "revenue": 1e9} for i in range(9)]
    bars = {s["ticker"]: [{"close": c} for c in up] for s in [bad] + peers}
    score_universe([bad] + peers, bars)
    # 坏 margin 被剔除 → BAD 的盈利质量分位应与同行相近(不是被 808% 顶到最高)
    assert bad["subScores"]["profitability"] <= 75


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


def test_trend_score_continuous_strength():
    # 连续化：强多头仍接近顶，"勉强站上均线"不再顶格(旧阶跃版会给满分 100)，且强弱可分
    strong = [100 * (1.01 ** i) for i in range(250)]   # 陡升强多头
    barely = [100.0] * 249 + [101.0]                   # 几乎平、刚冒头
    s_strong, s_barely = trend_score(strong), trend_score(barely)
    assert s_strong >= 90
    assert s_barely < 70        # 旧版此处会 = 100
    assert s_strong > s_barely


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


def test_composite_quality_dominates_after_standardization():
    # A: 高质量+弱时机(下跌)；B: 低质量+强时机(上涨)。两轨等方差标准化后，
    # 质量权重 0.6 应主导 → A.score > B.score（修复前时机离散度大，B 可能反超）。
    down = [200 - i * 0.5 for i in range(250)]   # 持续下跌 → 低动量/趋势
    up = [100 + i for i in range(250)]           # 持续上涨 → 高动量/趋势
    flat = [150 + (i % 5) for i in range(250)]
    A = _stock("A", "US", "信息技术", pe=10, roe=40, growth=60, margin=35)
    B = _stock("B", "US", "信息技术", pe=90, roe=3, growth=-5, margin=2)
    peers = [_stock(f"F{i}", "US", "信息技术", pe=25, roe=15, growth=10, margin=12) for i in range(8)]
    stocks = [A, B] + peers
    bars = {"A": [{"close": c} for c in down], "B": [{"close": c} for c in up]}
    for p in peers:
        bars[p["ticker"]] = [{"close": c} for c in flat]
    score_universe(stocks, bars)
    a = next(s for s in stocks if s["ticker"] == "A")
    b = next(s for s in stocks if s["ticker"] == "B")
    assert a["qualityScore"] > b["qualityScore"]   # A 质量更高
    assert a["timingScore"] < b["timingScore"]     # A 时机更弱
    assert a["score"] > b["score"]                 # 质量(0.6)主导 → A 综合分仍更高


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
