"""
stock_gene 单测
==============
覆盖：
  - schema v1 → v2 自动迁移
  - CRUD（add / update / remove）
  - 多 list 管理（add_list / move_item / delete_list 自动级联）
  - 评分历史追写（_append_history + 去重）
  - 评分变化预警 get_alerts()
  - import / export 含 lists v2 兼容

所有 IO 重定向到 tmp_path 避免污染真实数据。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import stock_gene as sg  # noqa: E402


@pytest.fixture
def tmp_sg(tmp_path, monkeypatch):
    fake_path = tmp_path / "stock_gene.json"
    monkeypatch.setattr(sg, "WATCHLIST_PATH", fake_path)
    yield fake_path


# ── 持久化 & schema 迁移 ───────────────────────────────────
def test_load_empty_returns_v2_default(tmp_sg):
    data = sg.load_watchlist()
    assert data["version"] == 2
    assert data["items"] == []
    assert len(data["lists"]) == 1
    assert data["lists"][0]["id"] == "default"


def test_v1_data_auto_migrates_to_v2(tmp_sg):
    """旧 v1 schema：items 没有 list_id，lists 不存在 → 自动迁移"""
    v1 = {
        "version": 1,
        "items": [
            {"ticker": "AAPL", "name": "Apple", "market": "US"},
            {"ticker": "MSFT", "name": "Microsoft", "market": "US"},
        ],
    }
    sg.save_watchlist(v1)
    # 再加载会触发迁移
    data = sg.load_watchlist()
    assert data["version"] == 2
    assert len(data["lists"]) == 1
    assert data["lists"][0]["id"] == "default"
    # 所有 items 都被赋 list_id="default"
    for it in data["items"]:
        assert it["list_id"] == "default"


def test_v2_data_preserved_on_load(tmp_sg):
    """已是 v2 时再 load 不会丢字段"""
    v2 = {
        "version": 2,
        "lists": [
            {"id": "default", "name": "默认", "color": "indigo"},
            {"id": "core", "name": "核心仓", "color": "emerald"},
        ],
        "items": [{"ticker": "NVDA", "list_id": "core"}],
    }
    sg.save_watchlist(v2)
    data = sg.load_watchlist()
    assert len(data["lists"]) == 2
    assert data["items"][0]["list_id"] == "core"


def test_orphan_item_normalized_to_default(tmp_sg):
    """item.list_id 指向不存在的 list → 自动归 default"""
    bad = {
        "version": 2,
        "lists": [{"id": "default", "name": "默认", "color": "indigo"}],
        "items": [{"ticker": "GHOST", "list_id": "list-that-was-deleted"}],
    }
    sg.save_watchlist(bad)
    data = sg.load_watchlist()
    assert data["items"][0]["list_id"] == "default"


# ── add / update / remove ────────────────────────────────
def test_add_to_watchlist_basic(tmp_sg):
    item = sg.add_to_watchlist(
        "aapl", name="Apple", market="US", sector="Technology",
        tags=["核心仓"], notes="长持",
    )
    assert item["ticker"] == "AAPL"          # 自动大写
    assert item["name"] == "Apple"
    assert item["list_id"] == "default"
    assert item["tags"] == ["核心仓"]
    assert item["notes"] == "长持"
    assert "added_at" in item


def test_add_empty_ticker_raises(tmp_sg):
    with pytest.raises(ValueError, match="ticker"):
        sg.add_to_watchlist("   ")


def test_add_updates_existing_metadata(tmp_sg):
    sg.add_to_watchlist("AAPL", name="Apple")
    # 第二次 add 应更新而非新增
    sg.add_to_watchlist("AAPL", name="Apple Inc.", sector="Technology")
    data = sg.load_watchlist()
    assert len(data["items"]) == 1
    assert data["items"][0]["name"] == "Apple Inc."
    assert data["items"][0]["sector"] == "Technology"


def test_add_with_invalid_list_id_falls_back(tmp_sg):
    """不存在的 list_id 自动降级到 default"""
    item = sg.add_to_watchlist("AAPL", list_id="nonexistent-list")
    assert item["list_id"] == "default"


def test_remove_from_watchlist(tmp_sg):
    sg.add_to_watchlist("AAPL")
    sg.add_to_watchlist("MSFT")
    assert sg.remove_from_watchlist("AAPL") is True
    data = sg.load_watchlist()
    assert [it["ticker"] for it in data["items"]] == ["MSFT"]


def test_remove_nonexistent_returns_false(tmp_sg):
    assert sg.remove_from_watchlist("NOPE") is False


def test_update_item(tmp_sg):
    sg.add_to_watchlist("AAPL")
    updated = sg.update_item("AAPL", notes="更新后的备注", tags=["新标签"])
    assert updated["notes"] == "更新后的备注"
    assert updated["tags"] == ["新标签"]


def test_update_nonexistent_returns_none(tmp_sg):
    assert sg.update_item("NOPE", notes="x") is None


# ── List CRUD ─────────────────────────────────────────────
def test_add_list_basic(tmp_sg):
    new = sg.add_list("核心仓", color="emerald")
    assert new["name"] == "核心仓"
    assert new["color"] == "emerald"
    assert new["id"]  # 自动生成
    lists = sg.list_lists()
    assert len(lists) == 2  # default + 核心仓


def test_add_list_unique_id_on_collision(tmp_sg):
    """slug 撞名时自动加 -N 后缀"""
    a = sg.add_list("Core Position")
    b = sg.add_list("Core Position")
    assert a["id"] != b["id"]


def test_add_list_empty_name_raises(tmp_sg):
    with pytest.raises(ValueError, match="名称不能为空"):
        sg.add_list("   ")


def test_update_list(tmp_sg):
    new = sg.add_list("旧名", color="slate")
    updated = sg.update_list(new["id"], name="新名", color="emerald")
    assert updated["name"] == "新名"
    assert updated["color"] == "emerald"


def test_update_unknown_list_returns_none(tmp_sg):
    assert sg.update_list("no-such-list", name="x") is None


def test_delete_list_moves_items_to_default(tmp_sg):
    new = sg.add_list("temp")
    sg.add_to_watchlist("AAPL", list_id=new["id"])
    sg.add_to_watchlist("MSFT", list_id=new["id"])
    moved = sg.delete_list(new["id"])
    assert moved == 2
    data = sg.load_watchlist()
    assert all(it["list_id"] == "default" for it in data["items"])
    assert all(l["id"] != new["id"] for l in data["lists"])


def test_delete_default_list_raises(tmp_sg):
    with pytest.raises(ValueError, match="默认.*不能删除"):
        sg.delete_list("default")


def test_move_item(tmp_sg):
    new = sg.add_list("speculative")
    sg.add_to_watchlist("AAPL")
    moved = sg.move_item("AAPL", new["id"])
    assert moved["list_id"] == new["id"]


def test_move_to_unknown_list_raises(tmp_sg):
    sg.add_to_watchlist("AAPL")
    with pytest.raises(ValueError, match="未知 list_id"):
        sg.move_item("AAPL", "no-such-list")


def test_move_unknown_ticker_returns_none(tmp_sg):
    new = sg.add_list("temp")
    assert sg.move_item("NOPE", new["id"]) is None


# ── 评分历史 ──────────────────────────────────────────────
def test_append_history_basic(tmp_sg):
    sg.add_to_watchlist("AAPL")
    data = sg.load_watchlist()
    item = data["items"][0]
    fake_result = {
        "score": 3, "max_score": 8, "available": 7,
        "checked_at": "2026-05-17T10:00:00Z",
        "verdict": {"level": "weak"},
    }
    sg._append_history(item, "trend", fake_result)
    assert len(item["score_history"]) == 1
    entry = item["score_history"][0]
    assert entry["engine"] == "trend"
    assert entry["score"] == 3
    assert entry["verdict_level"] == "weak"


def test_append_history_dedupes_same_minute(tmp_sg):
    sg.add_to_watchlist("AAPL")
    data = sg.load_watchlist()
    item = data["items"][0]
    r1 = {"score": 3, "max_score": 8, "checked_at": "2026-05-17T10:00:00Z",
          "verdict": {"level": "weak"}, "available": 8}
    r2 = {"score": 4, "max_score": 8, "checked_at": "2026-05-17T10:00:30Z",  # 同分钟
          "verdict": {"level": "neutral"}, "available": 8}
    sg._append_history(item, "trend", r1)
    sg._append_history(item, "trend", r2)
    # 同 engine + 同分钟 → 覆盖最后一条
    assert len(item["score_history"]) == 1
    assert item["score_history"][0]["score"] == 4


def test_append_history_cap_limits_size(tmp_sg):
    sg.add_to_watchlist("AAPL")
    data = sg.load_watchlist()
    item = data["items"][0]
    # 加 70 条，应被截到 60
    for i in range(70):
        fake = {"score": i % 8, "max_score": 8,
                "checked_at": f"2026-01-{(i % 28) + 1:02d}T10:{i:02d}:00Z",
                "verdict": {"level": "neutral"}, "available": 8}
        sg._append_history(item, "trend", fake, cap=60)
    assert len(item["score_history"]) == 60


# ── get_alerts ────────────────────────────────────────────
def test_get_alerts_detects_score_drop(tmp_sg):
    # 用相对日期，避免硬编码日期随时间滑出 get_alerts 的 days 窗口（时间炸弹）
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    sg.add_to_watchlist("AAPL")
    data = sg.load_watchlist()
    item = data["items"][0]
    item["score_history"] = [
        {"engine": "trend", "checked_at": (now - timedelta(days=14)).isoformat(),
         "score": 5, "max_score": 8, "verdict_level": "moderate"},
        {"engine": "trend", "checked_at": (now - timedelta(days=7)).isoformat(),
         "score": 3, "max_score": 8, "verdict_level": "weak"},
    ]
    sg.save_watchlist(data)
    alerts = sg.get_alerts(days=30)
    assert len(alerts) == 1
    assert alerts[0]["ticker"] == "AAPL"
    assert alerts[0]["from_score"] == 5
    assert alerts[0]["to_score"] == 3
    assert alerts[0]["delta"] == -2
    assert alerts[0]["from_verdict"] == "moderate"
    assert alerts[0]["to_verdict"] == "weak"


def test_get_alerts_filters_min_delta(tmp_sg):
    # 同上：相对日期，避免时间炸弹
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    sg.add_to_watchlist("AAPL")
    data = sg.load_watchlist()
    item = data["items"][0]
    item["score_history"] = [
        {"engine": "trend", "checked_at": (now - timedelta(days=14)).isoformat(),
         "score": 5, "max_score": 8, "verdict_level": "moderate"},
        # 仅 1 分差异
        {"engine": "trend", "checked_at": (now - timedelta(days=7)).isoformat(),
         "score": 4, "max_score": 8, "verdict_level": "neutral"},
    ]
    sg.save_watchlist(data)
    # min_delta=2 → 不算 alert
    alerts = sg.get_alerts(days=30, min_delta=2)
    assert alerts == []
    # min_delta=1 → 算
    alerts = sg.get_alerts(days=30, min_delta=1)
    assert len(alerts) == 1


def test_get_alerts_filters_by_age(tmp_sg):
    """超过 days 的不返回（基于 to_checked_at）"""
    from datetime import datetime, timedelta, timezone
    sg.add_to_watchlist("OLD")
    data = sg.load_watchlist()
    item = data["items"][0]
    old_date = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
    item["score_history"] = [
        {"engine": "trend", "checked_at": "2025-01-01T00:00:00Z", "score": 5, "max_score": 8},
        {"engine": "trend", "checked_at": old_date, "score": 2, "max_score": 8},
    ]
    sg.save_watchlist(data)
    alerts = sg.get_alerts(days=30)
    assert alerts == []


def test_get_alerts_sorted_desc(tmp_sg):
    """多 alerts 按 checked_at 倒序"""
    sg.add_to_watchlist("A")
    sg.add_to_watchlist("B")
    data = sg.load_watchlist()
    data["items"][0]["score_history"] = [
        {"engine": "trend", "checked_at": "2026-05-01T00:00:00Z", "score": 5, "max_score": 8},
        {"engine": "trend", "checked_at": "2026-05-10T00:00:00Z", "score": 3, "max_score": 8},
    ]
    data["items"][1]["score_history"] = [
        {"engine": "trend", "checked_at": "2026-05-01T00:00:00Z", "score": 5, "max_score": 8},
        {"engine": "trend", "checked_at": "2026-05-17T00:00:00Z", "score": 2, "max_score": 8},
    ]
    sg.save_watchlist(data)
    alerts = sg.get_alerts(days=60)
    assert len(alerts) == 2
    assert alerts[0]["ticker"] == "B"   # 更新的在前
    assert alerts[1]["ticker"] == "A"


# ── import / export ──────────────────────────────────────
def test_export_contains_lists_and_items(tmp_sg):
    sg.add_list("core", color="emerald")
    sg.add_to_watchlist("AAPL", list_id="core")
    payload = sg.export_data()
    assert payload["version"] == 2
    assert any(l["id"] == "core" for l in payload["lists"])
    assert any(it["ticker"] == "AAPL" for it in payload["items"])
    assert "exported_at" in payload


def test_import_merge_preserves_existing(tmp_sg):
    sg.add_to_watchlist("AAPL")
    payload = {
        "items": [{"ticker": "MSFT"}],
        "lists": [{"id": "default", "name": "默认", "color": "indigo"}],
    }
    res = sg.import_data(payload, mode="merge")
    assert res["items_added"] == 1
    assert res["items_skipped"] == 0
    data = sg.load_watchlist()
    assert {it["ticker"] for it in data["items"]} == {"AAPL", "MSFT"}


def test_import_merge_skips_duplicate(tmp_sg):
    sg.add_to_watchlist("AAPL")
    payload = {"items": [{"ticker": "AAPL", "name": "Apple"}]}
    res = sg.import_data(payload, mode="merge")
    assert res["items_added"] == 0
    assert res["items_skipped"] == 1


def test_import_replace_clears_existing(tmp_sg):
    sg.add_to_watchlist("AAPL")
    payload = {
        "items": [{"ticker": "MSFT"}, {"ticker": "GOOGL"}],
        "lists": [
            {"id": "default", "name": "默认", "color": "indigo"},
            {"id": "core", "name": "核心", "color": "emerald"},
        ],
    }
    res = sg.import_data(payload, mode="replace")
    assert res["items_added"] == 2
    data = sg.load_watchlist()
    assert {it["ticker"] for it in data["items"]} == {"MSFT", "GOOGL"}
    # lists 也被替换（但 default 始终保留）
    assert any(l["id"] == "core" for l in data["lists"])


def test_import_invalid_mode_raises(tmp_sg):
    with pytest.raises(ValueError, match="mode"):
        sg.import_data({"items": []}, mode="invalid")


def test_import_invalid_payload_raises(tmp_sg):
    with pytest.raises(ValueError, match="dict"):
        sg.import_data("not a dict", mode="merge")
    with pytest.raises(ValueError, match="list"):
        sg.import_data({"items": "not a list"}, mode="merge")
