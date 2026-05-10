# 宏观看板架构总览

> 5-layer 宏观分析模块的代码地图。读这个文档可以把整个模块的设计思路 / 数据流 / 关键文件位置一次理清。

## 1. 5 层架构

| 层 | 含义 | 关键代码 |
|---|---|---|
| L1 | 原始数据采集 + PIT 存储 | `backend/sync_*.py`、`backend/data_sources/`、`backend/db.py:series_observations` |
| L2 | 因子计算（rolling percentile + direction） | `backend/factors_lib/{liquidity,sentiment,breadth,valuation,cn_macro}.py` |
| L3 | 综合温度 + 4 子分加权 | `backend/factors_lib/composite.py:compute_composite` |
| L4 | regime detection（HMM 三态 + Kaplan-Meier 生存分析 + Bry-Boschan 一致性） | `backend/regime/{hmm_states,bull_bear,survival}.py` |
| L5 | 双重确认告警引擎 | `backend/regime/alerts.py:compute_alerts` |

## 2. 数据流

```
yfinance / FRED / akshare / Tushare  ──►  series_observations (PIT 表)
                                              │
                                              ▼
                                    factors_lib.* register_factor()
                                              │
                                       refresh_macro.py
                                              │
                                              ▼
                                       factor_values (snapshot 表)
                                              │
                ┌─────────────────────────────┴────────────────────────────┐
                ▼                                                          ▼
     compute_composite (实时)                                  export_macro_snapshot.py
     - 4 子分 + 顶层温度                                        ↓
     - 含 hmm/survival/alerts                          frontend/src/macroSnapshot.json
                │                                                          │
                ▼                                                          ▼
       /api/macro/composite (dev)                              MacroDashboard 直接 import
                                                                  (production / Vercel)
```

## 3. 前端组件树

```
MacroDashboard.jsx (路由级 state + 数据加载)
├── DataStatusBanner.jsx       ── 子模块错误/数据滞后聚合（折叠）
├── NarrativePanel.jsx         ── DeepSeek 240 字 3-段解读
├── CompositePanel.jsx         ── L3 大温度 + 4 子分卡片 + WoW Δ
├── AlertsPanel.jsx            ── L5 6 条规则；NEW 标记；deeplink → 评分
├── HmmPanel.jsx               ── L4 三态 stacked bar + 转移矩阵 + vs BB
├── SurvivalPanel.jsx          ── L4 KM 持续期预测
├── CompositeChart.jsx         ── 温度 + W5000 + HMM 牛%；bear 红色块
├── TopMovers.jsx              ── 拉牛/拉熊 top 3 + 极端反向
├── 4 row of filters: category / market / direction / search
├── FactorCard.jsx grid       ── star + 数据质量徽章 + sparkline
└── FactorDetailModal.jsx      ── 详情：大图 + 统计 + 表格；prev/next；focus trap
```

## 4. 关键模块约定

### `factors_lib/core.py`
- 因子注册装饰器 `@register_factor(...)`
- `directional_score(pct, direction, contrarian_at_extremes)` — 方向化分数
  - `higher_bullish`: pct 直接
  - `lower_bullish`: 100 - pct
  - `contrarian`: 极端区（<10 或 >90）反向，中间区按 direction 处理
- `to_percentile_series` / `to_percentile` — rolling rank（pandas pct=True，含边界平滑）
- `read_series_history(series_id, as_of=None)` — PIT 读取

### `regime/`
- `bull_bear.label_bull_bear(prices, threshold=0.20)` — Lunde-Timmermann 机械标注
- `regime_segments(labeled)` — 段压缩
- `hmm_states.fit_hmm_3state_cached(prices, seed=42)` — Gaussian HMM（带进程级 LRU 缓存）
- `survival.compute_survival_summary(segments, regime, days)` — KM + 条件概率（3M/6M/12M）
- `alerts.compute_alerts(composite)` — 6 条规则触发判断

