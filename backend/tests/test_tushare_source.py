"""tushare_source 测试 — 仅纯函数（to_ts_code / _df_normalize），不连远程。"""
import sys
from pathlib import Path

import pandas as pd
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from data_sources import tushare_source as ts_src  # noqa: E402


# ── to_ts_code 4 个市场 ──────────────────────────────────
def test_to_ts_code_us():
    code, mtype = ts_src.to_ts_code({"yf_symbol": "NVDA", "market": "US"})
    assert code == "NVDA"
    assert mtype == "US"


def test_to_ts_code_hk_pads_to_5():
    """yfinance 4 位港股 → tushare 5 位"""
    code, mtype = ts_src.to_ts_code({"yf_symbol": "0700.HK", "market": "HK"})
    assert code == "00700.HK"
    assert mtype == "HK"
    code, mtype = ts_src.to_ts_code({"yf_symbol": "5.HK", "market": "HK"})
    assert code == "00005.HK"


def test_to_ts_code_sh_swaps_suffix():
    """yfinance .SS → tushare .SH"""
    code, mtype = ts_src.to_ts_code({"yf_symbol": "600519.SS", "market": "SH"})
    assert code == "600519.SH"
    assert mtype == "A"


def test_to_ts_code_sz_keeps_suffix():
    code, mtype = ts_src.to_ts_code({"yf_symbol": "000001.SZ", "market": "SZ"})
    assert code == "000001.SZ"
    assert mtype == "A"


def test_to_ts_code_unsupported_market_raises():
    with pytest.raises(ts_src.TushareError, match="不支持"):
        ts_src.to_ts_code({"yf_symbol": "005930.KS", "market": "KR"})


# ── _df_normalize ────────────────────────────────────────
def test_df_normalize_basic():
    """tushare 长格式 (大写) → DataFrame 标准化（含 AdjFactor 默认 1.0）"""
    df = pd.DataFrame({
        "trade_date": ["20260103", "20260102"],  # 倒序
        "open": [100.0, 99.0],
        "high": [102.0, 100.5],
        "low": [98.0, 98.5],
        "close": [101.0, 100.0],
        "vol": [1000, 1100],
        "amount": [1.01e8, 1.10e8],
    })
    out = ts_src._df_normalize(df, adj=None)
    # 应该升序
    assert list(out.index) == sorted(out.index)
    # 列名标准化为大写
    assert "Open" in out.columns
    assert "Close" in out.columns
    assert "Volume" in out.columns
    # 缺 AdjFactor 时默认 1.0
    assert all(out["AdjFactor"] == 1.0)


def test_df_normalize_with_adj_factor():
    df = pd.DataFrame({
        "trade_date": ["20260102", "20260103"],
        "open": [99, 100],
        "high": [100, 102],
        "low": [98, 99],
        "close": [100, 101],
        "vol": [1000, 1100],
        "amount": [1e8, 1e8],
    })
    adj = pd.DataFrame({
        "trade_date": ["20260102", "20260103"],
        "adj_factor": [1.5, 1.5],
    })
    out = ts_src._df_normalize(df, adj=adj)
    assert all(out["AdjFactor"] == 1.5)


def test_df_normalize_empty_returns_empty():
    out = ts_src._df_normalize(pd.DataFrame(), adj=None)
    assert out.empty


def test_df_normalize_adj_ffills():
    """adj_factor 仅在某些日期存在时，应用 ffill 填充缺失日"""
    df = pd.DataFrame({
        "trade_date": ["20260102", "20260103", "20260104"],
        "open": [99, 100, 101],
        "high": [100, 102, 103],
        "low": [98, 99, 100],
        "close": [100, 101, 102],
        "vol": [1000, 1100, 1200],
        "amount": [1e8, 1e8, 1e8],
    })
    adj = pd.DataFrame({
        "trade_date": ["20260102"],   # 仅 02 一天
        "adj_factor": [2.0],
    })
    out = ts_src._df_normalize(df, adj=adj)
    # 三天都应是 2.0（ffill）
    assert all(out["AdjFactor"] == 2.0)


# ── health_check（不联网） ────────────────────────────────
def test_health_check_no_token(monkeypatch):
    """无 TUSHARE_TOKEN 时返回 False + 友好提示"""
    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)
    ok, msg = ts_src.health_check()
    assert not ok
    assert "TUSHARE_TOKEN" in msg or "未设置" in msg or "未安装" in msg
