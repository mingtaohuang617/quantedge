#!/usr/bin/env python3
"""
enrich_us_finnhub — 用 Finnhub free tier 补 universe_us.json 的 fundamentals
=================================================================================

为什么独立脚本：
  - Finnhub 仅给 fundamentals（不给 sector/marketCap），与 sync_us 的
    cap+sector enrich 关注点不同。分开避免 sync_us flow 复杂化。
  - 跑全量 ~3.3 小时（60 calls/min × 12k 票），需要 checkpoint + 中断恢复。

用法：
  # 1. 注册 https://finnhub.io 拿 free API key
  # 2. export FINNHUB_API_KEY=xxx (或写到 backend/.env)
  # 3. 先跑 sync_us 拉基础元数据
  python -m backend.universe.sync_us --enrich --source futu
  # 4. 再跑本脚本补 fundamentals
  python -m backend.universe.enrich_us_finnhub                 # 全量（~3.3 小时）
  python -m backend.universe.enrich_us_finnhub --limit 100     # 测试用
  python -m backend.universe.enrich_us_finnhub --force         # 覆盖已有 fundamentals
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# 加载 backend/.env（如果存在）— 让 FINNHUB_API_KEY 自动可用
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    pass   # python-dotenv 可选，没装也能跑（用户用 shell export 设环境变量）

_REPO_ROOT = Path(__file__).resolve().parents[2]
_BACKEND = _REPO_ROOT / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from data_sources.finnhub_source import (
    enrich_us_fundamentals_finnhub,
    FinnhubError,
)
from universe import sanitize_for_json

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "output" / "universe_us.json"


def save_universe(data: dict) -> None:
    """原子写回 universe_us.json（写 .tmp 再 rename）"""
    tmp = OUTPUT_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sanitize_for_json(data), f, ensure_ascii=False, indent=2, allow_nan=False)
    tmp.replace(OUTPUT_PATH)


def main() -> int:
    parser = argparse.ArgumentParser(description="Finnhub free tier US fundamentals enrich")
    parser.add_argument("--limit", type=int, default=None,
                        help="最多 enrich 多少只（测试用；不填 = 全量）")
    parser.add_argument("--force", action="store_true",
                        help="覆盖已有 fundamentals（默认仅补缺失的）")
    parser.add_argument("--sleep", type=float, default=1.05,
                        help="每次调用间隔秒数（默认 1.05 = 60/min 安全速率）")
    args = parser.parse_args()

    if not OUTPUT_PATH.exists():
        print(f"[error] {OUTPUT_PATH} 不存在 — 请先跑 `python -m backend.universe.sync_us`")
        return 1

    print(f"[1/3] 加载 {OUTPUT_PATH}")
    with open(OUTPUT_PATH, encoding="utf-8") as f:
        data = json.load(f)
    items = data.get("items", [])
    print(f"  {len(items)} items loaded")

    # 统计当前 fundamentals 覆盖率
    n_pe_before = sum(1 for it in items if it.get("pe") is not None)
    print(f"  fundamentals 当前覆盖率（PE）：{n_pe_before} / {len(items)}")

    print(f"\n[2/3] Finnhub enrich (sleep={args.sleep}s, force={args.force})")
    try:
        n_ok, n_processed = enrich_us_fundamentals_finnhub(
            items,
            limit=args.limit,
            sleep_sec=args.sleep,
            only_missing=not args.force,
            checkpoint_fn=lambda: save_universe(data),
            checkpoint_every=100,
        )
    except FinnhubError as e:
        print(f"[fatal] {e}")
        return 2
    except KeyboardInterrupt:
        print("\n[interrupted] 保存当前进度...")
        save_universe(data)
        return 130

    print(f"\n[3/3] 保存 {OUTPUT_PATH}")
    # 更新 meta
    meta = data.setdefault("meta", {})
    meta["finnhub_enriched_at"] = datetime.now().isoformat(timespec="seconds")
    meta["finnhub_enriched_count"] = sum(1 for it in items if it.get("pe") is not None)
    save_universe(data)

    n_pe_after = meta["finnhub_enriched_count"]
    delta = n_pe_after - n_pe_before
    print(f"  fundamentals 覆盖率：{n_pe_before} → {n_pe_after} (+{delta})")
    print(f"  Finnhub 处理 {n_processed} 票，成功 {n_ok}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
