#!/usr/bin/env python3
"""公司档案(F10)：给 A股补 top10Hold(前十大股东持股合计%) + esg(华证ESG评级)，写回 data.js
================================================================================
  - get_stock_shareholders → 前十大流通股东持股比例合计（多日期取首个非空=最新）
  - get_esg_data → 华证ESG评级（多机构，取华证；首个非空行）
只做 A股 SH/SZ（iFinD F10 最全）；US/HK 留后续。缺才填。认证读 ~/.claude.json。
用法：python enrich_profile.py [--only SH,SZ] [--limit N] [--dry-run]
"""
from __future__ import annotations
import argparse, sys, time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
import enrich_valuation as E
from refresh_data_js import parse_data_js, write_data_js

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"


def _rows(md: str):
    return [l for l in md.splitlines() if l.strip().startswith("|")]

def _answer(res):
    import json
    r = res.get("result", {})
    txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
    try:
        return json.loads(txt).get("data", {}).get("answer", "") if txt.strip().startswith("{") else txt
    except Exception:
        return txt


def parse_top10(md: str) -> dict:
    """前十大股东持股合计（多日期，首个非空即最新）→ {code: pct}"""
    import re
    out = {}
    lines = _rows(md)
    if not lines: return out
    header = [c.strip() for c in lines[0].strip("|").split("|")]
    ci = next((i for i, h in enumerate(header) if "持股比例合计" in h or ("前十大" in h and "比例" in h)), None)
    if ci is None: return out
    code_re = re.compile(r"(\d{6}\.(?:SH|SZ))", re.I)
    for l in lines[1:]:
        if set(l.strip()) <= {"|", "-", " "}: continue
        m = code_re.search(l)
        if not m: continue
        code = m.group(1).upper()
        if code in out: continue
        cells = [c.strip() for c in l.strip("|").split("|")]
        if ci < len(cells):
            v = cells[ci].replace(",", "").strip()
            try:
                fv = float(v)
                if fv > 0: out[code] = round(fv, 2)
            except ValueError:
                pass
    return out

def parse_esg(md: str) -> dict:
    """华证ESG评级（多机构列，取华证；首个非空行）→ {code: 'AA'}"""
    import re
    out = {}
    lines = _rows(md)
    if not lines: return out
    header = [c.strip() for c in lines[0].strip("|").split("|")]
    ci = next((i for i, h in enumerate(header) if "华证ESG评级" in h), None)
    if ci is None:  # 退而取任一 ESG 列
        ci = next((i for i, h in enumerate(header) if "ESG评级" in h), None)
    if ci is None: return out
    code_re = re.compile(r"(\d{6}\.(?:SH|SZ))", re.I)
    for l in lines[1:]:
        if set(l.strip()) <= {"|", "-", " "}: continue
        m = code_re.search(l)
        if not m: continue
        code = m.group(1).upper()
        if code in out: continue
        cells = [c.strip() for c in l.strip("|").split("|")]
        if ci < len(cells):
            v = cells[ci].strip()
            if v and re.fullmatch(r"[A-D]{1,3}", v):  # AAA/AA/A/BBB...
                out[code] = v
    return out

def ifind_batch(codes, url, auth, tool, query, parser):
    sid = [None]
    E._ifind_call(url, auth, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "f10", "version": "1"}}, sid=sid)
    E._ifind_call(url, auth, "notifications/initialized", notify=True, sid=sid)
    q = "、".join(codes) + query
    res = E._ifind_call(url, auth, "tools/call", {"name": tool, "arguments": {"query": q}}, sid=sid)
    return parser(_answer(res))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="SH,SZ")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    markets = set(args.only.upper().split(","))
    url, auth, _g = E._load_keys()

    stocks, alerts = parse_data_js(DATA_JS)
    cn = [s for s in stocks if s.get("market") in markets and not s.get("isETF")]
    if args.limit: cn = cn[:args.limit]
    idx = {}
    for s in cn:
        code = E.data_ticker_to_ifind(s["ticker"])
        if code: idx[code] = s
    codes = list(idx.keys())
    filled = {"top10Hold": 0, "esg": 0}
    print(f"公司档案: A股 {len(codes)} 只（批5，两 tool）")

    for b in range(0, len(codes), 5):
        batch = codes[b:b+5]
        try:
            top = ifind_batch(batch, url, auth, "get_stock_shareholders", " 的前十大流通股东持股比例合计", parse_top10)
        except Exception as e:
            print(f"  [holders {b}] {e}", flush=True); top = {}
        try:
            esg = ifind_batch(batch, url, auth, "get_esg_data", " 的最新华证ESG评级", parse_esg)
        except Exception as e:
            print(f"  [esg {b}] {e}", flush=True); esg = {}
        for code, v in top.items():
            s = idx.get(code)
            if s is not None and s.get("top10Hold") is None:
                s["top10Hold"] = v; filled["top10Hold"] += 1
        for code, v in esg.items():
            s = idx.get(code)
            if s is not None and s.get("esg") is None:
                s["esg"] = v; filled["esg"] += 1
        if (b // 5) % 10 == 0: print(f"  ...{b+len(batch)}/{len(codes)}", flush=True)
        time.sleep(0.6)

    print("[填充] " + " ".join(f"{k}:{v}" for k, v in filled.items()))
    if args.dry_run:
        print("[dry-run] 未写回"); return
    write_data_js(DATA_JS, stocks, alerts)
    print(f"[DONE] 写出 {len(stocks)} 标的 → {DATA_JS}")


if __name__ == "__main__":
    main()
