"""
FRED 数据源
============
拉取美联储 St. Louis Fed 时间序列（M2、收益率曲线、CPI、PMI、Fed BS …）
并写入 series_observations / series_meta 表。

PIT 处理：FRED 的每行观测带 realtime_start，即该值变得可见的日期，
作为 publish_date 落库。Phase 1 不抓修订版次（vintage=0 统一）；
Phase 2 升级时再用 ALFRED 端点拿全 vintage。

要求：
  - 已有 requests 依赖
  - 环境变量 FRED_API_KEY（https://fredaccount.stlouisfed.org/apikey）

文档：https://fred.stlouisfed.org/docs/api/fred/series_observations.html
"""
from __future__ import annotations

import os
import re
from typing import Any

import requests

import factors_lib as _fl

FRED_BASE = "https://api.stlouisfed.org/fred"
TIMEOUT_SEC = 30


class FREDError(RuntimeError):
    pass


def _sanitize_error(exc: Exception) -> str:
    """剥掉 API key（FRED 会把 ?api_key=xxx 写进 HTTPError.url）。"""
    return re.sub(r"api_key=[^&\s]+", "api_key=***", str(exc))


def _get_json(path: str, params: dict[str, Any]) -> dict[str, Any]:
    """统一 GET，错误时脱敏 url 再抛 FREDError。"""
    try:
        r = requests.get(f"{FRED_BASE}{path}", params=params, timeout=TIMEOUT_SEC)
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        raise FREDError(_sanitize_error(e)) from None
    except requests.RequestException as e:
        raise FREDError(_sanitize_error(e)) from None


def _api_key() -> str:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        raise FREDError("FRED_API_KEY 未设置（backend/.env）")
    return key


def fetch_observations(
    fred_series_id: str,
    start: str = "1900-01-01",
    end: str | None = None,
) -> list[dict]:
    """
    拉取 FRED 一只 series 全部观测（按 value_date 升序）。
    缺失值 ('.' / 空) 跳过；publish_date 取 realtime_start。
    """
    params: dict[str, Any] = {
        "series_id": fred_series_id,
        "api_key": _api_key(),
        "file_type": "json",
        "observation_start": start,
        "limit": 100000,
    }
    if end:
        params["observation_end"] = end

    data = _get_json("/series/observations", params)

    rows: list[dict] = []
    for o in data.get("observations", []):
        v = o.get("value")
        if v in ("", ".", None):
            continue
        try:
            value = float(v)
        except (TypeError, ValueError):
            continue
        rows.append({
            "value_date": o["date"],
            "publish_date": o.get("realtime_start") or o["date"],
            "value": value,
        })
    return rows


def fetch_series_info(fred_series_id: str) -> dict[str, Any]:
    """拿 FRED 端的 series 元数据（title、frequency、units）。"""
    params = {
        "series_id": fred_series_id,
        "api_key": _api_key(),
        "file_type": "json",
    }
    data = _get_json("/series", params)
    seriess = data.get("seriess", [])
    if not seriess:
        raise FREDError(f"series not found: {fred_series_id}")
    return seriess[0]


# 频率代码 → 内部统一标签
_FREQ_MAP = {
    "d": "daily", "daily": "daily",
    "w": "weekly", "weekly": "weekly",
    "bw": "biweekly",
    "m": "monthly", "monthly": "monthly",
    "q": "quarterly", "quarterly": "quarterly",
    "sa": "semiannual",
    "a": "annual", "annual": "annual",
}


def sync_series(
    local_series_id: str,
    fred_series_id: str,
    *,
    market: str = "US",
    description: str | None = None,
    start: str = "1900-01-01",
) -> int:
    """
    端到端：拉 FRED → upsert series_meta + series_observations。返回新写入观测条数。
    幂等：再跑一次只会覆盖已存在的同 (series_id, value_date, vintage=0) 行。
    """
    info = fetch_series_info(fred_series_id)
    rows = fetch_observations(fred_series_id, start=start)

    freq_short = (info.get("frequency_short") or "").lower()
    frequency = _FREQ_MAP.get(freq_short) or info.get("frequency", "unknown").lower()

    notes = (info.get("notes") or "").strip()
    desc = description or (notes[:300] + "…" if len(notes) > 300 else notes)

    _fl.upsert_series_meta(
        series_id=local_series_id,
        name=info.get("title", local_series_id),
        source="fred",
        source_id=fred_series_id,
        frequency=frequency,
        unit=info.get("units_short"),
        market=market,
        description=desc,
        is_revised=True,  # 大多数宏观序列 FRED 都会修订
    )
    return _fl.upsert_observations(local_series_id, rows, source="fred")
