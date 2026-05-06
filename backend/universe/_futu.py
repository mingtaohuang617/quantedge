"""
universe._futu — 共享的富途 OpenD enrich 工具
==============================================
sync_hk / sync_cn / sync_us 都用这两个函数补市值 + 行业板块。

约定：传入的 items 列表里，每项要有一个 code_field 字段（默认 "futu_code"），
形如 "HK.00700" / "SH.600519" / "SZ.000001" / "US.AAPL"。值为 None 的标的跳过。

接口限频：
  - get_market_snapshot：较松（10/秒）→ SLEEP_SNAPSHOT 1s
  - get_owner_plate：严（30 秒 10 次）→ SLEEP_OWNER_PLATE 3.1s

owner_plate 不支持非 STOCK 类型（ETF/CBBC/Warrant），失败的标的字段保持 None。
"""
from __future__ import annotations

import time
from typing import Iterable

try:
    from futu import RET_OK
    HAS_FUTU = True
except ImportError:
    HAS_FUTU = False
    RET_OK = 0

BATCH_SIZE = 200
SLEEP_SNAPSHOT = 1.0
SLEEP_OWNER_PLATE = 3.1


def enrich_market_cap(
    ctx,
    items: list[dict],
    *,
    code_field: str = "futu_code",
) -> int:
    """分批 get_market_snapshot 拿 total_market_val，回填 items[i]["marketCap"]（单位：元）。"""
    by_code = {it[code_field]: it for it in items if it.get(code_field)}
    codes = list(by_code.keys())
    if not codes:
        print("  [enrich_market_cap] 没有可映射 futu code 的标的")
        return 0
    total = len(codes)
    n_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"  enrich market_cap: {total} 只 / {n_batches} 批 / sleep {SLEEP_SNAPSHOT}s")

    ok = 0
    t0 = time.time()
    for i in range(0, total, BATCH_SIZE):
        chunk = codes[i:i + BATCH_SIZE]
        ret, df = ctx.get_market_snapshot(chunk)
        if ret != RET_OK:
            print(f"    batch {i//BATCH_SIZE+1}: snapshot fail - {df}")
            time.sleep(SLEEP_SNAPSHOT * 2)
            continue
        for _, row in df.iterrows():
            code = str(row.get("code", "")).strip()
            mv = row.get("total_market_val")
            if code in by_code and mv is not None:
                try:
                    by_code[code]["marketCap"] = float(mv)
                    ok += 1
                except Exception:
                    pass
        elapsed = time.time() - t0
        rate = (i + len(chunk)) / elapsed if elapsed > 0 else 0
        print(f"    batch {i//BATCH_SIZE+1}/{n_batches}: ok cumulative {ok} ({rate:.0f}/s)")
        time.sleep(SLEEP_SNAPSHOT)
    return ok


def _try_owner_plate(ctx, codes: list[str], plate_type_upper: str) -> tuple[bool, dict[str, list[str]], str]:
    """单批次 owner_plate 调用。返回 (success, ind_map, error_msg)。"""
    ret, df = ctx.get_owner_plate(codes)
    if ret != RET_OK:
        return False, {}, str(df)
    ind_map: dict[str, list[str]] = {}
    for _, row in df.iterrows():
        if str(row.get("plate_type", "")).strip().upper() != plate_type_upper:
            continue
        code = str(row.get("code", "")).strip()
        pname = str(row.get("plate_name", "")).strip()
        if code and pname:
            ind_map.setdefault(code, []).append(pname)
    return True, ind_map, ""


