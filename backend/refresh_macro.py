"""
宏观因子刷新入口（Phase 1）
==========================
端到端：
  1. 拉 FRED 上游序列 → series_observations / series_meta
  2. 调用所有已注册因子计算函数 → factor_values
  3. 把因子元数据 sync 到 factor_meta

用法：
    cd backend
    python refresh_macro.py [--series-only] [--factors-only]

环境变量（backend/.env）：
    FRED_API_KEY    必填
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# 让裸 import 生效（与 server.py / 其他 script 一致）
BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import db  # noqa: E402
import factors_lib as fl  # noqa: E402
from data_sources import fred_source, yfinance_series  # noqa: E402

# 触发因子注册（装饰器在 import 时执行）
import factors_lib.liquidity  # noqa: E402, F401
import factors_lib.sentiment  # noqa: E402, F401
import factors_lib.breadth    # noqa: E402, F401
import factors_lib.valuation  # noqa: E402, F401

from data_sources import multpl_source  # noqa: E402


# ── FRED 上游序列清单 ─────────────────────────────────────
# 字段：local series_id, FRED series_id, market, 起始日（早一点没坏处）
# PMI 不在 FRED（2017 起 ISM 不再授权）；W4+ 时考虑 OECD BCI 替代或外接 ISM
FRED_SERIES: list[tuple[str, str, str, str]] = [
    # W1-2: 期限利差
    ("US_T10Y2Y",     "T10Y2Y",        "US", "1976-06-01"),
    # W3: 流动性 + 信用 + 美元
    ("US_M2SL",       "M2SL",          "US", "1959-01-01"),  # M2 货币供应（月）
    ("US_DGS10",      "DGS10",         "US", "1962-01-02"),  # 10Y 国债收益率（日）
    ("US_DGS2",       "DGS2",          "US", "1976-06-01"),  # 2Y 国债收益率（日）
    ("US_WALCL",      "WALCL",         "US", "2002-12-18"),  # 美联储资产负债表（周）
    ("US_HY_OAS",     "BAMLH0A0HYM2",  "US", "1996-12-31"),  # 高收益债 OAS（日）
    ("US_BAA10Y",     "BAA10Y",        "US", "1986-01-02"),  # Baa - 10Y 利差（日，IG 代理）
    ("US_CPI",        "CPIAUCSL",      "US", "1947-01-01"),  # CPI（月）
    ("US_DXY_TWB",    "DTWEXBGS",      "US", "2006-01-04"),  # 贸易加权美元（日）
    # W2: 估值（Buffett 指标分母 + ERP 备用）
    # WILL5000IND 在 2024 年从 FRED 下架（许可纠纷）；改走 yfinance ^W5000
    ("US_GDP",        "GDP",           "US", "1947-01-01"),  # 名义 GDP（季）
]

# ── yfinance 上游序列清单（W5 情绪 + 后续指数）────────────
# 字段：local_id, yfinance symbol, name, market, start
YFINANCE_SERIES: list[tuple[str, str, str, str, str]] = [
    ("US_VIX_RAW",   "^VIX",   "CBOE VIX 隐含波动率指数",     "US", "1990-01-02"),
    ("US_SKEW_RAW",  "^SKEW",  "CBOE SKEW 期权偏斜指数",      "US", "1990-01-02"),
    ("US_W5000_RAW", "^W5000", "Wilshire 5000 全市值指数",     "US", "1990-01-02"),
]

# ── multpl.com 上游序列（W2 估值）─────────────────────────
# 字段：local_id, multpl slug, name
MULTPL_SERIES: list[tuple[str, str, str]] = [
    ("US_SPX_PE_RAW", "s-p-500-pe-ratio", "标普 500 trailing PE（月，multpl）"),
    ("US_CAPE_RAW",   "shiller-pe",       "Shiller CAPE 周期调整 PE（月，multpl）"),
]


def sync_all_series() -> dict[str, int]:
    """拉所有上游序列（FRED + yfinance）。单只失败不中断。"""
    out = {}
    for local, fred_id, market, start in FRED_SERIES:
        t0 = time.time()
        try:
            n = fred_source.sync_series(local, fred_id, market=market, start=start)
            out[local] = n
            print(f"  [ok]  {local:20s} <- FRED {fred_id:15s} {n:6d} obs  ({time.time()-t0:.1f}s)")
        except Exception as e:
            print(f"  [fail] {local:20s} <- FRED {fred_id:15s} {type(e).__name__}: {e}")
    for local, yf_sym, name, market, start in YFINANCE_SERIES:
        t0 = time.time()
        try:
            n = yfinance_series.sync_series(
                local, yf_sym, name=name, market=market, start=start,
            )
            out[local] = n
            print(f"  [ok]  {local:20s} <- yf   {yf_sym:15s} {n:6d} obs  ({time.time()-t0:.1f}s)")
        except Exception as e:
            print(f"  [fail] {local:20s} <- yf   {yf_sym:15s} {type(e).__name__}: {e}")
    for local, slug, name in MULTPL_SERIES:
        t0 = time.time()
        try:
            n = multpl_source.sync_series(local, slug, name=name)
            out[local] = n
            print(f"  [ok]  {local:20s} <- mlt  {slug:25s} {n:6d} obs  ({time.time()-t0:.1f}s)")
        except Exception as e:
            print(f"  [fail] {local:20s} <- mlt  {slug:25s} {type(e).__name__}: {e}")
    return out


def compute_all_factors() -> dict[str, dict]:
    """调用所有已注册因子，写 factor_values。返回 {factor_id: {raw, percentile}}。"""
    fl.sync_factor_meta()  # 元数据先落地
    out = {}
    for spec in fl.list_factors():
        for market in spec.markets:
            hist = spec.func()
            if hist.empty:
                print(f"  [warn] {spec.factor_id:25s} [{market}]  empty history")
                continue
            raw = float(hist.iloc[-1])
            last_date = str(hist.index[-1])
            pct = fl.to_percentile(hist, window=spec.rolling_window_days)
            fl.upsert_factor_value(
                spec.factor_id, market, last_date,
                raw_value=raw, percentile=pct, calc_version="v1",
            )
            out[f"{spec.factor_id}@{market}"] = {
                "raw": raw, "percentile": pct, "asof": last_date,
            }
            pct_str = f"{pct:5.1f}" if pct is not None else "  -- "
            print(f"  [ok]  {spec.factor_id:25s} [{market}]  raw={raw:8.3f}  pct={pct_str}  asof={last_date}")
    return out


def update_breadth_snapshots() -> int:
    """W4: SP500 全成分股宽度快照。前置：python sync_spx500_bars.py 已跑过。"""
    from breadth_engine import update_snapshots
    n = update_snapshots(start="2024-01-01")
    print(f"  [ok]  breadth_snapshot {n:6d} rows")
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--series-only", action="store_true", help="只拉上游不算因子")
    ap.add_argument("--factors-only", action="store_true", help="只算因子不拉上游")
    ap.add_argument("--skip-breadth", action="store_true", help="跳过宽度快照重算")
    args = ap.parse_args()

    db.init_db()

    if not args.factors_only:
        print("[1/3] 拉上游序列（FRED + yfinance）…")
        sync_all_series()
    else:
        print("[1/3] 跳过上游拉取（--factors-only）")

    if not args.skip_breadth and not args.series_only:
        print("[2/3] 重算 SP500 宽度快照…")
        try:
            update_breadth_snapshots()
        except Exception as e:
            print(f"  [warn] breadth 跳过：{e}")
    else:
        print("[2/3] 跳过宽度快照")

    if not args.series_only:
        print("[3/3] 计算因子并写库…")
        compute_all_factors()
    else:
        print("[3/3] 跳过因子计算（--series-only）")

    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
