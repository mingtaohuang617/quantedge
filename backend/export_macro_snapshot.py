"""
导出宏观看板的"线上 snapshot"
==============================
本地用 backend 实时 API；线上 production 因为没有跑后端，读这个 snapshot 文件。

用法（用户主动触发）:
    cd backend
    python export_macro_snapshot.py

会写到: frontend/src/macroSnapshot.json
然后 commit 这个文件 + push → CI 部署 → 线上看板更新。

写出的 JSON 结构与 /api/macro/{factors,composite,composite/history} 三个端点
一致——前端只要在 PROD 模式下读这个文件代替 fetch 即可。
"""
from __future__ import annotations

import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout.reconfigure(encoding="utf-8")

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import db  # noqa: E402
import factors_lib as fl  # noqa: E402

# 触发因子注册
import factors_lib.liquidity   # noqa: E402, F401
import factors_lib.sentiment   # noqa: E402, F401
import factors_lib.breadth     # noqa: E402, F401
import factors_lib.valuation   # noqa: E402, F401
import factors_lib.cn_macro    # noqa: E402, F401


SNAPSHOT_PATH = BACKEND.parent / "frontend" / "src" / "macroSnapshot.json"


def _sanitize(o):
    """复刻 server.py 的 sanitize：NaN/Inf → None。"""
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_sanitize(v) for v in o]
    if isinstance(o, float):
        if math.isnan(o) or math.isinf(o):
            return None
    return o


def export_factors(sparkline: int = 120, market: str | None = None) -> list[dict]:
    """复刻 list_macro_factors 端点，输出每因子最新值 + sparkline。"""
    conn = db._get_conn()
    out = []
    for spec in fl.list_factors():
        for mkt in spec.markets:
            if market and mkt != market:
                continue
            row = conn.execute(
                "SELECT value_date, raw_value, percentile FROM factor_values "
                "WHERE factor_id=? AND market=? "
                "ORDER BY value_date DESC LIMIT 1",
                (spec.factor_id, mkt),
            ).fetchone()
            entry = {
                "factor_id": spec.factor_id,
                "name": spec.name,
                "category": spec.category,
                "market": mkt,
                "freq": spec.freq,
                "description": spec.description,
                "rolling_window_days": spec.rolling_window_days,
                "direction": spec.direction,
                "contrarian_at_extremes": spec.contrarian_at_extremes,
                "latest": dict(row) if row else None,
            }
            if sparkline > 0:
                try:
                    hist = spec.func()
                    if not hist.empty:
                        last_n = hist.iloc[-sparkline:]
                        entry["sparkline"] = {
                            "dates": [str(i) for i in last_n.index],
                            "values": [float(v) for v in last_n.values],
                        }
                    else:
                        entry["sparkline"] = None
                except Exception as e:
                    entry["sparkline"] = None
                    entry["sparkline_error"] = str(e)
            out.append(entry)
    return out


def _validate(snapshot: dict) -> list[str]:
    """对 snapshot 做基本完整性校验，返回 warning 列表。空 = 完美。"""
    warns: list[str] = []
    if not snapshot.get("factors"):
        warns.append("factors 为空")
    else:
        n_missing_latest = sum(1 for f in snapshot["factors"] if not f.get("latest"))
        if n_missing_latest > 0:
            warns.append(f"{n_missing_latest} 个因子缺 latest（数据同步问题）")
    comp = snapshot.get("composite") or {}
    if comp.get("market_temperature") is None:
        warns.append("composite.market_temperature 为 None")
    if (comp.get("hmm") or {}).get("error"):
        warns.append(f"composite.hmm.error: {comp['hmm']['error']}")
    if (comp.get("survival") or {}).get("error"):
        warns.append(f"composite.survival.error: {comp['survival']['error']}")
    if not snapshot.get("composite_history", {}).get("dates"):
        warns.append("composite_history.dates 为空")
    return warns


def main() -> int:
    db.init_db()
    print("生成 snapshot…")
    t0 = time.time()

    # 之前的 snapshot 大小（用于显示 byte 差）
    prev_size = SNAPSHOT_PATH.stat().st_size if SNAPSHOT_PATH.exists() else 0

    factors_data = export_factors(sparkline=120)
    print(f"  [ok] factors: {len(factors_data)}")

    composite = fl.compute_composite(market="US")
    temp_v = composite.get("market_temperature")
    n_alerts = len(composite.get("alerts") or [])
    print(f"  [ok] composite: temp={temp_v}, {n_alerts} alert(s)")

    # AI 市场画像（DeepSeek，缓存 12h）
    narrative = None
    try:
        import llm as _llm
        nar = _llm.macro_narrative(composite)
        if nar.get("ok"):
            narrative = nar.get("narrative")
            print(f"  [ok] narrative: {len(narrative)} 字 (cached={nar.get('cached')})")
        else:
            print(f"  [warn] narrative 失败: {nar.get('error')}")
    except Exception as e:
        print(f"  [warn] narrative 跳过: {e}")

    history = fl.compute_composite_history(market="US")  # 默认 5Y window 节省 snapshot 体积
    print(f"  [ok] composite_history: {len(history.get('dates', []))} days")

    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "factors": factors_data,
        "composite": composite,
        "composite_history": history,
        "narrative": narrative,
    }
    snapshot = _sanitize(snapshot)

    # 校验
    warns = _validate(snapshot)
    for w in warns:
        print(f"  [warn] {w}")

    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SNAPSHOT_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, separators=(",", ":"))

    new_size = SNAPSHOT_PATH.stat().st_size
    size_kb = new_size / 1024
    delta_kb = (new_size - prev_size) / 1024
    delta_str = ""
    if prev_size > 0:
        sign = "+" if delta_kb >= 0 else ""
        delta_str = f" ({sign}{delta_kb:.1f}KB vs 上次)"
    print(f"  [ok] 写入 {SNAPSHOT_PATH.relative_to(BACKEND.parent)}  {size_kb:.0f}KB{delta_str}")
    print(f"耗时 {time.time()-t0:.1f}s")
    if warns:
        print(f"\n[!] 有 {len(warns)} 个非致命问题（见上方 [warn]），但 snapshot 已生成。")
    print("\n下一步: commit frontend/src/macroSnapshot.json + git push 即可上线更新。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
