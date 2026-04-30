"""
QuantEdge 本地数据库（SQLite）
==============================
作为多源行情数据的"事实库" + L0 缓存层。

存储位置: backend/data/quantedge.db

表结构:
  tickers     — 标的元数据
  daily_bars  — 日 K 线事实表（核心）
  sync_state  — 同步水位（每个 ticker 一行）

跨源覆盖策略 (SOURCE_PRIORITY):
  tushare(4) > futu(3) > itick(2) > yfinance(1)
  upsert 时仅当新源 ≥ 旧源优先级才覆盖。

并发: WAL 模式 + 每线程独立 connection。
读分析: open_duckdb_attach() 返回 DuckDB 只读 attach 的连接。
"""
from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

# ── 路径 ──────────────────────────────────────────────────
DB_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DB_DIR / "quantedge.db"

# ── 跨源覆盖优先级（数字越大越权威）──────────────────────
SOURCE_PRIORITY = {
    "tushare": 4,
    "futu": 3,
    "itick": 2,
    "yfinance": 1,
}

# ── 表结构 ────────────────────────────────────────────────
INIT_SQL = """
CREATE TABLE IF NOT EXISTS tickers (
  ticker        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  yf_symbol     TEXT NOT NULL,
  futu_symbol   TEXT,
  ts_code       TEXT,
  market        TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'stock',
  currency      TEXT NOT NULL DEFAULT 'USD',
  sector        TEXT,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_bars (
  ticker        TEXT NOT NULL,
  trade_date    TEXT NOT NULL,           -- 'YYYY-MM-DD'
  open          REAL,
  high          REAL,
  low           REAL,
  close         REAL NOT NULL,
  volume        INTEGER,
  amount        REAL,
  adj_factor    REAL DEFAULT 1.0,
  source        TEXT NOT NULL,
  ingested_at   INTEGER NOT NULL,
  PRIMARY KEY (ticker, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_bars_date    ON daily_bars(trade_date);
CREATE INDEX IF NOT EXISTS idx_daily_bars_source  ON daily_bars(source);

CREATE TABLE IF NOT EXISTS sync_state (
  ticker          TEXT PRIMARY KEY,
  last_bar_date   TEXT,
  last_sync_ts    INTEGER,
  last_attempt_ts INTEGER,
  last_source     TEXT,
  last_error      TEXT,
  consec_fails    INTEGER NOT NULL DEFAULT 0
);
"""

# ── 线程本地连接池 ────────────────────────────────────────
_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """每线程一个独立 connection。SQLite 不允许跨线程共享。"""
    conn = getattr(_local, "conn", None)
    if conn is None:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        # isolation_level=None: 手动管理事务（用 BEGIN/COMMIT）
        conn = sqlite3.connect(str(DB_PATH), timeout=30, isolation_level=None)
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.row_factory = sqlite3.Row
        _local.conn = conn
    return conn


@contextmanager
def transaction():
    """显式事务，批量 upsert 必须包在 with 里以避免每行 fsync。"""
    conn = _get_conn()
    conn.execute("BEGIN;")
    try:
        yield conn
        conn.execute("COMMIT;")
    except Exception:
        conn.execute("ROLLBACK;")
        raise


def init_db() -> None:
    """启动时调用，幂等。"""
    conn = _get_conn()
    conn.executescript(INIT_SQL)


# ── ticker 规范化 ─────────────────────────────────────────
def normalize_ticker(cfg: dict) -> str:
    """
    把数据源 cfg 转成统一的内部 ticker key。
    港股统一用 5 位（'00005.HK'），其他用 yf_symbol。
    与前端 BacktestEngine 传递的 ticker 一致。
    """
    explicit = cfg.get("ticker")
    if explicit:
        return explicit
    yf = cfg.get("yf_symbol", "")
    if yf.endswith(".HK"):
        base = yf.replace(".HK", "")
        return base.zfill(5) + ".HK"
    return yf


