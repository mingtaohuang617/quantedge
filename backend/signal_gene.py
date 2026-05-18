"""
signal_gene — 短期信号雷达
============================

针对 1-4 周入场时机判断，6 个短期技术信号（每个 0/1）：

  S1  突破前期阻力       — 收盘 ≥ 近 20D 高 × 0.99
  S2  放量突破            — 突破当日量比 ≥ 1.5（vs 20D 均量）
  S3  MACD 金叉           — 近 10D 内 DIF 上穿 DEA
  S4  RSI 抬头            — 近 10D RSI 从 ≤45 抬到 ≥50
  S5  短期均线多头排列    — MA5 > MA10 > MA20
  S6  强势整理（量缩窄幅）— 近 10D 内有放量阳后量缩 ≤ 70%、波幅 < 8%

输出结构与 stock_gene.score_stock 对齐，便于前端复用 ScoreDetail。
verdict 分级：5-6 = 入场窗口 · 4 = 可关注 · 3 = 观望 · ≤2 = 暂避

数据：复用 stock_gene._load_bars（db / yfinance 兜底）。
"""
from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

# 直接复用 stock_gene 的 bar 加载，避免重复代码
from stock_gene import _load_bars


# ── 各特征 ─────────────────────────────────────────────
def _feature_breakout(df: pd.DataFrame) -> dict:
    if len(df) < 22:
        return _na("breakout", "突破前期阻力", "数据不足 22 个交易日")
    close = float(df["close"].iloc[-1])
    high20 = float(df["close"].iloc[-21:-1].max())  # 不含当日
    ratio = close / high20
    passed = ratio >= 0.99
    desc = "正在创新高" if ratio >= 1 else ("紧贴阻力" if passed else "距高位较远")
    return {
        "id": "breakout",
        "label": "突破前期阻力",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"${close:.2f} vs 20D 高 ${high20:.2f}（{(ratio - 1) * 100:+.1f}%）",
        "detail": ("突破前期套牢区，潜在入场窗口" if passed
                   else f"{desc}，再等等"),
        "available": True,
    }


def _feature_volume_breakout(df: pd.DataFrame) -> dict:
    vol = df.get("volume")
    if vol is None or len(df) < 22 or vol.dropna().empty:
        return _na("vol_breakout", "放量突破", "成交量数据缺失或不足")
    v_today = float(vol.iloc[-1] or 0)
    v_avg = float(vol.iloc[-21:-1].mean() or 0)
    if v_avg <= 0:
        return _na("vol_breakout", "放量突破", "20D 均量为 0")
    ratio = v_today / v_avg
    passed = ratio >= 1.5
    return {
        "id": "vol_breakout",
        "label": "放量突破",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"量比 {ratio:.2f}（今日 vs 20D 均量）",
        "detail": ("资金跟进确认突破" if passed
                   else "量能不足，缺乏跟风盘"),
        "available": True,
    }


def _feature_macd_golden_cross(df: pd.DataFrame) -> dict:
    if len(df) < 40:
        return _na("macd_cross", "MACD 金叉（近 10D）", "数据不足 40 个交易日")
    close = df["close"].astype(float)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False).mean()
    diff = dif - dea
    # 近 10 天内出现"前值 ≤ 0 且当前 > 0"即金叉
    recent = diff.iloc[-10:]
    crossed = False
    cross_idx = None
    prev = diff.iloc[-11] if len(diff) >= 11 else 0
    for i, cur in enumerate(recent):
        if prev <= 0 and cur > 0:
            crossed = True
            cross_idx = i
            break
        prev = cur
    cur_diff = float(diff.iloc[-1])
    if crossed:
        days_ago = len(recent) - 1 - cross_idx
        detail = f"{days_ago} 天前金叉，DIF-DEA 现差 {cur_diff:+.2f}"
    else:
        detail = f"近 10D 无金叉，DIF-DEA 差 {cur_diff:+.2f}"
    return {
        "id": "macd_cross",
        "label": "MACD 金叉（近 10D）",
        "pass": crossed,
        "score": 1 if crossed else 0,
        "value": f"DIF-DEA {cur_diff:+.2f}",
        "detail": detail,
        "available": True,
    }


