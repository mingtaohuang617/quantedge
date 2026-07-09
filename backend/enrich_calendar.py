#!/usr/bin/env python3
"""财经日历快照：jin10 本周财经日历 → frontend/src/calendarSnapshot.json
================================================================================
生产只读静态数据，故离线烘焙。jin10 list_calendar 给当前自然周(周一~周日)事件，
滤 star>=2(去噪) + 未来/今日事件，存 [{t:标题, time, star, prev, cons, affect}]。
宏观看板「财经日历」卡读它。随每日管道刷新。用法：python enrich_calendar.py [--min-star 2]
"""
from __future__ import annotations
import argparse, json, os, sys, datetime as _dt
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
import enrich_valuation as E

OUT = BACKEND.parent / "frontend" / "src" / "calendarSnapshot.json"
CLAUDE_JSON = Path(os.path.expanduser("~/.claude.json"))


def fetch_calendar():
    d = json.load(open(CLAUDE_JSON, encoding="utf-8"))
    j = d["mcpServers"]["jin10"]
    url, auth = j["url"], j["headers"]["Authorization"]
    sid = [None]
    E._ifind_call(url, auth, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "cal", "version": "1"}}, sid=sid)
    E._ifind_call(url, auth, "notifications/initialized", notify=True, sid=sid)
    res = E._ifind_call(url, auth, "tools/call", {"name": "list_calendar", "arguments": {}}, sid=sid)
    r = res.get("result", {})
    sc = r.get("structuredContent")
    if not sc:
        txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
        try: sc = json.loads(txt)
        except Exception: sc = {}
    return sc.get("data", []) if isinstance(sc, dict) else (sc if isinstance(sc, list) else [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-star", type=int, default=3)
    args = ap.parse_args()
    events = fetch_calendar()
    now = _dt.datetime.now()
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)  # 今日起(含今天已过的时点)
    out = []
    for e in events:
        if not isinstance(e, dict) or not e.get("title"):
            continue
        try:
            star = int(e.get("star") or 0)
        except (TypeError, ValueError):
            star = 0
        if star < args.min_star:
            continue
        pt = (e.get("pub_time") or "").strip()
        try:
            dt = _dt.datetime.strptime(pt, "%Y-%m-%d %H:%M")
        except ValueError:
            continue
        if dt < day0:
            continue  # 只留今日及未来
        out.append({
            "t": e.get("title"),
            "time": pt,
            "star": star,
            "prev": e.get("previous"),
            "cons": e.get("consensus"),
        })
    out.sort(key=lambda x: x["time"])
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[DONE] {len(out)} 条(star>={args.min_star}, 今日起) → {OUT}")
    for e in out[:6]:
        print(f"  {'★'*e['star']} {e['time']} {e['t'][:30]}  前值{e['prev']}/预期{e['cons']}")


if __name__ == "__main__":
    main()
