# QuantEdge

自研综合量化投资平台 — 8 个独立子页协同打仗：

| Tab | 功能 | 后端 / 数据源 |
|-----|------|-------------|
| **量化评分** | 多因子打分 + 组合权重推荐 | factors.py + iTick/Futu/AKShare/yfinance |
| **组合回测** | 历史回测 + KPI vs 基准 + Underwater | factors + yfinance + 蒙特卡洛 |
| **实时监控** | 价格预警 + macro L5 + sector × regime | server.py 实时 + macro snapshot |
| **投资日志** | 持仓笔记 + macro context + AI 复盘 | KV + DeepSeek |
| **10x 猎手** | 三段筛选（赛道 → 候选 → 观察）+ AI 校验/排序 + 价值型 DCF | universe JSON + KV + DeepSeek |
| **因子挖掘** | Alpha191 因子库 + 信号回测 | mining_alpha 模块 |
| **股性检测** | 4 引擎（牛势 / 价值健康 / 短线动量 / 风险）+ 横向对比 | stock_gene 模块 + DeepSeek |
| **宏观看板** | 17 个宏观因子 + HMM regime + 生存分析 + 因子叙事 | FRED + multpl + akshare + macro_snapshot |

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
│   └── tests/                        # 933 pytest 用例
├── frontend/                         # React + Vite + Recharts + Tailwind
│   ├── src/
│   │   ├── pages/                    # 8 个子页（lazy loaded）
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

## Vercel production 部署

10x 猎手在 production（quantedge-chi.vercel.app）跑在 vercel serverless functions 上，
不依赖 self-hosted Python backend。一次性配置：

### 1. 环境变量（Vercel Settings → Environment Variables）

| 变量 | 用途 | 必需 |
|------|------|------|
| `DEEPSEEK_API_KEY` | LLM 调用（thesis 草稿 / 赛道匹配 / 卡位排序 / 关键词生成） | LLM 功能必需 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV 自动注入；watchlist + 自定义赛道持久化 | watchlist CRUD 必需 |
| `QUANTEDGE_ALLOWED_HOSTS` | 自定义域名 hostname 白名单（逗号分隔） | 仅自定义域名时 |

### 2. 启用 Vercel KV

Vercel Dashboard → 项目 → Storage → Create Database → KV → Connect。完成后
`KV_REST_API_URL` / `KV_REST_API_TOKEN` 自动注入到所有 environments。

### 3. universe 数据上线（候选筛选必需）

```bash
# 本地拉数据
python -m backend.universe.sync_us --enrich
python -m backend.universe.sync_hk --enrich
python -m backend.universe.sync_cn --enrich

# 复制到 frontend/public/data/universe/（git track）
python backend/export_universe_to_frontend.py

# commit + push 触发 vercel 部署
git add frontend/public/data/universe/
git commit -m "data: refresh universe"
git push
```

### 4. 验证

production 上打开 10x 猎手页面：
- 左栏看到 7 个内置赛道（4 个成长：AI 算力 / 半导体 / 光通信 / 算力中心；3 个价值：高股息蓝筹 / 周期价值 / 消费稳健）+ "+ 自定义赛道" 按钮（KV OK）
- 勾选任一赛道看到候选股列表（universe data OK）
- 点 ticker → 公司详情面板（含 30 天迷你 K 线 + 5 维财务）
- 编辑器里点 "AI 生成草稿" 拿到 5 段文字（DEEPSEEK_API_KEY OK）

任一步骤失败 → 检查 vercel function logs：Dashboard → Deployments → 选 deployment → Functions。

## 文档

- 业务背景与设计决策：[docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)
- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 待办列表：[docs/TODO.md](docs/TODO.md)
- 后端管道说明：[backend/README.md](backend/README.md)
