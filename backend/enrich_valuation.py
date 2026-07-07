#!/usr/bin/env python3
"""估值维度扩展：补 pe/pb/roe 残缺 + 新增 ps/peg/evEbitda/dividendYield，写回 data.js
================================================================================
在 enrich_fundamentals.py(yfinance) 之后跑，用更权威的源把估值维度补齐补新：
  - US   : FMP ratios-ttm + key-metrics-ttm（干净 JSON，覆盖最好）
  - SH/SZ: iFinD get_stock_summary「估值水平」表（同花顺权威，A股口径准）
新增字段：ps(市销率) peg(PEG) evEbitda(EV/EBITDA) dividendYield(股息率%，仅US)
策略：pe/pb/roe「缺才填」不覆盖；新字段缺才填；基本面慢变，按需手动跑（季度级）。

用法：
  python enrich_valuation.py                    # 全量 US + SH/SZ
  python enrich_valuation.py --only US          # 只美股
  python enrich_valuation.py --only SH,SZ --limit 5 --dry-run
"""
from __future__ import annotations
import argparse, json, os, re, sys, time, ssl, urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
import config
from refresh_data_js import parse_data_js, write_data_js

DATA_JS = BACKEND.parent / "frontend" / "src" / "data.js"
CLAUDE_JSON = Path(os.path.expanduser("~/.claude.json"))


def _load_keys():
    d = json.load(open(CLAUDE_JSON, encoding="utf-8"))
    srv = d["mcpServers"]
    fd_h = srv["financial-datasets"]["headers"]
    fd_key = fd_h.get("X-API-KEY") or list(fd_h.values())[0]
    ifind = srv["ifind-stock"]
    return fd_key, ifind["url"], ifind["headers"]["Authorization"]


# ---------- Financial Datasets (US) ----------
def fd_valuation(symbol: str, key: str) -> dict:
    url = f"https://api.financialdatasets.ai/financial-metrics/snapshot/?ticker={symbol}"
    try:
        req = urllib.request.Request(url, headers={"X-API-KEY": key, "User-Agent": "Mozilla/5.0"})
        d = json.load(urllib.request.urlopen(req, timeout=30))
    except Exception as e:
        print(f"    [FD {symbol}] {e}", flush=True); return {}
    m = d.get("snapshot") or d
    def num(k):
        v = m.get(k)
        return v if isinstance(v, (int, float)) else None
    r = {}
    if num("price_to_earnings_ratio") is not None: r["pe"] = round(num("price_to_earnings_ratio"), 2)
    if num("price_to_book_ratio") is not None: r["pb"] = round(num("price_to_book_ratio"), 2)
    if num("return_on_equity") is not None: r["roe"] = round(num("return_on_equity") * 100, 2)
    if num("price_to_sales_ratio") is not None: r["ps"] = round(num("price_to_sales_ratio"), 2)
    if num("peg_ratio") is not None: r["peg"] = round(num("peg_ratio"), 2)
    if num("enterprise_value_to_ebitda_ratio") is not None: r["evEbitda"] = round(num("enterprise_value_to_ebitda_ratio"), 2)
    if num("dividend_yield") is not None: r["dividendYield"] = round(num("dividend_yield") * 100, 2)
    return r


# ---------- iFinD (A股) ----------
_CTX = ssl.create_default_context(); _CTX.check_hostname = False; _CTX.verify_mode = ssl.CERT_NONE

def _ifind_call(url, auth, method, params=None, notify=False, sid=None):
    body = {"jsonrpc": "2.0", "method": method}
    if not notify: body["id"] = 1
    if params is not None: body["params"] = params
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
         "Authorization": auth, "MCP-Protocol-Version": "2025-06-18"}
    if sid[0]: h["Mcp-Session-Id"] = sid[0]
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h, method="POST")
    r = urllib.request.urlopen(req, context=_CTX, timeout=60)
    if r.headers.get("Mcp-Session-Id"): sid[0] = r.headers.get("Mcp-Session-Id")
    raw = r.read().decode("utf-8", "replace")
    if notify: return None
    for line in raw.splitlines():
        if line.startswith("data:"): raw = line[5:].strip(); break
    try: return json.loads(raw)
    except Exception: return {}

def ifind_valuation_batch(codes: list[str], url: str, auth: str) -> dict:
    """一次查最多5只A股估值，返回 {code: {pe,pb,ps,peg,evEbitda}}。code 形如 600519.SH"""
    sid = [None]
    _ifind_call(url, auth, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "enrich", "version": "1"}}, sid=sid)
    _ifind_call(url, auth, "notifications/initialized", notify=True, sid=sid)
    q = "、".join(codes) + " 的最新估值水平：市盈率PE、市净率PB、市销率PS、PEG、EV/EBITDA"
    res = _ifind_call(url, auth, "tools/call", {"name": "get_stock_summary", "arguments": {"query": q}}, sid=sid)
    r = res.get("result", {})
    txt = json.dumps(r.get("structuredContent"), ensure_ascii=False) if r.get("structuredContent") else \
          " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
    try:
        answer = json.loads(txt).get("data", {}).get("answer", "") if txt.strip().startswith("{") else txt
    except Exception:
        answer = txt
    return _parse_valuation_table(answer)

