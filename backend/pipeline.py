#!/usr/bin/env python3
"""
QuantEdge 数据管道
==================
从 yfinance 拉取真实行情和财务数据，计算量化因子，
输出前端可直接使用的 JSON 文件。

使用方式:
    pip install -r requirements.txt
    python pipeline.py

输出:
    output/stocks_data.json     — 前端数据 (直接替换前端 STOCKS 数组)
    output/alerts.json          — 自动生成的预警信号
    output/pipeline_log.txt     — 运行日志
"""

import json
import sys
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

from config import TICKERS, SECTOR_ETF_MAP
from factors import (
    calc_rsi, calc_momentum, calc_stock_score, calc_etf_score,
    calc_leverage_decay, parse_leverage,
)
from data_sources import fetch_history, health_check


BASE_DIR = Path(__file__).resolve().parent  # backend/
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# 前端直接 import 的数据文件路径（基于 backend/ 解析，跨工作目录调用都正确）
FRONTEND_DATA_PATH = BASE_DIR.parent / "frontend" / "src" / "data.js"

LOG_LINES: list[str] = []


def apply_overrides(result: dict, cfg: dict, latest_price: float = None) -> dict:
    """
    应用 static_overrides 兜底缺失字段
    仅当 yfinance 返回 None 时才用静态值替换
    """
    overrides = cfg.get("static_overrides", {})
    if not overrides:
        return result

    # 杠杆 ETF：禁止用静态 NAV 兜底（NAV 概念不适用，会被误算成离谱溢价率）
    is_leveraged = parse_leverage(cfg.get("leverage")) is not None
    skip_keys = {"nav"} if is_leveraged else set()

    for key, val in overrides.items():
        if key in skip_keys:
            continue
        if result.get(key) is None:
            result[key] = val

    # 如果 ETF 有 NAV 兜底但没有溢价率，自动重算
    if result.get("isETF") and result.get("nav") and latest_price:
        if result.get("premiumDiscount") is None:
            nav = result["nav"]
            result["premiumDiscount"] = round((latest_price - nav) / nav * 100, 2)

    return result


def log(msg: str):
    """同时打印和记录日志"""
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    LOG_LINES.append(line)


def safe_get(info: dict, key: str, default=None):
    """安全获取 yfinance info 字段"""
    val = info.get(key, default)
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return default
    return val