### 前端 `components/macro/shared.js`
- `directionalScore(f) / bullishContribution(f)` — 与后端一致的方向化分数
- `wowDelta(history, key, lookback=5)` — 周环比 Δ
- `snapshotStaleness(generatedAt)` — 4 级新鲜度 tier
- `factorLagThreshold(freq)` — 频率级数据滞后阈值
- `readStarred / writeStarred / factorStarKey` — 收藏因子持久化

## 5. snapshot 模式 vs dev 模式

| 项 | dev (`npm run dev`) | prod (`npm run build`) |
|---|---|---|
| 数据来源 | `/api/macro/{factors,composite,history,narrative}` | `frontend/src/macroSnapshot.json`（静态） |
| 触发 | useEffect `load()` 调 apiFetch | useEffect 直接 `setFactors(macroSnapshot.factors)` |
| 切换条件 | `import.meta.env.PROD` (Vite) | 同上 |
| 刷新方式 | 后端任务（如 `python refresh_macro.py`）后页面 refresh | 本地 `python backend/export_macro_snapshot.py` → commit + push → Vercel deploy |
| AI 解读 | DeepSeek 实时（带 12h 缓存；force=true 跳过） | snapshot 烤入的 narrative 字符串 |

## 6. localStorage 键

| 键 | 用途 |
|---|---|
| `quantedge_macro_filter` | 当前 category 筛选 |
| `quantedge_macro_market_filter` | 当前 market 筛选（all/US/CN） |
| `quantedge_macro_dir_filter` | 当前方向筛选（all/higher/lower/contrarian） |
| `quantedge_macro_only_starred` | 是否仅显示收藏 |
| `quantedge_macro_starred` | 收藏因子集（JSON array of `factor_id@market`） |
| `quantedge_macro_seen_alerts` | 已见 alert id 集（用于 NEW 标记） |
| `quantedge_lang` | 语言（zh / en） |

## 7. 测试

后端（pytest）:
```
backend/tests/
├── test_factors_basic.py        15 case (既有)
├── test_regime.py               19 case (bull_bear + survival)
├── test_alerts.py               17 case (6 条规则 trigger/no-trigger + bug fix)
├── test_core_helpers.py         19 case (directional_score + percentile)
└── test_export_snapshot.py      6 case (snapshot 校验)
                                 ─────
                                 76 总
```

前端（vitest）:
```
frontend/src/
├── math/stats.test.ts                 100 case (既有 — Sharpe/Sortino/etc.)
└── components/macro/shared.test.js     35 case (snapshot stale / WoW Δ / directional / TEMP_LABEL)
                                       ─────
                                       135 总
```

## 8. 主动维护

每周 / 每隔几天用户做：
```bash
cd backend
python refresh_macro.py              # 拉新数据 + 算 factor_values
python export_macro_snapshot.py      # 生成 snapshot.json（含校验 + 大小 diff）
git add frontend/src/macroSnapshot.json
git commit -m "chore: refresh macro snapshot"
git push                             # → Vercel auto-deploy
```

`export_macro_snapshot.py` 会输出：
```
生成 snapshot…
  [ok] factors: 23
  [ok] composite: temp=33.6, 2 alert(s)
  [ok] narrative: 245 字 (cached=False)
  [ok] composite_history: 1305 days
  [ok] 写入 frontend/src/macroSnapshot.json  72KB (+0.3KB vs 上次)
耗时 12.3s

下一步: commit frontend/src/macroSnapshot.json + git push 即可上线更新。
```

如出现 `[warn]` 行说明子模块有问题（HMM 训练失败 / 数据滞后），但 snapshot 已生成不影响发布。

## 9. 下一步可能的迭代

- **CN composite 独立** — 当前 composite 仅 US，CN 因子只用作对照层。后续可加独立 `compute_composite(market="CN")`。
- **per-factor 历史 endpoint** — FactorDetailModal 当前只展示 sparkline 120 点，加完整历史需要 `/api/macro/factor/{id}/history` 端点。
- **告警通知** — 当前 alert 只在打开看板时显示。可对接 email / webhook 在状态翻转时通知。
- **回测 alerts 触发** — 把 L5 alerts 在历史每个交易日回放一遍，统计触发后未来 N 个月的 SPX 表现。
