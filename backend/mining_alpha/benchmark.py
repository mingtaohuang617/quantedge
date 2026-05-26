"""
mining_alpha.benchmark — 性能基准
==================================

测量 191 因子在不同 (T, N) panel 规模下的计算耗时。
帮助用户预估 CSI800/CSI1000/全A 上 compute-factors 的耗时。

CLI:
  python -m mining_alpha.benchmark
  python -m mining_alpha.benchmark --sizes "(500,100),(1000,300),(1500,800)"
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


def _gen_synthetic_panel(T: int, N: int, seed: int = 0) -> dict[str, pd.DataFrame]:
    """生成 (T, N) 合成 panel，含 bench_*。"""
    rng = np.random.RandomState(seed)
    dates = pd.bdate_range("2020-01-01", periods=T)
    tickers = [f"S{i:04d}" for i in range(N)]
    log_ret = rng.randn(T, N) * 0.02
    close_arr = 10 * np.cumprod(1 + log_ret, axis=0)
    close = pd.DataFrame(close_arr, index=dates, columns=tickers)
    high = close * (1 + np.abs(rng.randn(T, N)) * 0.01)
    low = close * (1 - np.abs(rng.randn(T, N)) * 0.01)
    open_ = close.shift(1).bfill()
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))
    volume = pd.DataFrame(rng.uniform(1e5, 1e7, (T, N)), index=dates, columns=tickers)
    amount = volume * close
    vwap = amount / volume
    ret = close.pct_change()

    bench_close_1d = 3000 * np.cumprod(1 + rng.randn(T) * 0.012)
    bench_close = pd.DataFrame(np.tile(bench_close_1d[:, None], (1, N)),
                                index=dates, columns=tickers)
    bench_open = bench_close.shift(1).bfill()
    bench_high = bench_close * 1.005
    bench_low = bench_close * 0.995
    return {
        "open": open_, "high": high, "low": low, "close": close,
        "volume": volume, "amount": amount, "vwap": vwap, "ret": ret,
        "bench_open": bench_open, "bench_high": bench_high,
        "bench_low": bench_low, "bench_close": bench_close,
    }


def benchmark_factor(num: int, data: dict, repeats: int = 1) -> dict:
    """跑 num 号因子 repeats 次，返回最小耗时 + 输出 shape。"""
    from mining_alpha.alpha191_factors import compute_alpha
    times = []
    result = None
    for _ in range(repeats):
        t0 = time.perf_counter()
        try:
            result = compute_alpha(num, data)
            ok = True
        except Exception as e:
            return {"alpha": num, "ok": False, "error": str(e)[:120]}
        times.append(time.perf_counter() - t0)
    notna = result.notna().sum().sum() if result is not None else 0
    return {
        "alpha": num, "ok": True,
        "ms": round(min(times) * 1000, 2),
        "ms_mean": round(np.mean(times) * 1000, 2),
        "notna_ratio": round(float(notna / result.size), 3) if result is not None else 0,
    }


def run_benchmark(sizes: list[tuple[int, int]], repeats: int = 1) -> pd.DataFrame:
    """对每个 (T, N) 跑所有 191 个因子，返回汇总 DataFrame。"""
    from mining_alpha.alpha191_factors import list_alphas

    nums = list_alphas()
    rows = []
    for T, N in sizes:
        print(f"\n=== 基准: T={T} × N={N} ({T*N:,} cells) ===")
        data = _gen_synthetic_panel(T, N)
        per_factor = []
        t_start = time.perf_counter()
        for num in nums:
            r = benchmark_factor(num, data, repeats=repeats)
            per_factor.append(r)
        total_sec = time.perf_counter() - t_start
        failures = [r for r in per_factor if not r["ok"]]
        ok_results = [r for r in per_factor if r["ok"]]
        total_ms = sum(r["ms"] for r in ok_results)
        top_slow = sorted(ok_results, key=lambda r: -r["ms"])[:5]
        print(f"  总耗时: {total_sec:.2f}s, 单因子均 {total_ms / max(len(ok_results), 1):.1f}ms")
        print(f"  失败: {len(failures)} 个")
        print("  Top 5 最慢:")
        for r in top_slow:
            print(f"    α{r['alpha']}: {r['ms']:.1f}ms")
        rows.append({
            "T": T, "N": N, "cells": T * N,
            "total_sec": round(total_sec, 2),
            "mean_ms_per_factor": round(total_ms / max(len(ok_results), 1), 1),
            "n_ok": len(ok_results),
            "n_failed": len(failures),
            "top_slow": ", ".join(f"α{r['alpha']}({r['ms']:.0f}ms)" for r in top_slow[:3]),
        })
    return pd.DataFrame(rows)


def main():
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    p = argparse.ArgumentParser(prog="mining_alpha.benchmark")
    p.add_argument("--sizes", default="(500,50),(1000,300),(1500,800)",
                   help="逗号分隔的 (T, N) tuple")
    p.add_argument("--repeats", type=int, default=1)
    p.add_argument("--output", default=None,
                   help="可选：把结果写到 CSV")
    args = p.parse_args()

    raw = args.sizes.replace(" ", "")
    sizes = []
    for part_raw in raw.split(")")[:-1]:
        part = part_raw.lstrip(",").lstrip("(")
        if not part:
            continue
        t, n = part.split(",")
        sizes.append((int(t), int(n)))

    df = run_benchmark(sizes, repeats=args.repeats)
    print("\n=== 汇总 ===")
    print(df.to_string(index=False))
    if args.output:
        df.to_csv(args.output, index=False, float_format="%.2f")
        print(f"\n落盘: {args.output}")


if __name__ == "__main__":
    main()
