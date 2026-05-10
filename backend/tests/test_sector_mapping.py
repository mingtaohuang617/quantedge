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


# ── 富途/tushare 实际板块名（v2 加宽关键词后）────────────
def test_telecom_equipment_matches_optical():
    """富途 "通讯设备" / tushare "通信设备" 是含光通信的上层板块。
    v2 加宽关键词后纳入 optical（接受一定噪音 — 用户可在 watchlist 编辑时手动校准）。
    """
    assert "optical" in classify_sector("通讯设备")
    assert "optical" in classify_sector("通信设备")
    assert "optical" in classify_sector("Communication Equipment")


def test_application_software_matches_ai_compute():
    """富途 "应用软件" / "软件基础设施" — AI 公司常被归到此板块"""
    assert "ai_compute" in classify_sector("应用软件")
    assert "ai_compute" in classify_sector("软件基础设施")
    assert "ai_compute" in classify_sector("Software - Application")
    assert "ai_compute" in classify_sector("Software - Infrastructure")


def test_digital_solutions_matches_ai_compute():
    """富途 HK 板块 "数码解决方案服务" — 含腾讯/美团/京东等 AI 应用公司"""
    assert "ai_compute" in classify_sector("数码解决方案服务")


def test_it_services_matches_ai_compute():
    assert "ai_compute" in classify_sector("信息技术服务")
    assert "ai_compute" in classify_sector("Information Technology Services")


def test_communication_services_still_not_optical():
    """yfinance "Communication Services" 是 broader 大类（不含 Equipment），仍不应误判到 optical"""
    assert "optical" not in classify_sector("Communication Services")
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


# ── strict / broad 模式差异 ───────────────────────────────
def test_strict_mode_excludes_telecom_equipment():
    """strict 模式下 "通讯设备" 不命中 optical（仅核心光通信关键词命中）"""
    assert classify_sector("通讯设备", mode="strict") == set()
    assert classify_sector("通信设备", mode="strict") == set()
    assert classify_sector("Communication Equipment", mode="strict") == set()


def test_broad_mode_includes_telecom_equipment():
    """broad 模式下 "通讯设备" 命中 optical（v1 行为）"""
    assert "optical" in classify_sector("通讯设备", mode="broad")
    assert "optical" in classify_sector("通信设备", mode="broad")
    assert "optical" in classify_sector("Communication Equipment", mode="broad")


def test_strict_mode_excludes_application_software():
    """strict 模式下纯软件公司不命中 ai_compute"""
    assert classify_sector("应用软件", mode="strict") == set()
    assert classify_sector("软件基础设施", mode="strict") == set()
    assert classify_sector("Software - Application", mode="strict") == set()
    assert classify_sector("数码解决方案服务", mode="strict") == set()


def test_broad_mode_includes_application_software():
    """broad 模式下软件类命中 ai_compute（v1 行为）"""
    assert "ai_compute" in classify_sector("应用软件", mode="broad")
    assert "ai_compute" in classify_sector("数码解决方案服务", mode="broad")


def test_strict_mode_keeps_pure_optical():
    """strict 模式下纯光通信关键词仍能命中"""
    assert "optical" in classify_sector("光通信", mode="strict")
    assert "optical" in classify_sector("光通信/激光", mode="strict")
    assert "optical" in classify_sector("Optical Networks", mode="strict")


def test_strict_mode_keeps_pure_ai():
    """strict 模式下明确 AI 关键词仍命中 ai_compute"""
    assert "ai_compute" in classify_sector("半导体/AI", mode="strict")
    assert "ai_compute" in classify_sector("半导体/HBM", mode="strict")


def test_strict_mode_keeps_semi_intact():
    """semi 自带就精准，strict 与 broad 行为一致（命中相同）"""
    cases = ["半导体", "Semiconductors", "Memory", "集成电路", "电子元件"]
    for c in cases:
        assert classify_sector(c, mode="strict") == classify_sector(c, mode="broad"), c


def test_strict_mode_excludes_loose_utilities():
    """strict 模式下 "公共事业" 不命中 datacenter（避免泛公用事业入池）"""
    assert classify_sector("公共事业", mode="strict") == set()
    assert "datacenter" in classify_sector("公共事业", mode="broad")


def test_invalid_mode_raises():
    import pytest
    with pytest.raises(ValueError):
        classify_sector("Semiconductors", mode="loose")


def test_default_mode_is_broad():
    """无 mode 参数时默认 broad（向后兼容）"""
    assert classify_sector("通讯设备") == classify_sector("通讯设备", mode="broad")


def test_filter_by_supertrends_strict_mode():
    """filter_by_supertrends 透传 mode 参数"""
    items = [
        {"ticker": "AAOI", "sector": "通讯设备"},          # broad 命中 optical
        {"ticker": "LITE", "sector": "光通信/激光"},       # strict + broad 都命中
    ]
    out_strict = filter_by_supertrends(items, ["optical"], mode="strict")
    out_broad = filter_by_supertrends(items, ["optical"], mode="broad")
    assert sorted(it["ticker"] for it in out_strict) == ["LITE"]
    assert sorted(it["ticker"] for it in out_broad) == ["AAOI", "LITE"]


# ── 价值型 SUPERTRENDS (v2.0) ────────────────────────────
def test_value_dividend_classify():
    """value_div 命中：能源/电信/公用事业关键词 — 中文 + 英文"""
    assert "value_div" in classify_sector("石油天然气")
    assert "value_div" in classify_sector("Oil & Gas Integrated")
    assert "value_div" in classify_sector("Utilities—Regulated Electric")
    # 公共事业广义命中（broad）
    assert "value_div" in classify_sector("公共事业", mode="broad")
    # 不应误命中其他赛道
    assert classify_sector("Semiconductors") == {"semi"}


def test_value_cyclical_classify():
    """value_cyclical 命中：银行/保险/化工/钢铁"""
    assert "value_cyclical" in classify_sector("银行业")
    assert "value_cyclical" in classify_sector("Banks - Regional")
    assert "value_cyclical" in classify_sector("化工原料")
    assert "value_cyclical" in classify_sector("Specialty Chemicals")


def test_value_consumer_classify():
    """value_consumer 命中：食品饮料"""
    assert "value_consumer" in classify_sector("食品饮料")
    assert "value_consumer" in classify_sector("白酒")
    assert "value_consumer" in classify_sector("Beverages—Non-Alcoholic")
    assert "value_consumer" in classify_sector("Packaged Foods")


def test_list_supertrends_meta_strategy_filter():
    """list_supertrends_meta(strategy=...) 按策略过滤"""
    growth = list_supertrends_meta(strategy="growth")
    value = list_supertrends_meta(strategy="value")
    growth_ids = {m["id"] for m in growth}
    value_ids = {m["id"] for m in value}
    assert growth_ids == {"ai_compute", "semi", "optical", "datacenter"}
    assert value_ids == {"value_div", "value_cyclical", "value_consumer"}
    # 默认（无参数）返回全部
    all_meta = list_supertrends_meta()
    assert len(all_meta) == 7
    # 每项都有 strategy 字段
    for m in all_meta:
        assert m["strategy"] in ("growth", "value")


def test_list_supertrends_meta_strategy_invalid():
    """无效 strategy 返回空 list（不抛错，前端容错）"""
    out = list_supertrends_meta(strategy="speculative")
    assert out == []
