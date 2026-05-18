"""
mining_alpha.data_loader — 从 SQLite + tushare 加载 panel 数据
==========================================================

主要 API:
  - load_panel(start, end, universe='CSI800') → dict[field, DataFrame]
    返回 wide-format panel：index=trade_date, columns=ts_code。
  - load_benchmark(symbol, start, end) → pd.Series
    加载基准指数（HS300/CSI800/CSI500）日 close。
  - get_universe(universe, as_of) → list[ts_code]
    PIT universe — 给定日期 as_of 的成分股。
  - sync_universe_history(universe, start, end) → pd.DataFrame
    从 tushare 拉月末 index_weight 写入 SQLite。
  - sync_daily_bars(tickers, start, end) → dict
    从 tushare 拉指定 ticker 的 OHLCV+amount 写入 daily_bars。

数据约定:
  - 价格 = 后复权（用 daily_bars.adj_factor 应用）
  - 量 = 原始（tushare A 股: 手；输出保留原始单位）
  - 额 = 原始（tushare A 股: 千元）
  - VWAP = amount / volume * 10  (A 股单位换算: 千元/手 × 10 → 元/股)
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

# 让 import 父目录的 backend 模块工作（与现有 universe/sync_cn.py 同款做法）
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import db as _db  # noqa: E402

# tushare 是可选的：仅 sync_* 函数需要
try:
    from data_sources.tushare_source import _get_pro, TushareError  # noqa: E402
    HAS_TUSHARE = True
except Exception:
    HAS_TUSHARE = False

    class TushareError(RuntimeError):
        pass

# akshare 作 tushare daily 接口的免费降级备援
try:
    import akshare as ak  # noqa: E402
    HAS_AKSHARE = True
except Exception:
    HAS_AKSHARE = False


# CSI 指数 ID 映射（tushare 的 index_weight 接口需要的 index_code）
INDEX_CODES: dict[str, str] = {
    "CSI300": "000300.SH",
    "CSI500": "000905.SH",
    "CSI800": "000906.SH",
    "CSI1000": "000852.SH",
    "DEMO": "DEMO.IDX",  # 合成数据 demo (mining_alpha.synthetic_demo)
}


# ── 内部表：成分股历史 ─────────────────────────────────────
_INIT_INDEX_WEIGHT_SQL = """
CREATE TABLE IF NOT EXISTS index_weight (
  index_id      TEXT NOT NULL,            -- '000906.SH' 等
  ts_code       TEXT NOT NULL,            -- 成分股 ts_code
  trade_date    TEXT NOT NULL,            -- 'YYYY-MM-DD' (月末快照日)
  weight        REAL,                     -- 权重 (%)
  ingested_at   INTEGER NOT NULL,
  PRIMARY KEY (index_id, ts_code, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_index_weight_date ON index_weight(trade_date);
CREATE INDEX IF NOT EXISTS idx_index_weight_index ON index_weight(index_id, trade_date);
"""


def _ensure_index_weight_table() -> None:
    """幂等创建 index_weight 表。"""
    conn = _db._get_conn()
    conn.executescript(_INIT_INDEX_WEIGHT_SQL)


# ── Panel 加载 ────────────────────────────────────────────────


def _query_bars(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    """从 daily_bars 拉指定 tickers 的行情，返回 long-format DataFrame。"""
    if not tickers:
        return pd.DataFrame()
    conn = _db._get_conn()
    placeholders = ",".join("?" * len(tickers))
    sql = f"""
      SELECT ticker, trade_date, open, high, low, close, volume, amount, adj_factor
      FROM daily_bars
      WHERE ticker IN ({placeholders})
        AND trade_date >= ?
        AND trade_date <= ?
      ORDER BY trade_date, ticker
    """
    rows = conn.execute(sql, (*tickers, start, end)).fetchall()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(
        [dict(r) for r in rows],
        columns=["ticker", "trade_date", "open", "high", "low", "close", "volume", "amount", "adj_factor"],
    )


def _default_benchmark_for(universe: str) -> str:
    """根据 universe 自动选默认基准。"""
    if universe.upper() == "DEMO":
        return "DEMO.IDX"
    # 默认 HS300
    return "000300.SH"


def load_panel(
    start: str,
    end: str,
    universe: str = "CSI800",
    *,
    apply_adj: bool = True,
    require_pit_universe: bool = True,
    extra_tickers: list[str] | None = None,
    benchmark_symbol: str | None = None,
) -> dict[str, pd.DataFrame]:
    """
    加载 wide-format panel：每个字段一张 dates × tickers DataFrame。

    Args:
      start, end: 'YYYY-MM-DD'
      universe: 'CSI300' / 'CSI500' / 'CSI800' / 'ALL'（'ALL' 跳过 universe 过滤）
      apply_adj: 是否应用后复权因子到 OHLC。volume/amount 不变。
      require_pit_universe: True 用月末 index_weight 历史成分；False 用 universe 在 end 日的成分
      extra_tickers: 额外要包含的 ticker（用于调试/手动加入）
      benchmark_symbol: 基准指数 ts_code（默认 HS300）；None 跳过。
        会广播为 'bench_open' / 'bench_high' / 'bench_low' / 'bench_close' 等
        dates × tickers DataFrame（每日同值），供 Alpha75/149/181/182 使用。

    Returns:
      dict 含 keys: 'open', 'high', 'low', 'close', 'volume', 'amount', 'vwap', 'ret',
                    'bench_open', 'bench_high', 'bench_low', 'bench_close' (if benchmark_symbol)
      每个 value 是 pd.DataFrame，index=trade_date (升序), columns=ts_code。
      不在 PIT universe 的格点为 NaN（保留 panel 矩形）。
    """
    # 1) 确定 universe 候选 tickers
    if universe.upper() == "ALL":
        # 全 A：直接拉所有 daily_bars 里 ts_code 后缀 .SH/.SZ 的
        conn = _db._get_conn()
        rows = conn.execute(
            "SELECT DISTINCT ticker FROM daily_bars WHERE ticker LIKE '%.SH' OR ticker LIKE '%.SZ'"
        ).fetchall()
        candidate_tickers = sorted({r[0] for r in rows})
        pit_history = None
    else:
        index_id = INDEX_CODES.get(universe.upper())
        if index_id is None:
            raise ValueError(f"未知 universe: {universe}，支持: {list(INDEX_CODES)} 或 'ALL'")
        pit_history = _load_index_weight_history(index_id, start, end)
        if pit_history.empty:
            raise RuntimeError(
                f"index_weight 表里没有 {universe} ({index_id}) 在 [{start}, {end}] 的数据；"
                f"先跑 sync_universe_history('{universe}', '{start}', '{end}')"
            )
        candidate_tickers = sorted(pit_history.columns.tolist())

    if extra_tickers:
        candidate_tickers = sorted(set(candidate_tickers) | set(extra_tickers))

    if not candidate_tickers:
        raise RuntimeError(f"universe {universe} 候选 ticker 为空")

    # 2) 拉行情
    df_long = _query_bars(candidate_tickers, start, end)
    if df_long.empty:
        raise RuntimeError(
            f"daily_bars 表里没有 {len(candidate_tickers)} 个 ticker 在 [{start}, {end}] 的数据；"
            f"先跑 sync_daily_bars(...)"
        )

    # 3) 应用复权
    if apply_adj:
        adj = df_long["adj_factor"].fillna(1.0)
        for col in ("open", "high", "low", "close"):
            df_long[col] = df_long[col] * adj
        # 反向调整：把后复权价格除以最新 adj_factor，得到"相对最新价"的价格序列
        # 工业惯例：使用 adj_factor / latest_adj_factor 做整体归一化
        # 这里简化为直接 close * adj_factor（后复权）

    # 4) Wide-format pivot
    fields = ("open", "high", "low", "close", "volume", "amount")
    panel: dict[str, pd.DataFrame] = {}
    for field in fields:
        wide = df_long.pivot(index="trade_date", columns="ticker", values=field)
        # 索引转 datetime 便于后续操作
        wide.index = pd.to_datetime(wide.index)
        wide = wide.sort_index()
        panel[field] = wide

    # 对齐所有字段列（取并集）并填充 NaN
    all_tickers = sorted(set().union(*(p.columns for p in panel.values())))
    all_dates = sorted(set().union(*(p.index for p in panel.values())))
    for field in fields:
        panel[field] = panel[field].reindex(index=all_dates, columns=all_tickers)

    # 5) PIT universe 过滤：把不在 universe 里的格点设为 NaN
    if require_pit_universe and pit_history is not None:
        pit_mask = _expand_pit_mask(pit_history, all_dates, all_tickers)
        for field in fields:
            panel[field] = panel[field].where(pit_mask)

    # 6) 派生字段
    # VWAP: tushare A 股 amount=千元, volume=手 → 元/股 = amount/volume * 10
    # 注意复权后 close 已经调整，VWAP 用原始 amount/volume 表示
    # pandas 3.x 移除了 mode.use_inf_as_na；直接 replace inf
    vwap = panel["amount"] / panel["volume"] * 10.0
    panel["vwap"] = vwap.replace([np.inf, -np.inf], np.nan).astype(float)

    # RET = close.pct_change()（复权后）
    panel["ret"] = panel["close"].pct_change()

    # 7) 基准指数（广播到 dates × tickers，每日同值）
    if benchmark_symbol is None:
        benchmark_symbol = _default_benchmark_for(universe)
    if benchmark_symbol:
        try:
            bench_ohlc = load_benchmark_ohlc(benchmark_symbol, start, end)
            for col_name, bench_field in [
                ("bench_open", "open"), ("bench_high", "high"),
                ("bench_low", "low"), ("bench_close", "close"),
            ]:
                series = bench_ohlc[bench_field].reindex(all_dates)
                # 广播为 dates × tickers DataFrame
                panel[col_name] = pd.DataFrame(
                    np.tile(series.values[:, None], (1, len(all_tickers))),
                    index=all_dates, columns=all_tickers,
                )
        except Exception as e:
            print(f"  [warn] 加载基准 {benchmark_symbol} 失败: {e}；跳过 bench_* 字段")

    return panel


def load_industry(ts_codes: list[str]) -> pd.Series:
    """
    从 tushare pro.stock_basic 加载 ts_code → industry 映射。
    用于行业中性化。返回 pd.Series, index=ts_code, value=industry(str)。
    """
    if not HAS_TUSHARE:
        raise TushareError("tushare 不可用，无法加载行业数据")
    pro = _get_pro()
    df = pro.stock_basic(
        exchange="", list_status="L",
        fields="ts_code,industry",
    )
    if df is None or df.empty:
        raise TushareError("stock_basic 返回空")
    df = df[df["ts_code"].isin(ts_codes)]
    return df.set_index("ts_code")["industry"].fillna("Unknown")


def load_industry_panel(ts_codes: list[str], dates: list) -> pd.DataFrame:
    """
    把 ts_code → industry 映射广播为 dates × tickers DataFrame（每行同值）。
    """
    industry_map = load_industry(ts_codes)
    industry_arr = np.tile(
        industry_map.reindex(ts_codes).fillna("Unknown").values[None, :],
        (len(dates), 1),
    )
    return pd.DataFrame(industry_arr, index=dates, columns=ts_codes)


def load_mktcap_panel(
    ts_codes: list[str], start: str, end: str,
) -> pd.DataFrame:
    """
    加载日度市值 panel：dates × tickers DataFrame，单位元（total_mv 来自 tushare daily_basic）。

    依赖：tushare 2000+ 积分（daily_basic）。
    """
    if not HAS_TUSHARE:
        raise TushareError("tushare 不可用，无法加载市值数据")
    pro = _get_pro()
    start_ts = start.replace("-", "")
    end_ts = end.replace("-", "")

    frames = []
    # tushare daily_basic 单调按 trade_date 拉，每次最多 5000 行。
    # 对一只 ts_code 拉历史 daily_basic 较慢；用按 ticker 循环（CSI800 约 800 次调用）。
    for tc in ts_codes:
        try:
            df = pro.daily_basic(
                ts_code=tc, start_date=start_ts, end_date=end_ts,
                fields="ts_code,trade_date,total_mv",
            )
        except Exception:
            continue
        if df is None or df.empty:
            continue
        df["trade_date"] = pd.to_datetime(df["trade_date"].astype(str), format="%Y%m%d")
        frames.append(df.set_index("trade_date")["total_mv"].rename(tc))

    if not frames:
        return pd.DataFrame()
    panel = pd.concat(frames, axis=1).sort_index()
    return panel.reindex(columns=ts_codes)


def compute_tradeable_mask(
    panel: dict[str, pd.DataFrame],
    *,
    limit_up_pct: float = 0.099,
    limit_down_pct: float = -0.099,
    min_volume: float = 1.0,
    skip_first_n_days: int = 30,
) -> pd.DataFrame:
    """
    生成 dates × tickers 的"可交易"布尔 mask。
    True 表示 t 日收盘后可对 t+1 开盘下单。

    剔除条件:
      - volume <= 0 (停牌/无成交)
      - 当日收盘价相对昨收涨跌 ≥ ±9.9% (涨跌停板)
      - 新股 / 次新股前 N 个有数据日（list_date 后 30 日内常常无法买入）

    Args:
      panel: load_panel() 返回的 dict，需含 'close', 'volume'
      limit_up_pct / limit_down_pct: 涨/跌停板阈值（A 股主板 ±10%）
      min_volume: 当日成交量阈值
      skip_first_n_days: 每只 ticker 出现在 panel 后跳过 N 个日（次新股保护）

    Returns:
      DataFrame[bool]，True = 可交易。
    """
    close = panel["close"]
    volume = panel["volume"]
    prev_close = close.shift(1)
    ret = (close - prev_close) / prev_close

    has_volume = volume.fillna(0) > min_volume
    not_limit_up = ret < limit_up_pct
    not_limit_down = ret > limit_down_pct
    base_mask = has_volume & not_limit_up & not_limit_down

    if skip_first_n_days > 0:
        # 每只 ticker 第一次出现非 NaN 的位置；之后 N 日内置 False
        valid_count = close.notna().cumsum()
        # valid_count > skip_first_n_days 时才允许交易
        skip_mask = valid_count > skip_first_n_days
        base_mask = base_mask & skip_mask

    return base_mask.fillna(False)


def load_benchmark_ohlc(symbol: str, start: str, end: str) -> pd.DataFrame:
    """
    加载基准指数 OHLC DataFrame。
    优先从 SQLite daily_bars（ts_code=指数代码），缺失时尝试 tushare pro.index_daily。

    Returns:
      pd.DataFrame, index=trade_date (datetime)，columns=['open','high','low','close']。
    """
    conn = _db._get_conn()
    rows = conn.execute(
        "SELECT trade_date, open, high, low, close FROM daily_bars "
        "WHERE ticker=? AND trade_date>=? AND trade_date<=? ORDER BY trade_date",
        (symbol, start, end),
    ).fetchall()
    if rows:
        df = pd.DataFrame([dict(r) for r in rows],
                          columns=["trade_date", "open", "high", "low", "close"])
        df["trade_date"] = pd.to_datetime(df["trade_date"])
        return df.set_index("trade_date").sort_index()

    if not HAS_TUSHARE:
        raise RuntimeError(f"基准 {symbol} 不在 daily_bars，且 tushare 不可用")
    pro = _get_pro()
    start_ts = start.replace("-", "")
    end_ts = end.replace("-", "")
    df = pro.index_daily(ts_code=symbol, start_date=start_ts, end_date=end_ts,
                         fields="trade_date,open,high,low,close")
    if df is None or df.empty:
        raise RuntimeError(f"tushare index_daily 返回空: {symbol}")
    df["trade_date"] = pd.to_datetime(df["trade_date"].astype(str), format="%Y%m%d")
    return df.set_index("trade_date").sort_index()[["open", "high", "low", "close"]]


def _load_index_weight_history(index_id: str, start: str, end: str) -> pd.DataFrame:
    """从 SQLite index_weight 拉历史成分股，返回 dates × tickers 的权重矩阵（只在月末日有非 NaN）。"""
    _ensure_index_weight_table()
    conn = _db._get_conn()
    # 取 [start, end] 范围内的所有 (trade_date, ts_code, weight)
    rows = conn.execute(
        """
        SELECT trade_date, ts_code, weight
        FROM index_weight
        WHERE index_id = ? AND trade_date >= ? AND trade_date <= ?
        """,
        (index_id, start, end),
    ).fetchall()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame([dict(r) for r in rows], columns=["trade_date", "ts_code", "weight"])
    return df.pivot(index="trade_date", columns="ts_code", values="weight")


def _expand_pit_mask(
    pit_history: pd.DataFrame, all_dates: list, all_tickers: list,
) -> pd.DataFrame:
    """
    把月末快照扩展到日度 mask：
      在 [snapshot_t, snapshot_{t+1}) 区间内，universe = snapshot_t 的成分
    返回 dates × tickers 的 bool DataFrame，True = 在 universe 里。
    """
    pit_history = pit_history.copy()
    pit_history.index = pd.to_datetime(pit_history.index)
    pit_history = pit_history.sort_index()
    # bool mask：weight > 0（or NaN→False）
    bool_snapshot = pit_history.notna()

    # reindex 到全部 dates，用 forward-fill
    full = bool_snapshot.reindex(pd.to_datetime(all_dates), method="ffill").fillna(False)
    # 确保列覆盖 all_tickers，缺失列填 False
    full = full.reindex(columns=all_tickers, fill_value=False)
    return full


# ── 基准指数加载 ──────────────────────────────────────────────


def load_benchmark(symbol: str = "000300.SH", start: str = None, end: str = None) -> pd.Series:
    """
    加载基准指数日 close。优先从 SQLite daily_bars（ts_code=指数代码）；
    缺失时尝试 tushare pro.index_daily。

    Returns:
      pd.Series, index=trade_date (datetime), name=symbol。
    """
    conn = _db._get_conn()
    if start and end:
        rows = conn.execute(
            "SELECT trade_date, close FROM daily_bars WHERE ticker=? AND trade_date>=? AND trade_date<=? ORDER BY trade_date",
            (symbol, start, end),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT trade_date, close FROM daily_bars WHERE ticker=? ORDER BY trade_date",
            (symbol,),
        ).fetchall()
    if rows:
        s = pd.Series(
            [r["close"] for r in rows],
            index=pd.to_datetime([r["trade_date"] for r in rows]),
            name=symbol,
        )
        return s

    if not HAS_TUSHARE:
        raise RuntimeError(f"基准 {symbol} 不在 daily_bars 表里，且 tushare 不可用")

    pro = _get_pro()
    start_ts = start.replace("-", "") if start else "20100101"
    end_ts = end.replace("-", "") if end else datetime.now().strftime("%Y%m%d")
    df = pro.index_daily(ts_code=symbol, start_date=start_ts, end_date=end_ts)
    if df is None or df.empty:
        raise RuntimeError(f"tushare index_daily 返回空: {symbol}")
    df["trade_date"] = pd.to_datetime(df["trade_date"].astype(str), format="%Y%m%d")
    return df.set_index("trade_date").sort_index()["close"].rename(symbol)


# ── universe 同步 ─────────────────────────────────────────────


def get_universe(universe: str = "CSI800", as_of: str | None = None) -> list[str]:
    """
    返回 universe 在 as_of 日期（或当前）的成分股列表。
    优先从 SQLite index_weight 读最近一次月末快照。
    """
    index_id = INDEX_CODES.get(universe.upper())
    if index_id is None:
        raise ValueError(f"未知 universe: {universe}")
    _ensure_index_weight_table()
    conn = _db._get_conn()
    if as_of:
        row = conn.execute(
            """
            SELECT MAX(trade_date) as d FROM index_weight
            WHERE index_id = ? AND trade_date <= ?
            """,
            (index_id, as_of),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT MAX(trade_date) as d FROM index_weight WHERE index_id = ?",
            (index_id,),
        ).fetchone()
    if not row or not row["d"]:
        raise RuntimeError(
            f"index_weight 表里没有 {universe} 的快照；先跑 sync_universe_history(...)"
        )
    rows = conn.execute(
        "SELECT ts_code FROM index_weight WHERE index_id=? AND trade_date=? ORDER BY ts_code",
        (index_id, row["d"]),
    ).fetchall()
    return [r["ts_code"] for r in rows]


def sync_universe_history(
    universe: str = "CSI800",
    start: str = "2019-01-01",
    end: str | None = None,
) -> int:
    """
    从 tushare 拉指定 universe 在 [start, end] 区间的月末 index_weight，写入 SQLite。

    Returns:
      插入条数。
    """
    if not HAS_TUSHARE:
        raise TushareError("tushare 不可用，无法同步 universe 历史")
    index_id = INDEX_CODES.get(universe.upper())
    if index_id is None:
        raise ValueError(f"未知 universe: {universe}")
    _ensure_index_weight_table()
    pro = _get_pro()

    end = end or datetime.now().strftime("%Y-%m-%d")
    # 生成月末日期列表（YYYYMMDD）
    month_ends = pd.date_range(start=start, end=end, freq="ME").strftime("%Y%m%d").tolist()
    if not month_ends:
        return 0

    import time as _time

    total = 0
    for me in month_ends:
        try:
            df = pro.index_weight(index_code=index_id, trade_date=me)
        except Exception as e:
            print(f"  [warn] index_weight({index_id}, {me}) 失败: {e}")
            continue
        if df is None or df.empty:
            continue
        rows = []
        now_ms = int(_time.time() * 1000)
        for _, row in df.iterrows():
            tdate = str(row["trade_date"])
            iso = f"{tdate[:4]}-{tdate[4:6]}-{tdate[6:8]}"
            rows.append((index_id, row["con_code"], iso, float(row.get("weight") or 0.0), now_ms))
        with _db.transaction() as conn:
            conn.executemany(
                """
                INSERT INTO index_weight (index_id, ts_code, trade_date, weight, ingested_at)
                VALUES (?,?,?,?,?)
                ON CONFLICT(index_id, ts_code, trade_date) DO UPDATE SET
                  weight      = excluded.weight,
                  ingested_at = excluded.ingested_at
                """,
                rows,
            )
        total += len(rows)
        # 限速：tushare 接口默认每分钟限 500 次，月末日期较少，不需要限速
    return total


# ── daily_bars 增量同步 ──────────────────────────────────────


def _fetch_daily_akshare(ts_code: str, start: str, end: str) -> pd.DataFrame:
    """
    akshare 拉 A 股日线 (作 tushare 不可用时的免费降级备援)。

    返回与 tushare daily 同 schema 的 DataFrame: trade_date / open / high / low /
    close / vol / amount。adj_factor 由 hfq vs raw close 比值反推。
    """
    if not HAS_AKSHARE:
        raise RuntimeError("akshare 未安装")
    # ts_code '600519.SH' → 'sh600519'，'000001.SZ' → 'sz000001'
    base, exch = ts_code.split(".")
    symbol = exch.lower() + base
    raw = ak.stock_zh_a_daily(symbol=symbol, start_date=start.replace("-", ""),
                              end_date=end.replace("-", ""), adjust="")
    hfq = ak.stock_zh_a_daily(symbol=symbol, start_date=start.replace("-", ""),
                              end_date=end.replace("-", ""), adjust="hfq")
    if raw is None or raw.empty:
        return pd.DataFrame()
    raw["trade_date"] = pd.to_datetime(raw["date"]).dt.strftime("%Y%m%d")
    raw = raw.rename(columns={"volume": "vol"})
    # adj_factor = hfq_close / raw_close
    if hfq is not None and not hfq.empty:
        hfq["trade_date"] = pd.to_datetime(hfq["date"]).dt.strftime("%Y%m%d")
        merged = raw.merge(
            hfq[["trade_date", "close"]].rename(columns={"close": "close_hfq"}),
            on="trade_date", how="left",
        )
        merged["adj_factor"] = merged["close_hfq"] / merged["close"]
        merged["adj_factor"] = merged["adj_factor"].fillna(1.0)
    else:
        merged = raw
        merged["adj_factor"] = 1.0
    return merged[["trade_date", "open", "high", "low", "close", "vol", "amount", "adj_factor"]]


def sync_daily_bars(
    tickers: list[str],
    start: str,
    end: str | None = None,
    *,
    batch_size: int = 50,
    max_retries: int = 3,
    use_akshare_fallback: bool = True,
    incremental: bool = True,
) -> dict:
    """
    从 tushare 拉指定 ts_code 的 OHLCV+amount+adj_factor，写入 daily_bars。
    A 股 ts_code 形如 '600519.SH' / '000001.SZ'。

    Args:
      tickers: ts_code 列表
      start, end: ISO 日期 'YYYY-MM-DD'
      batch_size: 限速保险触发批量
      max_retries: 单 ticker 失败重试次数（指数退避 1s/2s/4s）
      use_akshare_fallback: tushare 拉空/抛权限错时是否用 akshare 备援
      incremental: 增量模式 — 若 sync_state 已记录 last_bar_date，则从 last_bar_date+1 开始

    Returns:
      {'inserted': N, 'failed': [ts_code,...], 'total': N+failed,
       'fallback_used': [ts_code,...]}
    """
    if not HAS_TUSHARE and not (HAS_AKSHARE and use_akshare_fallback):
        raise RuntimeError("tushare 和 akshare 都不可用，无法同步行情")
    end = end or datetime.now().strftime("%Y-%m-%d")

    pro = _get_pro() if HAS_TUSHARE else None
    stats = {"inserted": 0, "failed": [], "total": len(tickers), "fallback_used": []}
    import time as _time

    for ts_code in tickers:
        # 1) 增量起点
        per_ticker_start = start
        if incremental:
            last = _db.get_latest_bar_date(ts_code)
            if last and last >= start:
                from datetime import datetime as _dt, timedelta as _td
                per_ticker_start = (_dt.fromisoformat(last) + _td(days=1)).strftime("%Y-%m-%d")
                if per_ticker_start > end:
                    continue  # 已经是最新

        start_ts = per_ticker_start.replace("-", "")
        end_ts = end.replace("-", "")
        df = None
        adj = None
        used_fallback = False

        # 2) 优先 tushare + 重试
        if HAS_TUSHARE:
            for attempt in range(max_retries):
                try:
                    df = pro.daily(ts_code=ts_code, start_date=start_ts, end_date=end_ts)
                    adj = pro.adj_factor(ts_code=ts_code, start_date=start_ts, end_date=end_ts)
                    break
                except Exception as e:
                    err_msg = str(e)
                    # 权限错直接降级 akshare，不重试
                    if "权限" in err_msg or "permission" in err_msg.lower():
                        df = None
                        break
                    if attempt < max_retries - 1:
                        _time.sleep(2 ** attempt)  # 1s, 2s, 4s
                    else:
                        df = None

        # 3) tushare 失败时降级 akshare
        if (df is None or (hasattr(df, "empty") and df.empty)) and use_akshare_fallback and HAS_AKSHARE:
            try:
                df = _fetch_daily_akshare(ts_code, per_ticker_start, end)
                used_fallback = True
                if df is not None and not df.empty:
                    stats["fallback_used"].append(ts_code)
            except Exception as e:
                print(f"  [warn] {ts_code} akshare fallback 失败: {e}")
                df = None

        if df is None or df.empty:
            stats["failed"].append(ts_code)
            _db.mark_sync_failure(ts_code, "tushare", "all attempts failed (incl. akshare fallback)")
            continue

        # 4) 合并 adj（tushare 路径用单独 adj_factor 表；akshare 路径已含在 df 里）
        if not used_fallback and adj is not None and not adj.empty:
            adj = adj[["trade_date", "adj_factor"]]
            df = df.merge(adj, on="trade_date", how="left")
        if "adj_factor" not in df.columns:
            df["adj_factor"] = 1.0
        df["adj_factor"] = df["adj_factor"].fillna(1.0)

        # 5) 转 rows + 写库
        rows = []
        for _, r in df.iterrows():
            tdate = str(r["trade_date"])
            iso = f"{tdate[:4]}-{tdate[4:6]}-{tdate[6:8]}"
            rows.append({
                "trade_date": iso,
                "open": float(r["open"]) if pd.notna(r["open"]) else None,
                "high": float(r["high"]) if pd.notna(r["high"]) else None,
                "low": float(r["low"]) if pd.notna(r["low"]) else None,
                "close": float(r["close"]),
                "volume": int(r["vol"]) if pd.notna(r["vol"]) else None,
                "amount": float(r["amount"]) if pd.notna(r["amount"]) else None,
                "adj_factor": float(r["adj_factor"]),
            })
        source = "akshare" if used_fallback else "tushare"
        n = _db.upsert_bars(ts_code, rows, source=source)
        stats["inserted"] += n
        if stats["inserted"] % batch_size == 0:
            _time.sleep(0.3)
    return stats


# ── CLI 自检 ──────────────────────────────────────────────────


def health_check() -> dict:
    """检查 data_loader 依赖是否就位。"""
    _db.init_db()  # 确保 daily_bars 等表已创建
    _ensure_index_weight_table()
    conn = _db._get_conn()
    out = {"tushare_available": HAS_TUSHARE}
    # daily_bars 概览
    row = conn.execute(
        "SELECT COUNT(DISTINCT ticker) AS n_tickers, MIN(trade_date) AS first, MAX(trade_date) AS last "
        "FROM daily_bars WHERE ticker LIKE '%.SH' OR ticker LIKE '%.SZ'"
    ).fetchone()
    out["a_share_tickers_in_bars"] = row["n_tickers"]
    out["bars_date_range"] = (row["first"], row["last"])
    # index_weight 概览
    rows = conn.execute(
        "SELECT index_id, COUNT(DISTINCT ts_code) AS n, MIN(trade_date) AS first, MAX(trade_date) AS last "
        "FROM index_weight GROUP BY index_id"
    ).fetchall()
    out["index_weight_coverage"] = [dict(r) for r in rows]
    return out


if __name__ == "__main__":
    import json

    print(json.dumps(health_check(), indent=2, default=str, ensure_ascii=False))