def fetch_stock_data(ticker_key: str, cfg: dict) -> dict | None:
    """
    拉取个股数据并计算因子
    返回前端需要的完整数据结构
    """
    symbol = cfg["yf_symbol"]
    log(f"  拉取 {ticker_key} ({symbol})...")

    try:
        # 行情走数据源路由（HK→Futu, US→yfinance）
        hist, src_name = fetch_history(cfg, days=120)
        log(f"    [行情数据源] {src_name} | {len(hist)} 行日K")

        # 基本面 info 仍走 yfinance（Futu 财务数据需付费且字段不全）
        tk = yf.Ticker(symbol)
        info = tk.info or {}

        close = hist["Close"]
        latest_price = round(float(close.iloc[-1]), 2)

        # 涨跌幅 (与前一交易日相比)
        if len(close) >= 2:
            prev_close = float(close.iloc[-2])
            change_pct = round((latest_price - prev_close) / prev_close * 100, 2)
        else:
            change_pct = 0.0

        # 计算因子
        rsi = calc_rsi(close)
        momentum = calc_momentum(close)

        # 财务指标
        pe = safe_get(info, "trailingPE")
        roe = safe_get(info, "returnOnEquity")
        if roe is not None:
            roe = round(roe * 100, 1)  # 转为百分比

        revenue_growth = safe_get(info, "revenueGrowth")
        if revenue_growth is not None:
            revenue_growth = round(revenue_growth * 100, 1)

        profit_margin = safe_get(info, "profitMargins")
        if profit_margin is not None:
            profit_margin = round(profit_margin * 100, 1)

        # 综合评分
        score, sub_scores = calc_stock_score(pe, roe, revenue_growth, profit_margin, momentum, rsi, detailed=True)

        # 构建价格历史 (用于前端图表)
        price_history = []
        # 取最近10个交易日的样本点
        sample_indices = np.linspace(0, len(hist) - 1, min(12, len(hist)), dtype=int)
        for idx in sample_indices:
            row = hist.iloc[idx]
            date_str = row.name.strftime("%b %d")
            price_history.append({"m": date_str, "p": round(float(row["Close"]), 2)})

        # 格式化大数字
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

        market_cap_raw = safe_get(info, "marketCap")
        revenue_raw = safe_get(info, "totalRevenue")
        ebitda_raw = safe_get(info, "ebitda")

        result = {
            "ticker": ticker_key,
            "name": cfg["name"],
            "market": cfg["market"],
            "sector": cfg["sector"],
            "currency": cfg["currency"],
            "price": latest_price,
            "change": change_pct,
            "score": score,
            "isETF": False,
            # 个股指标
            "pe": round(pe, 2) if pe else None,
            "roe": roe,
            "momentum": momentum,
            "rsi": rsi,
            "revenueGrowth": revenue_growth,
            "profitMargin": profit_margin,
            "ebitda": fmt_big(ebitda_raw),
            "marketCap": fmt_big(market_cap_raw),
            "revenue": fmt_big(revenue_raw),
            "eps": safe_get(info, "trailingEps"),
            "beta": round(safe_get(info, "beta", 0), 2) or None,
            "week52High": safe_get(info, "fiftyTwoWeekHigh"),
            "week52Low": safe_get(info, "fiftyTwoWeekLow"),
            "avgVolume": fmt_big(safe_get(info, "averageVolume")),
            "nextEarnings": None,  # yfinance 不稳定提供此字段
            "priceHistory": price_history,
            "description": cfg["description"],
            "subScores": sub_scores,
        }

        # 尝试获取下次财报日期
        try:
            cal = tk.calendar
            if cal is not None and not cal.empty:
                if "Earnings Date" in cal.index:
                    ed = cal.loc["Earnings Date"]
                    if len(ed) > 0:
                        result["nextEarnings"] = str(ed.iloc[0])[:10]
        except Exception:
            pass

        log(f"  ✓ {ticker_key}: ${latest_price} ({change_pct:+.2f}%) 评分={score}")
        result = apply_overrides(result, cfg, latest_price)
        # 兜底后重新计算评分（如果财务字段被补充了）
        if cfg.get("static_overrides"):
            result["score"], result["subScores"] = calc_stock_score(
                result.get("pe"), result.get("roe"),
                result.get("revenueGrowth"), result.get("profitMargin"),
                result.get("momentum"), result.get("rsi"),
                detailed=True,
            )
        return result

    except Exception as e:
        log(f"  ✗ {ticker_key}: 拉取失败 - {e}")
        traceback.print_exc()
        return None