def _feature_rsi_rising(df: pd.DataFrame) -> dict:
    if len(df) < 25:
        return _na("rsi_rising", "RSI 抬头（30→50）", "数据不足 25 个交易日")
    close = df["close"].astype(float)
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    period = 14
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.dropna()
    if len(rsi) < 10:
        return _na("rsi_rising", "RSI 抬头（30→50）", "RSI 历史不足")
    recent = rsi.iloc[-10:]
    low_pt = float(recent.min())
    cur = float(recent.iloc[-1])
    passed = low_pt <= 45 and cur >= 50
    return {
        "id": "rsi_rising",
        "label": "RSI 抬头（30→50）",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"近 10D 低点 RSI {low_pt:.0f} → 现 {cur:.0f}",
        "detail": ("从超卖区抬升，动能回暖" if passed
                   else "RSI 未走出此类型态"),
        "available": True,
    }


def _feature_ma_bullish(df: pd.DataFrame) -> dict:
    if len(df) < 25:
        return _na("ma_bullish", "短期均线多头排列", "数据不足 25 个交易日")
    close = df["close"].astype(float)
    ma5 = float(close.rolling(5).mean().iloc[-1])
    ma10 = float(close.rolling(10).mean().iloc[-1])
    ma20 = float(close.rolling(20).mean().iloc[-1])
    passed = ma5 > ma10 > ma20
    return {
        "id": "ma_bullish",
        "label": "短期均线多头排列（5>10>20）",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"MA5 ${ma5:.2f} · MA10 ${ma10:.2f} · MA20 ${ma20:.2f}",
        "detail": ("短中长期共振向上" if passed
                   else "均线未形成多头排列"),
        "available": True,
    }


def _feature_consolidation_pause(df: pd.DataFrame) -> dict:
    """放量阳 + 之后量缩窄幅整理（强势 pause 形态）。"""
    if len(df) < 25:
        return _na("pause", "强势整理（量缩窄幅）", "数据不足 25 个交易日")
    vol = df.get("volume")
    if vol is None or vol.dropna().empty:
        return _na("pause", "强势整理（量缩窄幅）", "成交量缺失")
    close = df["close"].astype(float)
    high = df["high"].astype(float).fillna(close)
    low = df["low"].astype(float).fillna(close)
    last10 = df.iloc[-10:]
    vol10 = last10["volume"].astype(float).fillna(0)
    if vol10.sum() <= 0:
        return _na("pause", "强势整理（量缩窄幅）", "近 10D 成交量为 0")
    # 找一根放量阳：close > prev_close 且 vol >= 1.5 * 20D 均量
    v_avg20 = float(vol.iloc[-21:-1].mean() or 0)
    if v_avg20 <= 0:
        return _na("pause", "强势整理（量缩窄幅）", "20D 均量为 0")
    big_up_idx = -1
    for i in range(len(last10)):
        idx = -10 + i
        prev_c = close.iloc[idx - 1] if abs(idx - 1) <= len(close) else None
        cur_c = close.iloc[idx]
        v = float(vol.iloc[idx] or 0)
        if prev_c is not None and cur_c > prev_c and v >= 1.5 * v_avg20:
            big_up_idx = i
            break
    if big_up_idx < 0:
        return {
            "id": "pause",
            "label": "强势整理（量缩窄幅）",
            "pass": False, "score": 0,
            "value": "未见放量阳",
            "detail": "近 10D 没有明显放量上涨动作",
            "available": True,
        }
    # 后续量缩 + 窄幅
    tail = last10.iloc[big_up_idx + 1:]
    if len(tail) < 2:
        return {
            "id": "pause",
            "label": "强势整理（量缩窄幅）",
            "pass": False, "score": 0,
            "value": "放量后样本太短",
            "detail": "近 10D 放量太靠后，无法判断整理形态",
            "available": True,
        }
    v_tail = float(tail["volume"].astype(float).mean() or 0)
    big_up_vol = float(vol.iloc[big_up_idx - 10] or 0)
    if big_up_vol <= 0:
        return _na("pause", "强势整理（量缩窄幅）", "放量阳量为 0")
    v_ratio = v_tail / big_up_vol
    h = float(tail["high"].astype(float).max())
    l = float(tail["low"].astype(float).min())
    mid = (h + l) / 2 if (h + l) > 0 else 1
    range_pct = (h - l) / mid * 100
    passed = v_ratio <= 0.7 and range_pct < 8
    return {
        "id": "pause",
        "label": "强势整理（量缩窄幅）",
        "pass": passed,
        "score": 1 if passed else 0,
        "value": f"放量后量比 {v_ratio:.2f} · 波幅 {range_pct:.1f}%",
        "detail": ("放量后温和回调 — 强势整理" if passed
                   else "未呈现 pause 形态"),
        "available": True,
    }


