"""
favorites 单测
==============
覆盖 load/save 往返 + 规范化（去重 / 去空白 / 排序 / 保大小写）+ 空默认 + 全量替换。
用 monkeypatch 把 FAVORITES_PATH 重定向到 tmp_path，避免污染真实数据。
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import favorites as fav  # noqa: E402


@pytest.fixture
def tmp_favorites(tmp_path, monkeypatch):
    fake = tmp_path / "favorites.json"
    monkeypatch.setattr(fav, "FAVORITES_PATH", fake)
    return fake


def test_load_missing_returns_empty(tmp_favorites):
    data = fav.load_favorites()
    assert data == {"version": 1, "tickers": [], "updated_at": None}


def test_save_then_load_roundtrip(tmp_favorites):
    saved = fav.save_favorites(["EWY", "TQQQ", "SOXL", "KORU"])
    assert saved["tickers"] == ["EWY", "KORU", "SOXL", "TQQQ"]  # 已排序
    assert saved["updated_at"] is not None
    reloaded = fav.load_favorites()
    assert reloaded["tickers"] == ["EWY", "KORU", "SOXL", "TQQQ"]
    assert reloaded["updated_at"] == saved["updated_at"]


def test_normalize_dedup_strip_sort(tmp_favorites):
    saved = fav.save_favorites([" NVDA ", "AAPL", "NVDA", "", "  ", "AAPL"])
    assert saved["tickers"] == ["AAPL", "NVDA"]


def test_normalize_preserves_case_and_suffix(tmp_favorites):
    # 港股 / A 股带后缀的 ticker key 必须原样往返（不可大小写折叠）
    saved = fav.save_favorites(["00700.HK", "600519.SH", "BABX"])
    assert saved["tickers"] == ["00700.HK", "600519.SH", "BABX"]


def test_save_is_full_replace(tmp_favorites):
    fav.save_favorites(["AAPL", "MSFT"])
    after = fav.save_favorites(["NVDA"])
    assert after["tickers"] == ["NVDA"]  # 旧集合被整体替换，非合并
    assert fav.load_favorites()["tickers"] == ["NVDA"]


def test_save_empty_clears(tmp_favorites):
    fav.save_favorites(["AAPL"])
    after = fav.save_favorites([])
    assert after["tickers"] == []
    assert fav.load_favorites()["tickers"] == []


def test_load_corrupt_file_returns_empty(tmp_favorites):
    tmp_favorites.write_text("{not valid json", encoding="utf-8")
    assert fav.load_favorites()["tickers"] == []


def test_save_writes_atomically_no_tmp_left(tmp_favorites):
    fav.save_favorites(["AAPL"])
    assert tmp_favorites.exists()
    assert not tmp_favorites.with_suffix(".json.tmp").exists()
    # 文件内容是合法 JSON
    on_disk = json.loads(tmp_favorites.read_text(encoding="utf-8"))
    assert on_disk["tickers"] == ["AAPL"]
