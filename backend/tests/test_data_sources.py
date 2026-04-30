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
from data_sources.itick_source import _to_itick_params  # noqa: E402

US_CFG = {"yf_symbol": "NVDA", "market": "US", "name": "NVIDIA"}
HK_CFG = {"yf_symbol": "0005.HK", "market": "HK", "name": "汇丰", "futu_symbol": "HK.00005"}
SH_CFG = {"yf_symbol": "600519.SS", "market": "SH", "name": "贵州茅台"}
SZ_CFG = {"yf_symbol": "000333.SZ", "market": "SZ", "name": "美的集团"}
KR_CFG = {"yf_symbol": "005930.KS", "market": "KR", "name": "三星电子"}
JP_CFG = {"yf_symbol": "7203.T", "market": "JP", "name": "丰田"}


# ── 离线: itick region/code 转换 ─────────────────────────

def test_itick_region_us():
    assert _to_itick_params(US_CFG) == {"region": "US", "code": "NVDA"}


def test_itick_region_hk_strips_leading_zeros():
    """港股: yf '0005.HK' → region=HK, code='5'（去前导零）"""
    assert _to_itick_params(HK_CFG) == {"region": "HK", "code": "5"}


def test_itick_region_sh():
    assert _to_itick_params(SH_CFG) == {"region": "SH", "code": "600519"}


def test_itick_region_sz():
    assert _to_itick_params(SZ_CFG) == {"region": "SZ", "code": "000333"}


def test_itick_region_kr_keeps_leading_zeros():
    """韩股: yf '005930.KS' → region=KR, code='005930'（保留前导零）"""
    assert _to_itick_params(KR_CFG) == {"region": "KR", "code": "005930"}


def test_itick_region_jp():
    assert _to_itick_params(JP_CFG) == {"region": "JP", "code": "7203"}


# ── network: 真实拉数据 ──────────────────────────────────

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
def test_fetch_history_a_stock():
    """A股 — iTick/Futu/yfinance 任一可用即通过"""
    df, src = fetch_history(SH_CFG, days=10)
    assert df is not None and len(df) >= 5, f"A股 K线异常：{src}"


@pytest.mark.network
def test_fetch_history_kr_stock():
    """韩股 — Futu 不支持，应该走 iTick → yfinance"""
    df, src = fetch_history(KR_CFG, days=10)
    assert df is not None and len(df) >= 5, f"韩股 K线异常：{src}"
    assert src in ("iTick", "yfinance"), f"韩股不应走 Futu，实际 src={src}"


@pytest.mark.network
def test_fetch_history_jp_stock():
    """日股 — Futu 不支持，应该走 iTick → yfinance"""
    df, src = fetch_history(JP_CFG, days=10)
    assert df is not None and len(df) >= 5, f"日股 K线异常：{src}"
    assert src in ("iTick", "yfinance"), f"日股不应走 Futu，实际 src={src}"


@pytest.mark.network
def test_fetch_quote_us():
    q, src = fetch_quote(US_CFG)
    if src == "none":
        pytest.skip("所有报价源都不可用")
    assert "price" in q
