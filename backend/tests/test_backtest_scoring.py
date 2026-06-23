"""backtest_scoring 工具测试 —— spearman 纯函数 + 合成窗口 IC。零网络。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from backtest_scoring import spearman, window_ic  # noqa: E402


def test_spearman_perfect_positive():
    assert spearman([1, 2, 3, 4, 5, 6, 7, 8], [10, 20, 30, 40, 50, 60, 70, 80]) == 1.0


def test_spearman_perfect_negative():
    assert spearman([1, 2, 3, 4, 5, 6, 7, 8], [80, 70, 60, 50, 40, 30, 20, 10]) == -1.0


def test_spearman_monotonic_but_nonlinear():
    # 秩相关只看单调性 → 仍为 1.0
    assert spearman([1, 2, 3, 4, 5, 6, 7, 8], [1, 4, 9, 16, 25, 36, 49, 64]) == 1.0


def test_spearman_too_few_returns_none():
    assert spearman([1, 2, 3], [3, 2, 1]) is None


def test_window_ic_detects_momentum_predictiveness():
    # 构造 40 只股票：一半持续上涨(强动量)、一半持续下跌。
    # 上涨股 T 之后继续涨 → 动量/时机分应与前向收益正相关(IC>0)。
    stocks, bars = [], {}
    n = 200  # 每只 200 根 K
    for i in range(40):
        up = i < 20
        t = f"{'U' if up else 'D'}{i}"
        stocks.append({"ticker": t, "market": "US", "gicsSector": "信息技术", "isETF": False,
                       "pe": 20, "pb": 2, "roe": 15, "profitMargin": 12, "revenueGrowth": 10,
                       "marketCap": 1e10, "revenue": 1e9})
        base = 100
        series = [base + (j if up else -j) * 0.5 for j in range(n)]
        bars[t] = [{"close": c} for c in series]
    r = window_ic(stocks, bars, k=21, H=21)  # T=倒数第22根, 前向21日
    assert r is not None
    # 时机分(含动量)应与前向收益正相关
    assert r["时机"] is not None and r["时机"] > 0.2
