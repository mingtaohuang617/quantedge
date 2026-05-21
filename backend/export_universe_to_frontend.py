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

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "backend" / "output"
DST_DIR = ROOT / "frontend" / "public" / "data" / "universe"

MARKETS = ["us", "cn", "hk"]

# 复制时剥离 frontend 不用的字段（瘦身）
# - futu_code: 仅 backend sync 用，frontend 完全不引用
# - is_derivative: frontend 不引用
# 保留：ticker / name / market / exchange / sector / industry / marketCap /
#       is_etf / pe / pb / dividend_yield / roe / debt_to_equity
DROP_FIELDS = ("futu_code", "is_derivative")


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

        # 读 → 剥离 → 写（不再 shutil.copy2 整文件复制）
        with open(src, "r", encoding="utf-8") as f:
            data = json.load(f)
        src_size = src.stat().st_size

        n_stripped = 0
        # Strip frontend-unused fields + 空字符串 / null（缺字段 = 老数据，frontend
        # 已用 `it.sector || ''` / `mc == null` 等防御性读法处理 undefined）
        for it in data.get("items", []):
            for k in DROP_FIELDS:
                if k in it:
                    del it[k]
                    n_stripped += 1
            # 空字符串 sector / industry / exchange / market — 丢
            for k in ("sector", "industry", "exchange", "market"):
                if it.get(k) == "":
                    del it[k]
                    n_stripped += 1
            # marketCap = None / 0 也丢（frontend 用 `mc == null` 判断）
            if it.get("marketCap") in (None, 0):
                if "marketCap" in it:
                    del it["marketCap"]
                    n_stripped += 1

        with open(dst, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
        size = dst.stat().st_size
        total_bytes += size
        copied.append((fname, size))
        saving = src_size - size
        print(f"  [ok]   {fname} -> {fmt_size(size)} (剥离 {n_stripped} 字段，省 {fmt_size(saving)})")

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
