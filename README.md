# QuantEdge

自研综合量化投资平台 — **量化评分 + 组合回测 + 实时监控 + 投资日志**。

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
├── backend/                    # Python 数据管道 + FastAPI
│   ├── pipeline.py             # 主管道（拉数 → 因子 → 输出）
│   ├── server.py               # FastAPI 服务
│   ├── factors.py              # 评分因子（纯函数）
│   ├── config.py               # 标的元数据
│   ├── data_sources/           # 多源数据路由（iTick/Futu/AKShare/yfinance）
│   └── tests/                  # pytest
├── frontend/                   # React + Recharts + Tailwind
│   ├── src/
│   │   ├── quant-platform.jsx  # 主组件（待拆分）
│   │   ├── standalone.js       # Yahoo 直连兜底
│   │   ├── i18n.jsx
│   │   └── math/stats.ts
│   ├── public/                 # PWA / sw.js / manifest
│   └── api/yahoo.js            # Vercel serverless proxy
├── docs/
│   ├── PROJECT_CONTEXT.md      # 业务背景
│   ├── ARCHITECTURE.md         # 架构与数据流
│   └── TODO.md                 # 任务清单
└── pyproject.toml              # Python 工具链配置 (ruff + pytest)
```

## 追踪标的

美股个股（RKLB / NVDA / SNDK / MU / LITE）+ 港股个股（00005.HK 汇丰、09988.HK 阿里、03986.HK 兆易）+ ETF（DRAM 等）+ 港股杠杆 ETF（07709.HK 2x）。

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
- 左栏看到 4 个内置赛道 + "+ 自定义赛道" 按钮（KV OK）
- 勾选 "半导体" 看到候选股列表（universe data OK）
- 编辑器里点 "AI 生成草稿" 拿到 5 段文字（DEEPSEEK_API_KEY OK）

任一步骤失败 → 检查 vercel function logs：Dashboard → Deployments → 选 deployment → Functions。

## 文档

- 业务背景与设计决策：[docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)
- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 待办列表：[docs/TODO.md](docs/TODO.md)
- 后端管道说明：[backend/README.md](backend/README.md)
