"""regime 模块单测 — Lunde-Timmermann 牛熊标注 + Kaplan-Meier 生存分析。

Phase 2 关键无网络依赖逻辑：bull_bear / survival。
HMM 训练需要 hmmlearn + 真实 W5000 序列，留给集成测试，这里不覆盖。
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from regime.bull_bear import (  # noqa: E402
    label_bull_bear,
    regime_segments,
    annotate_returns,
)
from regime.survival import (  # noqa: E402
    kaplan_meier,
    conditional_prob_survive,
    compute_survival_summary,
)


# ── label_bull_bear ─────────────────────────────────────
def test_label_bull_bear_empty():
    out = label_bull_bear(pd.Series([], dtype=float))
    assert out.empty
    assert list(out.columns) == ["regime", "peak_or_trough"]


def test_label_bull_bear_single_point():
    """只有 1 个点 — 长度 < 2 直接返回空 DataFrame."""
    out = label_bull_bear(pd.Series([100.0], index=[pd.Timestamp("2020-01-01")]))
    assert out.empty


def test_label_bull_bear_pure_uptrend_stays_bull():
    """单调上涨 — 全程 bull，无转折."""
    dates = pd.date_range("2020-01-01", periods=10, freq="D")
    s = pd.Series([100, 101, 103, 105, 110, 115, 120, 125, 130, 140], index=dates, dtype=float)
    out = label_bull_bear(s, threshold=0.20)
    assert (out["regime"] == "bull").all()
    assert out["peak_or_trough"].isna().all()


def test_label_bull_bear_drop_triggers_bear():
    """涨到 100 后跌到 79（-21%）应触发 bear；前高标 P."""
    dates = pd.date_range("2020-01-01", periods=5, freq="D")
    s = pd.Series([80, 100, 90, 85, 79], index=dates, dtype=float)
    out = label_bull_bear(s, threshold=0.20)
    assert out["regime"].iloc[0] == "bull"
    assert out["regime"].iloc[1] == "bull"  # 100 是 peak，本日仍是 bull 直到下行触发
    # 100 那天打 P
    assert out.loc[dates[1], "peak_or_trough"] == "P"
    # 跌穿 -20% 后续应是 bear
    assert out["regime"].iloc[-1] == "bear"


def test_label_bull_bear_recovery_back_to_bull():
    """先跌触发 bear，再反弹 +20% 应回 bull；前低标 T."""
    dates = pd.date_range("2020-01-01", periods=8, freq="D")
    # 100 → 79 (-21%, bear) → 95 (+20% from 79)
    s = pd.Series([80, 100, 90, 80, 79, 85, 90, 95], index=dates, dtype=float)
    out = label_bull_bear(s, threshold=0.20)
    # 79 那天打 T
    assert out.loc[dates[4], "peak_or_trough"] == "T"
    # 最后应回 bull
    assert out["regime"].iloc[-1] == "bull"


def test_label_bull_bear_threshold_just_below_no_trigger():
    """跌幅刚好不到阈值 — 不触发."""
    dates = pd.date_range("2020-01-01", periods=4, freq="D")
    s = pd.Series([90, 100, 95, 81], index=dates, dtype=float)  # 100→81 = -19%
    out = label_bull_bear(s, threshold=0.20)
    assert (out["regime"] == "bull").all()


# ── regime_segments ─────────────────────────────────────
def test_regime_segments_empty():
    assert regime_segments(pd.DataFrame()) == []


def test_regime_segments_single_regime():
    dates = pd.date_range("2020-01-01", periods=5, freq="D")
    df = pd.DataFrame({"regime": ["bull"] * 5, "peak_or_trough": [None] * 5}, index=dates)
    segs = regime_segments(df)
    assert len(segs) == 1
    assert segs[0]["regime"] == "bull"
    assert segs[0]["days"] == 5


def test_regime_segments_multi_regime():
    dates = pd.date_range("2020-01-01", periods=10, freq="D")
    regimes = ["bull"] * 3 + ["bear"] * 4 + ["bull"] * 3
    df = pd.DataFrame({"regime": regimes, "peak_or_trough": [None] * 10}, index=dates)
    segs = regime_segments(df)
    assert len(segs) == 3
    assert [s["regime"] for s in segs] == ["bull", "bear", "bull"]
    assert [s["days"] for s in segs] == [3, 4, 3]


# ── annotate_returns ────────────────────────────────────
def test_annotate_returns_basic():
    dates = pd.date_range("2020-01-01", periods=5, freq="D")
    prices = pd.Series([100, 110, 120, 100, 90], index=dates, dtype=float)
    segs = [
        {"start": "2020-01-01", "end": "2020-01-03", "regime": "bull", "days": 3},
        {"start": "2020-01-04", "end": "2020-01-05", "regime": "bear", "days": 2},
    ]
    out = annotate_returns(prices, segs)
    # bull 100 → 120 = +20%
    assert out[0]["ret_pct"] == 20.0
    # bear: end is 90, but start filter uses .loc[:start] so picks up 100 on 2020-01-04
    # which equals 100 → 90 = -10%
    assert out[1]["ret_pct"] is not None


# ── kaplan_meier ────────────────────────────────────────
def test_kaplan_meier_empty():
    out = kaplan_meier([], [])
    assert out == {"times": [], "survival": []}


def test_kaplan_meier_no_censoring():
    """3 个完成段 [1,2,3] — 经典 KM 阶梯."""
    out = kaplan_meier([1, 2, 3], [False, False, False])
    assert out["times"] == [1, 2, 3]
    # S(t=1) = (3-1)/3 = 2/3, S(t=2) = 2/3 * (2-1)/2 = 1/3, S(t=3) = 1/3 * (1-1)/1 = 0
    assert out["survival"][0] == round(2 / 3, 4)
    assert out["survival"][1] == round(1 / 3, 4)
    assert out["survival"][2] == 0.0


def test_kaplan_meier_with_censoring():
    """censored 不计为 event，但减少 at_risk."""
    # 完成 1, 2 censored 在 1 (current 进行中)
    out = kaplan_meier([1, 1, 2], [False, True, False])
    # at t=1: 3 at risk, 1 event -> S(1) = 2/3; 2 leave (1 event + 1 censor), at_risk → 1
    # at t=2: 1 at risk, 1 event -> S(2) = 2/3 * 0 = 0
    assert out["survival"][0] == round(2 / 3, 4)
    assert out["survival"][1] == 0.0


# ── conditional_prob_survive ────────────────────────────
def test_conditional_prob_survive_basic():
    """P(T > 5 | T > 0) = S(5)/S(0) = S(5) when S(0)=1."""
    km = {"times": [3, 6], "survival": [0.5, 0.25]}
    # P(T > 6 | T > 0) = S(6) / S(0) = 0.25
    p = conditional_prob_survive(km, current=0, additional=6)
    assert p == 0.25
    # P(T > 6 | T > 3) = S(6) / S(3) = 0.25 / 0.5 = 0.5
    p2 = conditional_prob_survive(km, current=3, additional=3)
    assert p2 == 0.5


def test_conditional_prob_survive_zero_baseline():
    km = {"times": [1], "survival": [0.0]}
    # S(1) = 0 → 不能计算 P
    assert conditional_prob_survive(km, current=1, additional=1) is None


# ── compute_survival_summary ────────────────────────────
def test_compute_survival_summary_no_segments():
    out = compute_survival_summary([], "bull", 100)
    assert "error" in out


def test_compute_survival_summary_unknown_regime():
    segs = [{"regime": "bull", "days": 100}]
    out = compute_survival_summary(segs, "neutral", 50)
    assert "error" in out


def test_compute_survival_summary_insufficient_history():
    """少于 2 段同类型历史 → error."""
    segs = [
        {"regime": "bull", "days": 100},
        {"regime": "bear", "days": 50},
        {"regime": "bull", "days": 80},  # 当前进行中（最后一段）
    ]
    out = compute_survival_summary(segs, "bull", 80)
    # 排除最后一段后只有 1 个 past_same
    assert "error" in out


def test_compute_survival_summary_basic():
    segs = [
        {"regime": "bull", "days": 100},
        {"regime": "bear", "days": 50},
        {"regime": "bull", "days": 200},
        {"regime": "bear", "days": 30},
        {"regime": "bull", "days": 60},  # 当前进行中
    ]
    out = compute_survival_summary(segs, "bull", 60)
    # past_same = [100, 200]，median = 150
    assert out["median_past_days"] == 150.0
    assert out["max_past_days"] == 200
    assert out["n_past_same_segments"] == 2
    # 60 比 100, 200 都小 → pct_rank = 0%
    assert out["current_duration_pct_rank"] == 0.0
    # prob_continue 应该是 dict 含 3M/6M/12M
    assert "3M" in out["prob_continue"]
    assert "6M" in out["prob_continue"]
    assert "12M" in out["prob_continue"]
