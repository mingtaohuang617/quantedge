"""数据源烟雾测试 — 默认跳过网络，CI 不会触发。

本地运行：
    pytest backend/tests/test_data_sources.py -m network -s
"""
import sys
from pathlib import Path

import pytest

# 把 backend/ 加进 sys.path，让裸 import 生效
BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from data_sources import fetch_history, fetch_quote, health_check  # noqa: E402

US_CFG = {"yf_symbol": "NVDA", "market": "US", "name": "NVIDIA"}
HK_CFG = {"yf_symbol": "0005.HK", "market": "HK", "name": "汇丰", "futu_symbol": "HK.00005"}


@pytest.mark.network
def test_health_check_returns_dict():
    """health_check 实际会向 iTick / OpenD / AKShare 发探测请求，归类到 network。"""
    status = health_check()
    assert isinstance(status, dict)
    assert all(isinstance(v, tuple) and len(v) == 2 for v in status.values())


@pytest.mark.network
def test_fetch_history_us_stock():
    df, src = fetch_history(US_CFG, days=10)
    assert df is not None and len(df) >= 5, f"美股 K线异常：{src}"
    assert "Close" in df.columns


@pytest.mark.network
def test_fetch_history_hk_stock():
    df, src = fetch_history(HK_CFG, days=10)
    assert df is not None and len(df) >= 5, f"港股 K线异常：{src}"


@pytest.mark.network
def test_fetch_quote_us():
    q, src = fetch_quote(US_CFG)
    if src == "none":
        pytest.skip("所有报价源都不可用")
    assert "price" in q