def fetch_etf_data(ticker_key: str, cfg: dict) -> dict | None:
    """
    拉取ETF数据并计算ETF专属因子
    """
    symbol = cfg["yf_symbol"]
    log(f"  拉取 {ticker_key} ({symbol})...")

    try:
        # 行情走数据源路由（HK→Futu, US→yfinance）
        hist, src_name = fetch_history(cfg, days=120)
        log(f"    [行情数据源] {src_name} | {len(hist)} 行日K")

        # 基本面 info / 持仓数据仍走 yfinance
        tk = yf.Ticker(symbol)
        info = tk.info or {}

        close = hist["Close"]
        latest_price = round(float(close.iloc[-1]), 2)

        if len(close) >= 2:
            prev_close = float(close.iloc[-2])
            change_pct = round((latest_price - prev_close) / prev_close * 100, 2)
        else:
            change_pct = 0.0

        # 因子
        momentum = calc_momentum(close)
        rsi = calc_rsi(close)

        # ETF 专属指标
        expense_ratio = safe_get(info, "annualReportExpenseRatio")
        if expense_ratio is not None:
            expense_ratio = round(expense_ratio * 100, 2)
        else:
            # yfinance 不一定有，从配置中备用
            expense_ratio = None

        nav = safe_get(info, "navPrice")
        # 杠杆 ETF 不计算溢价率（NAV 概念不适用），改算波动磨损率
        is_leveraged = parse_leverage(cfg.get("leverage")) is not None
        if is_leveraged:
            premium_discount = None
            decay_rate = calc_leverage_decay(close, cfg.get("leverage"))
        else:
            decay_rate = None
            premium_discount = None
            if nav and nav > 0:
                premium_discount = round((latest_price - nav) / nav * 100, 2)

        # AUM
        total_assets = safe_get(info, "totalAssets")
        aum_str = None
        if total_assets:
            if total_assets >= 1e9:
                aum_str = f"{total_assets/1e9:.1f}B {cfg['currency']}"
            elif total_assets >= 1e6:
                aum_str = f"{total_assets/1e6:.0f}M {cfg['currency']}"
            else:
                aum_str = f"{total_assets:.0f} {cfg['currency']}"

        # 持仓信息 (尝试从 yfinance 获取)
        top_holdings = []
        concentration_top3 = None
        total_holdings = None
        try:
            # yfinance 的 ETF 持仓接口
            if hasattr(tk, 'funds_data'):
                fd = tk.funds_data
                if hasattr(fd, 'top_holdings') and fd.top_holdings is not None:
                    holdings_df = fd.top_holdings
                    if not holdings_df.empty:
                        total_holdings = len(holdings_df)
                        for _, row in holdings_df.head(5).iterrows():
                            name = row.get("Name", row.get("Symbol", "Unknown"))
                            weight = row.get("% Assets", row.get("Holding Percent", 0))
                            if isinstance(weight, str):
                                weight = float(weight.replace("%", ""))
                            else:
                                weight = round(float(weight) * 100, 2) if weight < 1 else round(float(weight), 2)
                            top_holdings.append({"name": str(name)[:20], "weight": weight})
                        # 前3集中度
                        if len(top_holdings) >= 3:
                            concentration_top3 = round(sum(h["weight"] for h in top_holdings[:3]), 2)
        except Exception as e:
            log(f"  ⚠ {ticker_key}: 持仓数据获取失败 ({e})")

        # ETF 评分
        score, sub_scores = calc_etf_score(
            expense_ratio=expense_ratio,
            premium_discount=premium_discount,
            aum_usd=total_assets,
            momentum=momentum,
            concentration_top3=concentration_top3,
            leverage=cfg.get("leverage"),
            detailed=True,
        )

        # 价格历史
        price_history = []
        sample_indices = np.linspace(0, len(hist) - 1, min(12, len(hist)), dtype=int)
        for idx in sample_indices:
            row = hist.iloc[idx]
            date_str = row.name.strftime("%b %d")
            price_history.append({"m": date_str, "p": round(float(row["Close"]), 2)})

        result = {
            "ticker": ticker_key,
            "name": cfg["name"],
            "market": cfg["market"],
            "sector": cfg["sector"],
            "currency": cfg["currency"],
            "price": latest_price,
            "change": change_pct,
            "score": score,
            "isETF": True,
            "etfType": cfg.get("etf_type", "ETF"),
            "leverage": cfg.get("leverage"),
            # ETF 专属
            "expenseRatio": expense_ratio,
            "premiumDiscount": premium_discount,  # 杠杆 ETF 为 None
            "decayRate": decay_rate,              # 杠杆 ETF 的年化波动磨损率（%）
            "nav": nav if not is_leveraged else None,
            "navDate": datetime.now().strftime("%Y-%m-%d") if not is_leveraged else None,
            "trackingError": (
                f"年化波动磨损 ≈ {decay_rate}%" if decay_rate is not None
                else ("较高 (杠杆损耗)" if cfg.get("leverage") else None)
            ),
            "aum": aum_str,
            "adv": None,  # 日均成交额需要额外计算
            "bidAskSpread": None,
            "benchmark": cfg.get("benchmark", "N/A"),
            "issuer": cfg.get("issuer", "Unknown"),
            "dividendPolicy": cfg.get("dividend_policy", "N/A"),
            "inceptionDate": cfg.get("inception_date"),
            "topHoldings": top_holdings if top_holdings else None,
            "concentrationTop3": concentration_top3,
            "totalHoldings": total_holdings,
            # 通用字段 (ETF不适用的)
            "pe": None, "roe": None,
            "momentum": momentum, "rsi": rsi,
            "revenueGrowth": None, "profitMargin": None,
            "ebitda": None, "revenue": None, "eps": None, "beta": None,
            "marketCap": aum_str,  # 对ETF用AUM代替
            "week52High": safe_get(info, "fiftyTwoWeekHigh"),
            "week52Low": safe_get(info, "fiftyTwoWeekLow"),
            "avgVolume": None,
            "nextEarnings": None,
            "priceHistory": price_history,
            "description": cfg["description"],
            "subScores": sub_scores,
        }

        # 日均成交额
        if len(hist) >= 5:
            avg_vol = hist["Volume"].tail(20).mean()
            avg_price = close.tail(20).mean()
            adv = avg_vol * avg_price
            if adv >= 1e9:
                result["adv"] = f"{adv/1e9:.1f}B"
            elif adv >= 1e6:
                result["adv"] = f"{adv/1e6:.0f}M"
            else:
                result["adv"] = f"{adv:.0f}"

        log(f"  ✓ {ticker_key}: {cfg['currency']} {latest_price} ({change_pct:+.2f}%) 评分={score}")
        result = apply_overrides(result, cfg, latest_price)
        # 兜底后重算 ETF 评分
        if cfg.get("static_overrides"):
            result["score"], result["subScores"] = calc_etf_score(
                expense_ratio=result.get("expenseRatio"),
                premium_discount=result.get("premiumDiscount"),
                aum_usd=total_assets,
                momentum=result.get("momentum"),
                concentration_top3=result.get("concentrationTop3"),
                leverage=cfg.get("leverage"),
                detailed=True,
            )
        return result

    except Exception as e:
        log(f"  ✗ {ticker_key}: 拉取失败 - {e}")
        traceback.print_exc()
        return None


