#!/usr/bin/env python3
"""每标的资讯快照：抓 top-N 财经新闻 → frontend/src/newsSnapshot.json
================================================================================
生产只读静态数据，故资讯离线烘焙：iFinD news search_news 按标的名搜近 N 天新闻，
存 {ticker: [{t:标题, d:日期, u:URL}]}。前端详情「相关资讯」卡读它。定时刷新。
用法：python enrich_news.py [--days 30] [--size 3] [--limit N] [--only US,SH...]
"""
from __future__ import annotations
import argparse, json, os, sys, time, datetime as _dt
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
import enrich_valuation as E
from refresh_data_js import parse_data_js

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"
OUT = BACKEND.parent / "frontend" / "src" / "newsSnapshot.json"
CLAUDE_JSON = Path(os.path.expanduser("~/.claude.json"))


def _news_conf():
    d = json.load(open(CLAUDE_JSON, encoding="utf-8"))
    s = d["mcpServers"]["ifind-news"]
    return s["url"], s["headers"]["Authorization"]


def _load_cn_names() -> dict:
    """从 frontend/src/standalone.js 解析 STOCK_CN_NAMES（ticker→中文名，覆盖美股）。
    iFinD 新闻是中文源，美股必须用中文名搜（英文名搜不到）。"""
    import re
    src = (BACKEND.parent / "frontend" / "src" / "standalone.js").read_text(encoding="utf-8")
    m = re.search(r"STOCK_CN_NAMES\s*=\s*\{", src)
    if not m:
        return {}
    # 从 { 起匹配到对应 }（简单深度计数）
    i = m.end() - 1
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{": depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                body = src[i + 1:j]; break
    else:
        return {}
    return {k: v for k, v in re.findall(r'([A-Za-z0-9.]+)\s*:\s*"([^"]+)"', body)}


def fetch_news(name: str, url: str, auth: str, size: int, t0: str, t1: str) -> list:
    sid = [None]
    E._ifind_call(url, auth, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "news", "version": "1"}}, sid=sid)
    E._ifind_call(url, auth, "notifications/initialized", notify=True, sid=sid)
    res = E._ifind_call(url, auth, "tools/call", {"name": "search_news", "arguments": {"query": name, "size": size, "time_start": t0, "time_end": t1}}, sid=sid)
    r = res.get("result", {})
    txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
    try:
        data = json.loads(txt).get("data")
        if isinstance(data, dict):          # 双层嵌套：{data:{data:"[...]"}}
            data = data.get("data")
        if isinstance(data, str):
            data = json.loads(data)
    except Exception:
        return []
    out = []
    if isinstance(data, list):
        for it in data:
            if isinstance(it, dict) and it.get("资讯标题"):
                out.append({"t": it.get("资讯标题"), "d": it.get("日期"), "u": it.get("URL")})
    return out[:size]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--size", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default=None, help="市场过滤，逗号分隔，如 SH,SZ")
    args = ap.parse_args()
    url, auth = _news_conf()
    cn_names = _load_cn_names()
    # 日期范围（不用 Date.now：从最新价日期推；这里用 data.js 无日期，简单用系统日）
    t1 = _dt.date.today().isoformat()
    t0 = (_dt.date.today() - _dt.timedelta(days=args.days)).isoformat()

    stocks, _ = parse_data_js(DATA_JS)
    targets = [s for s in stocks if not s.get("isETF")]
    if args.only:
        mk = set(args.only.upper().split(","))
        targets = [s for s in targets if s.get("market") in mk]
    if args.limit:
        targets = targets[:args.limit]

    snap = {}
    if OUT.exists():
        try: snap = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception: snap = {}

    print(f"资讯抓取 {len(targets)} 只（{t0}~{t1}，size {args.size}）")
    ok = 0
    for i, s in enumerate(targets, 1):
        # 美股/日韩用中文名搜（iFinD 中文源）；A股/港股 data.js 名本就是中文
        name = cn_names.get(s["ticker"]) or s.get("name") or s["ticker"]
        try:
            items = fetch_news(name, url, auth, args.size, t0, t1)
        except Exception as e:
            print(f"  [{s['ticker']} {name}] {e}", flush=True); items = []
        if items:
            snap[s["ticker"]] = items; ok += 1
        if i % 25 == 0:
            print(f"  ...{i}/{len(targets)}（命中 {ok}）", flush=True)
            OUT.write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")  # 中途落盘
        time.sleep(0.5)  # iFinD 2/秒
    OUT.write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[DONE] 命中 {ok}/{len(targets)}；写 {OUT}（{OUT.stat().st_size} bytes）")


if __name__ == "__main__":
    main()
