"""
anomaly_store — 关注股异动扫描结果持久化（本地 / Render 侧）
============================================================
与 frontend/api/_lib/anomalyScan.js 同契约：GET 读最近快照 / PUT 整快照替换。

持久化：backend/anomaly_scan.json
  { "version":1, "scanned_at":"ISO|None", "time_range":7,
    "items":[...], "skipped":[...], "errors":[...] }

本地扫描脚本 futu_anomaly_scan.py 跑完写生产 KV（让生产监控页可见），
也可同时写这里供本地 dev 的监控页读取。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ANOMALY_PATH = Path(__file__).resolve().parent / "anomaly_scan.json"


def _empty() -> dict:
    return {"version": 1, "scanned_at": None, "time_range": 7,
            "items": [], "skipped": [], "errors": []}


def load_scan() -> dict:
    if not ANOMALY_PATH.exists():
        return _empty()
    try:
        with open(ANOMALY_PATH, encoding="utf-8") as f:
            d = json.load(f)
        out = _empty()
        out["version"] = d.get("version", 1)
        out["scanned_at"] = d.get("scanned_at")
        out["time_range"] = d.get("time_range", 7)
        for k in ("items", "skipped", "errors"):
            v = d.get(k, [])
            out[k] = v if isinstance(v, list) else []
        return out
    except Exception:
        return _empty()


def save_scan(payload: dict) -> dict:
    payload = payload or {}
    data = {
        "version": 1,
        "scanned_at": payload.get("scanned_at")
        or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "time_range": payload.get("time_range", 7),
        "items": payload.get("items") if isinstance(payload.get("items"), list) else [],
        "skipped": payload.get("skipped") if isinstance(payload.get("skipped"), list) else [],
        "errors": payload.get("errors") if isinstance(payload.get("errors"), list) else [],
    }
    ANOMALY_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ANOMALY_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(ANOMALY_PATH)
    return data
