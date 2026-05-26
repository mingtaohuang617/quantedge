"""
mining_alpha.run — CLI 总入口
=========================

子命令:
  sync-data        从 tushare 拉 CSI800 成分股 + 行情写入 SQLite
  compute-factors  在 panel 上计算所有已注册因子，落盘 parquet
  ic-report        单因子 IC 诊断，落盘 CSV + 排序汇总
  train            walk-forward 训练 LightGBM ranker，保存模型 + 预测
  backtest         读取预测分数 + 收盘价跑回测，输出 JSON 报告 + 净值图

用例:
  python -m mining_alpha.run sync-data --universe CSI800 --start 2020-01-01
  python -m mining_alpha.run compute-factors --start 2020-01-01 --end 2025-05-15
  python -m mining_alpha.run ic-report --start 2020-01-01 --end 2025-05-15
  python -m mining_alpha.run train --start 2020-01-01 --end 2025-05-15
  python -m mining_alpha.run backtest --start 2022-07-01 --end 2025-05-15

输出目录: backend/output/mining_alpha/
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

OUTPUT_ROOT = _BACKEND / "output" / "mining_alpha"


def _resolve_run_dir(run_id: str | None) -> Path:
    """
    解析单次运行目录。若指定 run_id 则写到 OUTPUT_ROOT/runs/{run_id}/，
    并更新 OUTPUT_ROOT/latest.txt 指向；若 None 走老路径（不版本化）。
    """
    if not run_id:
        return OUTPUT_ROOT
    run_dir = OUTPUT_ROOT / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    # latest 指针 — 用文件而非 symlink（Windows 友好）
    latest_file = OUTPUT_ROOT / "latest.txt"
    latest_file.parent.mkdir(parents=True, exist_ok=True)
    latest_file.write_text(run_id, encoding="utf-8")
    return run_dir

# 修复 Windows GBK 终端 Unicode 输出（沿用 backend/universe/sync_cn.py 同款做法）
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv(_BACKEND / ".env")
except ImportError:
    pass


def _ensure_output_dir(subdir: str = "") -> Path:
    p = OUTPUT_ROOT / subdir if subdir else OUTPUT_ROOT
    p.mkdir(parents=True, exist_ok=True)
    return p


# ── sync-data ────────────────────────────────────────────────


def cmd_sync_data(args):
    """同步 CSI800 universe + 成分股行情。"""
    from mining_alpha.data_loader import (  # noqa: E402
        get_universe,
        sync_daily_bars,
        sync_universe_history,
    )

    print(f"[sync-data] universe={args.universe} start={args.start} end={args.end}")
    # 1) 拉 universe 历史
    print("  ── 同步 universe 历史 (index_weight) ──")
    n_weights = sync_universe_history(args.universe, args.start, args.end)
    print(f"  写入 {n_weights} 条成分股-月份记录")

    # 2) 拉成分股行情
    tickers = get_universe(args.universe)
    print(f"  ── 同步 {len(tickers)} 个成分股的日行情 ──")
    stats = sync_daily_bars(tickers, args.start, args.end)
    print(f"  共写入 {stats['inserted']} 行，失败 {len(stats['failed'])} 只 ts_code")
    if stats["failed"]:
        print(f"  失败 ts_code: {stats['failed'][:10]}{'...' if len(stats['failed'])>10 else ''}")


# ── compute-factors ──────────────────────────────────────────


def cmd_compute_factors(args):
    """读取行情 → 计算所有因子 → 落 parquet。支持 alpha191 / alpha101 / all。"""
    from mining_alpha.data_loader import compute_tradeable_mask, load_panel

    print(f"[compute-factors] universe={args.universe} {args.start}..{args.end} sets={args.factor_sets}")
    panel = load_panel(args.start, args.end, universe=args.universe)
    print(f"  panel: {panel['close'].shape[0]} 天 × {panel['close'].shape[1]} 票")

    sets = [s.strip() for s in args.factor_sets.split(",") if s.strip()]
    # 构造 (set_name, [(num, compute_fn, file_prefix), ...]) 列表
    todo: list[tuple[int, callable, str]] = []
    if "alpha191" in sets or "all" in sets:
        from mining_alpha.alpha191_factors import compute_alpha as _ca, list_alphas
        for n in list_alphas():
            todo.append((n, lambda d, _n=n: _ca(_n, d), "alpha"))
    if "alpha101" in sets or "all" in sets:
        from mining_alpha.alpha101_factors import compute_alpha101 as _ca101, list_alpha101
        for n in list_alpha101():
            todo.append((n, lambda d, _n=n: _ca101(_n, d), "wq"))

    out_dir = _ensure_output_dir("factors")
    print(f"  共 {len(todo)} 个因子，写到 {out_dir}")
    for i, (num, fn, prefix) in enumerate(todo, 1):
        try:
            result = fn(panel)
            result.to_parquet(out_dir / f"{prefix}_{num:03d}.parquet")
            if i % 20 == 0:
                print(f"  [{i}/{len(todo)}] {prefix}_{num} 完成")
        except Exception as e:
            print(f"  [warn] {prefix}_{num} 失败: {e}")
    mask = compute_tradeable_mask(panel)
    mask.to_parquet(out_dir / "_tradeable_mask.parquet")
    print(f"  完成。文件落在 {out_dir}/ (含 _tradeable_mask.parquet)")


# ── ic-report ────────────────────────────────────────────────


def cmd_ic_report(args):
    """单因子 IC 诊断 + 相关性冗余剔除 + 月度 IC 热力图。"""
    from mining_alpha.data_loader import load_industry_panel, load_mktcap_panel, load_panel
    from mining_alpha.ic_report import (
        factor_correlation_matrix,
        factor_ic_monthly_heatmap,
        filter_alphas_by_ic,
        filter_redundant_alphas,
        run_ic_report,
    )
    from mining_alpha.preprocess import preprocess_pipeline

    print(f"[ic-report] universe={args.universe} {args.start}..{args.end} horizon={args.horizon}")
    panel = load_panel(args.start, args.end, universe=args.universe)

    factor_dir = OUTPUT_ROOT / "factors"
    if not factor_dir.exists() or not any(factor_dir.glob("alpha_*.parquet")):
        raise RuntimeError(f"{factor_dir} 是空的；先跑 `compute-factors`")

    # 中性化数据（可选）
    industry_panel = None
    log_mktcap = None
    if args.neutralize:
        print("  加载行业 + 市值数据（可能较慢，首次拉取 daily_basic）...")
        try:
            tickers = list(panel["close"].columns)
            industry_panel = load_industry_panel(tickers, list(panel["close"].index))
            mktcap = load_mktcap_panel(tickers, args.start, args.end)
            if not mktcap.empty:
                # 对齐 + log
                import numpy as np
                mktcap = mktcap.reindex_like(panel["close"])
                log_mktcap = mktcap.apply(np.log1p)
            print(f"  industry: {industry_panel.shape}, log_mktcap: {None if log_mktcap is None else log_mktcap.shape}")
        except Exception as e:
            print(f"  [warn] 中性化数据加载失败（跳过中性化）: {e}")

    factors = {}
    for f in sorted(factor_dir.glob("alpha_*.parquet")):
        if f.stem.startswith("_"):  # _tradeable_mask 等内部文件
            continue
        num = int(f.stem.split("_")[1])
        df = pd.read_parquet(f)
        df.index = pd.to_datetime(df.index)
        df = df.loc[args.start:args.end]
        factors[num] = preprocess_pipeline(
            df,
            vol_scale_window=args.vol_scale_window,
            log_mktcap=log_mktcap,
            industry=industry_panel,
        )
    print(f"  读入 {len(factors)} 个因子，开始 IC 计算...")

    report = run_ic_report(factors, panel["close"], horizon=args.horizon, decile=10)

    out_dir = _resolve_run_dir(args.run_id)
    csv_path = out_dir / "ic_report.csv"
    report.to_csv(csv_path, index=False, float_format="%.4f")
    print(f"  IC 表: {csv_path}")

    # 同时输出 IC 历史时间序列（前端热力图 + 衰减告警用）
    from mining_alpha.ic_report import compute_ic_history
    ic_hist = compute_ic_history(factors, panel["close"], horizon=args.horizon)
    if not ic_hist.empty:
        ic_hist.to_parquet(out_dir / "ic_history.parquet")
        print(f"  IC 历史时序: {out_dir/'ic_history.parquet'}")
    print(f"\n  Top 20 by |ICIR|:\n{report.head(20).to_string(index=False)}")

    # 初筛
    kept = filter_alphas_by_ic(report, min_abs_ic_mean=0.02, min_abs_ic_ir=0.3)
    print(f"\n  按 |IC|>=0.02 & |ICIR|>=0.3 初筛: {len(kept)} 个因子")

    # 相关性冗余剔除
    if args.filter_redundant and len(kept) > 2:
        print(f"  计算因子相关性（采样 {args.corr_sample_dates or '所有'} 个日期）...")
        kept_factors = {n: factors[n] for n in kept if n in factors}
        corr = factor_correlation_matrix(kept_factors, sample_dates=args.corr_sample_dates)
        corr.to_csv(out_dir / "factor_correlation.csv", float_format="%.3f")
        kept_after = filter_redundant_alphas(report, corr, corr_threshold=args.corr_threshold)
        # 只保留同时通过 IC 初筛的
        kept = [n for n in kept_after if n in set(kept)]
        print(f"  按 |corr|>{args.corr_threshold} 去冗余后: {len(kept)} 个因子")

    with open(out_dir / "selected_alphas.json", "w", encoding="utf-8") as f:
        json.dump({
            "selected": kept,
            "n": len(kept),
            "criteria": (
                "|IC|>=0.02 & |ICIR|>=0.3"
                + (f" & |corr|<={args.corr_threshold}" if args.filter_redundant else "")
            ),
            "preprocessing": {
                "vol_scale_window": args.vol_scale_window,
                "neutralize": args.neutralize,
            },
        }, f, ensure_ascii=False, indent=2)
    print(f"  落盘: {out_dir/'selected_alphas.json'}")

    # 月度 IC 热力图（保留所有因子的，不只 kept）
    print("  计算 factor × month IC 热力图...")
    try:
        heatmap = factor_ic_monthly_heatmap(factors, panel["close"], horizon=args.horizon)
        heatmap.to_csv(out_dir / "ic_monthly_heatmap.csv", float_format="%.4f")
        print(f"  热力图: {out_dir/'ic_monthly_heatmap.csv'} (shape={heatmap.shape})")
    except Exception as e:
        print(f"  [warn] 热力图生成失败: {e}")


# ── train ────────────────────────────────────────────────────


def cmd_train(args):
    """walk-forward 训练 LightGBM ranker，支持 regime-aware 模式 + Optuna 超参。"""
    import numpy as np
    from mining_alpha.data_loader import load_industry_panel, load_mktcap_panel, load_panel
    from mining_alpha.ic_report import compute_forward_return
    from mining_alpha.model import (
        aggregate_feature_importance,
        aggregate_test_predictions,
        prepare_xy,
        walk_forward_train,
    )
    from mining_alpha.preprocess import preprocess_pipeline

    print(f"[train] universe={args.universe} {args.start}..{args.end}")
    panel = load_panel(args.start, args.end, universe=args.universe)

    # 读取上一步 selected_alphas（优先使用 run_id 指向的，否则 root）
    run_dir = _resolve_run_dir(args.run_id)
    factor_dir = OUTPUT_ROOT / "factors"
    selected_file = run_dir / "selected_alphas.json"
    if not selected_file.exists():
        selected_file = OUTPUT_ROOT / "selected_alphas.json"
    factors = {}
    if selected_file.exists() and not args.use_all_factors:
        with open(selected_file, encoding="utf-8") as f:
            sa = json.load(f)
        selected = sa["selected"]
        preproc_cfg = sa.get("preprocessing", {})
        print(f"  使用 {selected_file} 里的 {len(selected)} 个因子（preprocessing={preproc_cfg}）")
        factor_files = [factor_dir / f"alpha_{num:03d}.parquet" for num in selected]
    else:
        factor_files = sorted([f for f in factor_dir.glob("alpha_*.parquet") if not f.stem.startswith("_")])
        preproc_cfg = {}
        print(f"  使用所有 {len(factor_files)} 个因子")

    # 中性化数据（与 ic-report 一致；若 ic-report 用了，这里也要用）
    industry_panel = None
    log_mktcap = None
    if args.neutralize or preproc_cfg.get("neutralize"):
        try:
            tickers = list(panel["close"].columns)
            industry_panel = load_industry_panel(tickers, list(panel["close"].index))
            mktcap = load_mktcap_panel(tickers, args.start, args.end)
            if not mktcap.empty:
                log_mktcap = mktcap.reindex_like(panel["close"]).apply(np.log1p)
        except Exception as e:
            print(f"  [warn] 中性化数据加载失败: {e}")

    vol_scale_window = args.vol_scale_window or preproc_cfg.get("vol_scale_window")

    for f in factor_files:
        if not f.exists():
            continue
        num = int(f.stem.split("_")[1])
        df = pd.read_parquet(f)
        df.index = pd.to_datetime(df.index)
        df = df.loc[args.start:args.end]
        factors[num] = preprocess_pipeline(
            df,
            vol_scale_window=vol_scale_window,
            log_mktcap=log_mktcap,
            industry=industry_panel,
        )

    fwd_ret = compute_forward_return(panel["close"], horizon=args.horizon)

    # Optuna 超参（可选）
    params = None
    if args.use_optuna_params:
        optuna_file = run_dir / "optuna_best.json"
        if not optuna_file.exists():
            optuna_file = OUTPUT_ROOT / "optuna_best.json"
        if optuna_file.exists():
            with open(optuna_file, encoding="utf-8") as f:
                params = json.load(f).get("best_params") or json.load(f)
                # best_params may be inside dict
            # 加上必要的固定字段
            params = {
                "objective": "lambdarank", "metric": "ndcg", "eval_at": [50, 100],
                "verbose": -1, **(params or {}),
            }
            print(f"  使用 Optuna 优化的超参: {params}")
        else:
            print("  [warn] 找不到 optuna_best.json；用默认超参")

    # Regime-aware 训练分支
    if args.regime_aware:
        from mining_alpha.data_loader import load_benchmark
        from mining_alpha.improvements import (
            hmm_regime_series, predict_regime_aware, train_regime_aware_lgb,
        )

        print("  [regime-aware] 加载基准 + HMM 三态识别...")
        bench = load_benchmark(args.benchmark, args.start, args.end)
        regime = hmm_regime_series(bench)
        # 落盘 regime 用于前端 overlay
        regime.to_csv(run_dir / "regime.csv", float_format="%.4f")

        X, y, group = prepare_xy(factors, fwd_ret)
        rb = train_regime_aware_lgb(X, y, group, regime,
                                    params=params,
                                    num_boost_round=args.num_boost_round)
        preds = predict_regime_aware(rb, factors)
        # 保存 boosters
        models_dir = run_dir / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        for label, b in rb.boosters.items():
            b.save_model(str(models_dir / f"regime_{label}.lgb"))
        preds.to_parquet(run_dir / "predictions.parquet")
        # 简化 feature importance: 三模型平均
        fis = []
        for label, b in rb.boosters.items():
            fi = pd.Series(b.feature_importance(importance_type="gain"),
                           index=rb.feature_names, name=f"regime_{label}")
            fis.append(fi)
        if fis:
            pd.concat(fis, axis=1).to_csv(run_dir / "feature_importance.csv",
                                          float_format="%.2f")
        print(f"  完成。3 个 regime booster 落 {models_dir}/")
        print(f"  预测 panel: {run_dir/'predictions.parquet'}")
        return

    # Ensemble (LGB + XGB + CB) 分支
    if args.ensemble:
        from mining_alpha.ensemble import (
            walk_forward_ensemble,
        )
        results = walk_forward_ensemble(
            factors, fwd_ret,
            train_years=args.train_years,
            valid_years=args.valid_years,
            test_years=args.test_years,
            step_months=args.step_months,
            num_boost_round=args.num_boost_round,
            early_stopping=args.early_stopping,
            use_lgb=True, use_xgb=True, use_cb=True,
        )
        models_dir = run_dir / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        for r in results:
            for name, b in r.boosters.items():
                if name == "lgb":
                    b.save_model(str(models_dir / f"fold_{r.fold_idx+1:02d}_lgb.lgb"))
                elif name == "xgb":
                    b.save_model(str(models_dir / f"fold_{r.fold_idx+1:02d}_xgb.json"))
                elif name == "cb":
                    b.save_model(str(models_dir / f"fold_{r.fold_idx+1:02d}_cb.cbm"))
        # 拼接预测
        preds = pd.concat([r.test_predictions for r in results if not r.test_predictions.empty]).sort_index()
        preds.to_parquet(run_dir / "predictions.parquet")
        # per-fold IC
        fold_ic_df = pd.DataFrame([{
            "fold": r.fold_idx + 1,
            "test_ic_mean": r.test_ic_mean,
            "test_ic_ir": r.test_ic_ir,
            "n_models": len(r.boosters),
        } for r in results])
        fold_ic_df.to_csv(run_dir / "fold_ic.csv", index=False, float_format="%.4f")
        print(f"\n  Ensemble per-fold IC:\n{fold_ic_df.to_string(index=False)}")
        print(f"  模型落 {models_dir}/ (LGB/XGB/CB × {len(results)} folds)")
        print(f"  预测 panel: {run_dir/'predictions.parquet'}")
        return

    # 标准 walk-forward
    results = walk_forward_train(
        factors, fwd_ret,
        train_years=args.train_years,
        valid_years=args.valid_years,
        test_years=args.test_years,
        step_months=args.step_months,
        num_boost_round=args.num_boost_round,
        early_stopping=args.early_stopping,
        params=params,
        # 用 10 deciles 标签：每天 ticker 数不同时仍能稳定（避免 LightGBM
        # "label N not in label mappings" 错）
        label_buckets=args.label_buckets,
    )

    models_dir = run_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    # Windows + Unicode 路径下 lgb.save_model() 会失败，改用 model_to_string + Python open
    for i, r in enumerate(results, 1):
        model_str = r.booster.model_to_string()
        (models_dir / f"fold_{i:02d}.lgb").write_text(model_str, encoding="utf-8")
    preds = aggregate_test_predictions(results)
    preds.to_parquet(run_dir / "predictions.parquet")
    fi = aggregate_feature_importance(results)
    fi.to_csv(run_dir / "feature_importance.csv", float_format="%.2f")
    # per-fold IC 摘要
    fold_ic_df = pd.DataFrame([{
        "fold": i + 1,
        "test_start": str(r.fold.test_start.date()),
        "test_end": str(r.fold.test_end.date()),
        "test_ic_mean": r.test_ic_mean,
        "test_ic_ir": r.test_ic_ir,
        "best_iter": r.best_iter,
    } for i, r in enumerate(results)])
    fold_ic_df.to_csv(run_dir / "fold_ic.csv", index=False, float_format="%.4f")
    print(f"\n  Per-fold 测试集 IC:\n{fold_ic_df.to_string(index=False)}")
    print(f"  模型落 {models_dir}/")
    print(f"  预测 panel: {run_dir/'predictions.parquet'}")
    print(f"  特征重要性: {run_dir/'feature_importance.csv'}")


# ── backtest ─────────────────────────────────────────────────


def cmd_backtest(args):
    """跑回测，输出 JSON 报告 + 净值图。支持多 Top-N + 涨跌停剔除。"""
    from mining_alpha.backtest import run_backtest, run_multi_topn, summarize_multi_topn
    from mining_alpha.data_loader import compute_tradeable_mask, load_benchmark, load_panel

    print(f"[backtest] universe={args.universe} {args.start}..{args.end} top_n={args.top_n}")
    panel = load_panel(args.start, args.end, universe=args.universe)
    close = panel["close"]

    run_dir = _resolve_run_dir(args.run_id)
    preds_path = run_dir / "predictions.parquet"
    if not preds_path.exists():
        preds_path = OUTPUT_ROOT / "predictions.parquet"
    if not preds_path.exists():
        raise RuntimeError("predictions.parquet 不存在；先跑 `train`")
    scores = pd.read_parquet(preds_path)
    scores.index = pd.to_datetime(scores.index)
    scores = scores.loc[args.start:args.end]

    benchmark = load_benchmark(args.benchmark, args.start, args.end)

    # 涨跌停 / 停牌 mask
    tmask = None
    if args.use_tradeable_mask:
        # 优先用 compute-factors 已落盘的；否则现算
        cached = OUTPUT_ROOT / "factors" / "_tradeable_mask.parquet"
        if cached.exists():
            tmask = pd.read_parquet(cached)
            tmask.index = pd.to_datetime(tmask.index)
            tmask = tmask.loc[args.start:args.end]
            tmask = tmask.reindex(index=scores.index, columns=scores.columns).fillna(False).astype(bool)
        else:
            tmask = compute_tradeable_mask(panel)
            tmask = tmask.reindex(index=scores.index, columns=scores.columns).fillna(False).astype(bool)
        print(f"  涨跌停剔除已启用：可交易格点 {tmask.sum().sum()} / {tmask.size}")

    # 多 Top-N 切片
    if args.multi_topn:
        top_ns = tuple(int(x) for x in args.multi_topn.split(","))
        print(f"  多 Top-N 切片回测: {top_ns}")
        reports = run_multi_topn(scores, close, benchmark, top_ns=top_ns,
                                 cost=args.cost, tradeable_mask=tmask)
        summary = summarize_multi_topn(reports)
        summary.to_csv(run_dir / "backtest_multi_topn.csv", index=False, float_format="%.4f")
        print(f"\n{summary.to_string(index=False)}")
        # 把 top_n=主参数对应的报告作为主报告
        report = reports.get(args.top_n) or next(iter(reports.values()))
    elif args.constrained:
        # 约束 Top-N（单票 + 行业 + 可选动态杠杆）
        from mining_alpha.data_loader import load_industry
        from mining_alpha.portfolio import portfolio_returns_constrained
        try:
            industry_map = load_industry(list(scores.columns))
        except Exception as e:
            print(f"  [warn] 行业数据加载失败: {e}；跳过行业约束")
            industry_map = None
        strat_ret, holdings = portfolio_returns_constrained(
            scores, close, industry_map,
            top_n=args.top_n, cost=args.cost,
            max_per_stock=args.max_per_stock,
            max_per_industry=args.max_per_industry,
            use_dynamic_leverage=args.dynamic_leverage,
            tradeable_mask=tmask,
        )
        from mining_alpha.backtest import compute_metrics
        bench_ret = benchmark.pct_change().reindex(strat_ret.index).fillna(0.0) if benchmark is not None else None
        metrics = compute_metrics(strat_ret, bench_ret)
        metrics.update({
            "top_n": args.top_n, "cost": args.cost,
            "start_date": str(strat_ret.index.min().date()),
            "end_date": str(strat_ret.index.max().date()),
            "turnover_annual": float(holdings.diff().abs().sum().sum() / len(holdings) * 252 / 2),
            "constrained": True,
            "max_per_stock": args.max_per_stock,
            "max_per_industry": args.max_per_industry,
            "dynamic_leverage": args.dynamic_leverage,
            "has_tradeable_mask": tmask is not None,
        })
        equity = (1 + strat_ret).cumprod()
        bench_eq = (1 + bench_ret).cumprod() if bench_ret is not None else None
        from mining_alpha.backtest import BacktestReport
        report = BacktestReport(
            daily_returns=strat_ret, equity_curve=equity,
            holdings=holdings, long_short_returns=None,
            metrics=metrics, benchmark_equity=bench_eq,
        )
    else:
        report = run_backtest(scores, close, benchmark, top_n=args.top_n,
                              cost=args.cost, tradeable_mask=tmask)

    out_dir = run_dir
    with open(out_dir / "backtest_report.json", "w", encoding="utf-8") as f:
        json.dump(report.metrics, f, indent=2, ensure_ascii=False, default=str)
    report.daily_returns.to_csv(out_dir / "daily_returns.csv", header=["return"])
    report.equity_curve.to_csv(out_dir / "equity_curve.csv", header=["equity"])
    if report.benchmark_equity is not None:
        report.benchmark_equity.to_csv(out_dir / "benchmark_equity.csv", header=["bench_equity"])
    print("\n  ╭──── 回测指标 ────╮")
    for k, v in report.metrics.items():
        if isinstance(v, float):
            print(f"  {k:30s}: {v:.4f}")
        else:
            print(f"  {k:30s}: {v}")
    print("  ╰──────────────────╯")

    # 画图
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(10, 5))
        ax.plot(report.equity_curve.index, report.equity_curve.values, label="Strategy")
        if report.benchmark_equity is not None:
            ax.plot(report.benchmark_equity.index, report.benchmark_equity.values, label=f"Benchmark ({args.benchmark})", linestyle="--")
        if report.long_short_returns is not None:
            ls_eq = (1 + report.long_short_returns).cumprod()
            ax.plot(ls_eq.index, ls_eq.values, label="Long-Short (diagnostic)", alpha=0.6)
        ax.set_title(f"Alpha191 backtest: top_n={args.top_n}, cost={args.cost}")
        ax.set_ylabel("Equity")
        ax.legend()
        ax.grid(alpha=0.3)
        plt.tight_layout()
        plt.savefig(out_dir / "equity_curve.png", dpi=120)
        plt.close()
        print(f"  净值图: {out_dir/'equity_curve.png'}")
    except Exception as e:
        print(f"  [warn] 画图失败: {e}")


# ── explain ──────────────────────────────────────────────────


def cmd_explain(args):
    """对最新预测 Top-N 持仓做 SHAP 解释，输出每只票的 Top-K 贡献因子。"""
    import lightgbm as lgb
    from mining_alpha.data_loader import load_panel
    from mining_alpha.explain import top_contributions_for_holdings
    from mining_alpha.ic_report import compute_forward_return
    from mining_alpha.model import prepare_xy
    from mining_alpha.preprocess import preprocess_pipeline

    print(f"[explain] universe={args.universe} {args.start}..{args.end}")
    panel = load_panel(args.start, args.end, universe=args.universe)
    run_dir = _resolve_run_dir(args.run_id)

    # 加载选中的因子（与训练一致）
    factor_dir = OUTPUT_ROOT / "factors"
    selected_file = run_dir / "selected_alphas.json"
    if not selected_file.exists():
        selected_file = OUTPUT_ROOT / "selected_alphas.json"
    if selected_file.exists():
        with open(selected_file, encoding="utf-8") as f:
            sa = json.load(f)
        selected = sa["selected"]
        factor_files = [factor_dir / f"alpha_{num:03d}.parquet" for num in selected]
    else:
        factor_files = sorted([f for f in factor_dir.glob("alpha_*.parquet") if not f.stem.startswith("_")])
    factors = {}
    for f in factor_files:
        if not f.exists():
            continue
        num = int(f.stem.split("_")[1])
        df = pd.read_parquet(f)
        df.index = pd.to_datetime(df.index)
        df = df.loc[args.start:args.end]
        factors[num] = preprocess_pipeline(df)

    fwd_ret = compute_forward_return(panel["close"], horizon=args.horizon)
    X, y, group = prepare_xy(factors, fwd_ret)
    last_date = X.index.get_level_values(0).max()
    X_today = X.loc[last_date].copy()
    X_today.index = pd.MultiIndex.from_tuples(
        [(last_date, t) for t in X_today.index], names=["date", "ticker"],
    )

    # 加载最后一个 fold 的 booster
    models_dir = run_dir / "models"
    if not models_dir.exists():
        models_dir = OUTPUT_ROOT / "models"
    lgb_files = sorted(models_dir.glob("fold_*.lgb"))
    if not lgb_files:
        raise RuntimeError("没找到 LGB 模型；先跑 train")
    booster = lgb.Booster(model_file=str(lgb_files[-1]))

    df = top_contributions_for_holdings(
        booster, X_today,
        top_n_stocks=args.top_n, top_k_factors=args.top_k, model_kind="lgb",
    )
    out_file = run_dir / "shap_top_contributions.csv"
    df.to_csv(out_file, index=False, float_format="%.4f")
    print(f"  落盘 {out_file} (shape={df.shape})")
    print(df.head(30).to_string(index=False))


# ── optuna ───────────────────────────────────────────────────


def cmd_optuna(args):
    """在第一个 walk-forward fold 上做 Bayesian 超参优化。"""
    import numpy as np
    from mining_alpha.data_loader import load_industry_panel, load_mktcap_panel, load_panel
    from mining_alpha.hyperopt import optuna_optimize
    from mining_alpha.ic_report import compute_forward_return
    from mining_alpha.preprocess import preprocess_pipeline

    print(f"[optuna] universe={args.universe} {args.start}..{args.end} n_trials={args.n_trials}")
    panel = load_panel(args.start, args.end, universe=args.universe)

    run_dir = _resolve_run_dir(args.run_id)
    factor_dir = OUTPUT_ROOT / "factors"
    selected_file = run_dir / "selected_alphas.json"
    if not selected_file.exists():
        selected_file = OUTPUT_ROOT / "selected_alphas.json"
    if selected_file.exists():
        with open(selected_file, encoding="utf-8") as f:
            sa = json.load(f)
        selected = sa["selected"]
        preproc_cfg = sa.get("preprocessing", {})
        print(f"  使用 selected_alphas 里的 {len(selected)} 个因子")
        factor_files = [factor_dir / f"alpha_{num:03d}.parquet" for num in selected]
    else:
        factor_files = sorted([f for f in factor_dir.glob("alpha_*.parquet") if not f.stem.startswith("_")])
        preproc_cfg = {}

    # 中性化（与 ic-report 一致）
    industry_panel = None
    log_mktcap = None
    if preproc_cfg.get("neutralize"):
        try:
            tickers = list(panel["close"].columns)
            industry_panel = load_industry_panel(tickers, list(panel["close"].index))
            mktcap = load_mktcap_panel(tickers, args.start, args.end)
            if not mktcap.empty:
                log_mktcap = mktcap.reindex_like(panel["close"]).apply(np.log1p)
        except Exception as e:
            print(f"  [warn] 中性化数据加载失败: {e}")

    vol_scale_window = preproc_cfg.get("vol_scale_window")

    factors = {}
    for f in factor_files:
        if not f.exists():
            continue
        num = int(f.stem.split("_")[1])
        df = pd.read_parquet(f)
        df.index = pd.to_datetime(df.index)
        df = df.loc[args.start:args.end]
        factors[num] = preprocess_pipeline(
            df, vol_scale_window=vol_scale_window,
            log_mktcap=log_mktcap, industry=industry_panel,
        )

    fwd_ret = compute_forward_return(panel["close"], horizon=args.horizon)
    best_params = optuna_optimize(
        factors, fwd_ret,
        n_trials=args.n_trials,
        fold_idx=args.fold_idx,
        train_years=args.train_years,
        valid_years=args.valid_years,
        test_years=args.test_years,
        step_months=args.step_months,
        output_dir=run_dir,
    )
    print(f"  最佳超参已保存到 {run_dir/'optuna_best.json'}")


# ── argparse ─────────────────────────────────────────────────


def main():
    p = argparse.ArgumentParser(prog="mining_alpha")
    sub = p.add_subparsers(dest="cmd", required=True)

    today = datetime.now().strftime("%Y-%m-%d")
    five_years_ago = (datetime.now().replace(year=datetime.now().year - 5)).strftime("%Y-%m-%d")
    default_run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    def _add_common(sp):
        sp.add_argument("--universe", default="CSI800")
        sp.add_argument("--start", default=five_years_ago)
        sp.add_argument("--end", default=today)
        sp.add_argument("--run-id", default=None,
                        help="运行 ID（默认不版本化，写到 OUTPUT_ROOT 顶层）；"
                             "建议 ic-report/train/backtest 用 --run-id $RUN_ID 串起来")

    # sync-data
    sp = sub.add_parser("sync-data", help="从 tushare 同步 universe + 行情（tushare 不可用时降级 akshare）")
    sp.add_argument("--universe", default="CSI800")
    sp.add_argument("--start", default=five_years_ago)
    sp.add_argument("--end", default=today)
    sp.set_defaults(func=cmd_sync_data)

    # compute-factors
    sp = sub.add_parser("compute-factors", help="计算因子 + 落 tradeable mask (默认 alpha191)")
    _add_common(sp)
    sp.add_argument("--factor-sets", default="alpha191",
                    help="逗号分隔: alpha191 / alpha101 / all。默认仅 alpha191。"
                         " 文件落 factors/{prefix}_NNN.parquet (prefix=alpha 或 wq)")
    sp.set_defaults(func=cmd_compute_factors)

    # ic-report
    sp = sub.add_parser("ic-report",
        help="单因子 IC 报告 + 相关性冗余剔除 + (可选) 中性化 / vol-scale")
    _add_common(sp)
    sp.add_argument("--horizon", type=int, default=5)
    sp.add_argument("--vol-scale-window", type=int, default=None,
                    help="若给定，因子在 preprocess 前先做 N 日时序波动率归一化")
    sp.add_argument("--neutralize", action="store_true",
                    help="启用行业 + log(市值) 中性化（需 tushare daily_basic 权限）")
    sp.add_argument("--filter-redundant", action="store_true",
                    help="启用因子相关性贪心剔除")
    sp.add_argument("--corr-threshold", type=float, default=0.85)
    sp.add_argument("--corr-sample-dates", type=int, default=60,
                    help="计算因子相关性时随机采样 N 个日期（提速；0=用全部）")
    sp.set_defaults(func=cmd_ic_report)

    # train
    sp = sub.add_parser("train", help="walk-forward LightGBM 训练 + (可选) regime-aware + Optuna 超参")
    _add_common(sp)
    sp.add_argument("--horizon", type=int, default=5)
    sp.add_argument("--train-years", type=float, default=2.0)
    sp.add_argument("--valid-years", type=float, default=0.5)
    sp.add_argument("--test-years", type=float, default=0.5)
    sp.add_argument("--step-months", type=int, default=6)
    sp.add_argument("--num-boost-round", type=int, default=500)
    sp.add_argument("--early-stopping", type=int, default=50)
    sp.add_argument("--label-buckets", type=int, default=10,
                    help="标签离散化桶数（每日横截面 rank → 0..buckets-1）；"
                         "默认 10 deciles，对每日 ticker 数不一致鲁棒")
    sp.add_argument("--use-all-factors", action="store_true")
    sp.add_argument("--regime-aware", action="store_true",
                    help="启用 HMM 三态分别训练 + 概率加权融合预测")
    sp.add_argument("--neutralize", action="store_true")
    sp.add_argument("--vol-scale-window", type=int, default=None)
    sp.add_argument("--use-optuna-params", action="store_true",
                    help="读取 optuna_best.json 作 LightGBM 超参")
    sp.add_argument("--ensemble", action="store_true",
                    help="启用 LightGBM + XGBoost + CatBoost 集成 (rank-mean)")
    sp.add_argument("--benchmark", default="000300.SH",
                    help="regime-aware 模式下的基准（取 HMM 训练数据）")
    sp.set_defaults(func=cmd_train)

    # backtest
    sp = sub.add_parser("backtest", help="跑回测 + (可选) 多 Top-N + 涨跌停剔除")
    _add_common(sp)
    sp.add_argument("--top-n", type=int, default=50)
    sp.add_argument("--cost", type=float, default=0.002)
    sp.add_argument("--benchmark", default="000300.SH")
    sp.add_argument("--use-tradeable-mask", action="store_true",
                    help="启用涨跌停 / 停牌 / 次新股剔除（推荐）")
    sp.add_argument("--multi-topn", default=None,
                    help="逗号分隔的多 Top-N 列表，如 '20,50,100,200'；非空时跑切片对比")
    sp.add_argument("--constrained", action="store_true",
                    help="启用约束 Top-N（单票/行业上限）替代等权")
    sp.add_argument("--max-per-stock", type=float, default=0.05)
    sp.add_argument("--max-per-industry", type=float, default=0.30)
    sp.add_argument("--dynamic-leverage", action="store_true",
                    help="启用动态杠杆（信号离散度驱动 0.5-1.5x）")
    sp.set_defaults(func=cmd_backtest)

    # optuna
    sp = sub.add_parser("optuna", help="Bayesian 超参优化")
    _add_common(sp)
    sp.add_argument("--horizon", type=int, default=5)
    sp.add_argument("--n-trials", type=int, default=50)
    sp.add_argument("--fold-idx", type=int, default=0)
    sp.add_argument("--train-years", type=float, default=2.0)
    sp.add_argument("--valid-years", type=float, default=0.5)
    sp.add_argument("--test-years", type=float, default=0.5)
    sp.add_argument("--step-months", type=int, default=6)
    sp.set_defaults(func=cmd_optuna)

    # explain
    sp = sub.add_parser("explain", help="SHAP 解释最新预测 Top-N 持仓的贡献因子")
    _add_common(sp)
    sp.add_argument("--horizon", type=int, default=5)
    sp.add_argument("--top-n", type=int, default=20, help="对预测最高的 N 只票做解释")
    sp.add_argument("--top-k", type=int, default=3, help="每只票输出 K 个最大贡献因子")
    sp.set_defaults(func=cmd_explain)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
