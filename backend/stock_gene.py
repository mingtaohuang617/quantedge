"""
stock_gene — 股性检测 / 牛股特征器
=================================

按 8 个"牛股特征"对一只股票打分（每个特征 0/1 = 不达标/达标，外加细分数值）：

  F1  股价在 200 日均线之上                  — 收盘价 / MA200
  F2  200 日均线方向向上                     — MA200 当前 vs 20 日前
  F3  股价接近或正在创新高（52 周）          — 收盘价 vs 52W 高
  F4  相对强度排名靠前（RS 评级 80+）        — 6 个月相对基准的百分位
  F5  盈利在加速增长                          — yfinance 季度 EPS 增速
  F6  所属行业 / 板块正在走强                — 行业 ETF 6 个月收益排名
  F7  机构资金进场痕迹（量能放大）           — 近 20 日成交量 vs 50 日均量
  F8  经过充分的整理 / 筑底（波动收敛）      — 近 20 日 ATR / 前 50 日 ATR

输出：
  {
    "ticker": "...",
    "score": 6,            # 满足条件数（0-8）
    "verdict": "牛股潜质",   # 6+ 强 / 5 中性偏强 / 4 中性 / <=3 待观察
    "checked_at": "...",
    "features": [
      {
        "id": "above_ma200",
        "label": "股价在 200 日均线之上",
        "pass": True,
        "score": 1,
        "value": "$245.30 vs MA200 $198.40 (+23.6%)",
        "detail": "...",
      },
      ...
    ],
    "warnings": ["yfinance 季报数据获取失败"]
  }

持久化：backend/stock_gene.json
  {
    "version": 1,
    "items": [
      { "ticker": "AAPL", "added_at": "...", "notes": "", "tags": [], "last_result": {...} }
    ]
  }

数据源：优先用本地 db (daily_bars)，缺失时回退 yfinance。基本面（F5）走 yfinance；
行业基准（F6）走 SECTOR_ETF_MAP；相对强度基准（F4）默认用 SPY/HSI/000300.SH。
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

WATCHLIST_PATH = Path(__file__).resolve().parent / "stock_gene.json"

# 相对强度基准（按市场）
RS_BENCHMARK = {
    "US": "SPY",
    "HK": "^HSI",
    "CN": "000300.SH",
    "SH": "000300.SH",
    "SZ": "000300.SH",
}


# ── 持久化 ───────────────────────────────────────────────
def load_watchlist() -> dict:
    if not WATCHLIST_PATH.exists():
        return {"version": 1, "items": []}
    try:
        with open(WATCHLIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("version", 1)
        data.setdefault("items", [])
        return data
    except Exception:
        return {"version": 1, "items": []}


def save_watchlist(data: dict) -> None:
    WATCHLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = WATCHLIST_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(WATCHLIST_PATH)


def add_to_watchlist(ticker: str, name: str = "", market: str = "US",
                     sector: str = "", notes: str = "", tags: list[str] | None = None) -> dict:
    data = load_watchlist()
    ticker = ticker.strip().upper()
    if not ticker:
        raise ValueError("ticker 不能为空")
    for it in data["items"]:
        if it["ticker"] == ticker:
            # 已存在：更新元数据
            it["name"] = name or it.get("name", "")
            it["market"] = market or it.get("market", "US")
            it["sector"] = sector or it.get("sector", "")
            if notes:
                it["notes"] = notes
            if tags is not None:
                it["tags"] = tags
            save_watchlist(data)
            return it
    item = {
        "ticker": ticker,
        "name": name,
        "market": market,
        "sector": sector,
        "notes": notes,
        "tags": tags or [],
        "added_at": date.today().isoformat(),
        "last_result": None,
        "last_checked_at": None,
    }
    data["items"].append(item)
    save_watchlist(data)
    return item


def remove_from_watchlist(ticker: str) -> bool:
    data = load_watchlist()
    ticker = ticker.strip().upper()
    before = len(data["items"])
    data["items"] = [it for it in data["items"] if it["ticker"] != ticker]
    if len(data["items"]) != before:
        save_watchlist(data)
        return True
    return False


def update_item(ticker: str, **fields) -> dict | None:
    data = load_watchlist()
    ticker = ticker.strip().upper()
    for it in data["items"]:
        if it["ticker"] == ticker:
            for k, v in fields.items():
                if k in ("notes", "tags", "name", "sector", "market"):
                    it[k] = v
            save_watchlist(data)
            return it
    return None


# ── 数据加载 ────────────────────────────────────────────
def _load_bars(ticker: str, days: int = 280) -> pd.DataFrame | None:
    """
    先查本地 db，缺失时 yfinance 兜底。
    返回 DataFrame[trade_date, close, volume, high, low]，trade_date 升序。
    """
    rows: list[dict] = []

    # 1) 本地 db 优先
    try:
        import db as _db  # type: ignore
        start = (date.today() - timedelta(days=int(days * 1.8) + 30)).isoformat()
        rows = _db.get_bars(ticker, start=start)
    except Exception:
        rows = []

    if not rows:
        # 2) yfinance 兜底
        try:
            import yfinance as yf
            tk = yf.Ticker(ticker)
            hist = tk.history(period=f"{int(days * 1.6)}d", auto_adjust=False)
            if hist is None or hist.empty:
                return None
            df = hist.reset_index().rename(columns={
                "Date": "trade_date", "Close": "close",
                "High": "high", "Low": "low", "Volume": "volume",
            })
            df["trade_date"] = df["trade_date"].astype(str).str[:10]
            return df[["trade_date", "close", "high", "low", "volume"]].dropna(subset=["close"])
        except Exception:
            return None

    df = pd.DataFrame(rows)
    if df.empty or "close" not in df.columns:
        return None
    # 字段对齐
    for col in ("high", "low", "volume"):
        if col not in df.columns:
            df[col] = np.nan
    df = df[["trade_date", "close", "high", "low", "volume"]].copy()
    df = df.dropna(subset=["close"]).sort_values("trade_date").reset_index(drop=True)
    return df


# ── 各特征计算 ──────────────────────────────────────────
def _feature_above_ma200(df: pd.DataFrame) -> dict:
    if len(df) < 200:
        return {
            "id": "above_ma200",
            "label": "股价在 200 日均线之上",
            "pass": False, "score": 0,
            "value": "—",
            "detail": f"数据不足 200 个交易日（仅 {len(df)} 天）",
            "available": False,
        }
    close = float(df["close"].iloc[-1])
    ma200 = float(df["close"].rolling(200).mean().iloc[-1])
    diff_pct = (close - ma200) / ma200 * 100
    passed = close > ma200
    return {
        "id": "above_ma200",
        "label": "股价在 200 日均线之上",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"${close:.2f} vs MA200 ${ma200:.2f} ({diff_pct:+.1f}%)",
        "detail": "盈利持有者不会恐慌抛售 — 上涨基础" if passed else "尚未站稳长期均线，趋势未确立",
        "available": True,
    }


def _feature_ma200_rising(df: pd.DataFrame) -> dict:
    if len(df) < 220:
        return {
            "id": "ma200_rising",
            "label": "200 日均线方向向上",
            "pass": False, "score": 0,
            "value": "—",
            "detail": f"数据不足 220 个交易日（仅 {len(df)} 天）",
            "available": False,
        }
    ma200 = df["close"].rolling(200).mean()
    current = float(ma200.iloc[-1])
    past = float(ma200.iloc[-21])  # 20 个交易日前
    slope_pct = (current - past) / past * 100
    passed = slope_pct > 0.5  # 至少 0.5% 抬升才算明确向上
    return {
        "id": "ma200_rising",
        "label": "200 日均线方向向上",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"20D 斜率 {slope_pct:+.2f}%",
        "detail": "长期趋势明确向上" if passed else "均线走平或向下，趋势不明",
        "available": True,
    }


def _feature_near_new_high(df: pd.DataFrame) -> dict:
    # 优先 52 周高（约 252 个交易日）
    lookback = min(252, len(df))
    if lookback < 60:
        return {
            "id": "near_new_high",
            "label": "股价接近或正在创新高",
            "pass": False, "score": 0,
            "value": "—",
            "detail": f"数据不足（仅 {len(df)} 天）",
            "available": False,
        }
    high52 = float(df["close"].iloc[-lookback:].max())
    close = float(df["close"].iloc[-1])
    dist_pct = (close - high52) / high52 * 100  # 距高点的百分比，0 = 新高，负 = 在下方
    # 标准：当前价 >= 高点 - 5%（接近或创新高）
    passed = dist_pct >= -5.0
    desc = "正在创新高" if dist_pct >= -0.5 else ("接近新高" if passed else "距高点较远")
    return {
        "id": "near_new_high",
        "label": "股价接近或正在创新高",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"距 52W 高 {dist_pct:+.1f}%（{desc}）",
        "detail": "无套牢盘、上方无阻力" if passed else "上方仍有获利盘 / 套牢盘压力",
        "available": True,
    }


def _feature_relative_strength(df: pd.DataFrame, benchmark_df: pd.DataFrame | None) -> dict:
    if len(df) < 130:
        return {
            "id": "relative_strength",
            "label": "相对强度排名靠前（RS）",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "需 6 个月（≈126 天）以上历史",
            "available": False,
        }
    # 6 个月收益（约 126 个交易日）
    ret_6m = float(df["close"].iloc[-1] / df["close"].iloc[-126] - 1) * 100
    if benchmark_df is None or len(benchmark_df) < 126:
        # 没有基准时，按绝对收益给档：>30% = 强，10-30% 中性，<10% 弱
        if ret_6m > 30:
            rs, passed = 90, True
        elif ret_6m > 15:
            rs, passed = 75, False
        elif ret_6m > 0:
            rs, passed = 55, False
        else:
            rs, passed = 30, False
        return {
            "id": "relative_strength",
            "label": "相对强度排名靠前（RS）",
            "pass": passed,
            "score": 1 if passed else 0,
            "value": f"6M 收益 {ret_6m:+.1f}%（无基准估算 RS≈{rs}）",
            "detail": "（基准未配置，使用绝对收益近似）" + ("启动前已跑赢大盘" if passed else "强度不足"),
            "available": True,
        }
    bench_ret = float(benchmark_df["close"].iloc[-1] / benchmark_df["close"].iloc[-126] - 1) * 100
    # RS 评分：把"个股 vs 基准"的超额收益映射到 0-99
    excess = ret_6m - bench_ret
    # 简化：每 1% 超额给 +1.5 分，从 50 分起跳；夹到 [1, 99]
    rs = int(np.clip(50 + excess * 1.5, 1, 99))
    passed = rs >= 80
    return {
        "id": "relative_strength",
        "label": "相对强度排名靠前（RS）",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"RS≈{rs}（6M {ret_6m:+.1f}% vs 基准 {bench_ret:+.1f}%）",
        "detail": "已显著跑赢基准，符合牛股启动前特征" if passed else "相对强度未达 80，尚未明显跑赢",
        "available": True,
    }


def _feature_earnings_acceleration(ticker: str) -> dict:
    """yfinance quarterly_earnings - 计算最近 3 个季度的同比增速是否在抬升。"""
    try:
        import yfinance as yf
        tk = yf.Ticker(ticker)
        # quarterly_income_stmt 提供近 4 个季度的 NetIncome / TotalRevenue
        df = getattr(tk, "quarterly_income_stmt", None)
        if df is None or df.empty:
            df = getattr(tk, "quarterly_financials", None)
        if df is None or df.empty:
            raise ValueError("无季报数据")
        # 优先 Diluted EPS，回退 Net Income
        row = None
        for key in ("Diluted EPS", "Basic EPS", "Net Income", "NetIncome", "Net Income Common Stockholders"):
            if key in df.index:
                row = df.loc[key]
                break
        if row is None:
            raise ValueError("未找到 EPS / NetIncome 行")
        # row: Series, index = period_end_date (Timestamp)
        s = row.dropna().astype(float).sort_index()
        if len(s) < 4:
            raise ValueError(f"季度数据不足（仅 {len(s)} 个季度）")
        # 取最近 4 个季度，计算最近 2 个季度的 QoQ 增速
        q_last = float(s.iloc[-1])
        q_prev = float(s.iloc[-2])
        q_prev2 = float(s.iloc[-3]) if len(s) >= 3 else None
        def _growth(cur, prev):
            if prev == 0 or prev is None:
                return None
            return (cur - prev) / abs(prev) * 100
        g_now = _growth(q_last, q_prev)
        g_prev = _growth(q_prev, q_prev2) if q_prev2 is not None else None
        if g_now is None:
            raise ValueError("增速计算失败")
        # 评判：当前季度 QoQ 增长 ≥25% 且较上季度加速
        if g_prev is not None:
            accelerating = g_now > g_prev
        else:
            accelerating = g_now > 25
        strong = g_now >= 25
        passed = strong and accelerating
        value_str = f"最新季 QoQ {g_now:+.1f}%"
        if g_prev is not None:
            value_str += f"（上季 {g_prev:+.1f}%）"
        detail = ("盈利在加速增长 — 踩油门" if passed
                  else "增速不足或未加速" if strong
                  else "增速偏低或为负")
        return {
            "id": "earnings_acceleration",
            "label": "盈利在加速增长",
            "pass": passed,
            "score": 1 if passed else 0,
            "value": value_str,
            "detail": detail,
            "available": True,
        }
    except Exception as e:
        return {
            "id": "earnings_acceleration",
            "label": "盈利在加速增长",
            "pass": False, "score": 0,
            "value": "—",
            "detail": f"基本面数据不可用（{e}）",
            "available": False,
        }


def _resolve_sector_etf(sector: str) -> str | None:
    """从 SECTOR_ETF_MAP 解析行业代理 ETF；支持中文 sector + 常见英文别名。"""
    from config import SECTOR_ETF_MAP
    s = (sector or "").strip()
    if not s:
        return None
    # 英文 → 中文映射（仅覆盖与 SECTOR_ETF_MAP 已有键对得上的）
    en_to_zh = {
        "Technology": "科技",
        "Information Technology": "科技",
        "Software": "科技",
        "Semiconductors": "半导体",
        "Semiconductor": "半导体",
        "Financial Services": "银行",
        "Financials": "银行",
        "Banks": "银行",
        "Energy": "原油",
        "Communication Services": "电信",
        "Telecommunication": "电信",
        "Basic Materials": "黄金",
    }
    keys_to_try = [s, en_to_zh.get(s, "")]
    for k in keys_to_try:
        if not k:
            continue
        entry = SECTOR_ETF_MAP.get(k)
        if isinstance(entry, dict):
            return entry.get("etf")
        if isinstance(entry, str):
            return entry
    return None


def _feature_sector_strength(sector: str, market: str) -> dict:
    """用 SECTOR_ETF_MAP 找行业代理 ETF，比 6 个月收益是否跑赢基准。"""
    try:
        etf = _resolve_sector_etf(sector)
        if not etf:
            raise ValueError(f"未找到 '{sector}' 对应的 ETF")
        df = _load_bars(etf, days=180)
        if df is None or len(df) < 100:
            raise ValueError(f"{etf} 数据不足")
        ret_6m = float(df["close"].iloc[-1] / df["close"].iloc[-min(126, len(df) - 1)] - 1) * 100
        # 基准：SPY / HSI / 沪深 300
        bench_ticker = RS_BENCHMARK.get(market, "SPY")
        bench_df = _load_bars(bench_ticker, days=180)
        if bench_df is not None and len(bench_df) >= 126:
            bench_ret = float(bench_df["close"].iloc[-1] / bench_df["close"].iloc[-126] - 1) * 100
            excess = ret_6m - bench_ret
            passed = excess > 3  # 超额 3% 以上算"走强"
            detail = f"{etf} 6M {ret_6m:+.1f}% vs 基准 {bench_ret:+.1f}%（超额 {excess:+.1f}%）"
        else:
            passed = ret_6m > 10
            detail = f"{etf} 6M {ret_6m:+.1f}%（无基准对比）"
        return {
            "id": "sector_strength",
            "label": "所属行业 / 板块正在走强",
            "pass": passed,
            "score": 1 if passed else 0,
            "value": f"行业 ETF {etf}: 6M {ret_6m:+.1f}%",
            "detail": detail if passed else f"{detail}，板块尚未明显走强",
            "available": True,
        }
    except Exception as e:
        return {
            "id": "sector_strength",
            "label": "所属行业 / 板块正在走强",
            "pass": False, "score": 0,
            "value": "—",
            "detail": f"行业数据不可用（{e}）",
            "available": False,
        }


def _feature_volume_spike(df: pd.DataFrame) -> dict:
    if len(df) < 60 or df["volume"].dropna().empty:
        return {
            "id": "volume_spike",
            "label": "机构资金进场痕迹（量能放大）",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "成交量数据不足",
            "available": False,
        }
    vol = df["volume"].fillna(0)
    v20 = float(vol.iloc[-20:].mean())
    v50 = float(vol.iloc[-50:].mean())
    if v50 <= 0:
        return {
            "id": "volume_spike",
            "label": "机构资金进场痕迹（量能放大）",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "50 日均量为 0，无法判断",
            "available": False,
        }
    ratio = v20 / v50
    # 同时看近 20 天里上涨日的量能：上涨日均量 > 下跌日均量
    close = df["close"].astype(float)
    chg = close.diff().iloc[-20:]
    up_mask = chg > 0
    dn_mask = chg < 0
    up_vol = float(vol.iloc[-20:][up_mask].mean()) if up_mask.any() else 0
    dn_vol = float(vol.iloc[-20:][dn_mask].mean()) if dn_mask.any() else 0
    up_dn_ratio = (up_vol / dn_vol) if dn_vol > 0 else (2.0 if up_vol > 0 else 0)
    passed = ratio >= 1.15 and up_dn_ratio >= 1.1
    value = f"近 20D / 50D 量比 {ratio:.2f}，涨/跌量 {up_dn_ratio:.2f}"
    detail = ("成交量放大且上涨日量能更强 — 资金活跃" if passed
              else "未见明显放量或上涨日量能不足")
    return {
        "id": "volume_spike",
        "label": "机构资金进场痕迹（量能放大）",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": value,
        "detail": detail,
        "available": True,
    }


def _feature_consolidation(df: pd.DataFrame) -> dict:
    """波动收敛：近 20 日 ATR / 前 50 日 ATR < 0.85。"""
    if len(df) < 80:
        return {
            "id": "consolidation",
            "label": "经过充分的整理 / 筑底（波动收敛）",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "数据不足",
            "available": False,
        }
    high = df["high"].astype(float).fillna(df["close"])
    low = df["low"].astype(float).fillna(df["close"])
    close = df["close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr_recent = float(tr.iloc[-20:].mean())
    atr_prior = float(tr.iloc[-70:-20].mean())
    if atr_prior <= 0:
        return {
            "id": "consolidation",
            "label": "经过充分的整理 / 筑底（波动收敛）",
            "pass": False, "score": 0,
            "value": "—",
            "detail": "ATR 计算异常",
            "available": False,
        }
    ratio = atr_recent / atr_prior
    # 同时看价格波动幅度：近 20 天高低差 / 中位价
    last20 = df.iloc[-20:]
    h = float(last20["high"].max()) if not last20["high"].isna().all() else float(last20["close"].max())
    l = float(last20["low"].min()) if not last20["low"].isna().all() else float(last20["close"].min())
    mid = (h + l) / 2 if (h + l) > 0 else 1
    range_pct = (h - l) / mid * 100
    # 标准：ATR 比率 < 0.85（明显收窄），且近 20 天波动 < 15%
    passed = ratio < 0.85 and range_pct < 15
    value = f"ATR 比率 {ratio:.2f}，近 20D 波幅 {range_pct:.1f}%"
    detail = ("波动收敛，筹码从弱手转强手" if passed
              else "波动未收敛，整理不充分")
    return {
        "id": "consolidation",
        "label": "经过充分的整理 / 筑底（波动收敛）",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": value,
        "detail": detail,
        "available": True,
    }


# ── 综合评分入口 ────────────────────────────────────────
def _verdict(score: int, available: int) -> dict:
    """根据满足条件数给评价。available = 实际能判断的特征数（满分基数）。"""
    # 强弱档：6+/8 = 牛股潜质；5/8 = 中性偏强；4/8 = 中性；<=3 = 待观察
    if available == 0:
        return {"level": "unknown", "label": "数据不足", "color": "gray"}
    pct = score / available
    if score >= 6 or (available < 8 and pct >= 0.75):
        return {"level": "strong", "label": "牛股潜质", "color": "emerald"}
    if score >= 5 or pct >= 0.6:
        return {"level": "moderate", "label": "中性偏强", "color": "amber"}
    if score >= 4 or pct >= 0.5:
        return {"level": "neutral", "label": "中性", "color": "slate"}
    return {"level": "weak", "label": "待观察 / 放弃", "color": "rose"}


def score_stock(ticker: str, name: str = "", market: str = "US",
                sector: str = "") -> dict:
    """对单只股票跑完 8 个特征评分，返回汇总结果。"""
    ticker = ticker.strip().upper()
    warnings: list[str] = []

    df = _load_bars(ticker, days=280)
    if df is None or df.empty:
        return {
            "ticker": ticker,
            "name": name,
            "market": market,
            "sector": sector,
            "score": 0,
            "max_score": 8,
            "available": 0,
            "verdict": _verdict(0, 0),
            "checked_at": datetime.utcnow().isoformat() + "Z",
            "features": [],
            "warnings": [f"无法获取 {ticker} 的历史 K 线（db / yfinance 均失败）"],
        }

    # 基准 K 线（RS 用）
    bench_ticker = RS_BENCHMARK.get(market, "SPY")
    bench_df = _load_bars(bench_ticker, days=180)
    if bench_df is None or len(bench_df) < 126:
        warnings.append(f"基准 {bench_ticker} 数据缺失，RS 改用绝对收益估算")
        bench_df = None

    features = [
        _feature_above_ma200(df),
        _feature_ma200_rising(df),
        _feature_near_new_high(df),
        _feature_relative_strength(df, bench_df),
        _feature_earnings_acceleration(ticker),
        _feature_sector_strength(sector, market),
        _feature_volume_spike(df),
        _feature_consolidation(df),
    ]

    available = sum(1 for f in features if f.get("available"))
    score = sum(1 for f in features if f.get("pass"))

    return {
        "ticker": ticker,
        "name": name,
        "market": market,
        "sector": sector,
        "score": score,
        "max_score": 8,
        "available": available,
        "verdict": _verdict(score, available),
        "checked_at": datetime.utcnow().isoformat() + "Z",
        "features": features,
        "warnings": warnings,
    }


def _append_history(item: dict, engine: str, result: dict, cap: int = 60) -> None:
    """评分历史追加：紧凑形式（避免 JSON 文件膨胀），按时间倒序裁剪 cap 条。

    cap=60 默认允许两个引擎各保留约 30 条历史，足以覆盖几个月的周频评分。
    """
    if not result or "checked_at" not in result:
        return
    history = item.setdefault("score_history", [])
    entry = {
        "engine": engine,
        "checked_at": result.get("checked_at"),
        "score": result.get("score"),
        "max_score": result.get("max_score"),
        "available": result.get("available"),
        "verdict_level": (result.get("verdict") or {}).get("level"),
    }
    # 同一分钟重复点"评分"时去重（覆盖最后一条）
    if history and history[-1].get("engine") == engine and \
            history[-1].get("checked_at", "")[:16] == entry["checked_at"][:16]:
        history[-1] = entry
    else:
        history.append(entry)
    # 控制大小
    if len(history) > cap:
        item["score_history"] = history[-cap:]


def score_and_persist(ticker: str) -> dict:
    """对 watchlist 里的某项重新评分并把结果写回 last_result + 历史。"""
    data = load_watchlist()
    ticker = ticker.strip().upper()
    item = next((it for it in data["items"] if it["ticker"] == ticker), None)
    if item is None:
        raise ValueError(f"{ticker} 不在 stock_gene 观察列表中")
    result = score_stock(
        ticker, name=item.get("name", ""),
        market=item.get("market", "US"),
        sector=item.get("sector", ""),
    )
    item["last_result"] = result
    item["last_checked_at"] = result["checked_at"]
    _append_history(item, "trend", result)
    save_watchlist(data)
    return result


def score_all() -> list[dict]:
    """批量评分所有观察项；逐个保存避免一项失败拖垮全部。"""
    data = load_watchlist()
    results: list[dict] = []
    for item in data["items"]:
        try:
            r = score_stock(
                item["ticker"], name=item.get("name", ""),
                market=item.get("market", "US"),
                sector=item.get("sector", ""),
            )
            item["last_result"] = r
            item["last_checked_at"] = r["checked_at"]
            _append_history(item, "trend", r)
            results.append(r)
        except Exception as e:
            results.append({
                "ticker": item["ticker"],
                "error": str(e),
            })
    save_watchlist(data)
    return results


def compare_peers(tickers: list[str], sector: str = "", market: str = "US") -> dict:
    """横向对比同行业的多只股票 — 各跑一遍 score_stock 后对齐返回。"""
    rows = []
    for t in tickers:
        try:
            r = score_stock(t, market=market, sector=sector)
            rows.append(r)
        except Exception as e:
            rows.append({"ticker": t, "error": str(e)})
    return {
        "sector": sector,
        "market": market,
        "count": len(rows),
        "items": rows,
    }


# ── Value engine 集成（V1—V6 价值健康度）────────────────
def _get_cached_stock(ticker: str) -> dict | None:
    """从 server.cache.stocks 里查同 ticker 的快照（pe/roe/profitMargin 已 pipeline 计算）。
    用作 yfinance .info 失败时的兜底。导入失败（如脱离 server 运行）返回 None。"""
    try:
        import server  # type: ignore
        return next((s for s in server.cache.stocks if s.get("ticker") == ticker), None)
    except Exception:
        return None


def score_value_and_persist(ticker: str) -> dict:
    """对 watchlist 里的某项跑价值评分并写回 last_value_result + 历史。"""
    import value_gene
    data = load_watchlist()
    ticker = ticker.strip().upper()
    item = next((it for it in data["items"] if it["ticker"] == ticker), None)
    if item is None:
        raise ValueError(f"{ticker} 不在 stock_gene 观察列表中")
    cached = _get_cached_stock(ticker)
    result = value_gene.score_value(
        ticker, name=item.get("name", ""),
        market=item.get("market", "US"),
        sector=item.get("sector", ""),
        cached_stock=cached,
    )
    item["last_value_result"] = result
    item["last_value_checked_at"] = result["checked_at"]
    _append_history(item, "value", result)
    save_watchlist(data)
    return result


def score_all_value() -> list[dict]:
    """批量价值评分所有观察项。"""
    import value_gene
    data = load_watchlist()
    results: list[dict] = []
    for item in data["items"]:
        try:
            cached = _get_cached_stock(item["ticker"])
            r = value_gene.score_value(
                item["ticker"], name=item.get("name", ""),
                market=item.get("market", "US"),
                sector=item.get("sector", ""),
                cached_stock=cached,
            )
            item["last_value_result"] = r
            item["last_value_checked_at"] = r["checked_at"]
            _append_history(item, "value", r)
            results.append(r)
        except Exception as e:
            results.append({"ticker": item["ticker"], "error": str(e)})
    save_watchlist(data)
    return results


def compare_peers_value(tickers: list[str], sector: str = "",
                        market: str = "US") -> dict:
    """横向价值对比。"""
    import value_gene
    rows = []
    for t in tickers:
        try:
            cached = _get_cached_stock(t)
            rows.append(value_gene.score_value(
                t, market=market, sector=sector, cached_stock=cached,
            ))
        except Exception as e:
            rows.append({"ticker": t, "error": str(e)})
    return {
        "engine": "value",
        "sector": sector,
        "market": market,
        "count": len(rows),
        "items": rows,
    }


# ── 导入 / 导出 ────────────────────────────────────────
def export_data() -> dict:
    """整份观察列表（含评分历史、双引擎缓存）导出为 dict，前端转 JSON 下载。"""
    data = load_watchlist()
    return {
        "version": data.get("version", 1),
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "items": data.get("items", []),
    }


def import_data(payload: dict, mode: str = "merge") -> dict:
    """
    从备份 payload 导入。
      - mode='merge'：同 ticker 跳过；新增项 append（推荐）
      - mode='replace'：清空 items 后导入（不可撤销）

    返回 {ok, mode, items_added, items_skipped}。
    """
    if mode not in ("merge", "replace"):
        raise ValueError("mode 必须是 'merge' 或 'replace'")
    if not isinstance(payload, dict):
        raise ValueError("payload 必须是 dict")
    incoming = payload.get("items") or []
    if not isinstance(incoming, list):
        raise ValueError("payload.items 必须是 list")

    data = load_watchlist()
    added = 0
    skipped = 0
    if mode == "replace":
        data["items"] = []
    existing_tickers = {it["ticker"] for it in data["items"]}

    for raw in incoming:
        if not isinstance(raw, dict):
            continue
        t = (raw.get("ticker") or "").strip().upper()
        if not t:
            continue
        if t in existing_tickers:
            skipped += 1
            continue
        # 仅白名单字段，避免恶意 payload 污染
        item = {
            "ticker": t,
            "name": raw.get("name", ""),
            "market": raw.get("market", "US"),
            "sector": raw.get("sector", ""),
            "notes": raw.get("notes", ""),
            "tags": raw.get("tags") or [],
            "added_at": raw.get("added_at") or date.today().isoformat(),
            "last_result": raw.get("last_result"),
            "last_value_result": raw.get("last_value_result"),
            "last_checked_at": raw.get("last_checked_at"),
            "last_value_checked_at": raw.get("last_value_checked_at"),
            "score_history": raw.get("score_history") or [],
        }
        data["items"].append(item)
        existing_tickers.add(t)
        added += 1

    save_watchlist(data)
    return {
        "ok": True,
        "mode": mode,
        "items_added": added,
        "items_skipped": skipped,
    }
