"""
数据源路由器（多源版 + L0 SQLite 缓存）
========================================
优先级链:
  L0 SQLite 库      —— 命中且新鲜（≤3 天）直接返回，不走网络
  L1 tushare        —— 全市场（A/HK/US，需 TUSHARE_TOKEN）
  L2 iTick          —— 全市场
  L3 Futu           —— 仅 HK/SH/SZ
  L4 yfinance       —— 全市场兜底

每一层失败后自动降级到下一层。
任何远程层成功后会自动写库（_persist_to_db），下次直接命中 L0。

行情数据 (K线/报价): L0 → tushare → iTick → Futu(港股/A股) → yfinance
财务数据:           iTick info + AKShare(港股) + yfinance info

市场支持:
  US (美股)       — tushare → iTick → yfinance
  HK (港股)       — tushare → iTick → Futu → yfinance
  SH/SZ/CN (A股)  — tushare → iTick → Futu → yfinance
  KR (韩股)       — iTick → yfinance     (Futu/tushare 不支持)
  JP (日股)       — iTick → yfinance     (Futu/tushare 不支持)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd

# ── 每个数据源独立 try/except —— 缺任一不影响其他 ──
# 缺失的源在路由链中自动跳过；标志位用于 health_check 与决策
import sys as _sys

def _try_import(name):
    try:
        mod = __import__(f"{__package__}.{name}", fromlist=[name])
        return mod, True, ""
    except Exception as e:
        print(f"[router] {name} unavailable: {e}", file=_sys.stderr)
        return None, False, str(e)

itick_source,    HAS_ITICK,    _ITICK_ERR    = _try_import("itick_source")
futu_source,     HAS_FUTU,     _FUTU_ERR     = _try_import("futu_source")
yfinance_source, HAS_YFINANCE, _YFINANCE_ERR = _try_import("yfinance_source")
akshare_source,  HAS_AKSHARE,  _AKSHARE_ERR  = _try_import("akshare_source")
tushare_source,  HAS_TUSHARE,  _TUSHARE_ERR  = _try_import("tushare_source")

# 延迟导入 db（启动顺序敏感）
# backend/ 不是 package（没 __init__.py），用绝对导入。调用方需保证
# sys.path 包含 backend 目录（server.py 启动时已是这样）。
try:
    import db as _db  # type: ignore
    HAS_DB = True
except Exception as _db_err:
    HAS_DB = False
    _db = None  # type: ignore

# Futu 支持的市场
_FUTU_MARKETS = {"HK", "SH", "SZ", "CN"}
# tushare 支持的市场
_TUSHARE_MARKETS = {"HK", "SH", "SZ", "CN", "US"}

# L0 缓存"新鲜度"门槛：库里最新一根 K 线距今 ≤3 天即视为新鲜
_FRESH_DAYS = 3


# ── 工具：DataFrame ↔ DB rows ─────────────────────────────
def _df_to_rows(df: pd.DataFrame) -> list[dict]:
    """把 yfinance/tushare 风格 DataFrame 转为 db.upsert_bars 期望的 dict 列表。"""
    if df is None or df.empty:
        return []
    rows = []
    has_amount = "Amount" in df.columns
    has_adj = "AdjFactor" in df.columns
    import math
    for idx, r in df.iterrows():
        close_raw = r.get("Close")
        if pd.isna(close_raw):
            continue
        try:
            close_f = float(close_raw)
        except (TypeError, ValueError):
            continue
        # 数据 sanity（与 db._is_sane_bar 对齐）—— 拒绝 NaN / inf / ≤0
        if math.isnan(close_f) or math.isinf(close_f) or close_f <= 0:
            continue
        d_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        rows.append({
            "trade_date": d_str,
            "open":  float(r["Open"])  if pd.notna(r.get("Open"))  else None,
            "high":  float(r["High"])  if pd.notna(r.get("High"))  else None,
            "low":   float(r["Low"])   if pd.notna(r.get("Low"))   else None,
            "close": close_f,
            "volume": int(r["Volume"]) if pd.notna(r.get("Volume")) else None,
            "amount": float(r["Amount"]) if has_amount and pd.notna(r.get("Amount")) else None,
            "adj_factor": float(r["AdjFactor"]) if has_adj and pd.notna(r.get("AdjFactor")) else 1.0,
        })
    return rows


def _rows_to_df(rows: list[dict]) -> pd.DataFrame:
    """把 db.get_bars 返回的 dict 列表转回 DataFrame。"""
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["Date"] = pd.to_datetime(df["trade_date"])
    df = df.set_index("Date").sort_index()
    df = df.rename(columns={
        "open": "Open", "high": "High", "low": "Low",
        "close": "Close", "volume": "Volume", "amount": "Amount",
        "adj_factor": "AdjFactor",
    })
    cols = ["Open", "High", "Low", "Close", "Volume", "AdjFactor"]
    if "Amount" in df.columns:
        cols.append("Amount")
    return df[cols]


def _persist_to_db(cfg: dict, df: pd.DataFrame, source: str) -> None:
    """远程拉取成功后回写 SQLite。失败仅日志，不影响调用方。"""
    if not HAS_DB or _db is None:
        return
    try:
        ticker = _db.normalize_ticker(cfg)
        rows = _df_to_rows(df)
        if rows:
            _db.upsert_bars(ticker, rows, source)
    except Exception as e:
        print(f"[router] _persist_to_db failed ({source}): {e}")


# ── 行情数据 (K线) ────────────────────────────────────────

def fetch_history(cfg: dict, days: int = 120, *, prefer_db: bool = True) -> tuple[pd.DataFrame, str]:
    """
    拉取日 K 线，按优先级尝试多个数据源。
    返回 (DataFrame, source_name)。

    prefer_db=True: 先查 SQLite 库；命中且新鲜直接返回（不走网络）。
                   增量同步任务自身应传 prefer_db=False，避免循环命中。
    """
    market = (cfg.get("market") or "").upper()
    errors: list[str] = []

    # ── L0: SQLite 零级缓存 ──
    if prefer_db and HAS_DB and _db is not None:
        try:
            ticker = _db.normalize_ticker(cfg)
            last_bar = _db.get_latest_bar_date(ticker)
            if last_bar:
                last_dt = datetime.strptime(last_bar, "%Y-%m-%d").date()
                days_old = (date.today() - last_dt).days
                if days_old <= _FRESH_DAYS:
                    start = (date.today() - timedelta(days=days)).isoformat()
                    rows = _db.get_bars(ticker, start=start)
                    if len(rows) >= 5:
                        return _rows_to_df(rows), "sqlite-cache"
        except Exception as e:
            errors.append(f"sqlite-cache: {e}")

    # ── L1: tushare ──
    if HAS_TUSHARE and market in _TUSHARE_MARKETS:
        try:
            df = tushare_source.fetch_history(cfg, days=days)
            if df is not None and len(df) >= 5:
                _persist_to_db(cfg, df, "tushare")
                return df, "tushare"
        except Exception as e:
            errors.append(f"tushare: {e}")

    # ── L2: iTick ──
    if HAS_ITICK:
        try:
            df = itick_source.fetch_history(cfg, days=days)
            if df is not None and len(df) >= 5:
                _persist_to_db(cfg, df, "itick")
                return df, "iTick"
        except Exception as e:
            errors.append(f"iTick: {e}")

    # ── L3: Futu (港股/A股) ──
    if HAS_FUTU and market in _FUTU_MARKETS:
        try:
            df = futu_source.fetch_history(cfg, days=days)
            if df is not None and len(df) >= 5:
                _persist_to_db(cfg, df, "futu")
                return df, "Futu"
        except Exception as e:
            errors.append(f"Futu: {e}")

    # ── L4: yfinance 兜底 ──
    if HAS_YFINANCE:
        try:
            df = yfinance_source.fetch_history(cfg, days=days)
            if df is not None and len(df) >= 5:
                _persist_to_db(cfg, df, "yfinance")
                return df, "yfinance"
        except Exception as e:
            errors.append(f"yfinance: {e}")

    raise RuntimeError(
        f"所有数据源均失败 ({cfg.get('yf_symbol')}): " + " | ".join(errors)
    )


# ── 实时报价 ──────────────────────────────────────────────

def fetch_quote(cfg: dict) -> tuple[dict, str]:
    """获取实时报价快照。返回 (quote_dict, source_name)。"""
    if HAS_ITICK:
        try:
            return itick_source.fetch_quote(cfg), "iTick"
        except Exception:
            pass

    try:
        import yfinance as yf
        tk = yf.Ticker(cfg["yf_symbol"])
        fi = tk.fast_info
        return {
            "price": fi.get("lastPrice"),
            "open": fi.get("open"),
            "high": fi.get("dayHigh"),
            "low": fi.get("dayLow"),
            "prev_close": fi.get("previousClose"),
            "volume": fi.get("lastVolume"),
            "change": None,
            "change_pct": None,
        }, "yfinance"
    except Exception:
        pass

    return {}, "none"


# ── 公司信息 ─────────────────────────────────────────────

def fetch_info(cfg: dict) -> tuple[dict, str]:
    """获取公司基本信息（市值/PE/行业/简介）。返回 (info_dict, source_name)。"""
    if HAS_ITICK:
        try:
            return itick_source.fetch_info(cfg), "iTick"
        except Exception:
            pass
    return {}, "none"


# ── 港股财务补充 (AKShare) ────────────────────────────────

def fetch_hk_fundamentals(cfg: dict) -> tuple[dict, str]:
    """获取港股财务数据（PE/ROE/利润率等）。仅对 market=HK 的标的有效。"""
    market = (cfg.get("market") or "").upper()
    if market != "HK":
        return {}, "n/a"
    if not HAS_AKSHARE:
        return {}, "akshare-unavailable"
    try:
        ticker_key = cfg.get("yf_symbol", "")
        return akshare_source.fetch_hk_fundamentals(ticker_key), "AKShare"
    except Exception:
        return {}, "none"


# ── 搜索 ─────────────────────────────────────────────────

def search_stocks(keyword: str, market: str = "HK") -> pd.DataFrame:
    """按关键词搜索股票（AKShare 源）。"""
    if not HAS_AKSHARE:
        return pd.DataFrame()
    return akshare_source.search_stocks(keyword, market)


# ── 健康检查 ──────────────────────────────────────────────

def _safe_health(source_mod, fallback_err: str) -> tuple[bool, str]:
    """对单个源做健康检查，捕获所有异常。"""
    if source_mod is None:
        return False, fallback_err
    try:
        return source_mod.health_check()
    except Exception as e:
        return False, f"health_check 异常: {e}"


def health_check() -> dict:
    """检查所有数据源健康状态。缺失的源不会让本函数挂掉。"""
    return {
        "iTick":    _safe_health(itick_source,    _ITICK_ERR    or "iTick 未加载"),
        "Futu":     _safe_health(futu_source,     _FUTU_ERR     or "Futu 未加载"),
        "AKShare":  _safe_health(akshare_source,  _AKSHARE_ERR  or "AKShare 未加载"),
        "yfinance": (HAS_YFINANCE, _YFINANCE_ERR or "yfinance 无需健康检查（按需重试）"),
        "tushare":  _safe_health(tushare_source,  _TUSHARE_ERR  or "tushare 未加载"),
    }
