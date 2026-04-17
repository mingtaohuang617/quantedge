# QuantEdge

自研综合量化投资平台，集成 **量化评分 + 组合回测 + 实时监控 + 投资日志** 四大模块。

## 项目结构

```
QuantEdge/
├── frontend/          # React 前端（React + Recharts + Tailwind）
├── backend/           # Python 数据管道与 API
│   └── output/        # 数据管道输出目录
├── docs/               # 项目文档
│   └── PROJECT_CONTEXT.md
└── README.md
```

## 市场与标的

- **市场**：美股 + 港股
- **数据粒度**：日线起步，架构预留分钟级
- **追踪标的**：RKLB、NVDA、SNDK、DRAM (ETF)、07709.HK (2x 杠杆 ETF)、00005.HK (汇丰)

## 技术栈

- **前端**：React + Recharts + Tailwind
- **后端**：Python + yfinance（未来扩展 FastAPI + PostgreSQL/TimescaleDB）

详见 [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)。