# ── 工具 ────────────────────────────────────────────────
def _na(id_: str, label: str, why: str) -> dict:
    return {
        "id": id_,
        "label": label,
        "pass": False, "score": 0,
        "value": "—",
        "detail": why,
        "available": False,
    }


def _verdict(score: int, available: int) -> dict:
    if available == 0:
        return {"level": "unknown", "label": "数据不足", "color": "gray"}
    pct = score / available
    if score >= 5 or (available < 6 and pct >= 0.83):
        return {"level": "strong", "label": "入场窗口", "color": "emerald"}
    if score >= 4 or pct >= 0.66:
        return {"level": "moderate", "label": "可关注", "color": "amber"}
    if score >= 3 or pct >= 0.5:
        return {"level": "neutral", "label": "观望", "color": "slate"}
    return {"level": "weak", "label": "暂避", "color": "rose"}


# ── 综合入口 ────────────────────────────────────────────
def score_signal(ticker: str, name: str = "", market: str = "US",
                 sector: str = "") -> dict:
    """对单只股票跑完 6 个短期信号特征评分。"""
    ticker = ticker.strip().upper()
    warnings: list[str] = []
    df = _load_bars(ticker, days=80)
    if df is None or df.empty:
        return {
            "ticker": ticker,
            "name": name,
            "market": market,
            "sector": sector,
            "engine": "signal",
            "score": 0,
            "max_score": 6,
            "available": 0,
            "verdict": _verdict(0, 0),
            "checked_at": datetime.utcnow().isoformat() + "Z",
            "features": [],
            "warnings": [f"无法获取 {ticker} 的历史 K 线"],
        }

    features = [
        _feature_breakout(df),
        _feature_volume_breakout(df),
        _feature_macd_golden_cross(df),
        _feature_rsi_rising(df),
        _feature_ma_bullish(df),
        _feature_consolidation_pause(df),
    ]

    available = sum(1 for f in features if f.get("available"))
    score = sum(1 for f in features if f.get("pass"))

    return {
        "ticker": ticker,
        "name": name,
        "market": market,
        "sector": sector,
        "engine": "signal",
        "score": score,
        "max_score": 6,
        "available": available,
        "verdict": _verdict(score, available),
        "checked_at": datetime.utcnow().isoformat() + "Z",
        "features": features,
        "warnings": warnings,
    }


def compare_peers_signal(tickers: list[str], sector: str = "",
                         market: str = "US") -> dict:
    """短期信号横向对比。"""
    rows = []
    for t in tickers:
        try:
            rows.append(score_signal(t, market=market, sector=sector))
        except Exception as e:
            rows.append({"ticker": t, "error": str(e)})
    return {
        "engine": "signal",
        "sector": sector,
        "market": market,
        "count": len(rows),
        "items": rows,
    }
