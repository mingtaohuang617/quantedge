"""
futu_subscribe_favorites — 把关注股连上 OpenD 实时行情订阅
==========================================================
拉关注列表(生产 KV)→ 映射富途代码(无权限市场跳过)→ subscribe QUOTE。

⚠️ 富途订阅是"连接绑定"的:订阅只在本进程连接存活期间有效,进程退出即释放。
  - 默认(保持模式):订阅后挂住连接,定时重拉关注列表增减订阅,直到 Ctrl+C。
  - --once:只订一次 + 打印实时行情快照后退出(订阅随退出释放,用于验证)。

自包含(内联映射/拉取),不依赖其他模块,任意分支可跑。
依赖:本地 OpenD 运行 + VPN(访问生产 KV)+ futu-api。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
import urllib.request

PROD = "https://quantedge-chi.vercel.app"
DEFAULT_FAVORITES_URL = f"{PROD}/api/watchlist/favorites"
DEFAULT_REFERER = PROD


def favorite_to_futu(ticker: str):
    """app ticker key → (富途代码, 市场)。无权限/未知市场返回 (None, 市场标记)。"""
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
        return None, suf  # 韩/日/台/加密 … 无权限,跳过
    return f"US.{t.replace('-', '.')}", "US"


def _parse_tickers(text):
    d = json.loads(text)
    tickers = d.get("tickers") if isinstance(d, dict) else None
    return list(tickers) if isinstance(tickers, list) else []


def fetch_favorites(url=DEFAULT_FAVORITES_URL, referer=DEFAULT_REFERER, timeout=20, retries=6):
    """拉关注列表。GFW 对 vercel.app 的 TLS 重置是概率性的(约 1/3 失败),
    走代理 + 多次重试即可稳定通过。优先 curl(走 HTTP_PROXY),回退 urllib。"""
    curl = shutil.which("curl")
    last = None
    for _ in range(retries):
        try:
            if curl:
                out = subprocess.run(
                    [curl, "-sS", "-H", f"Referer: {referer}", "--max-time", str(timeout), url],
                    capture_output=True, text=True, timeout=timeout + 5,
                )
                if out.returncode == 0 and out.stdout.strip():
                    return _parse_tickers(out.stdout)
                last = out.stderr.strip() or f"curl rc={out.returncode}"
            else:
                req = urllib.request.Request(url, headers={"Referer": referer, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return _parse_tickers(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(1)
    raise RuntimeError(f"拉关注列表失败(GFW? 已重试 {retries} 次): {last}")


def resolve_codes(favorites):
    codes, skipped = [], []
    for tk in favorites:
        code, market = favorite_to_futu(tk)
        (skipped if code is None else codes).append((tk, code or market))
    return codes, skipped


def main(argv=None):
    p = argparse.ArgumentParser(description="关注股 → OpenD 实时行情订阅")
    p.add_argument("--favorites-url", default=DEFAULT_FAVORITES_URL)
    p.add_argument("--referer", default=DEFAULT_REFERER)
    p.add_argument("--host", default=os.getenv("FUTU_OPEND_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.getenv("FUTU_OPEND_PORT", "11111")))
    p.add_argument("--poll", type=int, default=300, help="重拉关注列表间隔秒(保持模式)")
    p.add_argument("--once", action="store_true", help="只订一次+打印快照后退出")
    p.add_argument("--tickers", help="逗号分隔,绕过 KV(调试)")
    p.add_argument("--reconnect-delay", type=int, default=30, help="掉线/异常后重连等待秒")
    args = p.parse_args(argv)

    os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")
    from futu import OpenQuoteContext, SubType, RET_OK

    def get_favs():
        if args.tickers:
            return [t.strip() for t in args.tickers.split(",") if t.strip()]
        return fetch_favorites(args.favorites_url, args.referer)

    def run_session():
        """连一次 + 订阅 + 轮询保持。任何连接级异常向上抛,交给外层重连。"""
        ctx = OpenQuoteContext(host=args.host, port=args.port)
        subscribed = set()
        try:
            while True:
                try:
                    favs = get_favs()
                except Exception as e:  # noqa: BLE001 — 拉取失败不拆连接,保持现有订阅,短退避后重试
                    if args.once:
                        raise
                    backoff = min(args.poll, 20)
                    print(f"[sub] 拉关注列表失败,保持现有 {len(subscribed)} 订阅,{backoff}s 后重试: {e}", flush=True)
                    time.sleep(backoff)
                    continue
                codes, skipped = resolve_codes(favs)
                want = {c for _, c in codes}
                add, rem = want - subscribed, subscribed - want
                if add:
                    ret, data = ctx.subscribe(list(add), [SubType.QUOTE])
                    if ret == RET_OK:
                        subscribed |= add
                        print(f"[sub] +{len(add)} 已订阅: {sorted(add)}", flush=True)
                    else:
                        print(f"[sub] 订阅失败: {data}", flush=True)
                if rem:
                    ctx.unsubscribe(list(rem), [SubType.QUOTE])
                    subscribed -= rem
                    print(f"[sub] -{len(rem)} 已取消: {sorted(rem)}", flush=True)
                if skipped:
                    print(f"[sub] 跳过(无权限市场): {[t for t, _ in skipped]}", flush=True)

                # 实时行情快照（证明订阅生效）
                if subscribed:
                    ret, q = ctx.get_stock_quote(list(subscribed))
                    if ret == RET_OK and hasattr(q, "to_dict"):
                        rows = q.to_dict(orient="records")
                        print(f"[sub] 实时行情({len(rows)}):", flush=True)
                        for r in rows:
                            print(f"      {r.get('code'):<12} 现价 {r.get('last_price')}", flush=True)

                ret, sub = ctx.query_subscription()
                used = sub.get("own_used") if isinstance(sub, dict) else None
                print(f"[sub] 订阅配额已用={used} (共1000) | 当前持有 {len(subscribed)} 只", flush=True)

                if args.once:
                    return
                time.sleep(args.poll)
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass

    if args.once:
        run_session()
        return 0

    # 永久常驻:OpenD 重启 / 掉线 / 拉取失败都自动重连,直到进程被杀
    while True:
        try:
            run_session()
        except Exception as e:  # noqa: BLE001
            print(f"[sub] 会话中断,{args.reconnect_delay}s 后重连: {e}", flush=True)
        time.sleep(args.reconnect_delay)


if __name__ == "__main__":
    raise SystemExit(main())