# ── 写入 ──────────────────────────────────────────────────
def upsert_bars(ticker: str, rows: list[dict], source: str) -> int:
    """
    rows: [{trade_date, open, high, low, close, volume, amount, adj_factor}, ...]
    冲突策略: 仅当新源优先级 ≥ 旧源时覆盖。
    返回入参 rows 长度（实际写入未必每行都生效，但事务整体成功）。
    """
    if not rows:
        return 0
    new_prio = SOURCE_PRIORITY.get(source, 0)

    sql = """
      INSERT INTO daily_bars
        (ticker, trade_date, open, high, low, close, volume, amount, adj_factor, source, ingested_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ticker, trade_date) DO UPDATE SET
        open        = excluded.open,
        high        = excluded.high,
        low         = excluded.low,
        close       = excluded.close,
        volume      = excluded.volume,
        amount      = excluded.amount,
        adj_factor  = excluded.adj_factor,
        source      = excluded.source,
        ingested_at = excluded.ingested_at
      WHERE
        (SELECT CASE source
                  WHEN 'tushare'  THEN 4
                  WHEN 'futu'     THEN 3
                  WHEN 'itick'    THEN 2
                  WHEN 'yfinance' THEN 1
                  ELSE 0 END
         FROM   daily_bars
         WHERE  ticker = excluded.ticker AND trade_date = excluded.trade_date)
        <= ?
    """
    now_ms = int(time.time() * 1000)
    params = [
        (
            ticker,
            r["trade_date"],
            r.get("open"),
            r.get("high"),
            r.get("low"),
            r["close"],
            r.get("volume"),
            r.get("amount"),
            r.get("adj_factor", 1.0),
            source,
            now_ms,
            new_prio,
        )
        for r in rows
    ]
    with transaction() as conn:
        conn.executemany(sql, params)

    last_date = max(r["trade_date"] for r in rows)
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO sync_state (ticker, last_bar_date, last_sync_ts, last_attempt_ts, last_source, consec_fails, last_error)
            VALUES (?, ?, ?, ?, ?, 0, NULL)
            ON CONFLICT(ticker) DO UPDATE SET
              last_bar_date   = MAX(excluded.last_bar_date, sync_state.last_bar_date),
              last_sync_ts    = excluded.last_sync_ts,
              last_attempt_ts = excluded.last_attempt_ts,
              last_source     = excluded.last_source,
              consec_fails    = 0,
              last_error      = NULL
            """,
            (ticker, last_date, now_ms, now_ms, source),
        )
    return len(rows)


def mark_sync_failure(ticker: str, source: str, err: str) -> None:
    now_ms = int(time.time() * 1000)
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO sync_state (ticker, last_attempt_ts, last_source, last_error, consec_fails)
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(ticker) DO UPDATE SET
              last_attempt_ts = excluded.last_attempt_ts,
              last_source     = excluded.last_source,
              last_error      = excluded.last_error,
              consec_fails    = sync_state.consec_fails + 1
            """,
            (ticker, now_ms, source, str(err)[:500]),
        )