def enrich_industry(
    ctx,
    items: list[dict],
    *,
    code_field: str = "futu_code",
    plate_type: str = "INDUSTRY",
    batch_size: int = 100,
    retry_batch_size: int = 25,
    checkpoint_every: int = 30,
    checkpoint_fn=None,
) -> int:
    """
    分批 get_owner_plate 拿 INDUSTRY 板块，回填 sector + industry。
    富途接口不支持 ETF/Warrant，整批中只要有一只就会全批失败。
    策略：先按 batch_size 跑，失败的批再按 retry_batch_size 跑一次（限一层）。
    仍失败的 sub-batch 整批跳过。
    """
    by_code = {it[code_field]: it for it in items if it.get(code_field)}
    codes = list(by_code.keys())
    if not codes:
        print("  [enrich_industry] 没有可映射 futu code 的标的")
        return 0
    total = len(codes)
    n_batches = (total + batch_size - 1) // batch_size
    print(f"  enrich industry: {total} 只 / {n_batches} 批 (size {batch_size}, retry {retry_batch_size}) / sleep {SLEEP_OWNER_PLATE}s")

    plate_type_upper = plate_type.upper()
    ok = 0
    n_skipped = 0
    t0 = time.time()
    failed_batches: list[list[str]] = []

    def _apply(ind_map: dict[str, list[str]]) -> int:
        n = 0
        for code, names in ind_map.items():
            if code in by_code:
                primary = names[0]
                by_code[code]["sector"] = primary
                by_code[code]["industry"] = " / ".join(names) if len(names) > 1 else primary
                n += 1
        return n

    def _maybe_checkpoint(label: str, idx: int):
        if checkpoint_fn and checkpoint_every > 0 and (idx > 0) and (idx % checkpoint_every == 0):
            try:
                checkpoint_fn()
                print(f"      [checkpoint] saved at {label} {idx}")
            except Exception as e:
                print(f"      [checkpoint] save failed: {e}")

    # Pass 1: 大批
    for i in range(0, total, batch_size):
        chunk = codes[i:i + batch_size]
        success, ind_map, err = _try_owner_plate(ctx, chunk, plate_type_upper)
        if success:
            ok += _apply(ind_map)
        else:
            failed_batches.append(chunk)
        elapsed = time.time() - t0
        b_idx = i // batch_size + 1
        print(f"    pass1 batch {b_idx}/{n_batches}: ok cumulative {ok} (failed batches {len(failed_batches)}, {elapsed:.0f}s)")
        _maybe_checkpoint("pass1 batch", b_idx)
        time.sleep(SLEEP_OWNER_PLATE)

    if not failed_batches:
        return ok

    # Pass 2: 小批 retry
    print(f"  retry pass: {len(failed_batches)} failed batch → 拆 size={retry_batch_size}")
    sub_chunks: list[list[str]] = []
    for fb in failed_batches:
        for j in range(0, len(fb), retry_batch_size):
            sub_chunks.append(fb[j:j + retry_batch_size])
    print(f"  retry pass: {len(sub_chunks)} sub-batches")
    for i, chunk in enumerate(sub_chunks):
        success, ind_map, err = _try_owner_plate(ctx, chunk, plate_type_upper)
        if success:
            ok += _apply(ind_map)
        else:
            n_skipped += len(chunk)
        if i % 10 == 0:
            elapsed = time.time() - t0
            print(f"    retry sub-batch {i+1}/{len(sub_chunks)}: ok cumulative {ok} (skipped {n_skipped}, {elapsed:.0f}s)")
        _maybe_checkpoint("retry sub-batch", i + 1)
        time.sleep(SLEEP_OWNER_PLATE)

    print(f"  enrich_industry done: ok {ok}, skipped (unsupported) {n_skipped}")
    return ok


def open_futu_ctx(host: str = "127.0.0.1", port: int = 11111):
    """打开 OpenQuoteContext，先 health check 失败抛 RuntimeError。"""
    if not HAS_FUTU:
        raise RuntimeError("futu-api 未安装：pip install futu-api")
    from futu import OpenQuoteContext
    ctx = OpenQuoteContext(host=host, port=port)
    ret, gs = ctx.get_global_state()
    if ret != RET_OK:
        ctx.close()
        raise RuntimeError(f"OpenD get_global_state 失败: {gs}")
    if not gs.get("qot_logined"):
        ctx.close()
        raise RuntimeError("OpenD 未登录行情服务，请在 GUI 登录")
    return ctx
