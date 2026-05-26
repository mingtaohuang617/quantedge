"""
mining_alpha.synthetic_demo — 合成数据端到端 demo / smoke test
==============================================================

不依赖 tushare：构造 N 只虚拟 A 股、5 年 OHLCV，注入轻度可学信号，
直接写入 daily_bars 表，让用户不需任何 API key 就能 demo 整条 pipeline。

CLI:
  python -m mining_alpha.synthetic_demo --n-stocks 100 --years 5 --seed 42

后续可正常跑：
  python -m mining_alpha.run compute-factors --universe DEMO --start ... --end ...
  python -m mining_alpha.run ic-report --universe DEMO --start ... --end ...
  python -m mining_alpha.run train --universe DEMO --start ... --end ...
  python -m mining_alpha.run backtest --universe DEMO --start ... --end ...

设计:
  - ticker 编号 'DEMO_001.SH' ... 'DEMO_NNN.SH'
  - 注入 AR(1) 慢变信号 + 短期 momentum 信号，让因子能学到东西
  - 通过 INDEX_CODES['DEMO'] 自动注册（已加入 data_loader）
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import db as _db


def generate_synthetic_panel(
    n_stocks: int = 100,
    years: float = 5.0,
    end_date: str | None = None,
    seed: int = 42,
) -> dict[str, pd.DataFrame]:
    """
    构造合成 panel。
    返回 dict 与 load_panel 一致：open/high/low/close/volume/amount。
    """
    rng = np.random.RandomState(seed)
    n_days = int(years * 252)
    end = pd.Timestamp(end_date) if end_date else pd.Timestamp.now().normalize()
    # 用 BDay 倒推，再用 bdate_range 取到的实际长度作为 n_days（避免 off-by-one）
    start = end - pd.tseries.offsets.BDay(n_days * 2)
    dates = pd.bdate_range(start=start, end=end)[-n_days:]
    n_days = len(dates)

    tickers = [f"DEMO{i:03d}.SH" for i in range(1, n_stocks + 1)]

    # 1) 持续型信号 (AR(1), phi=0.92)
    phi = 0.92
    signal = np.zeros((n_days, n_stocks))
    signal[0] = rng.randn(n_stocks) * 0.01
    for t in range(1, n_days):
        signal[t] = phi * signal[t - 1] + rng.randn(n_stocks) * 0.005

    # 2) 短期 momentum (10 日)
    short_mom = np.zeros((n_days, n_stocks))
    for t in range(10, n_days):
        short_mom[t] = signal[t - 10:t].mean(axis=0) * 0.4

    # 3) daily return = signal + 噪声
    noise = rng.randn(n_days, n_stocks) * 0.012
    daily_ret = signal + short_mom + noise

    # 4) cumulative close (初始 10 元)
    close_arr = 10.0 * np.cumprod(1 + daily_ret, axis=0)
    close = pd.DataFrame(close_arr, index=dates, columns=tickers)

    # 5) OHLV around close
    open_ = close.shift(1).fillna(close)
    high_factor = 1 + np.abs(rng.randn(n_days, n_stocks)) * 0.008
    low_factor = 1 - np.abs(rng.randn(n_days, n_stocks)) * 0.008
    high = close * high_factor
    low = close * low_factor
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))

    # 6) volume / amount
    volume_base = 10 ** (5 + rng.uniform(0, 2, size=n_stocks))  # 1e5 - 1e7 手
    volume_arr = np.tile(volume_base[None, :], (n_days, 1)) * \
                 (1 + rng.randn(n_days, n_stocks) * 0.3).clip(0.1, None)
    volume = pd.DataFrame(volume_arr.astype(int), index=dates, columns=tickers)
    amount = volume * close * 10.0 / 1000  # tushare 单位换算 (千元)

    return {
        "open": open_, "high": high, "low": low, "close": close,
        "volume": volume, "amount": amount,
    }


def write_to_db(panel: dict[str, pd.DataFrame], source: str = "synthetic") -> int:
    """
    把合成 panel 写入 daily_bars 表 + index_weight 表（universe='DEMO'）。

    Returns:
      写入行数
    """
    _db.init_db()
    # 1) 写 daily_bars
    open_, high, low, close = panel["open"], panel["high"], panel["low"], panel["close"]
    volume, amount = panel["volume"], panel["amount"]
    n_rows = 0
    for ticker in close.columns:
        rows = []
        for date in close.index:
            c = close.at[date, ticker]
            if pd.isna(c) or c <= 0:
                continue
            rows.append({
                "trade_date": date.strftime("%Y-%m-%d"),
                "open": float(open_.at[date, ticker]),
                "high": float(high.at[date, ticker]),
                "low": float(low.at[date, ticker]),
                "close": float(c),
                "volume": int(volume.at[date, ticker]),
                "amount": float(amount.at[date, ticker]),
                "adj_factor": 1.0,
            })
        n_rows += _db.upsert_bars(ticker, rows, source=source)

    # 2) 写 index_weight：'DEMO' index 自定义 ts_code 'DEMO.IDX'，每个月末快照全员等权
    from mining_alpha.data_loader import _ensure_index_weight_table
    _ensure_index_weight_table()
    month_ends = pd.date_range(start=close.index.min(),
                                end=close.index.max(),
                                freq="ME")
    n_stocks = len(close.columns)
    equal_weight = 100.0 / n_stocks  # 百分比
    now_ms = int(time.time() * 1000)
    weight_rows = []
    for me in month_ends:
        iso = me.strftime("%Y-%m-%d")
        for tc in close.columns:
            weight_rows.append(("DEMO.IDX", tc, iso, equal_weight, now_ms))
    with _db.transaction() as conn:
        conn.executemany(
            """
            INSERT INTO index_weight (index_id, ts_code, trade_date, weight, ingested_at)
            VALUES (?,?,?,?,?)
            ON CONFLICT(index_id, ts_code, trade_date) DO UPDATE SET
              weight = excluded.weight,
              ingested_at = excluded.ingested_at
            """,
            weight_rows,
        )
    print(f"  写入 daily_bars: {n_rows} 行 ({n_stocks} 票)")
    print(f"  写入 index_weight: {len(weight_rows)} 行 ({len(month_ends)} 月末快照)")

    # 3) 写一个 DEMO 基准指数：等权全 universe 的 close 均值
    bench_close = close.mean(axis=1)
    bench_rows = []
    for date in bench_close.index:
        bench_rows.append({
            "trade_date": date.strftime("%Y-%m-%d"),
            "open": float(bench_close[date]),
            "high": float(bench_close[date] * 1.002),
            "low": float(bench_close[date] * 0.998),
            "close": float(bench_close[date]),
            "volume": 0,
            "amount": 0.0,
            "adj_factor": 1.0,
        })
    _db.upsert_bars("DEMO.IDX", bench_rows, source=source)
    print(f"  写入基准 DEMO.IDX: {len(bench_rows)} 行")

    return n_rows


def main():
    # Windows GBK 终端兜底
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    p = argparse.ArgumentParser(prog="mining_alpha.synthetic_demo")
    p.add_argument("--n-stocks", type=int, default=100)
    p.add_argument("--years", type=float, default=5.0)
    p.add_argument("--end-date", default=None, help="ISO 日期，默认今天")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    print(f"[synthetic_demo] 生成 {args.n_stocks} 票 × {args.years} 年合成 panel "
          f"(seed={args.seed})...")
    panel = generate_synthetic_panel(
        n_stocks=args.n_stocks, years=args.years,
        end_date=args.end_date, seed=args.seed,
    )
    print(f"  panel shape: {panel['close'].shape}")
    print(f"  日期范围: {panel['close'].index.min().date()} → "
          f"{panel['close'].index.max().date()}")

    print("[synthetic_demo] 写入 SQLite ...")
    write_to_db(panel)

    print("\n[synthetic_demo] ✓ 完成。接下来跑：")
    start = panel["close"].index.min().strftime("%Y-%m-%d")
    end = panel["close"].index.max().strftime("%Y-%m-%d")
    print("  cd backend")
    print(f"  .venv/Scripts/python -m mining_alpha.run compute-factors "
          f"--universe DEMO --start {start} --end {end} --run-id demo")
    print(f"  .venv/Scripts/python -m mining_alpha.run ic-report "
          f"--universe DEMO --start {start} --end {end} --run-id demo")
    print(f"  .venv/Scripts/python -m mining_alpha.run train "
          f"--universe DEMO --start {start} --end {end} --run-id demo")
    print(f"  .venv/Scripts/python -m mining_alpha.run backtest "
          f"--universe DEMO --start {start} --end {end} --run-id demo --benchmark DEMO.IDX")


if __name__ == "__main__":
    main()
