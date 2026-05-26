"""
Finnhub Source — Free tier US fundamentals (PE/PB/ROE/股息/D/E)
=================================================================

为什么用 Finnhub：
  yfinance .info 被 Yahoo 严重限频（实测 12k 美股 fill rate ~0.1%）。
  Finnhub free tier 给 60 calls/min，相对稳定。

需要：
  - 注册 https://finnhub.io 拿 free API key
  - 设置环境变量 FINNHUB_API_KEY

性能：
  60 calls/min × 60 min = 3600 calls/hour
  12k 美股 ÷ 60 calls/min = 200 分钟 ≈ 3.3 小时 / 全量
  → 建议跑 backend/universe/enrich_us_finnhub.py（带 checkpoint）

API:
  GET /api/v1/stock/metric?symbol={SYM}&metric=all&token={KEY}
  返回 { metric: { peNormalizedAnnual, pbAnnual, dividendYieldIndicatedAnnual,
                   roeRfy, totalDebt/totalEquityAnnual, ... } }
"""
from __future__ import annotations

import os
import time

import httpx

FINNHUB_BASE = "https://finnhub.io/api/v1"

# Free tier 60 calls/min → 1.05s 间隔是安全的（留 ~5% buffer）
DEFAULT_SLEEP = 1.05


class FinnhubError(Exception):
    """Finnhub API 调用失败（限频 / 鉴权 / 网络等）。"""


def _get_api_key() -> str | None:
    return os.getenv("FINNHUB_API_KEY")


def fetch_fundamentals_finnhub(symbol: str, timeout: float = 10.0) -> dict | None:
    """
    拉单只 US ticker 的 fundamentals。

    返回字典（值可能为 None，全部失败返回 None）：
        {
          "pe": float | None,
          "pb": float | None,
          "dividend_yield": float | None,  # 小数（0.05 = 5%）
          "roe": float | None,              # 小数（0.15 = 15%）
          "debt_to_equity": float | None,
        }

    错误处理：
      - 429 rate limit → 抛 FinnhubError（调用方决定 retry / sleep）
      - 401 / 403 鉴权 → 抛 FinnhubError
      - 其它 HTTP / JSON 错 → 返回 None（单只失败不阻断批量）

    Raises:
        FinnhubError: 当 FINNHUB_API_KEY 未设置 / 限频 / 鉴权失败
    """
    api_key = _get_api_key()
    if not api_key:
        raise FinnhubError("FINNHUB_API_KEY not set in env")

    url = f"{FINNHUB_BASE}/stock/metric"
    params = {"symbol": symbol, "metric": "all", "token": api_key}
    try:
        r = httpx.get(url, params=params, timeout=timeout)
    except httpx.HTTPError:
        return None  # 单只网络错不阻断批量

    if r.status_code == 429:
        raise FinnhubError(f"rate limit hit on {symbol}")
    if r.status_code in (401, 403):
        raise FinnhubError(f"auth failed ({r.status_code}) — check FINNHUB_API_KEY")
    if r.status_code != 200:
        return None

    try:
        data = r.json()
    except ValueError:
        return None

    m = data.get("metric") or {}
    # Finnhub 字段映射 — 优先 annual，缺则 fallback TTM/quarterly
    # 百分比字段（dividendYieldIndicatedAnnual / roeRfy）原值是 %，需 /100 转小数
    pe = m.get("peNormalizedAnnual") or m.get("peBasicExclExtraTTM")
    pb = m.get("pbAnnual") or m.get("pbQuarterly")
    div = m.get("dividendYieldIndicatedAnnual")
    roe = m.get("roeRfy") or m.get("roeTTM")
    de = m.get("totalDebt/totalEquityAnnual") or m.get("longTermDebt/equityAnnual")

    return {
        "pe": float(pe) if isinstance(pe, (int, float)) and pe != 0 else None,
        "pb": float(pb) if isinstance(pb, (int, float)) and pb != 0 else None,
        "dividend_yield": float(div) / 100 if isinstance(div, (int, float)) and div > 0 else None,
        "roe": float(roe) / 100 if isinstance(roe, (int, float)) else None,
        "debt_to_equity": float(de) if isinstance(de, (int, float)) and de >= 0 else None,
    }


def enrich_us_fundamentals_finnhub(
    items: list[dict],
    *,
    limit: int | None = None,
    sleep_sec: float = DEFAULT_SLEEP,
    only_missing: bool = True,
    checkpoint_fn=None,
    checkpoint_every: int = 100,
) -> tuple[int, int]:
    """
    批量给 US universe items 补 fundamentals（in-place 修改）。

    Args:
        items: list of dict，每个含 'ticker'
        limit: 最多 enrich 多少只（None = 全部）
        sleep_sec: 每次调用间隔（默认 1.05s = 60/min 安全速率）
        only_missing: 仅补 fundamentals 全空的 item（默认 True，避免重复花 API quota）
        checkpoint_fn: 每 checkpoint_every 次后调一次（用于中途保存）
        checkpoint_every: checkpoint 频率

    Returns:
        (n_ok, n_processed) — 成功补到至少 1 个字段的票数 / 实际调过 API 的票数

    Raises:
        FinnhubError: 鉴权失败时（429 限频会自动 sleep 20s 重试一次）
    """
    if not _get_api_key():
        raise FinnhubError("FINNHUB_API_KEY not set in env")

    # 筛出需要补的票
    targets = []
    for it in items:
        if not it.get("ticker"):
            continue
        if only_missing and any(it.get(k) is not None for k in ("pe", "pb", "dividend_yield", "roe")):
            continue
        targets.append(it)

    if limit is not None:
        targets = targets[:limit]

    total = len(targets)
    eta_min = total * sleep_sec / 60
    print(f"  finnhub enrich: {total} tickers, sleep {sleep_sec}s each (~{eta_min:.0f} min)")

    n_ok = 0
    for i, it in enumerate(targets, start=1):
        ticker = it["ticker"]
        try:
            fundamentals = fetch_fundamentals_finnhub(ticker)
        except FinnhubError as e:
            if "rate limit" in str(e):
                print(f"  [warn] {ticker}: rate limit — sleep 20s + retry")
                time.sleep(20)
                try:
                    fundamentals = fetch_fundamentals_finnhub(ticker)
                except FinnhubError:
                    fundamentals = None
            else:
                # 鉴权失败等致命错 — 上抛终止
                raise

        if fundamentals and any(v is not None for v in fundamentals.values()):
            it.update(fundamentals)
            n_ok += 1

        if i % checkpoint_every == 0:
            print(f"  progress: {i}/{total} ({n_ok} ok)")
            if checkpoint_fn:
                try:
                    checkpoint_fn()
                except Exception as e:
                    print(f"  [warn] checkpoint failed: {e}")

        time.sleep(sleep_sec)

    print(f"  finnhub 完成: {n_ok}/{total} 成功")
    return n_ok, total
