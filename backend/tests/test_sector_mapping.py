"""
sector_mapping 单测
==================
覆盖三类输入来源：
  1. 中文复合分类（config.py 风格："半导体/HBM"）
  2. yfinance 英文（"Semiconductors", "Utilities - Regulated Electric"）
  3. tushare 中文行业（"半导体" / "通信设备" / "新型电力"）
"""
import sys
from pathlib import Path

# backend/tests/ → backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sector_mapping import (  # noqa: E402
    classify_sector,
    filter_by_supertrends,
    list_supertrends_meta,
    SUPERTRENDS,
)


# ── classify_sector：基本三类输入 ───────────────────────────
def test_chinese_composite_semi_hbm():
    """半导体/HBM 应同时命中 semi 和 ai_compute"""
    assert classify_sector("半导体/HBM") == {"semi", "ai_compute"}


def test_chinese_composite_semi_ai():
    assert classify_sector("半导体/AI") == {"semi", "ai_compute"}


def test_chinese_composite_optical_laser():
    assert classify_sector("光通信/激光") == {"optical"}


def test_yfinance_semiconductors():
    assert classify_sector("Semiconductors") == {"semi"}


def test_yfinance_semi_equipment():
    assert classify_sector("Semiconductor Equipment & Materials") == {"semi"}


def test_yfinance_utilities_regulated():
    assert classify_sector("Utilities - Regulated Electric") == {"datacenter"}


def test_tushare_semi():
    assert classify_sector("半导体") == {"semi"}


def test_tushare_optical_keyword_in_compound():
    """tushare 没有"光通信"字段，但中文复合 "光通信/激光" 这条要稳"""
    assert classify_sector("光通信") == {"optical"}


def test_tushare_new_power():
    assert classify_sector("新型电力") == {"datacenter"}


# ── 边界 ─────────────────────────────────────────────────
def test_none_returns_empty():
    assert classify_sector(None) == set()


def test_empty_string_returns_empty():
    assert classify_sector("") == set()
    assert classify_sector("   ") == set()


def test_unknown_returns_empty():
    assert classify_sector("未知") == set()
    assert classify_sector("Real Estate") == set()


# ── conservative：避免误伤 ────────────────────────────────
def test_telecom_equipment_does_not_match_optical():
    """tushare "通信设备" 是上层概念（含中兴/烽火），不应自动归 optical"""
    assert "optical" not in classify_sector("通信设备")


def test_communication_services_not_optical():
    """yfinance "Communication Services" 是大类，不应误判"""
    assert classify_sector("Communication Services") == set()


# ── 大小写 ───────────────────────────────────────────────
def test_case_insensitive_english():
    assert classify_sector("SEMICONDUCTORS") == {"semi"}
    assert classify_sector("optical Networks") == {"optical"}


# ── filter_by_supertrends ────────────────────────────────
def test_filter_by_supertrends_basic():
    items = [
        {"ticker": "NVDA", "sector": "Semiconductors"},
        {"ticker": "AAPL", "sector": "Consumer Electronics"},
        {"ticker": "AAOI", "sector": "光通信/激光"},
        {"ticker": "MU",   "sector": "半导体/HBM"},
    ]
    out = filter_by_supertrends(items, ["semi"])
    tickers = sorted(it["ticker"] for it in out)
    assert tickers == ["MU", "NVDA"]


def test_filter_by_supertrends_or_relationship():
    items = [
        {"ticker": "AAOI", "sector": "光通信/激光"},
        {"ticker": "NVDA", "sector": "Semiconductors"},
        {"ticker": "AAPL", "sector": "Consumer Electronics"},
    ]
    out = filter_by_supertrends(items, ["semi", "optical"])
    tickers = sorted(it["ticker"] for it in out)
    assert tickers == ["AAOI", "NVDA"]


def test_filter_by_supertrends_empty_wanted_returns_all():
    items = [{"ticker": "X"}, {"ticker": "Y"}]
    assert len(filter_by_supertrends(items, [])) == 2


def test_filter_uses_industry_when_sector_missing():
    """tushare CN 池的 sector/industry 都填的同一字段；验证 industry 也能匹配"""
    items = [
        {"ticker": "600171.SH", "sector": None, "industry": "半导体"},
    ]
    out = filter_by_supertrends(items, ["semi"])
    assert len(out) == 1


# ── meta ─────────────────────────────────────────────────
def test_list_supertrends_meta_contract():
    meta = list_supertrends_meta()
    assert len(meta) == len(SUPERTRENDS)
    for m in meta:
        assert "id" in m and "name" in m
        assert m["id"] in SUPERTRENDS
