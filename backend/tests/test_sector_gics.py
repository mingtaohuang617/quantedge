"""sector_gics 纯函数测试 —— 用例取自真实 data.js sector 串 + yfinance 英文。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sector_gics import (  # noqa: E402
    classify_gics, GICS_SECTORS,
    IT, COMM, DISC, STAPLES, HEALTH, FIN, INDU, ENERGY, MAT, UTIL, RE, OTHER,
)


# ── data.js 美股中文前缀式 ────────────────────────────
def test_us_cn_prefix():
    assert classify_gics("科技/Semiconductors") == IT
    assert classify_gics("科技/Software - Application") == IT
    assert classify_gics("科技/Communication Equipment") == IT  # 前缀优先，不误判 COMM
    assert classify_gics("通信服务/Internet Content & Information") == COMM
    assert classify_gics("消费/必需品/Beverages - Non-Alcoholic") == STAPLES
    assert classify_gics("消费/必需品/Discount Stores") == STAPLES
    assert classify_gics("消费/周期/Internet Retail") == DISC
    assert classify_gics("消费/周期/Auto Manufacturers") == DISC
    assert classify_gics("医疗健康/Drug Manufacturers - General") == HEALTH
    assert classify_gics("公用事业/Utilities - Regulated Electric") == UTIL
    assert classify_gics("工业/Specialty Business Services") == INDU
    assert classify_gics("金融/Credit Services") == FIN
    assert classify_gics("能源/Oil & Gas E&P") == ENERGY
    assert classify_gics("基础材料/Specialty Chemicals") == MAT
    assert classify_gics("房地产/Real Estate Services") == RE


# ── 主题/配置标签 ─────────────────────────────────────
def test_thematic_labels():
    assert classify_gics("航天/国防") == INDU
    assert classify_gics("白酒/消费") == STAPLES
    assert classify_gics("半导体/HBM") == IT
    assert classify_gics("半导体/存储") == IT
    assert classify_gics("光通信/激光") == IT
    assert classify_gics("新能源/动力电池") == INDU
    assert classify_gics("家电/智能制造") == DISC
    assert classify_gics("银行/金融") == FIN


# ── yfinance 英文（A股/港股回补）──────────────────────
def test_yfinance_english():
    assert classify_gics("Consumer Defensive", "Beverages - Wineries & Distilleries") == STAPLES
    assert classify_gics("Financial Services", "Banks - Diversified") == FIN
    assert classify_gics("Communication Services", "Internet Content & Information") == COMM
    assert classify_gics("Consumer Cyclical", "Furnishings, Fixtures & Appliances") == DISC
    assert classify_gics("Technology", "Semiconductors") == IT
    assert classify_gics("Healthcare", "Drug Manufacturers - Specialty & Generic") == HEALTH
    assert classify_gics("Basic Materials", "Steel") == MAT
    assert classify_gics("Real Estate", "Real Estate - Development") == RE


# ── 指数标签 / 空 → 其他 ──────────────────────────────
def test_index_labels_and_empty_fallback():
    assert classify_gics("沪深300") == OTHER
    assert classify_gics("恒生指数") == OTHER
    assert classify_gics("恒生科技") == OTHER
    assert classify_gics("纳斯达克100") == OTHER
    assert classify_gics(None) == OTHER
    assert classify_gics("") == OTHER
    assert classify_gics("   ") == OTHER


def test_output_always_valid_bucket():
    for s in ["科技/X", "随便瞎写的东西", "Technology", None, "恒生指数"]:
        assert classify_gics(s) in GICS_SECTORS + [OTHER]
