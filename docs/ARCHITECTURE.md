# QuantEdge — 架构与数据流

> 配套阅读：[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)（业务目标）、[TODO.md](TODO.md)（待办）。

## 1. 整体拓扑

```
┌──────────────┐  pip / venv   ┌────────────────────────────────────────┐
│  backend/    │ ───────────►  │  pipeline.py  ──► output/*.json        │
│  Python 3.11 │               │  server.py    ──► /api/* (FastAPI 20+) │
└──────┬───────┘               │  data/quantedge.db  (SQLite)            │
       │                       └────────────────────────────────────────┘
       │  data_sources/* 链路（多源容错）
       ├─► yfinance (Yahoo)             ── 行情主源 + .info 兜底
       ├─► Finnhub (REST + token)       ── 美股 PE/PB/ROE 补充（限频自动 retry）
       ├─► AKShare (REST)               ── 港股 / A 股财务补充
       ├─► Futu OpenD (本地 socket)     ── 港/A 行情备选
       ├─► Tushare (Mining Alpha 专用)  ── A 股日线 + Alpha191 因子
       ├─► multpl.com                   ── 标普 PE / Shiller CAPE
       └─► FRED                         ── 宏观因子（10Y-2Y / M2 / 信用利差等）
       │
       └─► DeepSeek LLM（B1-B7：摘要 / 评分解读 / 回测 narrate / 月度复盘 / thesis）
           带 SQLite cache（按 endpoint + model + prompt sha256）

┌──────────────┐  npm / vite   ┌────────────────────────────────────────┐
│  frontend/   │ ───────────►  │  vite dev :5173                        │
│  React 18    │               │   ├─ /api/*       proxy → :8001 后端    │
│  + Recharts  │               │   └─ /yahoo-api/* proxy → query1.yahoo  │
└──────────────┘               └────────────────────────────────────────┘
       │  Vercel 部署（生产，Hobby plan 12 函数硬上限）
       ├─► frontend/api/yahoo.js  serverless proxy（带 referer 白名单）
       └─► frontend/public/data/universe/universe_{us,hk,cn}.json
           Vercel SPA fallback：演示模式直接读静态 JSON（无后端时仍可见赛道）
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
pipeline.py（每日批处理）
  ├─ Windows GBK 终端兼容：sys.stdout.reconfigure(encoding="utf-8")
  └─► for ticker in TICKERS:
        ├─ data_sources.fetch_history()        → DataFrame
        │   └─ 3 次指数退避重试（1s/2s/4s，YFINANCE_RETRY_MAX 可调）
        ├─ data_sources.fetch_quote/info()     → dict
        ├─ factors.calc_stock_score / calc_etf_score
        ├─ apply_overrides()  ← config.py: static_overrides
        └─ dataFreshness = {priceAsOf, fundamentalsAsOf, source}

  写出:
  ├─ output/stocks_data.json   ── 主输出
  ├─ output/alerts.json
  ├─ output/pipeline_log.txt
  └─ ../frontend/src/data.js   ── 前端直接 import（ES module fallback）

server.py（FastAPI 在线 API）
  20+ 路由分组：
  ├─ 标的管理：/api/{tickers,search,data,refresh,sync}
  ├─ 行情查询：/api/intraday  (1m/5m/15m/1h/1d) 按需拉取不落库
  ├─ DB 接口：/api/db/{stats,bars/{ticker:path}}
  ├─ LLM：/api/llm/{summary,journal-structure,explain-score,backtest-narrate,
  │                  parse-strategy,monthly-review}
  ├─ 交易记录：/api/transactions (GET/POST/DELETE) + /api/positions
  └─ Mining Alpha：/api/mining-alpha/* 5 路由（详见 MINING_ALPHA.md）

logs/server.log: 10MB × 5 份 RotatingFileHandler（logging_config.py 模块级 setup）
```

## 4. 前端模块边界（v0.8.0 状态）

**已落地拆分**：`src/quant-platform.jsx` 主壳 2597 行（曾 6700+），8 个 tab 抽到独立 page 文件。

