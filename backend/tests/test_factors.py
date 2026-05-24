"""
test_factors — backend/factors.py 单元测试

锁住 calc_rsi / calc_momentum / calc_stock_score / parse_leverage /
calc_leverage_decay / calc_etf_score 的当前行为，方便后续重构。

⚠ 已知 quirks（本测试如实捕捉，未改实现，因 factors.py 属业务代码不动）：
  1. calc_rsi 在"全涨"序列上返回 50.0（而非直觉的 100）：
     loss 全 0 → avg_loss.replace(0, NaN) → rs 全 NaN → fallback 50。
  2. parse_leverage("-1x") 返回 None：实现里 `abs(val) > 1.0001` 才视为杠杆，
     -1 的 abs=1.0 不满足，被当非杠杆。-2x / -3x 等反向杠杆才被识别。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

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


# ── calc_rsi ─────────────────────────────────────────────

class TestCalcRsi:
    def test_data_insufficient_returns_neutral(self):
        """少于 period+1 个点 → 50.0 中性值。"""
        assert calc_rsi(pd.Series([100.0, 101.0]), period=14) == 50.0
        # 边界：period 个点也算不足（需要 period+1）
        assert calc_rsi(pd.Series([100.0] * 14), period=14) == 50.0

    def test_all_falling_returns_zero(self):
        prices = pd.Series(np.arange(130, 100, -1, dtype=float))
        assert calc_rsi(prices) == 0.0

    def test_all_rising_returns_neutral_quirk(self):
        """⚠ Quirk：全涨理论应 RSI=100，实现因 avg_loss=0 → NaN → fallback 50。

        若日后修复，此测试会失败，提醒同步更新此处期望。
        """
        prices = pd.Series(np.arange(100, 130, dtype=float))
        assert calc_rsi(prices) == 50.0

    def test_flat_prices_return_neutral(self):
        """横盘价（无变动）→ avg_gain/avg_loss 都 0 → NaN → 50.0。"""
        assert calc_rsi(pd.Series([100.0] * 30)) == 50.0

    def test_mixed_prices_within_range(self):
        """正常涨跌混合序列：RSI 应落在 (0, 100) 区间。"""
        np.random.seed(42)
        prices = pd.Series(100 + np.random.randn(60).cumsum())
        rsi = calc_rsi(prices)
        assert 0.0 < rsi < 100.0

    def test_custom_period(self):
        prices = pd.Series(np.arange(100, 130, dtype=float))
        # period=5 时仍走"全涨 → NaN → 50" 路径
        assert calc_rsi(prices, period=5) == 50.0
        # period=5 时 6 个点是边界刚够
        short = pd.Series(np.arange(110, 105, -1, dtype=float))  # 5 点
        assert calc_rsi(short, period=5) == 50.0  # 不足 period+1=6

    def test_rsi_rounded_to_one_decimal(self):
        np.random.seed(7)
        prices = pd.Series(100 + np.random.randn(60).cumsum())
        rsi = calc_rsi(prices)
        # round(x, 1) → 至多 1 位小数
        assert rsi == round(rsi, 1)


# ── calc_momentum ────────────────────────────────────────

class TestCalcMomentum:
    def test_data_insufficient_returns_neutral(self):
        assert calc_momentum(pd.Series([100.0] * 5), period=20) == 50.0

    def test_zero_return_returns_50(self):
        assert calc_momentum(pd.Series([100.0] * 30)) == 50.0

    def test_extreme_gain_clipped_to_100(self):
        # +100% 收益 → score = 50 + 100*2.5 = 300 → clip 100
        prices = pd.Series([100.0] * 20 + [200.0])
        assert calc_momentum(prices) == 100.0

    def test_extreme_loss_clipped_to_zero(self):
        # -50% 收益 → score = 50 + (-50)*2.5 = -75 → clip 0
        prices = pd.Series([100.0] * 20 + [50.0])
        assert calc_momentum(prices) == 0.0

    def test_known_value_10pct(self):
        # +10% → 50 + 25 = 75
        prices = pd.Series([100.0] * 20 + [110.0])
        assert calc_momentum(prices) == 75.0

    def test_known_value_negative_5pct(self):
        # -5% → 50 + (-12.5) = 37.5
        prices = pd.Series([100.0] * 20 + [95.0])
        assert calc_momentum(prices) == 37.5

    def test_custom_period(self):
        # 自定义 period=5，2 个点不足 5+1
        assert calc_momentum(pd.Series([100.0, 110.0]), period=5) == 50.0


# ── calc_stock_score ─────────────────────────────────────

class TestCalcStockScorePeBuckets:
    def _score(self, pe):
        return calc_stock_score(
            pe=pe, roe=15, revenue_growth=10, profit_margin=10,
            momentum=50, rsi=50,
        )

    def test_pe_none_treats_as_loss(self):
        # PE None → 20 分（与负 PE 同档）
        s1 = self._score(None)
        s2 = self._score(-5.0)
        assert s1 == s2

    def test_pe_low_scores_high(self):
        """PE 越低分越高（单调递减）。"""
        s_5 = self._score(5)
        s_20 = self._score(20)
        s_30 = self._score(30)
        s_50 = self._score(50)
        s_100 = self._score(100)
        # PE buckets: <15(95) > <25(80) > <40(60) > <80(40) > >=80(20)
        assert s_5 > s_20 > s_30 > s_50 > s_100


class TestCalcStockScoreRoeBuckets:
    def _score(self, roe):
        return calc_stock_score(
            pe=20, roe=roe, revenue_growth=10, profit_margin=10,
            momentum=50, rsi=50,
        )

    def test_roe_buckets_monotonic(self):
        # >30(95) > >20(80) > >10(60) > >0(40) > <=0(15)
        s = [self._score(v) for v in (-5, 5, 15, 25, 35)]
        assert s[0] < s[1] < s[2] < s[3] < s[4]

    def test_roe_none_treated_as_30(self):
        # ROE None → 30 分（介于 >0(40) 和 <=0(15) 之间）
        s_none = self._score(None)
        s_5 = self._score(5)
        s_neg = self._score(-1)
        assert s_neg < s_none < s_5


class TestCalcStockScoreProfitMarginBuckets:
    def _score(self, margin):
        return calc_stock_score(
            pe=20, roe=15, revenue_growth=10, profit_margin=margin,
            momentum=50, rsi=50,
        )

    def test_profit_margin_buckets_monotonic(self):
        # 档位 >30(95) > >15(75) > >5(55) > >0(35) > <=0(15)
        s = [self._score(v) for v in (-5, 3, 10, 20, 40)]
        assert s[0] < s[1] < s[2] < s[3] < s[4]


class TestCalcStockScoreRsiBands:
    def _score(self, rsi):
        return calc_stock_score(
            pe=20, roe=15, revenue_growth=10, profit_margin=10,
            momentum=50, rsi=rsi,
        )

    def test_healthy_band_40_60_highest(self):
        # [40-60] 健康（70 分）> [30-70] 一般（55）> 其他超买/超卖（35）
        s_healthy = self._score(50)
        s_mid = self._score(35)
        s_overbought = self._score(85)
        s_oversold = self._score(15)
        assert s_healthy > s_mid > s_overbought
        assert s_mid > s_oversold

    def test_band_boundaries(self):
        # RSI=40 和 RSI=60 都应在 healthy band
        assert self._score(40) == self._score(60)
        # RSI=30 和 RSI=70 都应在 mid band
        assert self._score(30) == self._score(70)


class TestCalcStockScoreGrowthBuckets:
    def _score(self, growth):
        return calc_stock_score(
            pe=20, roe=15, revenue_growth=growth, profit_margin=10,
            momentum=50, rsi=50,
        )

    def test_growth_buckets_monotonic(self):
        # 档位 >50(95) > >25(80) > >10(65) > >0(45) > <=0(20)
        s = [self._score(v) for v in (-5, 5, 20, 30, 80)]
        assert s[0] < s[1] < s[2] < s[3] < s[4]

    def test_growth_none_returns_40(self):
        # growth None → 40（介于 >0(45) 和 <=0(20) 之间）
        s_none = self._score(None)
        s_neg = self._score(-5)
        s_pos = self._score(5)
        assert s_neg < s_none < s_pos


class TestCalcStockScoreReturnsAndDetailed:
    def test_score_within_range(self):
        s = calc_stock_score(
            pe=20, roe=15, revenue_growth=10, profit_margin=10,
            momentum=50, rsi=50,
        )
        assert 0.0 <= s <= 100.0

    def test_all_none_inputs_returns_finite_score(self):
        s = calc_stock_score(
            pe=None, roe=None, revenue_growth=None, profit_margin=None,
            momentum=50, rsi=50,
        )
        assert 0.0 <= s <= 100.0

    def test_detailed_returns_breakdown(self):
        result = calc_stock_score(
            pe=10, roe=25, revenue_growth=30, profit_margin=20,
            momentum=70, rsi=50, detailed=True,
        )
        assert isinstance(result, tuple)
        score, breakdown = result
        assert set(breakdown.keys()) == {"fundamental", "technical", "growth"}
        assert all(0.0 <= v <= 100.0 for v in breakdown.values())

    def test_custom_weights_change_score(self):
        """权重改变（且分项分数不同）应改变总分。"""
        # 强基本面 + 弱成长 → 高权重给 fundamental 应抬高总分
        base = calc_stock_score(
            pe=5, roe=35, revenue_growth=-10, profit_margin=40,
            momentum=50, rsi=50,
            weights={"fundamental": 0.20, "technical": 0.30, "growth": 0.50},
        )
        boost = calc_stock_score(
            pe=5, roe=35, revenue_growth=-10, profit_margin=40,
            momentum=50, rsi=50,
            weights={"fundamental": 0.80, "technical": 0.10, "growth": 0.10},
        )
        assert boost > base

    def test_perfect_inputs_caps_at_100(self):
        """近乎完美的分项不应越过 100。"""
        s = calc_stock_score(
            pe=5, roe=50, revenue_growth=100, profit_margin=50,
            momentum=100, rsi=50,
        )
        assert s <= 100.0


# ── parse_leverage ───────────────────────────────────────

class TestParseLeverage:
    @pytest.mark.parametrize("val", [None, "", "None"])
    def test_empty_returns_none(self, val):
        assert parse_leverage(val) is None

    def test_2x_string(self):
        assert parse_leverage("2x") == 2.0

    def test_3x_uppercase_string(self):
        assert parse_leverage("3X") == 3.0

    def test_negative_2x_string(self):
        # -2x 反向杠杆，abs=2 > 1.0001，被识别
        assert parse_leverage("-2x") == -2.0

    def test_numeric_float(self):
        assert parse_leverage(2.5) == 2.5

    def test_numeric_int(self):
        # 实现：isinstance(int/float) 直接 float，不过 abs > 1.0001 检查（只在 string 路径检查）
        # 所以 int 2 直接返回 2.0
        assert parse_leverage(2) == 2.0

    def test_1x_treated_as_non_leverage(self):
        """1x 视作非杠杆 ETF，返回 None。"""
        assert parse_leverage("1x") is None

    def test_negative_1x_quirk(self):
        """⚠ Quirk：-1x（反向）也被当非杠杆，因 abs(-1) <= 1.0001。

        如果未来修复，此测试会失败，提醒同步更新。
        """
        assert parse_leverage("-1x") is None

    def test_invalid_string(self):
        assert parse_leverage("abc") is None


# ── calc_leverage_decay ──────────────────────────────────

class TestCalcLeverageDecay:
    def test_no_leverage_returns_none(self):
        prices = pd.Series(100 + np.random.RandomState(0).randn(60).cumsum())
        assert calc_leverage_decay(prices, None) is None
        # "1x" 被 parse_leverage 滤为 None
        assert calc_leverage_decay(prices, "1x") is None

    def test_too_few_prices_returns_none(self):
        # < 30 个价格点
        prices = pd.Series([100.0] * 20)
        assert calc_leverage_decay(prices, "2x") is None

    def test_2x_leverage_positive_drag(self):
        """2x 杠杆 + 有波动 → drag > 0。"""
        np.random.seed(0)
        # 60 天 1% 日波动
        returns = np.random.normal(0, 0.01, 60)
        prices = pd.Series(100 * np.exp(returns.cumsum()))
        drag = calc_leverage_decay(prices, "2x")
        assert drag is not None
        assert drag > 0

    def test_higher_volatility_higher_drag(self):
        """波动率越大，磨损越大。"""
        np.random.seed(0)
        low_vol = pd.Series(100 * np.exp(np.random.normal(0, 0.005, 60).cumsum()))
        np.random.seed(0)
        high_vol = pd.Series(100 * np.exp(np.random.normal(0, 0.02, 60).cumsum()))
        drag_low = calc_leverage_decay(low_vol, "2x")
        drag_high = calc_leverage_decay(high_vol, "2x")
        assert drag_low is not None and drag_high is not None
        assert drag_high > drag_low

    def test_3x_higher_drag_than_2x(self):
        """更高杠杆 → 更高磨损（(L²-L)/2 单调）。"""
        np.random.seed(0)
        returns = np.random.normal(0, 0.01, 60)
        prices_2x = pd.Series(100 * np.exp(2 * returns.cumsum()))  # 模拟 2x 标的
        prices_3x = pd.Series(100 * np.exp(3 * returns.cumsum()))
        d2 = calc_leverage_decay(prices_2x, "2x")
        d3 = calc_leverage_decay(prices_3x, "3x")
        assert d2 is not None and d3 is not None
        assert d3 > d2


# ── calc_etf_score ───────────────────────────────────────

class TestCalcEtfScore:
    def _base(self, **overrides):
        kwargs = dict(
            expense_ratio=0.5,
            premium_discount=0.1,
            aum_usd=5e8,
            momentum=60,
            concentration_top3=40,
            leverage=None,
        )
        kwargs.update(overrides)
        return calc_etf_score(**kwargs)

    def test_expense_ratio_buckets_monotonic(self):
        # <=0.3(95) > <=0.65(75) > <=1.0(55) > >1(30)
        s = [self._base(expense_ratio=v) for v in (0.2, 0.5, 0.8, 1.5)]
        assert s[0] > s[1] > s[2] > s[3]

    def test_expense_ratio_none_default(self):
        s_none = self._base(expense_ratio=None)
        s_cheap = self._base(expense_ratio=0.1)
        s_expensive = self._base(expense_ratio=2.0)
        # None → 50（介于便宜 95 和昂贵 30 之间）
        assert s_expensive < s_none < s_cheap

    def test_premium_discount_uses_abs(self):
        """正负溢价对称（取 abs）。"""
        s_pos = self._base(premium_discount=3.0)
        s_neg = self._base(premium_discount=-3.0)
        assert s_pos == s_neg

    def test_premium_discount_buckets_monotonic(self):
        # |pd|<0.5(95) > <2(75) > <5(55) > <10(35) > >=10(15)
        s = [self._base(premium_discount=v) for v in (0.1, 1.0, 3.0, 7.0, 15.0)]
        assert s[0] > s[1] > s[2] > s[3] > s[4]

    def test_aum_buckets_monotonic(self):
        s = [self._base(aum_usd=v) for v in (1e6, 5e7, 5e8, 5e9)]
        assert s[0] < s[1] < s[2] < s[3]

    def test_concentration_buckets_monotonic(self):
        # <50(85) > <70(60) > <90(35) > >=90(15) —— 越分散分越高
        s = [self._base(concentration_top3=v) for v in (95, 80, 60, 30)]
        assert s[0] < s[1] < s[2] < s[3]

    def test_leverage_penalty_applied(self):
        """有杠杆比无杠杆低 15 分（截断到 0 前）。"""
        s_no_lev = self._base(leverage=None)
        s_lev = self._base(leverage="2x")
        # 验收标准：杠杆惩罚生效
        assert s_no_lev - s_lev == 15.0

    def test_leverage_falsy_strings_treated_as_no_penalty(self):
        """实现里 `if leverage` 判定真假；空字符串 → 不惩罚。"""
        s_no_lev = self._base(leverage=None)
        s_empty = self._base(leverage="")
        assert s_no_lev == s_empty

    def test_score_clipped_at_zero(self):
        """所有维度都很差 + 杠杆惩罚 → 不低于 0。"""
        s = calc_etf_score(
            expense_ratio=5.0, premium_discount=20.0, aum_usd=1e5,
            momentum=0, concentration_top3=95, leverage="2x",
        )
        assert s >= 0.0

    def test_detailed_returns_breakdown(self):
        result = self._base(detailed=True)
        assert isinstance(result, tuple)
        score, breakdown = result
        assert set(breakdown.keys()) == {"cost", "liquidity", "momentum", "risk"}
        assert all(0.0 <= v <= 100.0 for v in breakdown.values())

    def test_score_capped_at_100(self):
        """最佳输入应被 clip 在 100。"""
        s = calc_etf_score(
            expense_ratio=0.05, premium_discount=0.0, aum_usd=1e10,
            momentum=100, concentration_top3=20, leverage=None,
        )
        assert s <= 100.0
