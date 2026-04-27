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

## 文档

- 业务背景与设计决策：[docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)
- 架构与数据流：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 待办列表：[docs/TODO.md](docs/TODO.md)
- 后端管道说明：[backend/README.md](backend/README.md)
