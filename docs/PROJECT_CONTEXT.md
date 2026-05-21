# QuantEdge — 项目背景文档

## 1. 项目目标

构建一个综合量化投资平台，集成以下模块：

1. **量化评分** — 对标的进行多因子打分
2. **组合回测** — 历史策略回测与组合绩效分析
3. **实时监控** — 价格、指标、信号的实时追踪与告警
4. **投资日志** — 交易记录、决策复盘、持仓管理
5. **宏观看板** — 23 因子综合温度 + HMM 三态 + Kaplan-Meier 持续期预测
6. **10x 猎手** — 超级赛道筛选 → AI 校验 → 观察列表（成长型 + 价值型双 strategy）
7. **股性检测** — 4 引擎（价值 / 技术信号 / 风险）对单只标的评分
8. **Mining Alpha** — A 股 Alpha191 因子挖掘 + ML 合成 + 回测（详见 [MINING_ALPHA.md](MINING_ALPHA.md)）

## 2. 目标市场

- **美股**
- **港股**
- **A 股**（仅 Mining Alpha 模块）

## 3. 数据粒度

- **日线起步**
- 架构需预留 **分钟级** 扩展能力（存储模型、时间索引、接口抽象均需兼容）

## 4. 追踪标的

### 原型种子（6 个 · 用于评分页默认展示）

| 代码       | 名称/说明                |
| ---------- | ------------------------ |
| RKLB       | Rocket Lab（美股个股）    |
| NVDA       | NVIDIA（美股个股）        |
| SNDK       | SanDisk（美股个股）       |
| DRAM       | ETF                      |
| 07709.HK   | 2倍杠杆 ETF（港股）       |
| 00005.HK   | 汇丰控股（港股个股）      |

### Universe 覆盖（10x 猎手 / 股性检测 / 价值型 可用全集）

- **US**：SPX 500 / NDX 100 + 用户添加 ≈ 1500+ 标的（含 sector / industry / market cap）
- **HK**：HSI 50 / HSTECH 30 + 用户添加 ≈ 100+ 标的
- **CN**：CSI 300 ≈ 300 标的
- 数据落盘：`backend/data/quantedge.db` SQLite（`daily_bars` / `tickers` / `index_constituents`）
- 静态导出：`frontend/public/data/universe/universe_{us,hk,cn}.json` 供 Vercel production 自填

## 5. 关键设计决策

- **ETF 与个股的指标体系完全分离**
  - 个股使用基本面 + 技术面混合因子
  - ETF 使用与个股不同的指标集（例如跟踪误差、溢价折价、底层持仓穿透等），
    不与个股共用同一套评分逻辑
- 该决策影响：数据模型、因子库、评分引擎、前端展示组件都需按资产类型分流

## 6. 技术栈

### 前端
- React 18 + Vite
- Recharts（图表）
- Tailwind CSS + 自定义 CSS 变量（OKLCH 感知均匀色 / 5 语义 token / 5 字号档 + v5 编辑式 hero 第 6 层）
- 字体：DM Sans（UI）+ JetBrains Mono（数字 tabular-nums）+ Noto Sans SC（中文）+ Fraunces serif（v5 编辑式 hero · OPT-IN）
- vitest + jsdom（组件测试）+ Playwright（E2E）
- Vercel 部署（Hobby plan 12 函数硬上限，详见 CHANGELOG PR #104）

### 后端（已落地）
- Python 3.11
- **FastAPI**（`backend/server.py`，20+ 路由：`/api/{search,tickers,data,refresh,sync,intraday,db/*,llm/*,transactions,positions,mining-alpha/*}`）
- **SQLite**（`backend/data/quantedge.db`）— 替代原计划的 PostgreSQL + TimescaleDB（详见 TODO P3 架构决策注解）
- 多数据源容错：yfinance + AKShare + Finnhub + Futu + Tushare + multpl.com + FRED
- DeepSeek LLM 集成（B1-B7：摘要 / 评分解读 / 回测 narration / 月度复盘 / 价值-成长 thesis 等，带 SQLite cache）
- 数据时效性：`dataFreshness.priceAsOf` 字段 + 客户端 `priceUpdatedAt` 双层时间戳

### 后端（未来扩展，未落地）
- **PostgreSQL + TimescaleDB**：长周期回溯 / 多实例并发场景再升级（当前 SQLite 单机性能足够）
- **分钟级落库**：现 `/api/intraday` 按需拉取不落库（避开 yfinance 7/60 天限制），需 TimescaleDB 才有意义
- **vectorbt 向量化回测**：替代现客户端实现，支持参数扫描 + 止损止盈

## 7. 当前阶段（2026-05 更新 · v0.8.0 已发布）

- **前后端真实数据流已打通**：`refresh-data` 一键脚本 → pipeline.py → frontend/src/data.js ES module
- **`backend/server.py` FastAPI** 20+ 路由全部在用，前端 `apiFetch` 直连 + 静态 fallback（离线可用）
- **8 个前端 tab 模块**：量化评分 / 组合回测 / 实时监控 / 投资日志 / 宏观看板 / 10x 猎手（成长 + 价值双 strategy）/ 股性检测 / Mining Alpha
- **数据管道**：yfinance + Finnhub + AKShare + Futu + Tushare 多源容错；Windows GBK UnicodeEncodeError 已修
- **v0.8.0 UI/UX 优化**：色彩 7→5 语义角色 / 字号 8→5 档 / 玻璃质感 + 玻璃面板 / 命令面板 ⌘K + 全局键盘流 / 移动端底部 Tab Bar
- **v5 编辑式设计语言**（2026-05 落地）：Fraunces serif Hero + AI Lead Paragraph（紫色 3px 左边线）+ Screener10x 4 阶段漏斗 chip
- **测试覆盖**：vitest 374+ / backend pytest 963+ 全套绿；Mining Alpha 433 测试独立
- **工程化**：ruff + pytest + vitest + GitHub Actions CI + Vercel preview deploy
- 架构与数据流细节：[ARCHITECTURE.md](ARCHITECTURE.md)
- TODO 13/18 完成 72%（详见 [TODO.md](TODO.md)）