def generate_alerts(stocks: list[dict]) -> list[dict]:
    """
    基于最新数据自动生成预警信号
    """
    alerts = []
    alert_id = 1

    for stk in stocks:
        ticker = stk["ticker"]
        now_str = datetime.now().strftime("%H:%M")

        # RSI 超买/超卖预警
        rsi = stk.get("rsi", 50)
        if rsi and rsi > 70:
            alerts.append({
                "id": alert_id, "type": "technical", "ticker": ticker,
                "message": f"RSI 达到 {rsi}，进入超买区间，注意回调风险",
                "time": now_str, "severity": "warning"
            })
            alert_id += 1
        elif rsi and rsi < 30:
            alerts.append({
                "id": alert_id, "type": "technical", "ticker": ticker,
                "message": f"RSI 降至 {rsi}，进入超卖区间，可能存在反弹机会",
                "time": now_str, "severity": "info"
            })
            alert_id += 1

        # 涨跌幅异常预警
        change = stk.get("change", 0)
        if abs(change) > 5:
            alerts.append({
                "id": alert_id, "type": "price", "ticker": ticker,
                "message": f"日内{'大涨' if change > 0 else '大跌'} {abs(change):.2f}%，波动异常",
                "time": now_str, "severity": "high"
            })
            alert_id += 1

        # 非杠杆 ETF：溢价预警
        if stk.get("isETF") and stk.get("premiumDiscount") is not None:
            pd_val = stk["premiumDiscount"]
            if abs(pd_val) > 5:
                alerts.append({
                    "id": alert_id, "type": "technical", "ticker": ticker,
                    "message": f"{'溢价' if pd_val > 0 else '折价'} {abs(pd_val):.1f}%，偏离NAV过大",
                    "time": now_str, "severity": "warning"
                })
                alert_id += 1

        # 杠杆 ETF：高磨损率预警
        if stk.get("isETF") and stk.get("decayRate") is not None:
            decay = stk["decayRate"]
            if decay > 10:
                alerts.append({
                    "id": alert_id, "type": "technical", "ticker": ticker,
                    "message": f"年化波动磨损约 {decay}%，长期持有损耗显著",
                    "time": now_str, "severity": "warning"
                })
                alert_id += 1

        # 52周新高/新低预警
        price = stk.get("price", 0)
        w52h = stk.get("week52High")
        w52l = stk.get("week52Low")
        if w52h and price >= w52h * 0.98:
            alerts.append({
                "id": alert_id, "type": "price", "ticker": ticker,
                "message": f"接近52周新高 {w52h}，当前 {price}",
                "time": now_str, "severity": "high"
            })
            alert_id += 1
        elif w52l and price <= w52l * 1.02:
            alerts.append({
                "id": alert_id, "type": "price", "ticker": ticker,
                "message": f"接近52周新低 {w52l}，当前 {price}",
                "time": now_str, "severity": "high"
            })
            alert_id += 1

    return alerts


