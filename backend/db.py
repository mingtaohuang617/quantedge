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

-- LLM 响应缓存（B1）
-- key: 由 (endpoint, model, prompt_hash) 组合，避免重复调 DeepSeek
CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key       TEXT PRIMARY KEY,    -- sha256(endpoint|model|prompt)[:32]
  endpoint        TEXT NOT NULL,        -- 'summary' | 'journal-structure' | ...
  model           TEXT NOT NULL,
  ticker          TEXT,                 -- 关联 ticker（按需，可空）
  response_json   TEXT NOT NULL,        -- 序列化后的响应
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER,              -- 过期时间戳（0=永久）
  hit_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_llm_cache_endpoint ON llm_cache(endpoint);
CREATE INDEX IF NOT EXISTS idx_llm_cache_ticker   ON llm_cache(ticker);
CREATE INDEX IF NOT EXISTS idx_llm_cache_expires  ON llm_cache(expires_at);

-- ── L1/L2 宏观因子库（Phase 1） ────────────────────────────
-- 时间序列发布观测（PIT，单表通用）：所有外部时间序列（宏观/估值/情绪）
CREATE TABLE IF NOT EXISTS series_observations (
  series_id     TEXT NOT NULL,
  value_date    TEXT NOT NULL,                  -- 数据期 'YYYY-MM-DD'
  publish_date  TEXT NOT NULL,                  -- 发布日 'YYYY-MM-DD'
  value         REAL NOT NULL,
  vintage       INTEGER NOT NULL DEFAULT 0,     -- 0=初值, 1+ 修订版次
  source        TEXT NOT NULL,
  ingested_at   INTEGER NOT NULL,
  PRIMARY KEY (series_id, value_date, vintage)
);
CREATE INDEX IF NOT EXISTS idx_series_obs_publish ON series_observations(series_id, publish_date);
CREATE INDEX IF NOT EXISTS idx_series_obs_value   ON series_observations(series_id, value_date);

CREATE TABLE IF NOT EXISTS series_meta (
  series_id        TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  source           TEXT NOT NULL,                -- 'fred' / 'tushare' / 'yfinance'
  source_id        TEXT NOT NULL,                -- 源端 ID（如 FRED 'M2SL'）
  frequency        TEXT NOT NULL,                -- daily/weekly/monthly/quarterly
  unit             TEXT,
  market           TEXT,                         -- US/CN/HK/global
  description      TEXT,
  publish_lag_days INTEGER,
  is_revised       INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL
);

-- L2 因子值（市场层面，按 factor × market × date × calc_version）
CREATE TABLE IF NOT EXISTS factor_values (
  factor_id     TEXT NOT NULL,
  market        TEXT NOT NULL,                  -- 'US' / 'CN' / 'HK' / 'global'
  value_date    TEXT NOT NULL,
  raw_value     REAL,
  percentile    REAL,                           -- 0-100 历史分位
  calc_version  TEXT NOT NULL,                  -- 'v1' / 'v2'，公式变更时换版本
  computed_at   INTEGER NOT NULL,
  PRIMARY KEY (factor_id, market, value_date, calc_version)
);
CREATE INDEX IF NOT EXISTS idx_factor_values_date   ON factor_values(value_date);
CREATE INDEX IF NOT EXISTS idx_factor_values_factor ON factor_values(factor_id, market, value_date);

