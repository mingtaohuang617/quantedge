"""
multpl.com 数据源
==================
抓 multpl 月度估值序列（SPX PE / Shiller CAPE / SPX 股息率等）。
multpl 没有官方 API，用 HTML 表格抓。

每页结构：
  https://www.multpl.com/<series-slug>/table/by-month
  → 一张 HTML 表，列 = Date | Value
  → 月度发布，value_date = 月末日

数据从 1880s（CAPE 长达 140 年历史）一直到当月。
"""
from __future__ import annotations

from io import StringIO
from typing import Any

import pandas as pd
import requests

import factors_lib as _fl


UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
TIMEOUT_SEC = 30


class MultplError(RuntimeError):
    pass


def fetch_table(slug: str) -> list[dict]:
    """
    抓 multpl 一张月度表，返回 [{value_date, publish_date, value}, ...]，
    按 value_date 升序。slug 例：'s-p-500-pe-ratio' / 'shiller-pe'。
    """
    url = f"https://www.multpl.com/{slug}/table/by-month"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT_SEC)
    r.raise_for_status()
    tables = pd.read_html(StringIO(r.text))
    if not tables:
        raise MultplError(f"multpl 抓表失败: {slug}")

    df = tables[0]
    if df.shape[1] < 2:
        raise MultplError(f"multpl 表结构异常: {slug} cols={list(df.columns)}")

    df.columns = ["date_raw", "value_raw"] + list(df.columns[2:])
    rows: list[dict] = []
    for _, r2 in df.iterrows():
        d = pd.to_datetime(r2["date_raw"], errors="coerce")
        if pd.isna(d):
            continue
        # 'value_raw' 可能含 'estimate' 字样或 ',' 千分号
        v_str = str(r2["value_raw"]).replace(",", "").split()[0]
        try:
            v = float(v_str)
        except ValueError:
            continue
        # multpl 用月末日
        date_str = d.date().isoformat()
        rows.append({
            "value_date": date_str,
            "publish_date": date_str,  # 当月数据 multpl 当月发布；首版近似
            "value": v,
        })
    rows.sort(key=lambda x: x["value_date"])
    return rows


def sync_series(
    local_series_id: str,
    multpl_slug: str,
    *,
    name: str,
    market: str = "US",
    description: str | None = None,
) -> int:
    """端到端：拉 multpl → upsert series_meta + observations。"""
    rows = fetch_table(multpl_slug)
    _fl.upsert_series_meta(
        series_id=local_series_id,
        name=name,
        source="multpl",
        source_id=multpl_slug,
        frequency="monthly",
        unit=None,
        market=market,
        description=description or f"multpl.com {multpl_slug}",
    )
    return _fl.upsert_observations(local_series_id, rows, source="multpl")