def run_pipeline():
    """主流程"""
    log("=" * 60)
    log("QuantEdge 数据管道启动")
    log(f"运行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"标的数量: {len(TICKERS)}")
    log("=" * 60)

    # 数据源健康检查
    log("─── 数据源健康检查 ───")
    health = health_check()
    for src, (ok, msg) in health.items():
        flag = "✓" if ok else "✗"
        log(f"  {flag} {src}: {msg}")
    if not health["futu"][0]:
        # 检查是否有 HK/A 股标的依赖 Futu
        needs_futu = any(
            (cfg.get("market") or "").upper() in ("HK", "SH", "SZ", "CN")
            for cfg in TICKERS.values()
        )
        if needs_futu:
            log("  ⚠ 存在依赖 Futu 的港股/A股标的，但 OpenD 不可用")
            log("  ⚠ 这些标的将拉取失败。请启动 Futu OpenD GUI 并登录后重试")
    log("")

    all_stocks = []
    failed = []

    for ticker_key, cfg in TICKERS.items():
        if cfg["type"] == "stock":
            result = fetch_stock_data(ticker_key, cfg)
        else:
            result = fetch_etf_data(ticker_key, cfg)

        if result:
            all_stocks.append(result)
        else:
            failed.append(ticker_key)

    # 按评分排序并分配排名
    all_stocks.sort(key=lambda x: x["score"], reverse=True)
    for i, stk in enumerate(all_stocks):
        stk["rank"] = i + 1

    # 生成预警
    alerts = generate_alerts(all_stocks)

    # 输出 JSON
    log("\n─── 输出文件 ───")

    stocks_path = OUTPUT_DIR / "stocks_data.json"
    with open(stocks_path, "w", encoding="utf-8") as f:
        json.dump(all_stocks, f, ensure_ascii=False, indent=2)
    log(f"✓ {stocks_path} ({len(all_stocks)} 个标的)")

    alerts_path = OUTPUT_DIR / "alerts.json"
    with open(alerts_path, "w", encoding="utf-8") as f:
        json.dump(alerts, f, ensure_ascii=False, indent=2)
    log(f"✓ {alerts_path} ({len(alerts)} 条预警)")

    # 生成前端可直接 import 的 ES 模块
    def write_data_module(path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("// 自动生成 - 由 backend/pipeline.py 写出，请勿手动编辑\n")
            f.write(f"// 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write("export const STOCKS = ")
            json.dump(all_stocks, f, ensure_ascii=False, indent=2)
            f.write(";\n\n")
            f.write("export const ALERTS = ")
            json.dump(alerts, f, ensure_ascii=False, indent=2)
            f.write(";\n")

    js_path = OUTPUT_DIR / "frontend_data.js"
    write_data_module(js_path)
    log(f"✓ {js_path} (备份)")

    # 同步写入前端 src，供 Vite import
    if FRONTEND_DATA_PATH.parent.exists():
        write_data_module(FRONTEND_DATA_PATH)
        log(f"✓ {FRONTEND_DATA_PATH.resolve()} (前端实时数据)")
    else:
        log(f"⚠ 前端目录不存在，跳过: {FRONTEND_DATA_PATH}")

    # 摘要
    log("\n─── 运行摘要 ───")
    log(f"成功: {len(all_stocks)} | 失败: {len(failed)}")
    if failed:
        log(f"失败标的: {', '.join(failed)}")

    log("\n评分排行:")
    for stk in all_stocks:
        etf_tag = " [ETF]" if stk.get("isETF") else ""
        log(f"  #{stk['rank']} {stk['ticker']}{etf_tag}: {stk['score']}分 | "
            f"{stk['currency']} {stk['price']} ({stk['change']:+.2f}%)")

    if alerts:
        log(f"\n活跃预警 ({len(alerts)} 条):")
        for a in alerts[:5]:
            log(f"  [{a['severity'].upper()}] {a['ticker']}: {a['message']}")
        if len(alerts) > 5:
            log(f"  ... 还有 {len(alerts) - 5} 条")

    # 写日志文件
    log_path = OUTPUT_DIR / "pipeline_log.txt"
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(LOG_LINES))

    log(f"\n✓ 管道运行完毕，输出目录: {OUTPUT_DIR.resolve()}")


if __name__ == "__main__":
    run_pipeline()