```
src/
├── quant-platform.jsx        # 主壳：DataContext + Tab nav + Footer + Header
├── i18n.jsx                  # zh/en 双语
├── main.jsx                  # 入口
├── standalone.js             # Yahoo 拉取（无后端模式）
│
├── pages/                    # 8 个 tab，独立页面组件
│   ├── ScoringDashboard.jsx       # 量化评分（2460 行）
│   ├── BacktestEngine.jsx         # 组合回测（3033 行 · 含 client-side 回测引擎）
│   ├── Monitor.jsx                # 实时监控（636 行）
│   ├── Journal.jsx                # 投资日志（1275 行）
│   ├── MacroDashboard.jsx         # 宏观看板（525 行）
│   ├── Screener10x.jsx            # 10x 猎手（1368 行）
│   ├── StockGene.jsx              # 股性检测（1542 行）
│   └── MiningAlpha.jsx            # A 股 Alpha 挖掘（794 行）
│
├── components/               # 共享组件
│   ├── AIStockSummaryCard.jsx     # B1 个股 AI 摘要（v5 .lead-paragraph）
│   ├── BacktestNarrationCard.jsx  # B4 回测 AI 总结（v5 .lead-paragraph）
│   ├── ScoreExplainCard.jsx       # B2 评分 AI 解读（v5 .lead-paragraph）
│   ├── MonthlyReviewModal.jsx     # B7 月度复盘
│   ├── ValueDCFCalculator.jsx     # 两阶段 DCF + 敏感性矩阵
│   ├── TenxItemEditor.jsx         # 10x 观察项编辑器
│   ├── WatchlistCard.jsx          # 观察项卡片
│   ├── macro/                     # 宏观看板 8 个子组件
│   └── stock-gene/                # 股性检测子组件 + 4 引擎
│
├── lib/                      # 纯函数 + 算法
│   ├── dcf.js                     # 两阶段 DCF
│   ├── alertBacktest.js           # 告警回测
│   ├── macroAdjust.js             # 宏观调整因子
│   ├── macroPortfolio.js          # 持仓宏观敏感性
│   ├── sectorRegimeExposure.js    # 板块 regime 敞口
│   ├── priceCache.js              # IndexedDB 价格缓存
│   ├── csvExport.js               # CSV 导出
│   └── idb.js                     # IndexedDB 包装
│
├── math/stats.ts             # 纯数学函数（TypeScript）
├── data.js                   # backend pipeline 自动生成的 ES module（fallback）
└── index.css                 # 设计 token + v5 编辑式工具类（.t-eyebrow / .t-hero /
                              #   .lead-paragraph / .pillar-card / Fraunces serif）
```

## 5. 部署

- **前端**：Vercel — 根目录 = `frontend/`，build = `npm run build`，output = `dist/`
  - 12 函数硬上限（Hobby plan），`.vercelignore` 排除 stock-gene 10 个 → 部署 12 贴顶
  - 生产 `quantedge-chi.vercel.app` 上 stock-gene tab = demo 模式（详见 CHANGELOG PR #104）
- **后端**：本地 `python backend/server.py`（端口 8001），暂无生产部署
- **定时任务**：`backend/scripts/install_pipeline_scheduler.ps1`（Windows）/ `install_cron.sh`（macOS/Linux）
- **CI**：`.github/workflows/ci.yml` — push/PR 跑 ruff + pytest（非网络）+ vitest + vite build

## 6. 关键约定

- **ETF 与个股因子库分离**（见 `factors.py`）
- 杠杆 ETF 不用 `static_overrides` 兜底 NAV（见 `pipeline.apply_overrides`）
- 所有 Yahoo 调用都要走 referer 白名单（生产 Vercel proxy 会拦）
- **v5 编辑式设计语言**（2026-05 落地）：AI 文本输出统一用 `.lead-paragraph`（紫 3px 左边线 + 渐变 bg + 13.5px serif body）；hero 数字用 `.t-hero` + Fraunces serif（OPT-IN）
- **5 字号 + 5 语义色 token**（详见 `index.css` 注释）：禁止散落 `text-[8px]` / `text-[12.5px]` 中间值；禁止散落 `emerald` / `fuchsia` / `sky` 装饰色
- **数据时效性**：`dataFreshness.priceAsOf` 字段贯穿后端到前端 Footer，与客户端 `priceUpdatedAt` 双层时间戳
- **LLM 缓存**：SQLite `llm_cache` 表按 `sha256(endpoint|model|prompt)` 截断 32 字符为 key；TTL 各 endpoint 不同（评分 24h / 摘要 1h / 回测 30min / 月度复盘 24h）
