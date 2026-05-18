# Mining Alpha — 因子挖掘与策略构建框架

> 国泰君安 2017《基于短周期价量特征的多因子选股体系》研报里 191 个 alpha 因子的工业化实现。
> Universe: 中证 800 / 预测目标: 5 日横截面收益排名 / 回测窗口: 近 5 年。

## 1. 文件布局

```
backend/mining_alpha/
├── __init__.py
├── operators.py     25 个 vectorized panel-data 算子 (RANK/TSRANK/DELTA/CORR/SMA/REGBETA/…)
├── alpha191_factors.py       183 个 Alpha191 因子 + _ALPHA_REGISTRY 注册器
├── data_loader.py   从 SQLite + tushare 加载 panel + CSI800 PIT universe
├── preprocess.py    winsorize → fillna → neutralize → zscore
├── ic_report.py     单因子 IC / ICIR / 换手 / Top decile excess
├── model.py         LightGBM LambdaRank + walk-forward CV
├── backtest.py      向量化回测 + 多空诊断 + 指标
└── run.py           CLI 总入口

backend/tests/
├── test_mining_alpha_operators.py    36 个算子测试
├── test_mining_alpha_alpha191_factors.py      ~270 个因子测试（含无前视性检查）
├── test_mining_alpha_pipeline.py     11 个 preprocess + IC 测试
└── test_mining_alpha_e2e.py          6 个端到端集成测试（含 LightGBM）

backend/output/mining_alpha/          运行产物（gitignored）
├── factors/                       每个因子一个 parquet
├── models/                        walk-forward 各 fold 的 .lgb
├── predictions.parquet            拼好的 test 集预测分数
├── ic_report.csv                  按 ICIR 排序的因子表
├── selected_alphas.json           |IC|≥0.02 & |ICIR|≥0.3 筛后名单
├── feature_importance.csv         ML 各 fold 的特征重要性
├── backtest_report.json           回测指标
└── equity_curve.png               净值图
```

## 2. 一键复现（推荐带 --run-id 版本化）

环境前提:
- `backend/.venv` 安装好（lightgbm / scikit-learn / matplotlib / **optuna**，见 `requirements.txt`）
- `backend/.env` 含 `TUSHARE_TOKEN=...`（推荐 2000+ 积分；不够时 `sync-data` 自动降级 **akshare** 免费数据源）

设 RUN_ID 让 ic-report / train / backtest 落到 `runs/$RUN_ID/`（可对比多次实验）：

```bash
cd backend
# Bash: RUN_ID=$(date +%Y%m%d_%H%M%S)
# PowerShell:
$RUN_ID = Get-Date -Format yyyyMMdd_HHmmss
```

### Step 1: 同步行情 + universe（首次 15-30 分钟，增量后秒级）

```bash
.venv/Scripts/python -m mining_alpha.run sync-data --universe CSI800 --start 2020-01-01
```

- 自动**增量同步**（基于 `sync_state.last_bar_date`）
- 失败重试 + 指数退避（1s / 2s / 4s）
- tushare 不可用时自动降级 akshare（adj_factor 由 hfq 收盘价反推）

### Step 2: 计算所有 187 个因子 + tradeable mask（< 5 分钟）

```bash
.venv/Scripts/python -m mining_alpha.run compute-factors --start 2020-01-01 --end 2025-05-15 --run-id $RUN_ID
```

落盘 `factors/alpha_*.parquet` + `factors/_tradeable_mask.parquet`（剔除涨跌停 / 停牌 / 次新 30 日）。

### Step 3: 单因子 IC 诊断（带中性化 + 冗余剔除）

```bash
.venv/Scripts/python -m mining_alpha.run ic-report \
  --start 2020-01-01 --end 2025-05-15 --horizon 5 \
  --run-id $RUN_ID \
  --vol-scale-window 20 \
  --neutralize \
  --filter-redundant --corr-threshold 0.85
```

可选 flag：
- `--vol-scale-window N`：因子先做 N 日时序波动率归一化（抑制高波动期主导）
- `--neutralize`：行业 + log(市值) 中性化（需 tushare daily_basic 权限）
- `--filter-redundant`：因子相关性 > 阈值时只保留 ICIR 最高的（去冗余）

产物：`ic_report.csv` / `factor_correlation.csv` / `selected_alphas.json`

### Step 3.5 (可选): Optuna Bayesian 超参优化（30 分钟左右）

```bash
.venv/Scripts/python -m mining_alpha.run optuna \
  --start 2020-01-01 --end 2025-05-15 --run-id $RUN_ID \
  --n-trials 50 --fold-idx 0
```

落盘 `optuna_trials.csv` + `optuna_best.json`。后续 train 加 `--use-optuna-params` 自动读取。

### Step 4: walk-forward 训练 LightGBM ranker

```bash
# 标准 walk-forward
.venv/Scripts/python -m mining_alpha.run train \
  --start 2020-01-01 --end 2025-05-15 --run-id $RUN_ID \
  --use-optuna-params  # 可选：用 Optuna 优化后超参

# 或：regime-aware 模式（三个 booster 按 HMM 概率融合）
.venv/Scripts/python -m mining_alpha.run train \
  --start 2020-01-01 --end 2025-05-15 --run-id $RUN_ID \
  --regime-aware
```

产物：
- `models/fold_*.lgb`（或 `regime_bull.lgb` / `regime_neutral.lgb` / `regime_bear.lgb`）
- `predictions.parquet` 测试集预测分数 panel
- `feature_importance.csv` ML 各 fold 的特征重要性
- `fold_ic.csv` Per-fold **测试集 IC** 摘要表
- `regime.csv` (仅 --regime-aware)：HMM 三态概率时序

