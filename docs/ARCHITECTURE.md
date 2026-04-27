# QuantEdge — 架构与数据流

> 配套阅读：[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)（业务目标）、[TODO.md](TODO.md)（待办）。

## 1. 整体拓扑

```
┌──────────────┐  pip / venv   ┌────────────────────────────────────────┐
│  backend/    │ ───────────►  │  pipeline.py  ──► output/*.json        │
│  Python      │               │  server.py    ──► /api/* (FastAPI)     │
└──────┬───────┘               └────────────────────────────────────────┘
       │  data_sources/router.py 链路（多源容错）
       ├─► iTick  (REST + token)        ── 全市场行情/财务
       ├─► Futu OpenD (本地 socket)     ── 港/A 备选
       ├─► AKShare (REST)               ── 港股财务补充
       └─► yfinance (Yahoo)             ── 最终兜底

┌──────────────┐  npm / vite   ┌────────────────────────────────────────┐
│  frontend/   │ ───────────►  │  vite dev :5173                        │
│  React + RC  │               │   ├─ /api/*       proxy → :8001 后端    │
│              │               │   └─ /yahoo-api/* proxy → query1.yahoo  │
└──────────────┘               └────────────────────────────────────────┘
       │  Vercel 部署（生产）
       └─► frontend/api/yahoo.js  serverless proxy（带 referer 白名单）
```

## 2. 数据加载的四条路径

前端有意保留**降级链**，开发/部署/离线均可用。优先级从上到下：

| # | 路径 | 触发场景 | 文件 |
|---|---|---|---|
| 1 | `apiFetch('/api/...')` | 后端 `server.py` 在跑 | quant-platform.jsx |
| 2 | `import './data.js'` | 静态 fallback（pipeline 写过一次） | quant-platform.jsx + src/data.js |
| 3 | Yahoo Finance 实时拉取 | 用户点"刷新"且后端不可用 | src/standalone.js |
| 4 | localStorage 缓存 | 离线/慢网 | quant-platform.jsx loadCache() |

**Yahoo 拉取的代理链**（standalone.js + quant-platform.jsx 重复实现，待统一）：
1. `/yahoo-api/*` (vite dev proxy) — 仅 dev
2. `/api/yahoo` (Vercel serverless) — 生产首选
3. `corsproxy.io`、`api.allorigins.win` — 公共 CORS 代理兜底

## 3. 后端数据管道

```
pipeline.py
  └─► for ticker in TICKERS:
        ├─ data_sources.fetch_history()    → DataFrame
        ├─ data_sources.fetch_quote/info() → dict
        ├─ factors.calc_stock_score / calc_etf_score
        └─ apply_overrides()  ← config.py: static_overrides
        
  写出（**当前重复，待去重**，见 TODO Batch 4）:
  ├─ output/stocks_data.json   ── 主输出
  ├─ output/frontend_data.js   ── ES module 副本（同内容）
  ├─ output/alerts.json
  ├─ output/pipeline_log.txt
  └─ ../frontend/src/data.js   ── 前端直接 import（同上 ES module）
```

## 4. 前端模块边界（当前 vs 目标）

**当前**：`src/quant-platform.jsx` 单文件 6700+ 行，包含四大模块所有组件。

**目标**（Batch 4 拆分后）：

```
src/
├── App.jsx                    # 路由 + 全局 layout
├── data/
│   ├── DataProvider.jsx       # STOCKS/ALERTS Context（替换 module-level let）
│   └── api.js                 # apiFetch 统一出口
├── features/
│   ├── scoring/               # 量化评分
│   ├── backtest/              # 组合回测
│   ├── monitor/               # 实时监控
│   └── journal/               # 投资日志
├── shared/
│   ├── ui/                    # glass-card / btn-tactile 等通用组件
│   └── charts/                # Recharts 包装
├── i18n.jsx
├── standalone.js              # Yahoo 拉取（外部数据源）
└── math/stats.ts
```

## 5. 部署

- **前端**：Vercel — 根目录 = `frontend/`，build = `npm run build`，output = `dist/`
- **后端**：本地 `python backend/server.py`（端口 8001），暂无生产部署
- **CI**：`.github/workflows/ci.yml` — push/PR 跑 ruff + pytest（非网络）+ vitest + vite build

## 6. 关键约定

- ETF 与个股因子库分离（见 `factors.py`）
- 杠杆 ETF 不用 `static_overrides` 兜底 NAV（见 `pipeline.apply_overrides`）
- 前端 mutable module-level `STOCKS`/`ALERTS` 是过渡态，目标用 Context（Batch 4）
- 所有 Yahoo 调用都要走 referer 白名单（生产 Vercel proxy 会拦）
