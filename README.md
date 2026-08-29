# QuantEdge

自研综合量化投资平台 — 10 个独立功能页共享同一数据与安全边界：

| Tab | 功能 | 后端 / 数据源 |
|-----|------|-------------|
| **量化评分** | 多因子打分 + 组合权重推荐 | factors.py + iTick/Futu/AKShare/yfinance |
| **组合回测** | 历史回测 + KPI vs 基准 + Underwater | factors + yfinance + 蒙特卡洛 |
| **Smart Beta** | 三层 ETF 轮动 + 风险层 + 快照回测 | smart_beta + FRED + ETF universe |
| **Mining Alpha** | Alpha191 因子库 + IC/训练/回测产物 | mining_alpha + Parquet + Tushare |
| **实时监控** | 价格预警 + macro L5 + sector × regime | server.py 实时 + macro snapshot |
| **投资日志** | 持仓笔记 + macro context + AI 复盘 | KV + DeepSeek |
| **10x 猎手** | 三段筛选（赛道 → 候选 → 观察）+ AI 校验/排序 + 价值型 DCF | universe JSON + KV + DeepSeek |
| **股性检测** | 4 引擎（牛势 / 价值健康 / 短线动量 / 风险）+ 横向对比 | stock_gene 模块 + DeepSeek |
| **宏观看板** | 17 个宏观因子 + HMM regime + 生存分析 + 因子叙事 | FRED + multpl + akshare + macro_snapshot |
| **复利的力量** | 长期收益路径、参数对比与回测预置 | 前端纯计算 |

## 快速开始

### 1. 后端（数据管道 + API）

```bash
# 进入后端目录，建虚拟环境
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows
# source .venv/bin/activate     # macOS/Linux

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（iTick API key 等）
cp .env.example .env
# 编辑 .env 填入 ITICK_API_KEY

# 一次性跑数据管道（输出到 backend/output/ + frontend/src/data.js）
python pipeline.py

# 或启动 API 服务（端口 8001）
python server.py
```

### 2. 前端（React + Vite）

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

### 3. 根目录便捷脚本

```bash
npm run dev           # 等价于 npm --prefix frontend run dev
npm run build         # 构建前端
npm run refresh-data  # python backend/pipeline.py
npm run serve-api     # python backend/server.py
npm run test          # 前端 vitest
npm run test:py       # 后端 pytest（默认跳过网络测试）
npm run lint:py       # ruff check backend
```

## 目录结构

```
QuantEdge/
├── backend/                          # Python 数据管道 + FastAPI（self-hosted）
│   ├── pipeline.py                   # 主管道（拉数 → 因子 → 输出）
│   ├── server.py                     # FastAPI 服务
│   ├── factors.py                    # 评分因子（纯函数）
│   ├── sector_mapping.py             # 行业 → supertrend 归一化
│   ├── watchlist_10x.py              # 10x 猎手 watchlist CRUD
│   ├── stock_gene.py                 # 股性 4 引擎
│   ├── llm.py                        # DeepSeek 集成 + 24h cache
│   ├── universe/                     # 候选股池同步（US/HK/CN）
│   ├── mining_alpha/                 # Alpha191 因子挖掘
│   ├── data_sources/                 # 多源数据（iTick/Futu/AKShare/yfinance/FRED/Finnhub）
│   └── tests/                        # 1272 pytest 用例
├── frontend/                         # React + Vite + Recharts + Tailwind
│   ├── src/
│   │   ├── pages/                    # 10 个功能页（lazy loaded）
│   │   ├── components/
│   │   │   ├── stock-gene/           # 股性检测组件
│   │   │   ├── macro/                # 宏观看板组件
│   │   │   └── *.jsx                 # 通用组件 + WatchlistCard / DCF / 详情面板
│   │   ├── lib/                      # 纯函数 helper（DCF / 排序 / CSV / 价格缓存）
│   │   └── quant-platform.jsx        # 主组件 shell + 路由
│   ├── public/data/universe/         # universe_us/hk/cn.json（git tracked）
│   └── api/                          # Vercel serverless（yahoo / llm / watchlist / stock-gene）
├── docs/                             # 业务背景 / 架构 / TODO
└── pyproject.toml                    # Python 工具链配置（ruff + pytest）
```

## 追踪标的

- **评分 / 回测 / 监控 / 日志**：手选标的（默认 RKLB / NVDA / SNDK / MU / LITE / 00005.HK / 09988.HK / 03986.HK 等）；在 frontend 主页 / 标的管理里增删
- **10x 猎手**：覆盖 S&P 500 / Nasdaq 100 / 恒生指数 / 恒生科技指数 / 沪深 300 全部成分（~1500 票）+ ETF + A 股 / 港股核心池

## 生产部署

前端与同源 BFF 部署在 Vercel，FastAPI 部署在 Render。浏览器不直连 Render；Render 除 `/healthz` 外只接受 BFF 内部签名。生产必须经过 CI、Preview、响应式/axe 验收和核心 API 冒烟，并保留上一条 Ready deployment 作为回滚点。

完整环境变量、固定 Vercel CLI、部署顺序和故障定位见 [部署与运维](docs/DEPLOYMENT.md)。数据库迁移、权限变更、付费资源和外部遥测不得随普通发布自动开启。

## 文档

- 业务背景与设计决策：[docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)
- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 数据源与新鲜度：[docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
- 后端运行时：[docs/BACKEND.md](docs/BACKEND.md)
- 部署与运维：[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- 待办列表：[docs/TODO.md](docs/TODO.md)
- 后端管道说明：[backend/README.md](backend/README.md)