CREATE TABLE IF NOT EXISTS factor_meta (
  factor_id           TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL,            -- valuation/liquidity/breadth/sentiment/macro/technical
  applicable_markets  TEXT NOT NULL,            -- 'US,CN' / 'US' / 'global'
  formula_ref         TEXT,                     -- 'module.function' 路径
  freq                TEXT NOT NULL,            -- daily/weekly/monthly
  description         TEXT,
  rolling_window_days INTEGER,                  -- 分位标准化窗口（默认 10Y=2520）
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

-- 指数成分股（PIT-aware；首版用 removed_date='' 表示当前在）
CREATE TABLE IF NOT EXISTS index_constituents (
  index_id      TEXT NOT NULL,        -- 'SP500' / 'NDX' / ...
  ticker        TEXT NOT NULL,        -- 内部 ticker key（与 daily_bars 对齐）
  yf_symbol     TEXT NOT NULL,        -- yfinance 拉数据用
  name          TEXT,
  sector        TEXT,
  market        TEXT NOT NULL DEFAULT 'US',
  added_date    TEXT,                 -- 加入指数日期（可空）
  removed_date  TEXT NOT NULL DEFAULT '',   -- 移除日期；空=当前在
  source        TEXT NOT NULL,        -- 'wikipedia' / 'manual'
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (index_id, ticker, removed_date)
);
CREATE INDEX IF NOT EXISTS idx_idx_const_active
  ON index_constituents(index_id, removed_date);

-- L1 全市场宽度日快照（每市场每日一行）
CREATE TABLE IF NOT EXISTS breadth_snapshot (
  snapshot_date    TEXT NOT NULL,
  market           TEXT NOT NULL,
  universe_size    INTEGER,
  advancing        INTEGER,
  declining        INTEGER,
  pct_above_200ma  REAL,
  pct_above_50ma   REAL,
  new_highs_52w    INTEGER,
  new_lows_52w     INTEGER,
  macd_diffusion   REAL,
  mcclellan_osc    REAL,
  computed_at      INTEGER NOT NULL,
  PRIMARY KEY (snapshot_date, market)
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


# ── LLM 缓存 (B1) ────────────────────────────────────────
import hashlib
import json as _json


def llm_cache_key(endpoint: str, model: str, prompt: str) -> str:
    """生成 cache key：sha256(endpoint|model|prompt) 截断到 32 字符。"""
    h = hashlib.sha256(f"{endpoint}|{model}|{prompt}".encode("utf-8")).hexdigest()
    return h[:32]


def llm_cache_get(cache_key: str) -> dict | None:
    """命中则返回 {response, prompt_tokens, completion_tokens}；过期或未命中返 None。"""
    conn = _get_conn()
    row = conn.execute(
        "SELECT response_json, prompt_tokens, completion_tokens, expires_at "
        "FROM llm_cache WHERE cache_key=?",
        (cache_key,),
    ).fetchone()
    if row is None:
        return None
    now = int(time.time())
    if row["expires_at"] and row["expires_at"] > 0 and row["expires_at"] < now:
        return None  # 过期
    # 命中计数 +1（异步，失败不影响读）
    try:
        conn.execute("UPDATE llm_cache SET hit_count = hit_count + 1 WHERE cache_key=?", (cache_key,))
    except Exception:
        pass
    return {
        "response": _json.loads(row["response_json"]),
        "prompt_tokens": row["prompt_tokens"],
        "completion_tokens": row["completion_tokens"],
    }


def llm_cache_put(
    cache_key: str,
    endpoint: str,
    model: str,
    response: dict,
    *,
    ticker: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    ttl_seconds: int = 3600,
) -> None:
    """写缓存。ttl_seconds=0 表示永不过期。"""
    now = int(time.time())
    expires_at = 0 if ttl_seconds == 0 else now + ttl_seconds
    with transaction() as conn:
        conn.execute(
            """
            INSERT INTO llm_cache
              (cache_key, endpoint, model, ticker, response_json,
               prompt_tokens, completion_tokens, created_at, expires_at, hit_count)
            VALUES (?,?,?,?,?,?,?,?,?,0)
            ON CONFLICT(cache_key) DO UPDATE SET
              response_json     = excluded.response_json,
              prompt_tokens     = excluded.prompt_tokens,
              completion_tokens = excluded.completion_tokens,
              created_at        = excluded.created_at,
              expires_at        = excluded.expires_at
            """,
            (
                cache_key, endpoint, model, ticker,
                _json.dumps(response, ensure_ascii=False),
                prompt_tokens, completion_tokens, now, expires_at,
            ),
        )


def llm_cache_stats() -> dict:
    """端点级别的命中/调用统计。"""
    conn = _get_conn()
    by_endpoint = [
        dict(r)
        for r in conn.execute(
            "SELECT endpoint, COUNT(*) as entries, SUM(hit_count) as total_hits, "
            "SUM(prompt_tokens) as p_tokens, SUM(completion_tokens) as c_tokens "
            "FROM llm_cache GROUP BY endpoint"
        )
    ]
    total_entries = conn.execute("SELECT COUNT(*) FROM llm_cache").fetchone()[0]
    return {
        "total_entries": total_entries,
        "by_endpoint": by_endpoint,
    }


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
