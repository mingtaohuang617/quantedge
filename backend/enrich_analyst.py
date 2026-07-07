#!/usr/bin/env python3
"""卖方共识：给 data.js 补 targetPrice / analystCount / buyRatio，写回 data.js
================================================================================
  - A股 SH/SZ → iFinD get_stock_summary（机构目标价综合值 + 评级家数分布）
  - 美股 US   → FMP price-target-consensus + grades-consensus
字段：targetPrice(本币综合目标价) analystCount(覆盖机构家数) buyRatio(买入占比 0-1)
策略：缺才填不覆盖；按需手动跑（月度级，卖方观点变化不快）。认证读 ~/.claude.json。

用法：
  python enrich_analyst.py                 # 全量 US + SH/SZ
  python enrich_analyst.py --only US --limit 5 --dry-run
"""
from __future__ import annotations
import argparse, json, os, re, sys, time, urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
from enrich_valuation import _ifind_call, _load_keys, data_ticker_to_ifind, DATA_JS
from refresh_data_js import parse_data_js, write_data_js

CLAUDE_JSON = Path(os.path.expanduser("~/.claude.json"))
FIELDS = ["targetPrice", "analystCount", "buyRatio"]


def _fmp_key():
    d = json.load(open(CLAUDE_JSON, encoding="utf-8"))
    return d["mcpServers"]["fmp"]["url"].split("apikey=")[1]


# ---------- FMP (US) ----------
def fmp_analyst(symbol: str, key: str) -> dict:
    out = {}
    def _get(ep):
        u = f"https://financialmodelingprep.com/stable/{ep}?symbol={symbol}&apikey={key}"
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
        return json.load(urllib.request.urlopen(req, timeout=30))
    try:
        row = _get("price-target-consensus")
        tc = row[0].get("targetConsensus") if row else None
        if isinstance(tc, (int, float)) and tc > 0:
            out["targetPrice"] = round(tc, 2)
    except Exception as e:
        print(f"  [FMP tgt {symbol}] {e}", flush=True)
    try:
        row = _get("grades-consensus")
        if row:
            g = row[0]
            tot = sum(int(g.get(k) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell"))
            if tot > 0:
                out["analystCount"] = tot
                out["buyRatio"] = round((int(g.get("strongBuy") or 0) + int(g.get("buy") or 0)) / tot, 3)
    except Exception as e:
        print(f"  [FMP grade {symbol}] {e}", flush=True)
    return out


# ---------- iFinD (A股) ----------
def _parse_astock_analyst(md: str) -> dict:
    """机构评级表（名前码后）→ {code: {targetPrice,analystCount,buyRatio}}。
    列：目标价(综合值)|评级机构家数|评级买入家数|评级增持家数|评级卖出家数。"""
    out = {}
    lines = [l for l in md.splitlines() if l.strip().startswith("|")]
    hi = None
    for i, l in enumerate(lines):
        if "目标价" in l and "家数" in l:
            hi = i; break
    if hi is None:
        return out
    header = [c.strip() for c in lines[hi].strip("|").split("|")]
    col = {}
    for i, h in enumerate(header):
        if "目标价" in h: col["t"] = i
        elif "机构家数" in h: col["n"] = i
        elif "买入家数" in h: col["b"] = i
        elif "增持家数" in h: col["a"] = i
    code_re = re.compile(r"(\d{6}\.(?:SH|SZ))", re.I)
    for l in lines[hi + 1:]:
        if set(l.strip()) <= {"|", "-", " "}: continue
        m = code_re.search(l)
        if not m: continue
        cells = [c.strip() for c in l.strip("|").split("|")]
        def g(k):
            i = col.get(k)
            if i is None or i >= len(cells): return None
            v = cells[i].replace(",", "").strip()
            try: return float(v)
            except ValueError: return None
        t, n, b, a = g("t"), g("n"), g("b") or 0, g("a") or 0
        rec = {}
        if t and t > 0: rec["targetPrice"] = round(t, 2)
        if n and n > 0:
            rec["analystCount"] = int(n)
            rec["buyRatio"] = round((b + a) / n, 3)
        if rec: out[m.group(1).upper()] = rec
    return out

def ifind_astock_analyst_batch(codes: list[str], url: str, auth: str) -> dict:
    sid = [None]
    _ifind_call(url, auth, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "analyst", "version": "1"}}, sid=sid)
    _ifind_call(url, auth, "notifications/initialized", notify=True, sid=sid)
    q = "、".join(codes) + " 的机构目标价综合值、评级机构家数、评级买入家数、评级增持家数"
    res = _ifind_call(url, auth, "tools/call", {"name": "get_stock_summary", "arguments": {"query": q}}, sid=sid)
    r = res.get("result", {})
    txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
    try:
        answer = json.loads(txt).get("data", {}).get("answer", "") if txt.strip().startswith("{") else txt
    except Exception:
        answer = txt
    return _parse_astock_analyst(answer)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="US / SH,SZ 组合")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    markets = set(args.only.upper().split(",")) if args.only else {"US", "SH", "SZ"}
    ifind_url, ifind_auth, _gurl = _load_keys()

    stocks, alerts = parse_data_js(DATA_JS)
    filled = {k: 0 for k in FIELDS}
    n_us = n_cn = 0

    def apply(s, rec):
        for k in FIELDS:
            if s.get(k) is None and rec.get(k) is not None:
                s[k] = rec[k]; filled[k] += 1

    # US via FMP
    if "US" in markets:
        fk = _fmp_key()
        us = [s for s in stocks if s.get("market") == "US" and not s.get("isETF")]
        if args.limit: us = us[:args.limit]
        print(f"US: FMP 分析师 {len(us)} 只")
        for i, s in enumerate(us, 1):
            apply(s, fmp_analyst(s["ticker"], fk)); n_us += 1
            if i % 25 == 0: print(f"  ...US {i}/{len(us)}", flush=True)
            time.sleep(0.1)

    # A股 via iFinD（批5）
    cn_markets = markets & {"SH", "SZ"}
    if cn_markets:
        cn = [s for s in stocks if s.get("market") in cn_markets and not s.get("isETF")]
        if args.limit: cn = cn[:args.limit]
        idx = {}
        for s in cn:
            code = data_ticker_to_ifind(s["ticker"])
            if code: idx[code] = s
        codes = list(idx.keys())
        print(f"A股: iFinD 分析师 {len(codes)} 只（批5）")
        for b in range(0, len(codes), 5):
            batch = codes[b:b+5]
            try:
                res = ifind_astock_analyst_batch(batch, ifind_url, ifind_auth)
            except Exception as e:
                print(f"  [iFinD batch {batch}] {e}", flush=True); res = {}
            for code, rec in res.items():
                if code in idx: apply(idx[code], rec)
            n_cn += len(batch)
            if (b // 5) % 10 == 0: print(f"  ...A股 {b+len(batch)}/{len(codes)}", flush=True)
            time.sleep(0.5)

    print(f"\n[统计] US {n_us} | A股 {n_cn}")
    print("[填充] " + " ".join(f"{k}:{v}" for k, v in filled.items()))
    if args.dry_run:
        print("[dry-run] 未写回"); return
    write_data_js(DATA_JS, stocks, alerts)
    print(f"[DONE] 写出 {len(stocks)} 标的 → {DATA_JS}")


if __name__ == "__main__":
    main()