def _parse_valuation_table(md: str) -> dict:
    """解析 iFinD 估值 markdown 表。按表头关键词定位列，按代码正则定位行。"""
    out = {}
    lines = [l for l in md.splitlines() if l.strip().startswith("|")]
    if not lines: return out
    # 表头 → 列关键词映射
    header = [c.strip() for c in lines[0].strip("|").split("|")]
    colmap = {}
    for i, h in enumerate(header):
        hu = h.upper()
        # 中文表头精确匹配（避免 "PE" 撞进 "PEG"）；PEG/EV 用大写关键词
        if "PEG" in hu: colmap.setdefault("peg", i)
        elif "市盈率" in h: colmap.setdefault("pe", i)
        elif "市净率" in h: colmap.setdefault("pb", i)
        elif "市销率" in h: colmap.setdefault("ps", i)
        elif "企业倍数" in h or "EBITDA" in hu: colmap.setdefault("evEbitda", i)
    code_re = re.compile(r"\b(\d{6}\.(?:SH|SZ))\b", re.I)
    for l in lines[1:]:
        if set(l.strip()) <= {"|", "-", " "}: continue  # 分隔行
        cells = [c.strip() for c in l.strip("|").split("|")]
        m = code_re.search(l)
        if not m: continue
        code = m.group(1).upper()
        rec = {}
        for f, idx in colmap.items():
            if idx < len(cells):
                v = cells[idx].replace(",", "").replace("|", "").strip()
                try:
                    fv = float(v)
                    if fv != 0: rec[f] = round(fv, 2)
                except ValueError:
                    pass
        if rec: out[code] = rec
    return out


def data_ticker_to_ifind(ticker: str) -> str | None:
    """data.js ticker(yahoo) → iFinD 代码。688256.SS→688256.SH；300308.SZ→300308.SZ"""
    if ticker.endswith(".SS"): return ticker[:-3] + ".SH"
    if ticker.endswith(".SZ"): return ticker
    return None


NEW_FIELDS = ["ps", "peg", "evEbitda", "dividendYield"]
FILL_FIELDS = ["pe", "pb", "roe"]  # 缺才填

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="US 或 SH,SZ")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    markets = set(args.only.upper().split(",")) if args.only else {"US", "SH", "SZ"}
    fd_key, ifind_url, ifind_auth = _load_keys()

    stocks, alerts = parse_data_js(DATA_JS)
    filled = {k: 0 for k in FILL_FIELDS + NEW_FIELDS}
    n_us = n_cn = 0

    def apply(s, rec):
        for k in FILL_FIELDS:
            if s.get(k) is None and rec.get(k) is not None:
                s[k] = rec[k]; filled[k] += 1
        for k in NEW_FIELDS:
            if s.get(k) is None and rec.get(k) is not None:
                s[k] = rec[k]; filled[k] += 1

    # US via FMP
    if "US" in markets:
        us = [s for s in stocks if s.get("market") == "US" and not s.get("isETF")]
        if args.limit: us = us[:args.limit]
        print(f"US: FD 取数 {len(us)} 只")
        for i, s in enumerate(us, 1):
            rec = fd_valuation(s["ticker"], fd_key)
            apply(s, rec); n_us += 1
            if i % 25 == 0: print(f"  ...US {i}/{len(us)}", flush=True)
            time.sleep(0.1)

    # A股 via iFinD（批5）
    cn_markets = markets & {"SH", "SZ"}
    if cn_markets:
        cn = [s for s in stocks if s.get("market") in cn_markets and not s.get("isETF")]
        if args.limit: cn = cn[:args.limit]
        # 建 iFinD代码→stock 映射
        idx = {}
        for s in cn:
            code = data_ticker_to_ifind(s["ticker"])
            if code: idx[code] = s
        codes = list(idx.keys())
        print(f"A股: iFinD 取数 {len(codes)} 只（批5）")
        for b in range(0, len(codes), 5):
            batch = codes[b:b+5]
            try:
                res = ifind_valuation_batch(batch, ifind_url, ifind_auth)
            except Exception as e:
                print(f"  [iFinD batch {batch}] {e}", flush=True); res = {}
            for code, rec in res.items():
                if code in idx: apply(idx[code], rec)
            n_cn += len(batch)
            if (b // 5) % 10 == 0: print(f"  ...A股 {b+len(batch)}/{len(codes)}", flush=True)
            time.sleep(0.5)  # iFinD 2/秒

    print(f"\n[统计] US取数 {n_us} | A股取数 {n_cn}")
    print("[填充] " + " ".join(f"{k}:{v}" for k, v in filled.items()))
    if args.dry_run:
        print("[dry-run] 未写回"); return
    write_data_js(DATA_JS, stocks, alerts)
    print(f"[DONE] 写出 {len(stocks)} 标的 → {DATA_JS}")


if __name__ == "__main__":
    main()
