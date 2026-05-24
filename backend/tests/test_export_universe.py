"""test_export_universe — slim_item / process_file 行为单测

覆盖 backend/export_universe_to_frontend.py 的瘦身逻辑（PR #120 引入）：
  - slim_item: 剥 futu_code/is_derivative/空 sector/null marketCap
  - process_file: 读写 round-trip + 体积下降
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# backend/tests/ → backend/（与 test_sector_mapping.py 同模式，CI 上 cwd ≠ root）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from export_universe_to_frontend import (  # noqa: E402
    DROP_FIELDS,
    EMPTY_STRING_FIELDS,
    fmt_size,
    process_file,
    slim_item,
)


# ── slim_item ──────────────────────────────────────────────────────


class TestSlimItem:
    def test_完整_item_零剥离(self):
        item = {
            "ticker": "NVDA",
            "name": "NVIDIA",
            "sector": "Technology",
            "industry": "Semiconductors",
            "exchange": "NASDAQ",
            "market": "US",
            "marketCap": 3_000_000_000_000,
            "pe": 50.0,
            "pb": 35.0,
            "is_etf": False,
        }
        original = dict(item)
        n = slim_item(item)
        assert n == 0
        assert item == original

    def test_剥_DROP_FIELDS(self):
        item = {
            "ticker": "NVDA",
            "futu_code": "US.NVDA",
            "is_derivative": False,
        }
        n = slim_item(item)
        assert n == 2
        assert "futu_code" not in item
        assert "is_derivative" not in item
        assert item == {"ticker": "NVDA"}

    def test_剥空字符串字段(self):
        item = {
            "ticker": "BABA",
            "sector": "",
            "industry": "",
            "exchange": "NYSE",
            "market": "",
        }
        n = slim_item(item)
        # sector, industry, market 都是空字符串 → 剥（3 个）
        # exchange 是非空 → 保留
        assert n == 3
        assert "sector" not in item
        assert "industry" not in item
        assert "market" not in item
        assert item["exchange"] == "NYSE"

    def test_marketCap_None_剥(self):
        item = {"ticker": "X", "marketCap": None}
        n = slim_item(item)
        assert n == 1
        assert "marketCap" not in item

    def test_marketCap_0_剥(self):
        item = {"ticker": "X", "marketCap": 0}
        n = slim_item(item)
        assert n == 1
        assert "marketCap" not in item

    def test_marketCap_非零数值_保留(self):
        item = {"ticker": "X", "marketCap": 1.5}  # 即使很小也保留
        n = slim_item(item)
        assert n == 0
        assert item["marketCap"] == 1.5

    def test_sector_非空字符串_保留(self):
        item = {"ticker": "X", "sector": "Technology"}
        n = slim_item(item)
        assert n == 0
        assert item["sector"] == "Technology"

    def test_sector_为_None_保留(self):
        """sector=None 不剥（只剥空字符串），让 frontend `it.sector || ''` 处理"""
        item = {"ticker": "X", "sector": None}
        n = slim_item(item)
        assert n == 0
        assert item["sector"] is None

    def test_组合剥离(self):
        item = {
            "ticker": "STALE",
            "name": "Old Co",
            "futu_code": "US.STALE",
            "is_derivative": False,
            "sector": "",
            "industry": "",
            "exchange": "NYSE",
            "market": "",
            "marketCap": None,
            "pe": 10.0,
        }
        n = slim_item(item)
        assert n == 6  # 2 DROP + 3 空字符串 + 1 marketCap
        assert item == {
            "ticker": "STALE",
            "name": "Old Co",
            "exchange": "NYSE",
            "pe": 10.0,
        }

    def test_空_item(self):
        item = {}
        n = slim_item(item)
        assert n == 0
        assert item == {}


# ── process_file ────────────────────────────────────────────────────


class TestProcessFile:
    def test_读_处理_写_round_trip(self, tmp_path: Path):
        src = tmp_path / "universe_us.json"
        dst = tmp_path / "out.json"
        src.write_text(
            json.dumps(
                {
                    "items": [
                        {"ticker": "NVDA", "sector": "Tech", "futu_code": "X"},
                        {"ticker": "BABA", "marketCap": None, "is_derivative": False},
                    ],
                    "meta": {"count": 2},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        n_stripped, src_size, dst_size = process_file(src, dst)
        # NVDA 剥 futu_code (1), BABA 剥 marketCap + is_derivative (2)
        assert n_stripped == 3
        assert src_size > 0
        assert dst_size > 0
        # 不比较 src/dst size — 测试用 compact JSON 但 process_file 写 indent=2，
        # 实际 production 场景两边都是 indent=2 时瘦身才会显著减小
        # round-trip：dst 仍是合法 JSON 且 items 保留
        data = json.loads(dst.read_text(encoding="utf-8"))
        assert len(data["items"]) == 2
        assert data["items"][0]["ticker"] == "NVDA"
        assert "futu_code" not in data["items"][0]
        assert "is_derivative" not in data["items"][1]
        assert "marketCap" not in data["items"][1]
        assert data["meta"] == {"count": 2}  # 非 items 字段保留

    def test_缺_items_key_不抛(self, tmp_path: Path):
        src = tmp_path / "empty.json"
        dst = tmp_path / "out.json"
        src.write_text(json.dumps({"meta": {"count": 0}}), encoding="utf-8")
        n_stripped, _, _ = process_file(src, dst)
        assert n_stripped == 0
        data = json.loads(dst.read_text(encoding="utf-8"))
        assert data == {"meta": {"count": 0}}

    def test_items_为空数组(self, tmp_path: Path):
        src = tmp_path / "empty.json"
        dst = tmp_path / "out.json"
        src.write_text(json.dumps({"items": []}), encoding="utf-8")
        n_stripped, _, _ = process_file(src, dst)
        assert n_stripped == 0

    def test_src_不存在_raise(self, tmp_path: Path):
        src = tmp_path / "nope.json"
        dst = tmp_path / "out.json"
        with pytest.raises(FileNotFoundError):
            process_file(src, dst)

    def test_indent2_source_瘦身后体积下降(self, tmp_path: Path):
        """产线场景：source 也是 indent=2，瘦身后 dst < src（与 PR #120 实测数据一致）"""
        src = tmp_path / "in.json"
        dst = tmp_path / "out.json"
        # 模拟产线 source —— 多个 item 都带垃圾字段
        items = [
            {
                "ticker": f"T{i}",
                "name": f"Name {i}",
                "futu_code": f"US.T{i}",
                "is_derivative": False,
                "sector": "",
                "industry": "",
                "marketCap": None,
            }
            for i in range(50)
        ]
        src.write_text(
            json.dumps({"items": items}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        n_stripped, src_size, dst_size = process_file(src, dst)
        assert n_stripped == 50 * 5  # 每个 item 剥 5 个字段
        assert dst_size < src_size

    def test_中文字段保留_ensure_ascii_False(self, tmp_path: Path):
        src = tmp_path / "cn.json"
        dst = tmp_path / "out.json"
        src.write_text(
            json.dumps(
                {"items": [{"ticker": "600519.SH", "name": "贵州茅台", "sector": "白酒"}]},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        process_file(src, dst)
        # 写出来的 JSON 直接含中文字符（不是 \uXXXX 转义）
        raw = dst.read_text(encoding="utf-8")
        assert "贵州茅台" in raw
        assert "白酒" in raw


# ── fmt_size ────────────────────────────────────────────────────────


class TestFmtSize:
    def test_MB(self):
        assert fmt_size(2 * 1024 * 1024) == "2.00 MB"
        assert fmt_size(1024 * 1024) == "1.00 MB"

    def test_KB(self):
        assert fmt_size(2048) == "2.0 KB"
        assert fmt_size(1024) == "1.0 KB"

    def test_B(self):
        assert fmt_size(500) == "500 B"
        assert fmt_size(0) == "0 B"


# ── 常量回归 ────────────────────────────────────────────────────────


class TestConstants:
    def test_DROP_FIELDS_包含_futu_code_和_is_derivative(self):
        assert "futu_code" in DROP_FIELDS
        assert "is_derivative" in DROP_FIELDS

    def test_EMPTY_STRING_FIELDS_完整(self):
        assert set(EMPTY_STRING_FIELDS) == {"sector", "industry", "exchange", "market"}
