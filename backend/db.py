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

-- 交易记录（A6 — Sprint 3）
-- 用户手动录入的买卖交易；持仓 = 所有 transactions 的 FIFO/加权平均聚合
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker        TEXT NOT NULL,
  side          TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  qty           REAL NOT NULL CHECK(qty > 0),
  price         REAL NOT NULL CHECK(price > 0),
  fee           REAL NOT NULL DEFAULT 0,
  traded_at     TEXT NOT NULL,    -- 'YYYY-MM-DD'
  journal_ref   INTEGER,          -- 可选关联 journal entry id
  notes         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_ticker ON transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_transactions_date   ON transactions(traded_at);

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
def _is_sane_bar(r: dict) -> bool:
    """
    数据 sanity guard：拒绝异常 row（写库前最后一道防线）。
    - close 必须是有限正数（NaN / inf / ≤0 全拒）
    - 已知症状: yfinance dividend-adjusted close 在多次拆股+大额股息时偶尔产生负值
    - high/low 颠倒、未来日期等暂不阻塞（仅日志），避免误杀边界 case
    """
    import math
    close = r.get("close")
    if close is None:
        return False
    try:
        c = float(close)
    except (TypeError, ValueError):
        return False
    if math.isnan(c) or math.isinf(c) or c <= 0:
        return False
    return True


def upsert_bars(ticker: str, rows: list[dict], source: str) -> int:
    """
    rows: [{trade_date, open, high, low, close, volume, amount, adj_factor}, ...]
    冲突策略: 仅当新源优先级 ≥ 旧源时覆盖。
    sanity: close ≤ 0 / NaN / inf 的 row 自动跳过并日志。
    返回 *实际写入* 的行数（被 sanity 过滤掉的不计）。
    """
    if not rows:
        return 0
    # Sanity 过滤
    sane = [r for r in rows if _is_sane_bar(r)]
    skipped = len(rows) - len(sane)
    if skipped > 0:
        print(f"[db] {ticker} ({source}): skipped {skipped} insane row(s) (close<=0/NaN)")
    if not sane:
        return 0
    rows = sane
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


# ── 交易记录 / 持仓 (A6 - Sprint 3) ──────────────────────
def insert_transaction(
    ticker: str, side: str, qty: float, price: float,
    *, fee: float = 0.0, traded_at: str | None = None,
    journal_ref: int | None = None, notes: str | None = None,
) -> int:
    """插入一条交易，返回新行 id。traded_at 缺省取今天。"""
    if side not in ("buy", "sell"):
        raise ValueError(f"side 必须是 buy 或 sell，收到: {side}")
    if qty <= 0 or price <= 0:
        raise ValueError("qty / price 必须 > 0")
    from datetime import date as _date
    if traded_at is None:
        traded_at = _date.today().isoformat()
    now_ms = int(time.time() * 1000)
    with transaction() as conn:
        cur = conn.execute(
            """INSERT INTO transactions (ticker, side, qty, price, fee, traded_at, journal_ref, notes, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (ticker, side, qty, price, fee, traded_at, journal_ref, notes, now_ms),
        )
        return cur.lastrowid


def list_transactions(ticker: str | None = None, limit: int = 200) -> list[dict]:
    conn = _get_conn()
    if ticker:
        cur = conn.execute(
            "SELECT * FROM transactions WHERE ticker=? ORDER BY traded_at DESC, id DESC LIMIT ?",
            (ticker, limit),
        )
    else:
        cur = conn.execute(
            "SELECT * FROM transactions ORDER BY traded_at DESC, id DESC LIMIT ?",
            (limit,),
        )
    return [dict(r) for r in cur.fetchall()]


def delete_transaction(tx_id: int) -> bool:
    with transaction() as conn:
        cur = conn.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
        return cur.rowcount > 0


def compute_positions() -> list[dict]:
    """
    用加权平均成本聚合每只 ticker 的持仓:
      - 净持仓量 net_qty = sum(buy.qty) - sum(sell.qty)
      - 平均成本 avg_cost = sum(buy.qty * buy.price + buy.fee) / sum(buy.qty)（仅买入计成本）
      - 已实现 P&L 简化：sum(sell.qty * (sell.price - avg_cost_at_time))（这里用最终 avg_cost 近似）
      - 未实现 P&L = net_qty * (latest_close - avg_cost) — latest_close 来自 daily_bars 最新一行
    返回每行: {ticker, net_qty, avg_cost, latest_close, market_value, unrealized_pnl, realized_pnl}
    净持仓为 0 的标的不返回。
    """
    conn = _get_conn()
    # 拿所有交易按 ticker 分组
    txs = [dict(r) for r in conn.execute(
        "SELECT ticker, side, qty, price, fee FROM transactions ORDER BY traded_at, id"
    )]
    by_ticker: dict[str, list[dict]] = {}
    for t in txs:
        by_ticker.setdefault(t["ticker"], []).append(t)

    out = []
    for ticker, ts in by_ticker.items():
        buy_qty = sum(t["qty"] for t in ts if t["side"] == "buy")
        sell_qty = sum(t["qty"] for t in ts if t["side"] == "sell")
        net_qty = buy_qty - sell_qty
        # 简化：忽略卖出后再买入的复杂场景
        if buy_qty <= 0:
            continue
        total_cost = sum(t["qty"] * t["price"] + (t.get("fee") or 0) for t in ts if t["side"] == "buy")
        avg_cost = total_cost / buy_qty
        realized = sum(t["qty"] * (t["price"] - avg_cost) - (t.get("fee") or 0)
                       for t in ts if t["side"] == "sell")

        # 拿最新 close
        latest_row = conn.execute(
            "SELECT close FROM daily_bars WHERE ticker=? ORDER BY trade_date DESC LIMIT 1",
            (ticker,),
        ).fetchone()
        latest_close = float(latest_row["close"]) if latest_row else None

        if net_qty <= 0:
            # 已清仓 — 仅显示已实现 P&L
            out.append({
                "ticker": ticker, "net_qty": 0, "avg_cost": round(avg_cost, 4),
                "latest_close": latest_close, "market_value": 0,
                "unrealized_pnl": 0, "realized_pnl": round(realized, 2),
                "closed": True,
            })
            continue

        market_value = net_qty * latest_close if latest_close else None
        unrealized = (net_qty * (latest_close - avg_cost)) if latest_close else None

        out.append({
            "ticker": ticker,
            "net_qty": round(net_qty, 4),
            "avg_cost": round(avg_cost, 4),
            "latest_close": round(latest_close, 4) if latest_close else None,
            "market_value": round(market_value, 2) if market_value is not None else None,
            "unrealized_pnl": round(unrealized, 2) if unrealized is not None else None,
            "unrealized_pnl_pct": round(unrealized / total_cost * 100, 2) if unrealized is not None and total_cost > 0 else None,
            "realized_pnl": round(realized, 2),
            "closed": False,
        })

    # 按 market_value 降序
    out.sort(key=lambda x: x.get("market_value") or 0, reverse=True)
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