### Step 5: 回测（含涨跌停剔除 + 多 Top-N 切片）

```bash
.venv/Scripts/python -m mining_alpha.run backtest \
  --start 2022-07-01 --end 2025-05-15 --run-id $RUN_ID \
  --top-n 50 --use-tradeable-mask \
  --multi-topn "20,50,100,200"
```

可选 flag：
- `--use-tradeable-mask`：剔除涨跌停 / 停牌 / 次新股（实战必开）
- `--multi-topn "20,50,100,200"`：同时跑多个 Top-N 切片对比

产物：`backtest_report.json` / `equity_curve.csv` / `benchmark_equity.csv` /
`backtest_multi_topn.csv` / `equity_curve.png` / `daily_returns.csv`

## 3. 关键设计决策

### Panel-data: wide-format `dates × tickers`

每个字段一张 `pd.DataFrame`，跨 N 票 × T 天。横截面算子 `RANK(x)` → `x.rank(axis=1, pct=True)`；
时序算子 `DELTA(x, 5)` → `x.diff(5)`。这是 WorldQuant / Qlib / Alphalens 的工业标准。

### 严格无前视

所有滚动算子 `min_periods=window`，因子在 t 日值只依赖 ≤ t 日数据。
PIT universe：t 日的 CSI800 成分用 t 日之前最近一次 `index_weight('000906.SH')` 快照。

### Label 用横截面 rank 而非绝对收益

牛市/熊市绝对收益分布不同，但 rank 对 regime shift 鲁棒；选股本质就是排序问题。

### 模型用 LightGBM LambdaRank

NDCG@50 优化，比 GBDT regressor 更适合"选股 Top K"任务。CV 用 walk-forward，绝不用 k-fold（会数据泄漏）。

### 回测约束（务实可落地）

- 调仓: 每周一开盘按上周五收盘后预测分数调仓（T+1 entry）
- 持仓: Top 50 等权（≈ CSI800 的 6.25%）
- 成本: 双边 0.2%（印花税 0.1% + 佣金 0.03% + 滑点 0.07%）
- A 股个股无法裸卖空 → 主策略是多头；多空只作因子纯度诊断

## 4. 已实现 vs 未实现

### 已注册因子（183 / 191）

覆盖论文中：
- 短期动量/反转（α14/15/18/19/20/24/29/31/34/37/...）
- KDJ / RSI / WR 系列（α47/57/63/67/72/79/82/96/102/112/162/...）
- 量价相关性（α1/5/16/32/36/62/74/83/90/99/105/123/139/141/179/...）
- MFI / A-D / 资金流（α11/40/43/52/60/84/93/94/110/128/159/167/...）
- 多周期均线 / TRIX / MACD（α46/65/66/71/89/122/135/151/152/155/173/...）
- ATR / 波动（α70/76/95/100/109/132/160/161/174/175/...）
- 极值位置（α103/133/165/177/183/...）
- 趋势回归（α21/116/147/...）
- 复合 DECAYLINEAR + CORR（α25/26/35/39/44/61/64/73/77/87/92/119/124/125/130/138/140/156/...）
- 复杂条件（α4/10/17/19/38/55/86/98/137/146/157/164/180/186/...）
- ADX / DTM / DBM 类（α69/93/172/186/187/...）

### 未实现 / 剔除（8 / 191）

| 编号 | 原因 |
|---|---|
| 30 | 需要 Fama-French SMB/HML 因子（外部依赖） |
| 75, 149, 181, 182 | 需要基准指数 OHLC；下一轮补 HS300 daily 后实现 |
| 143 | 递归 SELF (今天值依赖昨天值)，跳过 |
| 166 | 论文公式断裂（缺操作符），无法重构 |
| 190 | 复杂 SUMIF 嵌套，预期边际效用低 |

后续可基于 IC 报告里的实际表现决定是否补全前 4 个（含基准依赖的）。

## 5. KPI 门槛（达不到回到 PR3 调因子初筛 / PR4 调 ML 超参）

- 年化收益 ≥ HS300 + 6%
- Sharpe ≥ 1.2
- 最大回撤 ≤ 25%
- IR vs HS300 ≥ 0.8
- 月度胜率 ≥ 55%
- 年化换手 200-400%
- 研究型 Top-Bottom 多空（仅诊断用）: IR ≥ 1.5、最大回撤 ≤ 15%

## 6. 已知风险

| 风险 | 缓解 |
|---|---|
| Tushare 积分不够拉 5 年 CSI800 全量 | 先拉 2 年试通，再增量补 |
| Alpha143 (递归 SELF) 等改写后语义偏离 | docstring 标注，IC 评估若偏弱则剔除 |
| Walk-forward 在 2024.9.24 行情突变处大回撤 | 下一轮加 regime-aware overlay（基于 `backend/regime/hmm_states.py`） |
| 单因子 IC 在 CSI800 上偏弱（论文用全A） | Phase 后期可放大到 CSI1000 或全 A |
| 1300×800 panel 内存占用 ~10GB | 必要时切年度分批 + DuckDB 流式处理（`db.open_duckdb_attach`） |

## 7. 下一轮可做

- 因子改良版：vol-scaled / IC-decay 自适应权重 / regime-conditional
- 前端 tab 集成：因子 IC 热力图 + ML 特征重要性 + 回测净值 + 当前持仓 Top20
- 补齐剩余 ~50 因子（含基准依赖的 75/149/181/182）
- 实盘下单接口（依赖 FastAPI + 券商接口）
- 跨市场适配（港股 / 美股）
- 分钟级数据（TODO.md P3，独立任务）
