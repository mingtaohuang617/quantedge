"""
futu_anomaly_scan — 关注股异动扫描（本地定时任务）
======================================================
工作日 09:00 跑（与行情刷新同步）。流程:

  1) 从生产 KV 拉关注列表  GET /api/watchlist/favorites
  2) app ticker → 富途代码（无富途权限的市场自动跳过：韩/日/台/加密…）
  3) 对每只跑 3 类异动（请求-响应，**不需要订阅**）:
       get_financial_unusual  (资金)
       get_technical_unusual  (技术/K线形态)
       get_derivative_unusual (期权/牛熊证)
  4) 汇总成快照，PUT 到生产 KV  PUT /api/anomaly/scan
     → 「实时监控」页展示

依赖: 本地 OpenD 运行 + VPN（访问生产 KV）。异动是请求-响应,不占 0/1000 订阅配额;
同一批关注股 7 天窗口内重复拉历史K线免费,不会持续消耗你的 905/1000。

环境（与异动 skill 同）: OpenD≥10.7 + futu-api≥10.7 +
  PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python

纯函数（favorite_to_futu / extract_signals / build_snapshot）零依赖、可单测;
Futu SDK 延迟导入,不装也能 import 本模块测纯逻辑。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

PROD = "https://quantedge-chi.vercel.app"
DEFAULT_FAVORITES_URL = f"{PROD}/api/watchlist/favorites"
DEFAULT_PUT_URL = f"{PROD}/api/anomaly/scan"
DEFAULT_REFERER = PROD

# 富途有行情权限的市场（用户: 港股 LV2 / 美股 LV3 / A股 LV1 / 新加坡 LV1）
SUPPORTED_MARKETS = {"US", "HK", "CN", "SG"}
DIMS = ("capital", "technical", "derivative")


# ── 纯逻辑（可单测）─────────────────────────────────────────
def favorite_to_futu(ticker: str):
    """app ticker key → (富途代码, 市场)。无权限/未知市场返回 (None, 市场标记)。

    EWY → US.EWY | 00700.HK → HK.00700 | 600519.SH → SH.600519
    000001.SZ → SZ.000001 | BRK-B → US.BRK.B | 000660.KS → (None,'KS') 跳过
    """
    t = (ticker or "").strip().upper()
    if not t:
        return None, None
    if "." in t:
        base, suf = t.rsplit(".", 1)
        if suf == "HK":
            return f"HK.{base.zfill(5)}", "HK"
        if suf == "SH":
            return f"SH.{base}", "CN"
        if suf == "SZ":
            return f"SZ.{base}", "CN"
        if suf == "SG":
            return f"SG.{base}", "SG"
        # 韩(.KS/.KQ) / 日(.T) / 台(.TW/.TWO) / 加密 … → 无权限,跳过
        return None, suf
    # 无后缀 = 美股；连字符转点（BRK-B → BRK.B）
    return f"US.{t.replace('-', '.')}", "US"


def normalize_data(value):
    """DataFrame / Series → records；递归处理 dict/list。与异动 skill 一致。"""
    if hasattr(value, "to_dict"):
        try:
            return value.to_dict(orient="records")
        except TypeError:
            return value.to_dict()
    if isinstance(value, dict):
        return {k: normalize_data(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize_data(v) for v in value]
    return value


_SIGNAL_KEYS = ("desc", "description", "title", "name", "text", "signal",
                "content", "summary", "type", "pattern", "indicator", "remark")


def extract_signals(normalized, limit: int = 6):
    """从（未知形态的）异动响应里尽量抽出人类可读信号串 + 计数。

    防御式: 响应可能是 list[dict] / dict / 标量。抽 _SIGNAL_KEYS 命中的字段值,
    抽不到就退回整条 str()。返回 (signals[str], count)。
    （真实 OpenD 响应形态见到后可微调此处,但 count/has_anomaly 不受影响。）
    """
    rows = []
    if isinstance(normalized, list):
        rows = normalized
    elif isinstance(normalized, dict):
        # 形如 {dim: [...]} 或单条 dict
        nested = [v for v in normalized.values() if isinstance(v, list)]
        rows = [x for sub in nested for x in sub] if nested else [normalized]
    elif normalized:
        rows = [normalized]

    signals = []
    for r in rows:
        if isinstance(r, dict):
            parts = [str(r[k]) for k in _SIGNAL_KEYS if r.get(k) not in (None, "", [])]
            signals.append(" · ".join(parts) if parts else json.dumps(r, ensure_ascii=False)[:120])
        elif r not in (None, "", []):
            signals.append(str(r)[:120])
    # 去重保序
    seen, uniq = set(), []
    for s in signals:
        if s and s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq[:limit], len(uniq)


def build_snapshot(items, skipped, errors, time_range, scanned_at=None):
    """组装最终快照。items 按异动数降序（最异常的排前面）。"""
    items = sorted(items, key=lambda x: x.get("anomaly_count", 0), reverse=True)
    return {
        "version": 1,
        "scanned_at": scanned_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "time_range": time_range,
        "items": items,
        "skipped": skipped,
        "errors": errors,
    }


# ── I/O ────────────────────────────────────────────────────
def _http_json(url, method="GET", referer=DEFAULT_REFERER, payload=None, timeout=30):
    data = None
    headers = {"Referer": referer, "Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_favorites(url=DEFAULT_FAVORITES_URL, referer=DEFAULT_REFERER):
    d = _http_json(url, "GET", referer)
    tickers = d.get("tickers") if isinstance(d, dict) else None
    return list(tickers) if isinstance(tickers, list) else []


def run_one(quote_ctx, code, time_range):
    """对单个富途代码跑 3 类异动,返回 (dims dict, anomaly_count, error|None)。"""
    from futu import RET_OK  # 延迟导入

    api = {
        "capital": quote_ctx.get_financial_unusual,
        "technical": quote_ctx.get_technical_unusual,
        "derivative": quote_ctx.get_derivative_unusual,
    }
    dims, total, last_err = {}, 0, None
    for name, fn in api.items():
        try:
            ret, data = fn(code, time_range=time_range, language_id=0)
        except Exception as e:  # noqa: BLE001
            dims[name] = {"ok": False, "count": 0, "signals": [], "error": str(e)[:200]}
            last_err = str(e)[:200]
            continue
        if ret != RET_OK:
            dims[name] = {"ok": False, "count": 0, "signals": [], "error": str(data)[:200]}
            last_err = str(data)[:200]
            continue
        signals, count = extract_signals(normalize_data(data))
        dims[name] = {"ok": True, "count": count, "signals": signals}
        total += count
    return dims, total, last_err


def push_snapshot(snapshot, url=DEFAULT_PUT_URL, referer=DEFAULT_REFERER):
    return _http_json(url, "PUT", referer, payload=snapshot)


# ── 主流程 ─────────────────────────────────────────────────
def main(argv=None):
    p = argparse.ArgumentParser(description="关注股异动扫描 → 推到监控页")
    p.add_argument("--favorites-url", default=DEFAULT_FAVORITES_URL)
    p.add_argument("--put-url", default=DEFAULT_PUT_URL)
    p.add_argument("--referer", default=DEFAULT_REFERER)
    p.add_argument("--time-range", type=int, default=7)
    p.add_argument("--limit", type=int, default=0, help="只扫前 N 个（调试用，0=全部）")
    p.add_argument("--host", default=os.getenv("FUTU_OPEND_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.getenv("FUTU_OPEND_PORT", "11111")))
    p.add_argument("--dry-run", action="store_true", help="只打印快照,不 PUT")
    p.add_argument("--tickers", help="逗号分隔,绕过 KV 直接指定（调试用）")
    args = p.parse_args(argv)

    os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

    if args.tickers:
        favorites = [t.strip() for t in args.tickers.split(",") if t.strip()]
    else:
        favorites = fetch_favorites(args.favorites_url, args.referer)
    if args.limit > 0:
        favorites = favorites[: args.limit]
    print(f"[scan] {len(favorites)} 个关注标的")

    items, skipped, errors = [], [], []
    mapping = []
    for tk in favorites:
        code, market = favorite_to_futu(tk)
        if code is None:
            skipped.append({"ticker": tk, "reason": f"无富途权限/未知市场({market})"})
        else:
            mapping.append((tk, code, market))

    from futu import OpenQuoteContext  # 延迟导入
    quote_ctx = OpenQuoteContext(host=args.host, port=args.port)
    try:
        for tk, code, market in mapping:
            dims, total, err = run_one(quote_ctx, code, args.time_range)
            items.append({
                "ticker": tk, "futu": code, "market": market,
                "dims": dims, "anomaly_count": total, "has_anomaly": total > 0,
            })
            if err:
                errors.append({"ticker": tk, "error": err})
            print(f"  {tk:>12} → {code:<12} 异动={total}{' ⚠' if total else ''}")
    finally:
        quote_ctx.close()

    snap = build_snapshot(items, skipped, errors, args.time_range)
    n_anom = sum(1 for it in items if it["has_anomaly"])
    print(f"[scan] 完成: {len(items)} 扫描 / {n_anom} 有异动 / {len(skipped)} 跳过 / {len(errors)} 出错")

    if args.dry_run:
        print(json.dumps(snap, ensure_ascii=False, indent=2)[:4000])
        return 0
    resp = push_snapshot(snap, args.put_url, args.referer)
    print(f"[scan] 已推送到监控页: ok={resp.get('ok')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
