"""
全市场宽度计算引擎（W4）
========================
读 daily_bars + index_constituents，向量化计算每日宽度快照写入 breadth_snapshot。

字段：
  - universe_size       当日有数据的成分股数
  - advancing           当日上涨家数
  - declining           当日下跌家数
  - pct_above_200ma     200 日均线之上比例（%）
  - pct_above_50ma      50 日均线之上比例（%）
  - new_highs_52w       52 周新高家数
  - new_lows_52w        52 周新低家数

McClellan / MACD 扩散留 W4 后期。

用法（库）:
    from breadth_engine import update_snapshots
    update_snapshots(index_id='SP500', market='US', start='2024-01-01')
"""
from __future__ import annotations

import time

import pandas as pd

import db


def _load_constituents(index_id: str) -> list[str]:
    """读当前在指数内的 ticker 列表。"""
    conn = db._get_conn()
    rows = conn.execute(
        "SELECT ticker FROM index_constituents "
        "WHERE index_id=? AND removed_date=''",
        (index_id,),
    ).fetchall()
    return [r["ticker"] for r in rows]


def _load_close_matrix(tickers: list[str], start: str) -> pd.DataFrame:
    """
    返回 (date_index × ticker_columns) 的 close DataFrame。
    """
    if not tickers:
        return pd.DataFrame()
    placeholders = ",".join("?" * len(tickers))
    sql = (
        f"SELECT trade_date, ticker, close FROM daily_bars "
        f"WHERE ticker IN ({placeholders}) AND trade_date >= ? "
        f"ORDER BY trade_date"
    )
    conn = db._get_conn()
    rows = conn.execute(sql, (*tickers, start)).fetchall()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["trade_date", "ticker", "close"])
    return df.pivot(index="trade_date", columns="ticker", values="close")


def compute_snapshots(
    index_id: str = "SP500",
    market: str = "US",
    start: str = "2024-01-01",
) -> pd.DataFrame:
    """
    向量化计算 breadth 指标。返回每日一行的 DataFrame（不写库）。
    """
    tickers = _load_constituents(index_id)
    if not tickers:
        return pd.DataFrame()

    # 多拉一些历史，因为 200日均线 / 52周新高都要回看 200~252 个交易日
    # 把 start 往前推 350 天保证 rolling 窗口能填充
    fetch_start = (pd.Timestamp(start) - pd.Timedelta(days=400)).date().isoformat()
    wide = _load_close_matrix(tickers, fetch_start)
    if wide.empty:
        return pd.DataFrame()

    wide.index = pd.to_datetime(wide.index)
    wide = wide.sort_index()

    # 滚动统计
    ma_200 = wide.rolling(window=200, min_periods=100).mean()
    ma_50 = wide.rolling(window=50, min_periods=25).mean()
    high_52w = wide.rolling(window=252, min_periods=200).max()
    low_52w = wide.rolling(window=252, min_periods=200).min()
    daily_chg = wide.pct_change()

    # 每行（每天）的 universe = 当日 close 非空的列数
    universe = wide.notna().sum(axis=1)

    advancing = (daily_chg > 0).sum(axis=1)
    declining = (daily_chg < 0).sum(axis=1)

    above_200 = (wide > ma_200).sum(axis=1)
    above_50 = (wide > ma_50).sum(axis=1)
    # 0/0 → NaN（用 float NaN，不用 pd.NA，免得后续 astype(float) 炸）
    valid_200 = ma_200.notna().sum(axis=1).replace(0, float("nan"))
    valid_50 = ma_50.notna().sum(axis=1).replace(0, float("nan"))
    pct_above_200 = (above_200 / valid_200 * 100).astype(float)
    pct_above_50 = (above_50 / valid_50 * 100).astype(float)

    # 新高/新低：当日 close == 252 日窗口最高/最低
    new_highs = ((wide >= high_52w) & high_52w.notna()).sum(axis=1)
    new_lows = ((wide <= low_52w) & low_52w.notna()).sum(axis=1)

    out = pd.DataFrame({
        "universe_size":   universe.astype(int),
        "advancing":       advancing.astype(int),
        "declining":       declining.astype(int),
        "pct_above_200ma": pct_above_200,
        "pct_above_50ma":  pct_above_50,
        "new_highs_52w":   new_highs.astype(int),
        "new_lows_52w":    new_lows.astype(int),
    })

    # 切回到用户要求的 start 之后
    out = out[out.index >= pd.Timestamp(start)]
    out["snapshot_date"] = out.index.strftime("%Y-%m-%d")
    out["market"] = market
    return out.reset_index(drop=True)


def upsert_snapshots(snapshots: pd.DataFrame) -> int:
    """把 DataFrame 写入 breadth_snapshot 表。"""
    if snapshots.empty:
        return 0
    now_ms = int(time.time() * 1000)
    rows = [
        (
            r["snapshot_date"], r["market"],
            int(r["universe_size"]),
            int(r["advancing"]),
            int(r["declining"]),
            float(r["pct_above_200ma"]) if pd.notna(r["pct_above_200ma"]) else None,
            float(r["pct_above_50ma"])  if pd.notna(r["pct_above_50ma"])  else None,
            None,  # macd_diffusion (W4 后期)
            None,  # mcclellan_osc (W4 后期)
            int(r["new_highs_52w"]),
            int(r["new_lows_52w"]),
            now_ms,
        )
        for _, r in snapshots.iterrows()
    ]
    with db.transaction() as conn:
        conn.executemany(
            """
            INSERT INTO breadth_snapshot
              (snapshot_date, market, universe_size, advancing, declining,
               pct_above_200ma, pct_above_50ma, macd_diffusion, mcclellan_osc,
               new_highs_52w, new_lows_52w, computed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(snapshot_date, market) DO UPDATE SET
              universe_size   = excluded.universe_size,
              advancing       = excluded.advancing,
              declining       = excluded.declining,
              pct_above_200ma = excluded.pct_above_200ma,
              pct_above_50ma  = excluded.pct_above_50ma,
              new_highs_52w   = excluded.new_highs_52w,
              new_lows_52w    = excluded.new_lows_52w,
              computed_at     = excluded.computed_at
            """,
            rows,
        )
    return len(rows)


def update_snapshots(
    index_id: str = "SP500",
    market: str = "US",
    start: str = "2024-01-01",
) -> int:
    """端到端：算 + 写。返回写入条数。"""
    snaps = compute_snapshots(index_id=index_id, market=market, start=start)
    return upsert_snapshots(snaps)
