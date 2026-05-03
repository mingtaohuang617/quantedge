"""
加载 SP500 成分股列表到 index_constituents 表
==============================================
来源: Wikipedia https://en.wikipedia.org/wiki/List_of_S%26P_500_companies
首版只取当前成分股，PIT 历史变动留 Phase 2。

用法:
    cd backend
    python load_spx500.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from io import StringIO

import pandas as pd
import requests

import db


WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def fetch_spx500_from_wikipedia() -> list[dict]:
    """
    抓 SP500 当前成分股。返回 [{ticker, name, sector, sub_sector, added_date}, ...]。
    """
    r = requests.get(WIKI_URL, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    tables = pd.read_html(StringIO(r.text), match="Symbol")
    if not tables:
        raise RuntimeError("Wikipedia 抓表失败")
    df = tables[0]

    col_map = {
        "Symbol": "ticker",
        "Security": "name",
        "GICS Sector": "sector",
        "GICS Sub-Industry": "sub_sector",
        "Date added": "added_date",
    }
    cols = {k: col_map[k] for k in col_map if k in df.columns}
    df = df.rename(columns=cols)[list(cols.values())]

    rows = []
    for _, r in df.iterrows():
        ticker = str(r.get("ticker", "")).strip()
        if not ticker:
            continue
        # Wikipedia 用 'BRK.B'，yfinance 期望 'BRK-B'
        yf_symbol = ticker.replace(".", "-")
        added = r.get("added_date")
        if isinstance(added, str) and len(added) >= 10:
            added = added[:10]
        else:
            added = None
        rows.append({
            "ticker": ticker,
            "yf_symbol": yf_symbol,
            "name": str(r.get("name", "")).strip(),
            "sector": str(r.get("sector", "")).strip() or None,
            "added_date": added,
        })
    return rows


def upsert_spx500(rows: list[dict]) -> int:
    now_ms = int(time.time() * 1000)
    with db.transaction() as conn:
        # 把所有当前成分股标 removed_date='' = 在指数内
        conn.executemany(
            """
            INSERT INTO index_constituents
              (index_id, ticker, yf_symbol, name, sector, market,
               added_date, removed_date, source, updated_at)
            VALUES ('SP500', ?, ?, ?, ?, 'US', ?, '', 'wikipedia', ?)
            ON CONFLICT(index_id, ticker, removed_date) DO UPDATE SET
              yf_symbol  = excluded.yf_symbol,
              name       = excluded.name,
              sector     = excluded.sector,
              added_date = excluded.added_date,
              source     = excluded.source,
              updated_at = excluded.updated_at
            """,
            [
                (r["ticker"], r["yf_symbol"], r["name"], r["sector"],
                 r["added_date"], now_ms)
                for r in rows
            ],
        )
    return len(rows)


def main() -> int:
    db.init_db()
    print("拉取 SP500 成分股列表（Wikipedia）…")
    t0 = time.time()
    rows = fetch_spx500_from_wikipedia()
    print(f"  抓到 {len(rows)} 个成分股 ({time.time()-t0:.1f}s)")
    n = upsert_spx500(rows)
    print(f"  写入 index_constituents: {n}")

    # 简要 sanity check
    conn = db._get_conn()
    cnt = conn.execute(
        "SELECT COUNT(*) c FROM index_constituents WHERE index_id='SP500' AND removed_date=''"
    ).fetchone()["c"]
    sectors = conn.execute(
        "SELECT sector, COUNT(*) c FROM index_constituents "
        "WHERE index_id='SP500' AND removed_date='' "
        "GROUP BY sector ORDER BY c DESC"
    ).fetchall()
    print(f"  当前 SP500 成分股数: {cnt}")
    print(f"  分行业分布:")
    for r in sectors[:15]:
        print(f"    {r['sector']:35s} {r['c']:3d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