def upsert_ticker_meta(ticker: str, cfg: dict, is_builtin: bool = True) -> None:
    """登记标的元数据到 tickers 表（与 daily_bars 解耦，可选调用）。"""
    now_ms = int(time.time() * 1000)
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO tickers
              (ticker, name, yf_symbol, futu_symbol, ts_code, market, type, currency, sector,
               is_builtin, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(ticker) DO UPDATE SET
              name        = excluded.name,
              yf_symbol   = excluded.yf_symbol,
              futu_symbol = excluded.futu_symbol,
              ts_code     = excluded.ts_code,
              market      = excluded.market,
              type        = excluded.type,
              currency    = excluded.currency,
              sector      = excluded.sector,
              updated_at  = excluded.updated_at
            """,
            (
                ticker,
                cfg.get("name", ""),
                cfg.get("yf_symbol", ""),
                cfg.get("futu_symbol"),
                cfg.get("ts_code"),
                (cfg.get("market") or "US").upper(),
                cfg.get("type", "stock"),
                cfg.get("currency", "USD"),
                cfg.get("sector"),
                1 if is_builtin else 0,
                now_ms,
                now_ms,
            ),
        )


# ── 读取 ──────────────────────────────────────────────────
def get_bars(ticker: str, start: str | None = None, end: str | None = None) -> list[dict]:
    """读 K 线，返回 list[dict]，按 trade_date 升序。"""
    conn = _get_conn()
    if start and end:
        cur = conn.execute(
            "SELECT * FROM daily_bars WHERE ticker=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date",
            (ticker, start, end),
        )
    elif start:
        cur = conn.execute(
            "SELECT * FROM daily_bars WHERE ticker=? AND trade_date >= ? ORDER BY trade_date",
            (ticker, start),
        )
    else:
        cur = conn.execute(
            "SELECT * FROM daily_bars WHERE ticker=? ORDER BY trade_date",
            (ticker,),
        )
    return [dict(r) for r in cur.fetchall()]


def get_latest_bar_date(ticker: str) -> str | None:
    """库里最新一根 K 线日期。优先 sync_state，缺失时回退到 daily_bars MAX。"""
    conn = _get_conn()
    row = conn.execute(
        "SELECT last_bar_date FROM sync_state WHERE ticker=?", (ticker,)
    ).fetchone()
    if row and row["last_bar_date"]:
        return row["last_bar_date"]
    row = conn.execute(
        "SELECT MAX(trade_date) AS d FROM daily_bars WHERE ticker=?", (ticker,)
    ).fetchone()
    return row["d"] if row and row["d"] else None


def db_stats() -> dict:
    """库状态摘要，给 /api/db/stats 用。"""
    conn = _get_conn()
    out: dict = {
        "db_path": str(DB_PATH),
        "db_size_mb": round(DB_PATH.stat().st_size / 1024 / 1024, 3) if DB_PATH.exists() else 0.0,
        "tickers": conn.execute("SELECT COUNT(*) FROM tickers").fetchone()[0],
        "daily_bars": conn.execute("SELECT COUNT(*) FROM daily_bars").fetchone()[0],
        "by_source": {
            r[0]: r[1]
            for r in conn.execute("SELECT source, COUNT(*) FROM daily_bars GROUP BY source")
        },
        "last_synced": [
            dict(r)
            for r in conn.execute(
                "SELECT ticker, last_bar_date, last_source, consec_fails, last_error, last_sync_ts "
                "FROM sync_state ORDER BY last_sync_ts DESC NULLS LAST LIMIT 10"
            )
        ],
    }
    # 统计每个 ticker 的覆盖范围
    out["coverage"] = [
        {
            "ticker": r["ticker"],
            "bars": r["bars"],
            "first": r["first"],
            "last": r["last"],
        }
        for r in conn.execute(
            "SELECT ticker, COUNT(*) bars, MIN(trade_date) first, MAX(trade_date) last "
            "FROM daily_bars GROUP BY ticker ORDER BY bars DESC"
        )
    ]
    return out


# ── DuckDB 只读 attach（分析用）───────────────────────────
def open_duckdb_attach(read_only: bool = True):
    """
    返回内存 DuckDB 连接，已 ATTACH 当前 SQLite 文件为 'qe' schema。
    用法:
        con = open_duckdb_attach()
        df = con.execute("SELECT * FROM qe.daily_bars LIMIT 10").df()

    需要 `pip install duckdb`。第一次调用会触发 INSTALL sqlite（需联网）。
    """
    import duckdb  # 延迟导入，没装也不影响 SQLite 写入

    con = duckdb.connect(":memory:")
    con.execute("INSTALL sqlite;")
    con.execute("LOAD sqlite;")
    mode = "(TYPE SQLITE, READ_ONLY)" if read_only else "(TYPE SQLITE)"
    con.execute(f"ATTACH '{DB_PATH}' AS qe {mode};")
    return con


# ── CLI 自检 ──────────────────────────────────────────────
if __name__ == "__main__":
    import json
    init_db()
    print("[OK] init_db done.")
    print(json.dumps(db_stats(), indent=2, default=str, ensure_ascii=False))
