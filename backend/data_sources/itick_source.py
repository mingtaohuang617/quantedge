"""
iTick 数据源
=============
免费实时行情 API，覆盖美股/港股/A股等全球主要市场。
API 文档: https://docs.itick.org

功能:
  - 实时报价 (quote)
  - 日K线历史 (kline)
  - 公司基本信息 (info: 市值/PE/行业/简介)
  - 批量报价 (batch quote)
"""
import os
import time
from datetime import datetime

import pandas as pd
import requests

# ── 配置 ──────────────────────────────────────────────────
BASE_URL = "https://api.itick.org"
API_KEY = os.environ.get("ITICK_API_KEY", "")

# 免费版保守限速：请求之间至少间隔 0.3s
_MIN_INTERVAL = 0.3
_last_request_time = 0.0


class ITickError(RuntimeError):
    pass


def _headers() -> dict:
    if not API_KEY:
        raise ITickError("ITICK_API_KEY 未设置，请检查 .env 文件")
    return {"accept": "application/json", "token": API_KEY}


def _throttle():
    """简单限速，避免触发免费版 rate limit。"""
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < _MIN_INTERVAL:
        time.sleep(_MIN_INTERVAL - elapsed)
    _last_request_time = time.time()


def _get(path: str, params: dict) -> dict:
    """统一 GET 请求 + 错误处理。"""
    _throttle()
    url = f"{BASE_URL}{path}"
    resp = requests.get(url, headers=_headers(), params=params, timeout=15)
    resp.raise_for_status()
    body = resp.json()
    if body.get("code") != 0:
        raise ITickError(f"iTick {path} 返回错误: {body.get('msg', body)}")
    return body


# ── 辅助: config → iTick region + code ───────────────────
def _to_itick_params(cfg: dict) -> dict:
    """将 config.py 的标的配置转换为 iTick 的 region + code。"""
    market = (cfg.get("market") or "").upper()
    yf_sym = cfg.get("yf_symbol", "")

    if market == "HK":
        # yf_symbol: "0005.HK" / "9988.HK" / "7709.HK"
        code = yf_sym.split(".")[0].lstrip("0") or "0"
        return {"region": "HK", "code": code}
    if market in ("SH", "CN"):
        code = yf_sym.split(".")[0]
        return {"region": "SH", "code": code}
    if market == "SZ":
        code = yf_sym.split(".")[0]
        return {"region": "SZ", "code": code}
    # 默认美股
    return {"region": "US", "code": yf_sym}


# ── 公开接口 ──────────────────────────────────────────────

def fetch_quote(cfg: dict) -> dict:
    """
    获取实时报价快照。
    返回标准化 dict:
      {price, open, high, low, volume, change, change_pct, timestamp}
    """
    params = _to_itick_params(cfg)
    body = _get("/stock/quote", params)
    d = body["data"]
    return {
        "price": d.get("ld"),
        "open": d.get("o"),
        "high": d.get("h"),
        "low": d.get("l"),
        "prev_close": d.get("p"),
        "volume": d.get("v"),
        "turnover": d.get("tu"),
        "change": d.get("ch"),
        "change_pct": d.get("chp"),
        "timestamp": d.get("t"),
    }


def fetch_history(cfg: dict, days: int = 120) -> pd.DataFrame:
    """
    拉取日 K 线，返回与 yfinance 兼容的 DataFrame：
    列: Open / High / Low / Close / Volume
    索引: DatetimeIndex（升序）
    """
    params = _to_itick_params(cfg)
    params["kType"] = 8  # 8 = 日K
    params["limit"] = str(min(days + 30, 500))  # 多取一些缓冲

    body = _get("/stock/kline", params)
    data = body.get("data")
    if not data:
        raise ITickError(f"iTick K线返回空数据: {cfg.get('yf_symbol')}")

    df = pd.DataFrame(data)
    df = df.rename(columns={
        "o": "Open",
        "h": "High",
        "l": "Low",
        "c": "Close",
        "v": "Volume",
    })
    df["Date"] = pd.to_datetime(df["t"], unit="ms")
    df = df.set_index("Date").sort_index()
    return df[["Open", "High", "Low", "Close", "Volume"]]


def fetch_info(cfg: dict) -> dict:
    """
    获取公司基本信息。
    返回: {name, sector, industry, currency, market_cap, pe, description, website, shares_outstanding}
    """
    params = _to_itick_params(cfg)
    params["type"] = "stock"

    body = _get("/stock/info", params)
    d = body.get("data", {})
    return {
        "name": d.get("n"),
        "sector": d.get("s"),
        "industry": d.get("i"),
        "currency": d.get("r"),
        "market_cap": d.get("mcb"),
        "pe": d.get("pet"),
        "description": d.get("bd"),
        "website": d.get("wu"),
        "shares_outstanding": d.get("tso"),
        "exchange": d.get("e"),
    }


def fetch_batch_quotes(cfgs: list[dict]) -> dict:
    """
    批量获取实时报价。逐个调用（免费版无真正的 batch endpoint）。
    返回 {ticker_key: quote_dict, ...}
    """
    results = {}
    for cfg in cfgs:
        key = cfg.get("yf_symbol", "unknown")
        try:
            results[key] = fetch_quote(cfg)
        except Exception as e:
            results[key] = {"error": str(e)}
    return results


def health_check() -> tuple[bool, str]:
    """检查 iTick API 是否可达。"""
    if not API_KEY:
        return False, "ITICK_API_KEY 未设置"
    try:
        body = _get("/stock/quote", {"region": "US", "code": "AAPL"})
        price = body.get("data", {}).get("ld")
        return True, f"iTick 正常 (AAPL=${price})"
    except Exception as e:
        return False, f"iTick 连接失败: {e}"
