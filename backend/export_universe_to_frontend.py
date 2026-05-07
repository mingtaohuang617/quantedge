#!/usr/bin/env python3
"""
export_universe_to_frontend — 把 backend/output/universe_*.json 复制到 frontend/public/data/universe/

用途：
  Vercel production serverless functions 通过 self-fetch 读
  /data/universe/universe_us.json 等静态文件。这些文件需要 git track
  才能进 Vercel 部署 bundle。

工作流：
  1. python -m backend.universe.sync_us --enrich   # 拉数据到 backend/output/
  2. python backend/export_universe_to_frontend.py # 复制到 frontend/public/data/universe/
  3. git add frontend/public/data/universe/ && git commit -m "data: refresh universe"
  4. git push → Vercel 部署，production 上的 10x 猎手筛选立即生效

设计：
  - 仅复制 universe_us.json / universe_cn.json / universe_hk.json（已知列表）
  - 缺失的文件跳过并 warn（可能用户没跑对应市场的 sync）
  - 输出大小汇总，提醒注意 git 仓库膨胀

不会做：
  - 不执行 sync（用户负责）
  - 不 git add（用户决定何时 commit）
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "backend" / "output"
DST_DIR = ROOT / "frontend" / "public" / "data" / "universe"

MARKETS = ["us", "cn", "hk"]


def fmt_size(n: int) -> str:
    if n >= 1024 * 1024:
        return f"{n / 1024 / 1024:.2f} MB"
    if n >= 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n} B"


def main() -> int:
    DST_DIR.mkdir(parents=True, exist_ok=True)

    print(f"src: {SRC_DIR}")
    print(f"dst: {DST_DIR}")
    print()

    total_bytes = 0
    copied = []
    missing = []

    for m in MARKETS:
        fname = f"universe_{m}.json"
        src = SRC_DIR / fname
        dst = DST_DIR / fname

        if not src.exists():
            missing.append(fname)
            print(f"  [skip] {fname} not found at {src}")
            continue

        shutil.copy2(src, dst)
        size = dst.stat().st_size
        total_bytes += size
        copied.append((fname, size))
        print(f"  [ok]   {fname} -> {fmt_size(size)}")

    print()
    print(f"copied {len(copied)} file(s), total {fmt_size(total_bytes)}")
    if missing:
        print(f"missing {len(missing)} file(s): {', '.join(missing)}")
        print(f"  -> run sync first, e.g. python -m backend.universe.sync_us --enrich")

    print()
    print("next steps:")
    print(f"  git add {DST_DIR.relative_to(ROOT)}")
    print('  git commit -m "data: refresh universe"')
    print("  git push")

    return 0 if copied else 1


if __name__ == "__main__":
    sys.exit(main())
