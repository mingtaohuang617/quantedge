"""backtest_strategy 工具测试 —— metrics / _basket_ret 纯函数。零网络。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from backtest_strategy import metrics, _basket_ret  # noqa: E402


def test_metrics_constant_positive():
    m = metrics([0.01] * 12)   # 每期 +1%
    assert m["cum"] > 0.12 and m["cum"] < 0.14   # 复利略高于 12%
    assert m["ann"] > 0
    assert m["mdd"] == 0.0     # 一路涨无回撤


def test_metrics_drawdown_detected():
    m = metrics([0.1, 0.1, -0.3, 0.05, 0.05])  # 中途大跌
    assert m["mdd"] < -0.25    # 回撤被捕捉


def test_metrics_too_few():
    assert metrics([0.01]) == {}


def test_basket_picks_top_and_bottom():
    rows = [
        ({"score": 90}, 0.20),   # 高分高收益
        ({"score": 70}, 0.10),
        ({"score": 50}, 0.00),
        ({"score": 30}, -0.05),
        ({"score": 10}, -0.10),  # 低分低收益
    ]
    # top 20% (n=1) → 最高分那只 → 0.20
    assert _basket_ret(rows, "score", 0.2) == 0.20
    # bottom 20% (n=1) → 最低分那只 → -0.10
    assert _basket_ret(rows, "score", 0.2, bottom=True) == -0.10
    # top 40% (n=2) → 两只最高分 → 均值 0.15
    assert abs(_basket_ret(rows, "score", 0.4) - 0.15) < 1e-9
