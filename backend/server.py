#!/usr/bin/env python3
"""
QuantEdge API Server
====================
轻量 FastAPI 后端，提供：
  - /api/search?q=AAPL       — 搜索标的 (yfinance 验证 + 实时报价)
  - /api/tickers              — 获取当前标的列表
  - /api/tickers  POST        — 添加标的
  - /api/tickers/{key} DELETE — 删除标的
  - /api/data                 — 获取完整数据 (STOCKS + ALERTS)
  - /api/refresh  POST        — 刷新全量数据

启动方式:
    pip install fastapi uvicorn
    cd backend && python server.py
"""

import json
import math
import sys
import time
import threading
from pathlib import Path
from datetime import datetime

import numpy as np
import yfinance as yf

import logging_config  # noqa: F401  — 副作用：配置轮转日志


def sanitize(obj):
    """Recursively replace NaN/Inf with None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(obj, (np.integer,)):
        return int(obj)
    return obj

try:
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("请先安装依赖: pip install fastapi uvicorn")
    sys.exit(1)

# ─── Paths ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
CUSTOM_TICKERS_PATH = BASE_DIR / "tickers_custom.json"
OUTPUT_DIR = BASE_DIR / "output"
FRONTEND_DATA_PATH = BASE_DIR.parent / "frontend" / "src" / "data.js"

# ─── Import pipeline components ────────────────────────
from config import TICKERS as BUILTIN_TICKERS, SECTOR_ETF_MAP
from factors import calc_rsi, calc_momentum, calc_stock_score, calc_etf_score, parse_leverage

# Data sources import — optional (Futu may not be installed)
try:
    from data_sources import fetch_history, health_check
    HAS_DATA_SOURCES = True
except ImportError:
    HAS_DATA_SOURCES = False
    def fetch_history(cfg, days=120):
        """Fallback: use yfinance directly."""
        symbol = cfg.get("yf_symbol", "")
        tk = yf.Ticker(symbol)
        hist = tk.history(period=f"{days}d")
        return hist, "yfinance-direct"
    def health_check():
        return {"yfinance": (True, "OK"), "futu": (False, "not installed")}

# ─── Custom Ticker Store ───────────────────────────────
def load_custom_tickers() -> dict:
    """Load user-added tickers from JSON file."""
    if CUSTOM_TICKERS_PATH.exists():
        try:
            with open(CUSTOM_TICKERS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_custom_tickers(tickers: dict):
    """Save user-added tickers to JSON file."""
    with open(CUSTOM_TICKERS_PATH, "w", encoding="utf-8") as f:
        json.dump(tickers, f, ensure_ascii=False, indent=2)

def get_all_tickers() -> dict:
    """Merge built-in + custom tickers."""
    merged = dict(BUILTIN_TICKERS)
    merged.update(load_custom_tickers())
    return merged


# ─── Data Fetching Helpers ─────────────────────────────
def safe_get(info: dict, key: str, default=None):
    val = info.get(key, default)
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return default
    return val

def fmt_big(val):
    if val is None:
        return None
    if abs(val) >= 1e12:
        return f"{val/1e12:.2f}T"
    if abs(val) >= 1e9:
        return f"{val/1e9:.1f}B"
    if abs(val) >= 1e6:
        return f"{val/1e6:.0f}M"
    return f"{val:.0f}"

def fetch_single_stock(ticker_key: str, cfg: dict) -> dict | None:
    """Fetch data for a single stock/ETF. Reuses pipeline logic."""
    symbol = cfg.get("yf_symbol", ticker_key)
    is_etf = cfg.get("type") in ("etf", "leveraged_etf")

    try:
        # Try data source router first, fallback to yfinance
        try:
            hist, src = fetch_history(cfg, days=120)
        except Exception:
            tk_obj = yf.Ticker(symbol)
            hist = tk_obj.history(period="6mo")
            src = "yfinance-fallback"

        if hist is None or hist.empty or len(hist) < 2:
            return None

        tk = yf.Ticker(symbol)
        info = tk.info or {}

        close = hist["Close"]
        latest_price = round(float(close.iloc[-1]), 2)
        prev_close = float(close.iloc[-2])
        change_pct = round((latest_price - prev_close) / prev_close * 100, 2)

        rsi = calc_rsi(close)
        momentum = calc_momentum(close)

        # Build price history
        price_history = []
        sample_indices = np.linspace(0, len(hist) - 1, min(12, len(hist)), dtype=int)
        for idx in sample_indices:
            row = hist.iloc[idx]
            date_str = row.name.strftime("%b %d")
            price_history.append({"m": date_str, "p": round(float(row["Close"]), 2)})

        # Multi-timeframe price ranges
        price_ranges = fetch_price_ranges(symbol)

        # ── Auto-enrich: fill in sector/description from yfinance if not provided ──
        SECTOR_EN_TO_CN = {
            "Technology": "科技", "Consumer Cyclical": "消费/周期",
            "Consumer Defensive": "消费/必需品", "Financial Services": "金融",
            "Healthcare": "医疗健康", "Industrials": "工业",
            "Energy": "能源", "Utilities": "公用事业",
            "Basic Materials": "基础材料", "Communication Services": "通信服务",
            "Real Estate": "房地产",
        }
        cfg_sector = cfg.get("sector", "")
        if not cfg_sector or cfg_sector in ("其他", "未知", "Unknown", ""):
            yf_sector = info.get("sector") or info.get("category") or ""
            industry = info.get("industry") or ""
            if yf_sector:
                cn = SECTOR_EN_TO_CN.get(yf_sector, yf_sector)
                cfg_sector = f"{cn}/{industry}" if industry else cn
            else:
                cfg_sector = "未知"
            # Update the saved config too
            cfg["sector"] = cfg_sector

        cfg_desc = cfg.get("description", "")
        if not cfg_desc:
            cfg_desc = (info.get("longBusinessSummary") or "")[:300]
            cfg["description"] = cfg_desc

        cfg_name = cfg.get("name", "")
        if not cfg_name or cfg_name == ticker_key:
            cfg_name = info.get("shortName") or info.get("longName") or ticker_key
            cfg["name"] = cfg_name

        if is_etf:
            # ETF
            expense_ratio = safe_get(info, "annualReportExpenseRatio") or safe_get(info, "totalExpenseRatio")
            if expense_ratio:
                expense_ratio = round(expense_ratio * 100, 2)
            else:
                expense_ratio = cfg.get("static_overrides", {}).get("expenseRatio", 0.5)

            leverage_str = cfg.get("leverage")
            lev_factor = parse_leverage(leverage_str)

            aum_raw = safe_get(info, "totalAssets")
            score, sub_scores = calc_etf_score(
                expense_ratio=expense_ratio or 0.5,
                premium_discount=0,
                aum_usd=float(aum_raw) if aum_raw else None,
                momentum=momentum,
                concentration_top3=cfg.get("static_overrides", {}).get("concentrationTop3", 50),
                leverage=leverage_str,
                detailed=True,
            )

            result = {
                "ticker": ticker_key,
                "name": cfg_name,
                "market": cfg.get("market", "US"),
                "sector": cfg_sector,
                "currency": cfg.get("currency", "USD"),
                "price": latest_price,
                "change": change_pct,
                "score": score,
                "subScores": sub_scores,
                "isETF": True,
                "etfType": cfg.get("etf_type", "主题ETF"),
                "leverage": leverage_str,
                "expenseRatio": expense_ratio,
                "premiumDiscount": 0,
                "aum": fmt_big(safe_get(info, "totalAssets")) or "N/A",
                "adv": fmt_big(safe_get(info, "averageVolume")) or "N/A",
                "benchmark": cfg.get("benchmark", "N/A"),
                "issuer": cfg.get("issuer", info.get("fundFamily", "N/A")),
                "pe": None, "roe": None,
                "momentum": momentum, "rsi": rsi,
                "revenueGrowth": None, "profitMargin": None,
                "ebitda": None,
                "marketCap": fmt_big(safe_get(info, "totalAssets")),
                "revenue": None, "eps": None,
                "beta": round(safe_get(info, "beta3Year", 0) or 0, 2) or None,
                "week52High": safe_get(info, "fiftyTwoWeekHigh"),
                "week52Low": safe_get(info, "fiftyTwoWeekLow"),
                "avgVolume": fmt_big(safe_get(info, "averageVolume")),
                "nextEarnings": None,
                "priceHistory": price_history,
                "priceRanges": price_ranges,
                "description": cfg_desc,
            }
        else:
            # Stock
            pe = safe_get(info, "trailingPE")
            roe = safe_get(info, "returnOnEquity")
            if roe is not None:
                roe = round(roe * 100, 1)
            revenue_growth = safe_get(info, "revenueGrowth")
            if revenue_growth is not None:
                revenue_growth = round(revenue_growth * 100, 1)
            profit_margin = safe_get(info, "profitMargins")
            if profit_margin is not None:
                profit_margin = round(profit_margin * 100, 1)

            score, sub_scores = calc_stock_score(pe, roe, revenue_growth, profit_margin, momentum, rsi, detailed=True)

            result = {
                "ticker": ticker_key,
                "name": cfg_name,
                "market": cfg.get("market", "US"),
                "sector": cfg_sector,
                "currency": cfg.get("currency", "USD"),
                "price": latest_price,
                "change": change_pct,
                "score": score,
                "subScores": sub_scores,
                "isETF": False,
                "pe": round(pe, 2) if pe else None,
                "roe": roe,
                "momentum": momentum,
                "rsi": rsi,
                "revenueGrowth": revenue_growth,
                "profitMargin": profit_margin,
                "ebitda": fmt_big(safe_get(info, "ebitda")),
                "marketCap": fmt_big(safe_get(info, "marketCap")),
                "revenue": fmt_big(safe_get(info, "totalRevenue")),
                "eps": safe_get(info, "trailingEps"),
                "beta": round(safe_get(info, "beta", 0) or 0, 2) or None,
                "week52High": safe_get(info, "fiftyTwoWeekHigh"),
                "week52Low": safe_get(info, "fiftyTwoWeekLow"),
                "avgVolume": fmt_big(safe_get(info, "averageVolume")),
                "nextEarnings": None,
                "priceHistory": price_history,
                "priceRanges": price_ranges,
                "description": cfg_desc,
            }

        # Apply static overrides
        overrides = cfg.get("static_overrides", {})
        for key, val in overrides.items():
            if result.get(key) is None:
                result[key] = val

        return result
    except Exception as e:
        print(f"  [X] {ticker_key}: {e}")
        return None


def fetch_price_ranges(symbol: str) -> dict:
    """Fetch multi-timeframe price data for a single symbol."""
    ranges_config = {
        "1D": ("1d", "5m", 50),
        "5D": ("5d", "15m", 40),
        "1M": ("1mo", "1h", 30),
        "6M": ("6mo", "1d", 40),
        "YTD": ("ytd", "1d", 40),
        "1Y": ("1y", "1d", 40),
        "5Y": ("5y", "1wk", 40),
        "ALL": ("max", "1mo", 40),
    }
    result = {}
    tk = yf.Ticker(symbol)
    for range_key, (period, interval, max_pts) in ranges_config.items():
        try:
            hist = tk.history(period=period, interval=interval)
            if hist is None or hist.empty:
                continue
            close = hist["Close"]
            indices = np.linspace(0, len(close) - 1, min(max_pts, len(close)), dtype=int)
            points = []
            for idx in indices:
                val = float(close.iloc[idx])
                if math.isnan(val) or math.isinf(val):
                    continue  # Skip NaN/Inf price points
                ts = close.index[idx]
                if interval in ("5m", "15m", "1h"):
                    label = ts.strftime("%H:%M") if range_key == "1D" else ts.strftime("%m/%d %H:%M")
                elif interval == "1wk":
                    label = ts.strftime("%Y/%m")
                elif interval == "1mo":
                    label = ts.strftime("%Y/%m")
                else:
                    label = ts.strftime("%m/%d")
                points.append({"m": label, "p": round(val, 2)})
            result[range_key] = points
        except Exception:
            continue
    return result


def generate_alerts(stocks: list) -> list:
    """Generate alerts from stock data."""
    alerts = []
    alert_id = 1
    now_str = datetime.now().strftime("%H:%M")

    for stk in stocks:
        # RSI extremes
        rsi = stk.get("rsi")
        if rsi and rsi > 70:
            alerts.append({
                "id": alert_id, "type": "technical", "ticker": stk["ticker"],
                "message": f"RSI 达到 {rsi}，进入超买区间，注意回调风险",
                "time": now_str, "severity": "warning"
            })
            alert_id += 1
        elif rsi and rsi < 30:
            alerts.append({
                "id": alert_id, "type": "technical", "ticker": stk["ticker"],
                "message": f"RSI 降至 {rsi}，进入超卖区间，可能存在反弹机会",
                "time": now_str, "severity": "warning"
            })
            alert_id += 1

        # Large daily moves
        change = stk.get("change", 0)
        if abs(change) > 5:
            alerts.append({
                "id": alert_id, "type": "price", "ticker": stk["ticker"],
                "message": f"日内大幅{'上涨' if change > 0 else '下跌'} {abs(change):.1f}%，波动异常",
                "time": now_str, "severity": "high"
            })
            alert_id += 1

        # Near 52-week high/low
        hi = stk.get("week52High")
        lo = stk.get("week52Low")
        price = stk.get("price")
        if hi and price and hi > 0 and price / hi > 0.95:
            alerts.append({
                "id": alert_id, "type": "price", "ticker": stk["ticker"],
                "message": f"接近52周新高 {hi}，当前 {price}",
                "time": now_str, "severity": "info"
            })
            alert_id += 1
        elif lo and price and lo > 0 and price / lo < 1.05:
            alerts.append({
                "id": alert_id, "type": "price", "ticker": stk["ticker"],
                "message": f"接近52周新低 {lo}，当前 {price}",
                "time": now_str, "severity": "high"
            })
            alert_id += 1

    return alerts


# ─── In-Memory Data Cache ──────────────────────────────
class DataCache:
    def __init__(self):
        self.stocks: list = []
        self.alerts: list = []
        self.last_refresh: str = ""
        self.refreshing = False
        self._lock = threading.Lock()

    def load_from_file(self):
        """Load existing data.js data on startup."""
        try:
            data_path = OUTPUT_DIR / "stocks_data.json"
            alerts_path = OUTPUT_DIR / "alerts.json"
            if data_path.exists():
                with open(data_path, "r", encoding="utf-8") as f:
                    self.stocks = json.load(f)
            if alerts_path.exists():
                with open(alerts_path, "r", encoding="utf-8") as f:
                    self.alerts = json.load(f)
            self.last_refresh = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        except Exception as e:
            print(f"载入缓存数据失败: {e}")

    def refresh(self, tickers: dict = None):
        """Refresh all data. Merge strategy: keep old data for failed tickers."""
        if self.refreshing:
            return
        self.refreshing = True
        try:
            if tickers is None:
                tickers = get_all_tickers()

            # Build a map of existing stocks for fallback
            old_map = {s["ticker"]: s for s in self.stocks}

            new_stocks = []
            success_count = 0
            fail_count = 0
            total = len(tickers)
            for i, (key, cfg) in enumerate(tickers.items()):
                print(f"  [{i+1}/{total}] 拉取 {key}...")
                try:
                    result = fetch_single_stock(key, cfg)
                    if result:
                        new_stocks.append(result)
                        success_count += 1
                    elif key in old_map:
                        # Fetch returned None — keep old data
                        new_stocks.append(old_map[key])
                        fail_count += 1
                        print(f"    [WARN] {key}: 拉取返回空，保留旧数据")
                    else:
                        fail_count += 1
                        print(f"    [WARN] {key}: 拉取失败，无旧数据可用")
                except Exception as e:
                    fail_count += 1
                    if key in old_map:
                        new_stocks.append(old_map[key])
                        print(f"    [WARN] {key}: {e}，保留旧数据")
                    else:
                        print(f"    [X] {key}: {e}")

            new_stocks.sort(key=lambda x: x["score"], reverse=True)
            for i, stk in enumerate(new_stocks):
                stk["rank"] = i + 1

            alerts = generate_alerts(new_stocks)

            with self._lock:
                self.stocks = new_stocks
                self.alerts = alerts
                self.last_refresh = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # Save to files
            self._save_to_files(new_stocks, alerts)

            print(f"[OK] 刷新完成: {success_count} 成功 / {fail_count} 失败 / 共 {len(new_stocks)} 个标的, {len(alerts)} 条预警")
        finally:
            self.refreshing = False

    def add_single(self, ticker_key: str, cfg: dict) -> dict | None:
        """Add and fetch a single ticker."""
        result = fetch_single_stock(ticker_key, cfg)
        if result:
            with self._lock:
                # Remove if exists
                self.stocks = [s for s in self.stocks if s["ticker"] != ticker_key]
                self.stocks.append(result)
                # Re-rank
                self.stocks.sort(key=lambda x: x["score"], reverse=True)
                for i, stk in enumerate(self.stocks):
                    stk["rank"] = i + 1
                self.alerts = generate_alerts(self.stocks)
            self._save_to_files(self.stocks, self.alerts)
        return result

    def remove(self, ticker_key: str):
        with self._lock:
            self.stocks = [s for s in self.stocks if s["ticker"] != ticker_key]
            for i, stk in enumerate(self.stocks):
                stk["rank"] = i + 1
            self.alerts = generate_alerts(self.stocks)
        self._save_to_files(self.stocks, self.alerts)

    def _save_to_files(self, stocks, alerts):
        OUTPUT_DIR.mkdir(exist_ok=True)
        # Sanitize NaN/Inf before any serialization
        clean_stocks = sanitize(stocks)
        clean_alerts = sanitize(alerts)
        with open(OUTPUT_DIR / "stocks_data.json", "w", encoding="utf-8") as f:
            json.dump(clean_stocks, f, ensure_ascii=False, indent=2)
        with open(OUTPUT_DIR / "alerts.json", "w", encoding="utf-8") as f:
            json.dump(clean_alerts, f, ensure_ascii=False, indent=2)
        # Also write frontend data.js (must use allow_nan=False to catch any remaining NaN)
        if FRONTEND_DATA_PATH.parent.exists():
            with open(FRONTEND_DATA_PATH, "w", encoding="utf-8") as f:
                f.write("// 自动生成 - 由 backend/server.py 写出\n")
                f.write(f"// 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                f.write("export const STOCKS = ")
                json.dump(clean_stocks, f, ensure_ascii=False, indent=2, allow_nan=False)
                f.write(";\n\nexport const ALERTS = ")
                json.dump(clean_alerts, f, ensure_ascii=False, indent=2, allow_nan=False)
                f.write(";\n")

cache = DataCache()


# ─── FastAPI App ───────────────────────────────────────
app = FastAPI(title="QuantEdge API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AddTickerRequest(BaseModel):
    ticker: str
    name: str = ""
    type: str = "stock"        # stock | etf | leveraged_etf
    market: str = "US"
    sector: str = ""
    currency: str = "USD"
    description: str = ""
    etf_type: str | None = None
    leverage: str | None = None


@app.on_event("startup")
def startup():
    """Load cached data on startup."""
    cache.load_from_file()
    print(f"[OK] loaded {len(cache.stocks)} stocks on startup")


def _hk_yf_symbol(code_5digit: str) -> str:
    """Convert 5-digit HK code (00005.HK) to yfinance format (0005.HK)."""
    base = code_5digit.replace(".HK", "")
    return base.lstrip("0").zfill(4) + ".HK"

def _hk_5digit(code: str) -> str:
    """Normalize any HK code to 5-digit format (00005.HK)."""
    base = code.replace(".HK", "").replace("HK.", "")
    return base.zfill(5) + ".HK"

def _check_already_added(symbol: str) -> bool:
    """Check if a symbol is already in the watchlist (handles HK format variants)."""
    all_t = get_all_tickers()
    if symbol in all_t:
        return True
    # Try 5-digit HK format
    if ".HK" in symbol:
        hk5 = _hk_5digit(symbol)
        if hk5 in all_t:
            return True
    return False

def _get_display_symbol(symbol: str) -> str:
    """Return the canonical display symbol (5-digit for HK)."""
    if ".HK" in symbol:
        return _hk_5digit(symbol)
    return symbol

# Futu HK stock cache for Chinese name search
_futu_hk_cache = []
_futu_cache_time = 0

def _get_futu_hk_stocks():
    """Load HK stock list from Futu OpenD (cached for 1 hour)."""
    global _futu_hk_cache, _futu_cache_time
    if _futu_hk_cache and (time.time() - _futu_cache_time < 3600):
        return _futu_hk_cache
    try:
        from futu import OpenQuoteContext
        ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
        ret, data = ctx.get_stock_basicinfo('HK', stock_type='STOCK')
        ctx.close()
        if ret == 0 and data is not None:
            _futu_hk_cache = [
                {"code": row["code"], "name": row["name"]}
                for _, row in data[["code", "name"]].iterrows()
            ]
            _futu_cache_time = time.time()
            print(f"[OK] Futu HK stock cache: {len(_futu_hk_cache)} stocks")
    except Exception as e:
        print(f"[X] Futu HK cache failed: {e}")
    return _futu_hk_cache


@app.get("/api/search")
def search_ticker(q: str = Query(..., min_length=1, description="搜索关键词")):
    """
    搜索标的 — 支持代码/中文名搜索。
    港股: Futu OpenD 中文名 + yfinance 报价
    美股: yfinance 直接验证
    """
    query_raw = q.strip()
    query = query_raw.upper()
    results = []
    seen_symbols = set()
    all_tickers = get_all_tickers()

    def _add_result(symbol, name, price=0, change=0, market_cap=None,
                    currency="USD", market="US", ticker_type="stock",
                    sector="", exchange=""):
        display_sym = _get_display_symbol(symbol)
        if display_sym in seen_symbols:
            return
        seen_symbols.add(display_sym)
        results.append({
            "symbol": display_sym,
            "name": name,
            "price": round(price, 2) if price else 0,
            "change": round(change, 2) if change else 0,
            "marketCap": fmt_big(market_cap) if market_cap else "N/A",
            "currency": currency,
            "market": market,
            "type": ticker_type,
            "sector": sector,
            "exchange": exchange,
            "alreadyAdded": _check_already_added(display_sym),
        })

    def _futu_quote(futu_codes):
        """Fetch real-time quotes from Futu OpenD (fast, local). Returns dict[code] → {price, change, mkt_cap}."""
        quotes = {}
        try:
            from futu import OpenQuoteContext
            ctx = OpenQuoteContext(host='127.0.0.1', port=11111)
            ret, data = ctx.get_market_snapshot(futu_codes)
            ctx.close()
            if ret == 0 and data is not None:
                for _, row in data.iterrows():
                    prev = row.get("prev_close_price", 0) or 0
                    price = row.get("last_price", 0) or 0
                    change_pct = ((price - prev) / prev * 100) if prev > 0 else 0
                    quotes[row["code"]] = {
                        "price": price,
                        "change": round(change_pct, 2),
                        "mkt_cap": row.get("total_market_val"),
                        "name": row.get("name", ""),
                    }
        except Exception as e:
            print(f"[X] Futu quote error: {e}")
        return quotes

    # ── 1. Check if query looks like an HK stock code ──
    is_hk_code = False
    hk_digits = ""
    if ".HK" in query:
        is_hk_code = True
        hk_digits = query.replace(".HK", "")
    elif query.isdigit() and len(query) >= 4:
        is_hk_code = True
        hk_digits = query

    if is_hk_code and hk_digits:
        futu_code = "HK." + hk_digits.zfill(5)
        quotes = _futu_quote([futu_code])
        if futu_code in quotes:
            q_data = quotes[futu_code]
            _add_result(
                hk_digits.zfill(4) + ".HK",
                q_data["name"], q_data["price"], q_data["change"],
                q_data["mkt_cap"], "HKD", "HK", "stock", "", "",
            )
        else:
            # Fallback: try name from Futu cache
            for s in _get_futu_hk_stocks():
                if s["code"] == futu_code:
                    _add_result(
                        hk_digits.zfill(4) + ".HK",
                        s["name"], 0, 0, None, "HKD", "HK", "stock", "", "",
                    )
                    break

    # ── 2. Check if query contains Chinese characters → search Futu HK cache ──
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in query_raw)
    if has_chinese:
        futu_stocks = _get_futu_hk_stocks()
        matches = [s for s in futu_stocks if query_raw in s["name"]][:8]
        if matches:
            # Batch fetch prices from Futu (fast)
            futu_codes = [m["code"] for m in matches]
            quotes = _futu_quote(futu_codes)
            for m in matches:
                q_data = quotes.get(m["code"], {})
                code_num = m["code"].replace("HK.", "")
                _add_result(
                    code_num.lstrip("0").zfill(4) + ".HK",
                    m["name"],
                    q_data.get("price", 0), q_data.get("change", 0),
                    q_data.get("mkt_cap"), "HKD", "HK", "stock", "", "",
                )
                if len(results) >= 6:
                    break

    # ── 3. Also search in existing watchlist by Chinese name ──
    if has_chinese:
        for key, cfg in all_tickers.items():
            if query_raw in cfg.get("name", "") or query_raw in cfg.get("description", ""):
                stk = next((s for s in cache.stocks if s["ticker"] == key), None)
                if stk and key not in seen_symbols:
                    _add_result(
                        key, cfg["name"],
                        stk.get("price", 0), stk.get("change", 0), None,
                        cfg.get("currency", "USD"), cfg.get("market", "US"),
                        cfg.get("type", "stock"), cfg.get("sector", ""), "",
                    )

    # ── 4. US stock: direct yfinance match ──
    if not is_hk_code and not has_chinese:
        symbols_to_try = [query]
        if not query.endswith(".SS") and not query.endswith(".SZ"):
            symbols_to_try.append(f"{query}.HK")

        for symbol in symbols_to_try:
            try:
                tk = yf.Ticker(symbol)
                info = tk.info or {}
                price = info.get("regularMarketPrice") or info.get("currentPrice")
                if not price:
                    try:
                        price = tk.fast_info.get("lastPrice") or tk.fast_info.get("regularMarketPrice")
                    except Exception:
                        pass
                if not price:
                    continue
                name = info.get("shortName") or info.get("longName") or symbol
                change = info.get("regularMarketChangePercent") or 0
                market_cap = info.get("marketCap") or info.get("totalAssets")
                currency = info.get("currency", "USD")
                quote_type = info.get("quoteType", "EQUITY")
                sector = info.get("sector") or info.get("category") or ""
                exchange = info.get("exchange", "")
                market = "HK" if ".HK" in symbol else ("CN" if (".SS" in symbol or ".SZ" in symbol) else "US")
                _add_result(
                    symbol, name, price, change, market_cap,
                    currency, market,
                    "etf" if quote_type in ("ETF", "MUTUALFUND") else "stock",
                    sector, exchange,
                )
            except Exception:
                continue

    # ── 5. Fallback: Yahoo Finance search API (English queries) ──
    if not results and not has_chinese:
        try:
            import requests
            resp = requests.get(
                "https://query2.finance.yahoo.com/v1/finance/search",
                params={"q": q, "quotesCount": 8, "newsCount": 0},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=5,
            )
            data = resp.json()
            for quote in data.get("quotes", []):
                symbol = quote.get("symbol", "")
                market = "HK" if ".HK" in symbol else ("CN" if (".SS" in symbol or ".SZ" in symbol) else "US")
                _add_result(
                    symbol,
                    quote.get("shortname") or quote.get("longname") or symbol,
                    0, 0, None,
                    quote.get("currency", "USD"), market,
                    "etf" if quote.get("quoteType") == "ETF" else "stock",
                    "", quote.get("exchange", ""),
                )
        except Exception:
            pass

    return {"results": results[:8], "query": q}


@app.get("/api/tickers")
def list_tickers():
    """列出所有标的 (内置 + 自定义)。"""
    builtin_keys = set(BUILTIN_TICKERS.keys())
    custom = load_custom_tickers()
    all_t = get_all_tickers()

    ticker_list = []
    for key, cfg in all_t.items():
        ticker_list.append({
            "ticker": key,
            "name": cfg.get("name", key),
            "type": cfg.get("type", "stock"),
            "market": cfg.get("market", "US"),
            "sector": cfg.get("sector", ""),
            "isBuiltin": key in builtin_keys,
        })

    return {
        "tickers": ticker_list,
        "total": len(ticker_list),
        "builtinCount": len(builtin_keys),
        "customCount": len(custom),
    }


@app.post("/api/tickers")
def add_ticker(req: AddTickerRequest):
    """添加标的到自定义列表，并立即拉取数据。"""
    ticker_key = req.ticker.strip().upper()

    # Check if already exists (handle HK format variants)
    if _check_already_added(ticker_key):
        raise HTTPException(400, f"标的 {ticker_key} 已存在")

    # Build config — for HK stocks, derive correct yf_symbol (4-digit)
    yf_symbol = ticker_key
    if ".HK" in ticker_key:
        yf_symbol = _hk_yf_symbol(ticker_key)
    cfg = {
        "name": req.name or ticker_key,
        "yf_symbol": yf_symbol,
        "type": req.type,
        "market": req.market,
        "sector": req.sector or "其他",
        "currency": req.currency,
        "description": req.description,
    }
    if req.etf_type:
        cfg["etf_type"] = req.etf_type
    if req.leverage:
        cfg["leverage"] = req.leverage

    # Save to custom tickers (initial save — will be enriched by fetch_single_stock)
    custom = load_custom_tickers()
    custom[ticker_key] = cfg
    save_custom_tickers(custom)

    # Fetch data immediately (this enriches cfg with sector/description from yfinance)
    result = cache.add_single(ticker_key, cfg)

    # Re-save custom tickers with enriched data (sector, description, name)
    custom[ticker_key] = cfg
    save_custom_tickers(custom)

    if result:
        return {
            "success": True,
            "ticker": ticker_key,
            "message": f"已添加 {ticker_key} ({cfg['name']})，评分: {result['score']}",
            "data": sanitize(result),
        }
    else:
        return {
            "success": True,
            "ticker": ticker_key,
            "message": f"已添加 {ticker_key}，但数据拉取失败，将在下次刷新时重试",
        }


@app.delete("/api/tickers/{ticker_key}")
def remove_ticker(ticker_key: str):
    """删除标的。自定义标的从配置移除，内置标的仅从当前显示中隐藏。"""
    ticker_key = ticker_key.upper()

    is_builtin = ticker_key in BUILTIN_TICKERS

    # Remove from custom tickers if present
    custom = load_custom_tickers()
    if ticker_key in custom:
        del custom[ticker_key]
        save_custom_tickers(custom)

    # Always remove from cache display
    cache.remove(ticker_key)

    msg = f"已删除 {ticker_key}" + ("（内置标的，刷新后会恢复）" if is_builtin else "")
    return {"success": True, "message": msg, "isBuiltin": is_builtin}


@app.get("/api/data")
def get_data():
    """获取完整数据 (STOCKS + ALERTS)。"""
    return sanitize({
        "stocks": cache.stocks,
        "alerts": cache.alerts,
        "lastRefresh": cache.last_refresh,
        "total": len(cache.stocks),
    })


@app.post("/api/refresh")
def refresh_data():
    """刷新全量数据。"""
    if cache.refreshing:
        return {"success": False, "message": "正在刷新中，请稍候..."}

    # Run refresh in background
    thread = threading.Thread(target=cache.refresh, daemon=True)
    thread.start()

    return {
        "success": True,
        "message": f"开始刷新 {len(get_all_tickers())} 个标的，请稍候...",
    }


@app.get("/api/status")
def get_status():
    """服务状态。"""
    # Check data source health
    futu_status = {"available": False, "message": "not installed"}
    if HAS_DATA_SOURCES:
        try:
            hc = health_check()
            futu_ok, futu_msg = hc.get("futu", (False, "unknown"))
            futu_status = {"available": futu_ok, "message": futu_msg}
        except Exception as e:
            futu_status = {"available": False, "message": str(e)}

    return {
        "status": "running",
        "stockCount": len(cache.stocks),
        "alertCount": len(cache.alerts),
        "lastRefresh": cache.last_refresh,
        "refreshing": cache.refreshing,
        "customTickers": len(load_custom_tickers()),
        "dataSources": {
            "yfinance": {"available": True},
            "futu": futu_status,
        },
    }


if __name__ == "__main__":
    # Check Futu OpenD on startup
    futu_info = ""
    if HAS_DATA_SOURCES:
        try:
            hc = health_check()
            futu_ok, futu_msg = hc.get("futu", (False, "unknown"))
            futu_info = f"  Futu OpenD: {'[OK] ' + str(futu_ok) if futu_ok else '[X] ' + str(futu_msg)}"
        except Exception as e:
            futu_info = f"  Futu OpenD: [X] {e}"
    else:
        futu_info = "  Futu OpenD: [X] (futu-api not installed)"

    print("=" * 50)
    print("  QuantEdge API Server")
    print("  http://localhost:8001")
    print("  http://localhost:8001/docs (Swagger UI)")
    print(futu_info)
    print("  yfinance:   [OK] ready")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8001)
