#!/usr/bin/env python3
"""估值维度扩展：补 pe/pb/roe 残缺 + 新增 ps/peg/evEbitda，写回 data.js
================================================================================
在 enrich_fundamentals.py(yfinance) 之后跑，用同花顺 iFinD 把估值维度补齐补新：
  - US/HK: iFinD global_stock_quotes（港美股，一次给 PE/PB/PS/PEG/EV-EBITDA）
  - SH/SZ: iFinD get_stock_summary「估值水平」表（A股口径准）
新增字段：ps(市销率) peg(PEG) evEbitda(EV1/EBITDA)
策略：pe/pb/roe「缺才填」不覆盖；新字段缺才填；基本面慢变，按需手动跑（季度级）。
认证：ifind JWT 从 ~/.claude.json 读（7 个 ifind-* 服务同一 token）。

用法：
  python enrich_valuation.py                    # 全量 US + HK + SH/SZ
  python enrich_valuation.py --only US,HK       # 只港美股
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
    ifind = srv["ifind-stock"]
    auth = ifind["headers"]["Authorization"]  # 同一 JWT 用于所有 ifind-* 服务
    gurl = srv["ifind-global-stock"]["url"]    # 港美股 global-stock
    return ifind["url"], auth, gurl


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


# ---------- iFinD global-stock (港/美股) ----------
def _gkey(code: str) -> str:
    """归一化港美股代码用于匹配。02359.HK/2359.HK→HK:2359；NVDA/NVDA.O→US:NVDA"""
    code = code.strip().upper()
    base = code.split(".")[0]
    if code.endswith(".HK"):
        try: return "HK:" + str(int(base))
        except ValueError: return "HK:" + base
    return "US:" + base

def _parse_global_valuation(md: str) -> dict:
    """解析 global_stock_quotes 估值表（列比A股多：PE有LYR+TTM、EV有EV1+EV2）。
    代码在第一列（不同于A股汇总表的名在前）。优先取 TTM/最新/EV1。"""
    out = {}
    lines = [l for l in md.splitlines() if l.strip().startswith("|")]
    if not lines: return out
    header = [c.strip() for c in lines[0].strip("|").split("|")]
    colmap = {}
    for i, h in enumerate(header):
        hu = h.upper()
        if "PEG" in hu: colmap.setdefault("peg", i)
        elif "市盈率" in h and "TTM" in hu: colmap["pe"] = i          # TTM 优先（覆盖 LYR）
        elif "市盈率" in h: colmap.setdefault("pe", i)
        elif "市净率" in h and "最新" in h: colmap["pb"] = i          # 最新优先（覆盖 MRQ）
        elif "市净率" in h: colmap.setdefault("pb", i)
        elif "市销率" in h and "TTM" in hu: colmap["ps"] = i          # TTM 优先（覆盖 LYR）
        elif "市销率" in h: colmap.setdefault("ps", i)
        elif "EV1" in hu: colmap["evEbitda"] = i                       # EV1 优先（覆盖 EV2）
        elif "企业倍数" in h or "EBITDA" in hu: colmap.setdefault("evEbitda", i)
    for l in lines[1:]:
        if set(l.strip()) <= {"|", "-", " "}: continue
        cells = [c.strip() for c in l.strip("|").split("|")]
        if not cells or not cells[0]: continue
        rec = {}
        for f, idx in colmap.items():
            if idx < len(cells):
                v = cells[idx].replace(",", "").strip()
                try:
                    fv = float(v)
                    if fv != 0: rec[f] = round(fv, 2)
                except ValueError:
                    pass
        if rec: out[_gkey(cells[0])] = rec  # 首列即代码
    return out

def _parse_dividend(md: str, keyfn) -> dict:
    """解析股息率表（多日期行，首个非空即最新）→ {key: 小数}。iFinD 返回 %，存小数(÷100)配 fmtPct。"""
    out = {}
    lines = [l for l in md.splitlines() if l.strip().startswith("|")]
    if not lines: return out
    header = [c.strip() for c in lines[0].strip("|").split("|")]
    di = None
    for i, h in enumerate(header):
        if "股息率" in h:
            if "12" in h or "TTM" in h.upper():  # 近12个月/TTM 优先
                di = i; break
            if di is None: di = i
    if di is None: return out
    for l in lines[1:]:
        if set(l.strip()) <= {"|", "-", " "}: continue
        cells = [c.strip() for c in l.strip("|").split("|")]
        if len(cells) <= di or not cells[0]: continue
        key = keyfn(cells[0])
        if key in out: continue  # 首个非空（最新日期在前）
        v = cells[di].replace(",", "").strip()
        try:
            fv = float(v)
            if fv > 0: out[key] = round(fv / 100.0, 4)  # % → 小数
        except ValueError:
            pass
    return out

def ifind_dividend_batch(terms: list[str], url: str, auth: str, tool: str, keyfn) -> dict:
    """查股息率 → {key: 小数}。A股 tool=get_stock_financials/keyfn=identity；港美股 tool=global_stock_financial/keyfn=_gkey。"""
    sid = [None]
    _ifind_call(url, auth, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "enrich", "version": "1"}}, sid=sid)
    _ifind_call(url, auth, "notifications/initialized", notify=True, sid=sid)
    q = "、".join(terms) + " 的近12个月股息率(%)"
    res = _ifind_call(url, auth, "tools/call", {"name": tool, "arguments": {"query": q}}, sid=sid)
    r = res.get("result", {})
    txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
    try:
        answer = json.loads(txt).get("data", {}).get("answer", "") if txt.strip().startswith("{") else txt
    except Exception:
        answer = txt
    return _parse_dividend(answer, keyfn)

def ifind_global_batch(terms: list[str], url: str, auth: str) -> dict:
    """一次查最多5只港/美股估值 → {_gkey: {pe,pb,ps,peg,evEbitda}}。
    terms 传「名称(代码)」形如 美光科技(MU)——裸 ticker 会被 iFinD 实体解析猜错，必须带名消歧。"""
    sid = [None]
    _ifind_call(url, auth, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "enrich", "version": "1"}}, sid=sid)
    _ifind_call(url, auth, "notifications/initialized", notify=True, sid=sid)
    q = "、".join(terms) + " 的最新市盈率PE(TTM)、市净率PB、市销率PS(TTM)、预测PEG、企业倍数EV1/EBITDA"
    res = _ifind_call(url, auth, "tools/call", {"name": "global_stock_quotes", "arguments": {"query": q}}, sid=sid)
    r = res.get("result", {})
    txt = " ".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
    try:
        answer = json.loads(txt).get("data", {}).get("answer", "") if txt.strip().startswith("{") else txt
    except Exception:
        answer = txt
    return _parse_global_valuation(answer)


NEW_FIELDS = ["ps", "peg", "evEbitda"]
FILL_FIELDS = ["pe", "pb", "roe"]  # 缺才填

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="US / HK / SH,SZ 组合")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    markets = set(args.only.upper().split(",")) if args.only else {"US", "HK", "SH", "SZ"}
    ifind_url, ifind_auth, gurl = _load_keys()

    stocks, alerts = parse_data_js(DATA_JS)
    filled = {k: 0 for k in FILL_FIELDS + NEW_FIELDS + ["dividend_yield"]}
    n_gs = n_cn = 0

    def apply(s, rec):
        for k in FILL_FIELDS + NEW_FIELDS:
            if s.get(k) is None and rec.get(k) is not None:
                s[k] = rec[k]; filled[k] += 1

    def apply_div(s, div):
        if div is not None and s.get("dividend_yield") is None:
            s["dividend_yield"] = div; filled["dividend_yield"] += 1

    # 港/美股 via iFinD global-stock（批5）
    gs_markets = markets & {"US", "HK"}
    if gs_markets:
        gs = [s for s in stocks if s.get("market") in gs_markets and not s.get("isETF")]
        if args.limit: gs = gs[:args.limit]
        idx = {_gkey(s["ticker"]): s for s in gs}
        # 带中文名消歧（裸 ticker 会被 iFinD 猜错）：美光科技(MU)
        terms = [f'{s.get("name") or s["ticker"]}({s["ticker"]})' for s in gs]
        print(f"港/美股: iFinD global 取数 {len(terms)} 只（批5）")
        for b in range(0, len(terms), 5):
            batch = terms[b:b+5]
            try:
                res = ifind_global_batch(batch, gurl, ifind_auth)
            except Exception as e:
                print(f"  [global batch {batch}] {e}", flush=True); res = {}
            for gk, rec in res.items():
                if gk in idx: apply(idx[gk], rec)
            n_gs += len(batch)
            if (b // 5) % 10 == 0: print(f"  ...港/美股 {b+len(batch)}/{len(terms)}", flush=True)
            time.sleep(0.5)  # iFinD 2/秒
        # 股息率（另一 tool：global_stock_financial）
        print("港/美股: 补股息率")
        for b in range(0, len(terms), 5):
            try:
                divs = ifind_dividend_batch(terms[b:b+5], gurl, ifind_auth, "global_stock_financial", _gkey)
            except Exception as e:
                print(f"  [global div {b}] {e}", flush=True); divs = {}
            for gk, dv in divs.items():
                if gk in idx: apply_div(idx[gk], dv)
            time.sleep(0.5)

    # A股 via iFinD ifind-stock（批5）
    cn_markets = markets & {"SH", "SZ"}
    if cn_markets:
        cn = [s for s in stocks if s.get("market") in cn_markets and not s.get("isETF")]
        if args.limit: cn = cn[:args.limit]
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
        # 股息率（另一 tool：get_stock_financials）
        print("A股: 补股息率")
        for b in range(0, len(codes), 5):
            try:
                divs = ifind_dividend_batch(codes[b:b+5], ifind_url, ifind_auth, "get_stock_financials", lambda c: c.upper())
            except Exception as e:
                print(f"  [A股 div {b}] {e}", flush=True); divs = {}
            for code, dv in divs.items():
                if code in idx: apply_div(idx[code], dv)
            time.sleep(0.5)

    print(f"\n[统计] 港/美股取数 {n_gs} | A股取数 {n_cn}")
    print("[填充] " + " ".join(f"{k}:{v}" for k, v in filled.items()))
    if args.dry_run:
        print("[dry-run] 未写回"); return
    write_data_js(DATA_JS, stocks, alerts)
    print(f"[DONE] 写出 {len(stocks)} 标的 → {DATA_JS}")


if __name__ == "__main__":
    main()
