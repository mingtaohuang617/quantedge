# Mining Alpha — 贡献指南

## 模块结构

```
mining_alpha/
├── operators.py          25 个 vectorized panel-data 算子
├── operators_jit.py      Numba JIT 加速版（大窗口 CORR/DECAYLINEAR）
├── alpha191_factors.py   191 个国君短周期价量因子
├── alpha101_factors.py   34 个 WorldQuant 经典因子（独立 registry）
├── data_loader.py        SQLite + tushare/akshare 加载 panel
├── preprocess.py         winsorize / 中性化 / vol-scale / zscore
├── ic_report.py          单因子 IC 诊断 + 月度热力图 + 冗余剔除
├── model.py              LightGBM LambdaRank + walk-forward CV
├── ensemble.py           LightGBM + XGBoost + CatBoost rank 集成
├── hyperopt.py           Optuna Bayesian 超参优化
├── improvements.py       vol-scaled / IC-decay / regime-aware
├── explain.py            SHAP 因子贡献度
├── portfolio.py          约束 Top-N + 动态杠杆
├── backtest.py           向量化回测 + 多 Top-N 切片
├── alerts.py             IC 衰减 + 回撤 + 数据健康告警
├── benchmark.py          性能基准 (T × N panel 耗时)
├── catalog.py            自动生成因子目录 Markdown
├── synthetic_demo.py     合成数据一键生成（无 tushare 也能 demo）
└── run.py                CLI 总入口
```

## 加一个新因子（α192）

### 1. 写函数

`alpha191_factors.py` 末尾追加：

```python
@alpha(192, desc="(C - VWAP) / TR_14   收盘相对 VWAP 偏离归一化 ATR")
def alpha_192(data: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Alpha192: 你的新公式。
    用 data['close'], data['vwap'] 等。
    """
    close = data["close"]
    vwap = data["vwap"]
    tr = _tr(data)             # 复用 ATR helper
    atr14 = MEAN(tr, 14)
    return (close - vwap) / atr14
```

### 2. 加测试

`backend/tests/test_mining_alpha_alpha191_factors.py` 已经有自动参数化测试覆盖
所有注册的因子（compile / no-lookahead / NaN 比例），无需手动加。如果新因子有特殊
数值断言，新增手算测试即可：

```python
def test_alpha192_known_value(synthetic_panel):
    r = compute_alpha(192, synthetic_panel)
    expected = ...   # 手算第 N 天 ticker A
    np.testing.assert_allclose(r.iloc[N, 0], expected, atol=1e-10)
```

### 3. 跑测试

```bash
cd backend
.venv/Scripts/python -m pytest tests/test_mining_alpha_alpha191_factors.py -k "alpha_192 or no_lookahead\[192\]" -v
```

### 4. 重新生成因子目录

```bash
.venv/Scripts/python -m mining_alpha.catalog
```

## 调试手册

### 因子产 NaN 太多
- 检查 panel 是否够长：大窗口因子 (Alpha26 用 CORR window=230) 至少需 ~250 天数据
- 检查 universe ticker 数：小 N (10) 会让 RANK 量化太粗 + CORR 频繁触发"零方差"
- 用 `python -m mining_alpha.synthetic_demo --n-stocks 100 --years 5` 生成大 panel 测

### LightGBM "Label N not in label mappings"
- 加 `--label-buckets 10`（默认）— 把每日 rank 离散化到 10 deciles
- 或确保每日 ticker 数一致（用 PIT universe + drop NaN 之前对齐）

### Windows + 非 ASCII 路径 LightGBM `save_model` 失败
- 已修：所有保存改用 `booster.model_to_string()` + Python `open()`
- 加载同样：`lgb.Booster(model_str=Path("xxx.lgb").read_text(encoding="utf-8"))`

### pandas 3.x 兼容
- `mode.use_inf_as_na` 已移除 — 用 `df.replace([np.inf, -np.inf], np.nan)` 代替

### tushare daily 接口积分不够
- `--sync-data` 自动降级 akshare（hfq 收盘价反推 adj_factor）
- 完全没 tushare 也能用 `synthetic_demo` 跑 demo

### Walk-forward 重叠测试期产生 duplicate index
- `aggregate_test_predictions` 自动去重（后 fold 覆盖前 fold）
- 也可调大 `--step-months` ≥ test_years * 12 完全避免

## 性能调优

### 大 panel (CSI800 × 5y = 1.2M cells) 慢？
- 自动用 Numba JIT (n ≥ 60 的 CORR / n ≥ 30 的 DECAYLINEAR)
- 预估耗时：`.venv/Scripts/python -m mining_alpha.benchmark --sizes "(1250,800)"`

### CSI300 vs CSI800 vs 全A？
- CSI300: ~300 票 × 1250 天 = 0.4M cells, < 1 min
- CSI800: ~800 票 × 1250 天 = 1M cells, ~3 min
- 全A: ~5000 票 × 1250 天 = 6.3M cells, ~20 min

## 加新因子集（α101 / 自研）

1. 复制 `alpha101_factors.py` 作模板
2. 改 registry 名（如 `_MY_REGISTRY`）+ alpha decorator 名
3. 在 `run.py` 的 `cmd_compute_factors` 加 flag `--use-my-factors` 决定哪个 registry 跑
4. 共享 `operators.py` 算子；如缺新算子（如 SectorNeutralize），加到 operators.py

## CI 集成（未来）

GitHub Actions 加 step:
```yaml
- name: Mining Alpha smoke test
  run: |
    pip install -r backend/requirements.txt
    cd backend
    python -m mining_alpha.synthetic_demo --n-stocks 30 --years 1
    python -m mining_alpha.run compute-factors --universe DEMO --start 2024-06-01 --end 2025-05-15 --run-id ci
    python -m pytest tests/test_mining_alpha_*.py -m "not slow" -q
```
