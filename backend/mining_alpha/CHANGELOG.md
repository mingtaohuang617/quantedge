# Mining Alpha — Changelog

## v0.5.0 (2026-05-17) — 合成 e2e + Alpha101 + 性能基准

### Added
- **synthetic_demo.py** — 一键合成 N 票 × M 年 panel + 写库 + 注册 DEMO universe
- **alpha101_factors.py** — WorldQuant 经典因子集 36 个（独立 registry）
- **catalog.py** — 自动生成因子目录 Markdown（按关键词分类 14 类）
- **benchmark.py** — 性能基准 CLI，测不同 panel 规模耗时
- **notebooks/quick_tour.ipynb** — 5 分钟 Jupyter 入门
- **CONTRIBUTING.md** + **CHANGELOG.md**

### Fixed
- pandas 3.x 兼容（`mode.use_inf_as_na` 移除）
- LightGBM Windows + 非 ASCII 路径 `save_model` 失败 — 改用 `model_to_string()` + Python `open()`
- Walk-forward 测试期重叠产生 duplicate index — `aggregate_test_predictions` 自动去重
- LightGBM "Label N not in mappings" — 加 `--label-buckets 10` flag
- Windows GBK 终端 emoji 字符崩溃 — `sys.stdout.reconfigure(encoding="utf-8")`
- `mining_alpha.run backtest --multi-topn` 中 `Series truth value ambiguous` — 加 `int()` 防御

### Metrics
- 191/191 Alpha191 因子全部注册（含原跳过的 30/143/166/190 用近似实现补齐）
- 36 Alpha101 因子注册
- **719 backend tests pass** in 16s
- **基准性能**（cells = T×N）：
  - 25K cells: 2.4s（191 因子，单因子均 12ms）
  - 300K cells: 20s（单因子均 104ms）
  - 1.2M cells (~CSI800 5y): **89s**（单因子均 462ms）

---

## v0.4.0 (2026-05-16) — 优化迭代

### Added
- **portfolio.py** — 约束 Top-N + 动态杠杆
- **ensemble.py** — LightGBM + XGBoost + CatBoost rank 集成
- **explain.py** — SHAP 因子贡献度
- **hyperopt.py** — Optuna Bayesian 超参优化
- **alerts.py** — IC 衰减 / 回撤 / 数据健康告警
- **operators_jit.py** — Numba JIT 加速大窗口 CORR/DECAYLINEAR
- **improvements.py** — vol-scaled / IC-decay / regime-aware

### CLI 新增 flag
- `compute-factors` 自动落 `_tradeable_mask.parquet`
- `ic-report --vol-scale-window N --neutralize --filter-redundant --corr-threshold T`
- `train --regime-aware --use-optuna-params --label-buckets N`
- `backtest --use-tradeable-mask --multi-topn "20,50,100"`
- `optuna --n-trials 50 --fold-idx 0`
- 全局 `--run-id` 版本化

### Backend API
- `/api/mining-alpha/ic-heatmap` — 月度 IC 热力图
- `/api/mining-alpha/factor-detail/{alpha_num}` — 单因子详情
- `/api/mining-alpha/fold-ic` — Per-fold IC
- `/api/mining-alpha/alerts` — 告警查询
- `/api/mining-alpha/run/{step}` — 触发 CLI 子任务
- `/api/mining-alpha/run/status` — 轮询任务进度
- `/api/mining-alpha/switch-run/{run_id}` — 切换历史 run

### Frontend Mining Alpha tab
- 流水线 9 步骤状态 chip
- 历史 runs 切换器
- 净值图 + 基准线 + HMM regime 色块 overlay
- 持仓 diff（new/held/dropped 颜色标记）
- 多 Top-N 切片对比表
- Per-fold IC 表
- 月度 IC 热力图
- 因子详情 modal

---

## v0.3.0 (2026-05-15) — 基础因子库 + ML + 回测

### Added
- **operators.py** — 25 个 vectorized panel-data 算子
- **alpha191_factors.py** — 187/191 国君短周期价量因子（剔除 4 个：30/143/166/190）
- **data_loader.py** — SQLite + tushare CSI800 PIT universe
- **preprocess.py** — winsorize / MAD-3σ / zscore
- **ic_report.py** — 单因子 IC / ICIR / Top decile excess
- **model.py** — LightGBM LambdaRank + walk-forward CV
- **backtest.py** — 向量化回测 + 多空诊断
- **run.py** — CLI 总入口
- Frontend Mining Alpha tab MVP

---

## 总览

| 版本 | 关键产出 |
|---|---|
| v0.3.0 | Pipeline MVP — 187 因子 + ML + 回测 |
| v0.4.0 | 全链路工业化 — Optuna / Ensemble / SHAP / 改良 / 告警 / 前端可视化 |
| v0.5.0 | 完整性 + DX — 191/191 因子 + Alpha101 + 合成 demo + Jupyter + 性能基准 |
