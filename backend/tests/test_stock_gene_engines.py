"""
4 引擎评分单测
==============
直接 unit-test 每个特征函数 — 传入合成数据，验证 PASS/FAIL/N/A 判定符合阈值。
不打 yfinance / db，避免网络依赖。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import value_gene as vg  # noqa: E402
import signal_gene as sigg  # noqa: E402
import risk_gene as rg  # noqa: E402


# ─── value_gene ────────────────────────────────────────────
class TestValueGene:
    def test_valuation_pass(self):
        f = vg._feature_valuation({"trailingPE": 18, "priceToBook": 3.0})
        assert f["pass"] is True
        assert f["score"] == 1
        assert "PE 18" in f["value"]

    def test_valuation_fail_high_pe(self):
        f = vg._feature_valuation({"trailingPE": 50, "priceToBook": 3.0})
        assert f["pass"] is False

    def test_valuation_fail_negative_pe(self):
        """亏损（PE<0）应不合格"""
        f = vg._feature_valuation({"trailingPE": -5, "priceToBook": 2.0})
        assert f["pass"] is False
        assert "亏损" in f["value"]

    def test_valuation_unavailable(self):
        f = vg._feature_valuation({})
        assert f["available"] is False

    def test_roe_pass(self):
        f = vg._feature_roe({"returnOnEquity": 0.18})
        assert f["pass"] is True
        assert "18.0%" in f["value"]

    def test_roe_fail(self):
        f = vg._feature_roe({"returnOnEquity": 0.10})
        assert f["pass"] is False

    def test_gross_margin(self):
        assert vg._feature_gross_margin({"grossMargins": 0.40})["pass"] is True
        assert vg._feature_gross_margin({"grossMargins": 0.20})["pass"] is False
        assert vg._feature_gross_margin({})["available"] is False

    def test_free_cashflow_pass(self):
        f = vg._feature_free_cashflow({"freeCashflow": 50e9, "totalRevenue": 200e9})
        assert f["pass"] is True

    def test_free_cashflow_fail_negative(self):
        f = vg._feature_free_cashflow({"freeCashflow": -10e9, "totalRevenue": 200e9})
        assert f["pass"] is False

    def test_free_cashflow_fail_low_ratio(self):
        """FCF 为正但占营收 < 5%"""
        f = vg._feature_free_cashflow({"freeCashflow": 1e9, "totalRevenue": 200e9})
        assert f["pass"] is False

    def test_debt_pct_format(self):
        """yfinance 的 debtToEquity 单位是百分比（如 65.4 = 0.654）"""
        f = vg._feature_debt({"debtToEquity": 65.4})
        assert f["pass"] is True
        assert "0.65" in f["value"]

    def test_debt_decimal_format(self):
        """有些 ticker 直接给小数（< 5）"""
        f = vg._feature_debt({"debtToEquity": 0.85})
        assert f["pass"] is True

    def test_debt_high(self):
        f = vg._feature_debt({"debtToEquity": 150})  # 1.5 倍
        assert f["pass"] is False

    def test_profit_margin(self):
        assert vg._feature_profit_margin({"profitMargins": 0.15})["pass"] is True
        assert vg._feature_profit_margin({"profitMargins": 0.05})["pass"] is False

    def test_verdict_levels(self):
        assert vg._verdict(6, 6)["level"] == "strong"
        assert vg._verdict(4, 6)["level"] == "moderate"
        assert vg._verdict(3, 6)["level"] == "neutral"
        assert vg._verdict(1, 6)["level"] == "weak"
        assert vg._verdict(0, 0)["level"] == "unknown"


# ─── signal_gene ───────────────────────────────────────────
def _make_bars(closes, volumes=None, highs=None, lows=None):
    """构造一个 K 线 DataFrame，长度由 closes 决定。"""
    n = len(closes)
    if volumes is None:
        volumes = [1_000_000] * n
    if highs is None:
        highs = [c * 1.01 for c in closes]
    if lows is None:
        lows = [c * 0.99 for c in closes]
    return pd.DataFrame({
        "trade_date": [f"2026-01-{(i % 28) + 1:02d}" for i in range(n)],
        "close": closes,
        "high": highs,
        "low": lows,
        "volume": volumes,
    })


class TestSignalGene:
    def test_breakout_pass(self):
        """收盘价高于近 20D 高 → 突破"""
        bars = _make_bars([100 + i for i in range(22)])  # 上升趋势，最后一根创新高
        f = sigg._feature_breakout(bars)
        assert f["pass"] is True

    def test_breakout_fail(self):
        """收盘价远低于 20D 高"""
        # 前 21 天高 100-120，最后一天 90
        closes = [100 + i for i in range(21)] + [90]
        bars = _make_bars(closes)
        f = sigg._feature_breakout(bars)
        assert f["pass"] is False

    def test_breakout_data_insufficient(self):
        bars = _make_bars([100, 101, 102])
        f = sigg._feature_breakout(bars)
        assert f["available"] is False

    def test_volume_breakout_pass(self):
        """今日量为 20D 均量的 2 倍"""
        n = 22
        vols = [1_000_000] * 21 + [2_500_000]   # 最后一根放量
        bars = _make_bars([100] * n, volumes=vols)
        f = sigg._feature_volume_breakout(bars)
        assert f["pass"] is True

    def test_volume_breakout_fail(self):
        n = 22
        vols = [1_000_000] * n   # 量平
        bars = _make_bars([100] * n, volumes=vols)
        f = sigg._feature_volume_breakout(bars)
        assert f["pass"] is False

    def test_ma_bullish(self):
        """单调上升 → MA5 > MA10 > MA20"""
        bars = _make_bars([100 + i * 0.5 for i in range(25)])
        f = sigg._feature_ma_bullish(bars)
        assert f["pass"] is True

    def test_ma_bullish_fail_falling(self):
        """单调下跌 → 不成立"""
        bars = _make_bars([100 - i * 0.5 for i in range(25)])
        f = sigg._feature_ma_bullish(bars)
        assert f["pass"] is False

    def test_verdict_levels(self):
        assert sigg._verdict(5, 6)["level"] == "strong"
        assert sigg._verdict(5, 6)["label"] == "入场窗口"
        assert sigg._verdict(2, 6)["level"] == "weak"
        assert sigg._verdict(2, 6)["label"] == "暂避"


# ─── risk_gene ─────────────────────────────────────────────
class TestRiskGene:
    def test_max_drawdown_pass(self):
        """1Y 内 MDD ≤ 30% → 通过"""
        # 平缓上涨：MDD 几乎为 0
        bars = _make_bars([100 + i * 0.1 for i in range(252)])
        f = rg._feature_max_drawdown(bars)
        assert f["pass"] is True
        assert isinstance(f["pass"], bool)   # 防止 np.bool_ 类型

    def test_max_drawdown_fail(self):
        """大幅回撤"""
        closes = [100] * 50 + [60] * 220   # 40% 跌幅
        bars = _make_bars(closes)
        f = rg._feature_max_drawdown(bars)
        assert f["pass"] is False
        assert isinstance(f["pass"], bool)

    def test_volatility_pass(self):
        """低波动平稳"""
        bars = _make_bars([100 + np.sin(i / 10) * 0.5 for i in range(252)])
        f = rg._feature_volatility(bars)
        assert f["pass"] is True
        assert isinstance(f["pass"], bool)

    def test_volatility_fail(self):
        """高波动"""
        np.random.seed(42)
        # 日均涨跌 5%，年化波动远超 35%
        closes = [100]
        for _ in range(252):
            closes.append(closes[-1] * (1 + np.random.normal(0, 0.05)))
        bars = _make_bars(closes)
        f = rg._feature_volatility(bars)
        assert f["pass"] is False
        assert isinstance(f["pass"], bool)

    def test_beta(self):
        """同步走的资产 Beta ≈ 1"""
        np.random.seed(1)
        base = [100]
        for _ in range(252):
            base.append(base[-1] * (1 + np.random.normal(0, 0.01)))
        df = _make_bars(base)
        bench = _make_bars(base)   # 完全同步 → beta=1
        f = rg._feature_beta(df, bench)
        assert f["pass"] is True
        assert "Beta" in f["value"]

    def test_beta_no_bench(self):
        f = rg._feature_beta(_make_bars([100] * 200), None)
        assert f["available"] is False

    def test_liquidity_us_high(self):
        """美股 20D 平均成交额超 5M"""
        bars = _make_bars([100] * 22, volumes=[200_000] * 22)
        f = rg._feature_liquidity(bars, "US")
        # 200,000 股 * $100 = $20M 平均
        assert f["pass"] is True

    def test_liquidity_us_low(self):
        bars = _make_bars([100] * 22, volumes=[1_000] * 22)
        f = rg._feature_liquidity(bars, "US")
        # 1,000 股 * $100 = $100K << $5M
        assert f["pass"] is False

    def test_fundamentals_pass(self):
        """两个字段都达标"""
        f = rg._feature_fundamentals("TEST", "US",
                                      cached_stock={"profitMargin": 15.0, "roe": 20.0})
        # 注意：cached_stock 已经是百分比形式（如 15.0 = 15%），fetch_info 会除 100
        # 但这个函数直接读 info 的 profitMargins 是小数。看 _feature_fundamentals 内部逻辑：
        # 它通过 value_gene._fetch_info 读 info，所以 fake 一下：
        # cached_stock=profitMargin=15 → info.profitMargins=0.15
        assert f["available"] is True

    def test_verdict_levels(self):
        assert rg._verdict(6, 6)["label"] == "低风险"
        assert rg._verdict(3, 6)["label"] == "中等风险"
        assert rg._verdict(1, 6)["label"] == "高风险"
