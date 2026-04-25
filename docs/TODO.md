# QuantEdge — TODO

> 与 [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) 配套使用。
> 优先级：**P0**（阻塞 / 紧急修复）→ **P1**（核心能力）→ **P2**（增强）→ **P3**（长期）。
> 工作量：**S** ≈ 半天内、**M** ≈ 1–2 天、**L** ≈ 3 天以上。

---

## P0 — 阻塞 & 紧急修复

- [ ] **[P0]** 修复 pipeline.py 在 Windows GBK 终端下的 UnicodeEncodeError
  - 背景：`pipeline.py` 日志使用 ✓ / ✗ 等 Unicode 字符，Windows 默认 GBK 控制台 `print()` 直接抛 `UnicodeEncodeError`，导致整个管道在第一个标的就崩溃。当前 `backend/output/` 是空的，所有"数据打通"的下游任务都被这一行阻塞。
  - 验收标准：在 PowerShell / cmd / Git Bash 任一 Windows 终端运行 `python pipeline.py` 都能完整跑完 6 个标的，不抛编码异常；同时 macOS / Linux 行为不变。
  - 预估工作量：S

- [ ] **[P0]** 打通前后端真实数据流（refresh-data 一键脚本）
  - 背景：前端目前仍在用 `quant-platform.jsx` 内嵌的硬编码 STOCKS / ALERTS。需要 `backend/sync_to_frontend.py` + 根目录 `package.json` 的 `refresh-data` 脚本，把 `output/frontend_data.js` 转为 ES 模块写入 `frontend/src/data/stocks.js`，并让 `quant-platform.jsx` 改为 `import { STOCKS, ALERTS } from './data/stocks.js'`。
  - 验收标准：根目录执行 `npm run refresh-data` 后，前端 `npm run dev` 看到的数据与 `backend/output/stocks_data.json` 完全一致；删除内嵌的 STOCKS / ALERTS 不影响渲染。
  - 预估工作量：S
  - 依赖：上一项 P0

---

## P1 — 核心能力

### 数据层

- [ ] **[P1]** yfinance 调用增加重试 + 超时 + 退避
  - 背景：`fetch_stock_data` / `fetch_etf_data` 现在裸调 `yf.Ticker(...).info` 和 `.history(...)`，单次失败就当整个标的失败。yfinance 偶发 429 / 网络抖动很常见，单次失败会导致评分排行不完整。
  - 验收标准：每个标的至少重试 3 次（指数退避，1s / 2s / 4s），可配置；连续失败时日志明确写出"重试 N 次后放弃"，不污染其他标的；新增 `requirements.txt` 依赖（如 `tenacity`）需登记。
  - 预估工作量：S

- [ ] **[P1]** 港股财务数据补充源（AAStocks / 东方财富）
  - 背景：`config.py` 里 `00005.HK` 通过 `static_overrides` 写死 PE / ROE / 营收增长等字段，长期数据会过时。需要一个独立的 fetcher 从 AAStocks 或东方财富抓港股财务，作为 yfinance 之外的兜底；ETF（07709、未来可能新增）同理。
  - 验收标准：新增 `backend/sources/hk_fundamentals.py`，输入港股代码、输出与 yfinance 字段对齐的 dict；`pipeline.py` 在 yfinance 字段为 None 时优先调用此源，仍缺失再回落到 `static_overrides`；写一个最小集成测试验证 0005.HK 能拿到 PE / ROE。
  - 预估工作量：M

- [ ] **[P1]** 数据时效性标记（每个字段附带 `as_of`）
  - 背景：现在所有字段混在一个 dict 里，无法区分"实时行情 vs 上季度财报 vs 静态兜底"。前端 Footer 也无法告诉用户"这条数据多旧了"。
  - 验收标准：每个标的输出新增 `data_freshness` 子对象，至少包含 `price_as_of`、`fundamentals_as_of`、`source`（`yfinance` / `aastocks` / `static`）；前端 Footer 显示最旧字段的时间和"距现在 N 分钟"。
  - 预估工作量：M

### 评分层

- [ ] **[P1]** 评分平滑 + 评分变化率字段
  - 背景：当前 `score` 是基于"今天一天"的快照，单日波动会让排行剧烈跳动。需要保留历史评分（至少 5 日），输出平滑后的 `score_smoothed`（5 日均值）和 `score_delta_5d`（与 5 日前差值），前端排行能显示"上升 / 下降 / 持平"。
  - 验收标准：`backend/output/` 新增 `score_history.json` 持久化每日评分；输出新增 `score_smoothed` / `score_delta_5d` 字段；前端排行表新增趋势箭头列。
  - 预估工作量：M
  - 依赖：上一项时效性标记（用于落历史时间戳）

- [ ] **[P1]** factors.py 单元测试
  - 背景：`calc_rsi` / `calc_momentum` / `calc_stock_score` / `calc_etf_score` 都是纯函数，但目前没有任何测试。任何后续重构（评分平滑、权重调参）都会带风险。
  - 验收标准：`backend/tests/test_factors.py`，pytest 覆盖核心场景：RSI 边界（数据不足 / 全涨 / 全跌）、动量超出区间裁剪、个股评分各档位、ETF 杠杆惩罚生效；`pytest backend/tests` 全绿。
  - 预估工作量：S

### 监控层

- [ ] **[P1]** 监控模块对接真实 alerts.json
  - 背景：`Monitor` 组件里 `sectors` / `fearGreed` 都是写死的，且不读取 `alerts.json`。后端已经能产出真实 alerts，但前端没用上。
  - 验收标准：Monitor 模块从 `stocks.js` 中导入 ALERTS 渲染告警列表；板块流入栏目根据 STOCKS 按 sector 聚合 `change` 实时计算；fearGreed 暂时保留 mock 但加 TODO 注释说明数据源待定。
  - 预估工作量：S

---

## P2 — 增强

### 回测层

- [ ] **[P2]** 用真实历史走势替换 BacktestEngine 的 mock 数据
  - 背景：`BacktestEngine` 里 `stratReturns` / `benchReturns` / `metrics` / `holdings` 全是硬编码。后端需要新增一个回测脚本，用 6 个标的的真实日线生成等权 / 评分加权组合的净值曲线和绩效指标，输出 `backend/output/backtest.json`，前端读取。
  - 验收标准：`backend/backtest.py` 接收一个 weights dict 和 lookback 区间，产出 `monthly_nav` / `metrics`（夏普 / 最大回撤 / 卡玛 / 胜率 / 波动率 / 索提诺）；前端 `BacktestEngine` 切换到读取 `backtest.json`，"运行回测"按钮触发后端脚本（暂时手动 `npm run refresh-data` 同步即可）。
  - 预估工作量：M

- [ ] **[P2]** 接入 vectorbt 做向量化回测
  - 背景：上一项是手写实现，扩展性有限。vectorbt 支持参数扫描、止损止盈、组合优化，能为后续策略迭代节省大量时间。
  - 验收标准：`backend/backtest.py` 重构为 vectorbt 实现；至少跑通"评分前 3 加权 + 月度调仓"策略；输出与上一项 schema 兼容；vectorbt 加入 `requirements.txt`。
  - 预估工作量：L
  - 依赖：上一项

### 监控层

- [ ] **[P2]** Telegram / 企业微信 Webhook 推送
  - 背景：`generate_alerts` 已经能产出告警，但只写入 JSON，没人会主动看。RSI 超买、52 周新高这类高优先告警应该即时推送。
  - 验收标准：`backend/notifiers/` 下新增 `telegram.py` 和 `wecom.py`，从环境变量读 token / webhook url；`pipeline.py` 在 alerts severity 为 `high` 时触发推送；新增 `.env.example` 说明配置项；推送失败不影响管道主流程。
  - 预估工作量：M

- [ ] **[P2]** 定时任务（Windows Task Scheduler / cron）
  - 背景：`backend/README.md` 里有 cron 示例但没真正部署。本地至少应该每个交易日收盘后自动跑一次。
  - 验收标准：`backend/scripts/` 下提供 `run_scheduled.bat`（Windows）+ `install_cron.sh`（macOS/Linux），README 写明安装步骤；脚本内部调用 `npm run refresh-data` 等价命令；首次运行能在 `output/cron.log` 看到日志。
  - 预估工作量：S

### 前端

- [ ] **[P2]** 价格历史图表升级到 60–90 天完整数据
  - 背景：`pipeline.py` 现在用 `np.linspace` 把 3 个月数据采样成 12 个点，图表很糙；前端 Recharts 完全可以渲染 60+ 个点。
  - 验收标准：`pipeline.py` 的 `priceHistory` 输出全部交易日（不再下采样），字段从 `m`（短日期）改为 `date`（ISO 8601）；前端图表 X 轴用 `interval="preserveStartEnd"` 自动稀疏化标签；老的 `m` 字段保留作为兼容期 alias，下版本删除。
  - 预估工作量：S

- [ ] **[P2]** Footer 显示数据延迟时间
  - 背景：用户需要一眼看出"数据是几分钟前的"，否则容易误判实时性。
  - 验收标准：前端 Footer 固定显示 `数据更新于 HH:MM:SS （N 分钟前）`，N 实时刷新；时间源自 P1 的 `data_freshness.price_as_of`。
  - 预估工作量：S
  - 依赖：P1 的"数据时效性标记"

---

## P3 — 长期 / 架构演进

- [ ] **[P3]** FastAPI 后端封装
  - 背景：当前是"批处理脚本 → 静态 JSON → 前端 import"的模式。引入 FastAPI 后，前端可以按需查询、支持参数化（自定义权重 / 时间区间 / 标的过滤），也是接入数据库前的必经一步。
  - 验收标准：`backend/api/` 下新建 FastAPI app，至少暴露 `/stocks` / `/alerts` / `/backtest`；前端切换到 `fetch` 调用，保留 stocks.js 作为离线 fallback；CORS 配好。
  - 预估工作量：L

- [ ] **[P3]** PostgreSQL + TimescaleDB 数据持久化
  - 背景：脚本输出的 JSON 没法做长周期回溯（评分历史、回测结果、告警归档都需要时序存储）。TimescaleDB 是日线 / 分钟级时序的天然选择。
  - 验收标准：docker-compose 启动 Postgres + TimescaleDB；`backend/db/` 提供 SQLAlchemy models 和迁移；`pipeline.py` 写入数据库（保留 JSON 输出作为缓存）；FastAPI 改为从 DB 查询。
  - 预估工作量：L
  - 依赖：上一项 FastAPI

- [ ] **[P3]** 投资日志模块对接真实数据
  - 背景：前端 `Journal` 现在是硬编码 JOURNAL 数组，无法记录新交易。需要一个持久化层（先文件后 DB）。
  - 验收标准：日志条目用本地 JSON / DB 持久化；前端支持新增 / 编辑 / 删除条目；字段对齐 `JOURNAL` 现有结构。
  - 预估工作量：M
  - 依赖：FastAPI

- [ ] **[P3]** 数据粒度从日线扩展到分钟级
  - 背景：`PROJECT_CONTEXT.md` 明确说"架构预留分钟级"，但当前 `tk.history(period="3mo")` 拿的是日线。yfinance 支持 `interval="1m"` 但有 7 天 / 60 天的限制；需要引入更完善的源（IBKR / Polygon / iFinD）。
  - 验收标准：架构上 fetcher 接受 `interval` 参数；至少跑通某一个标的的分钟级抓取与存储（推荐先入 TimescaleDB）。
  - 预估工作量：L
  - 依赖：TimescaleDB

---

## 优先级分布

| 优先级 | 数量 | 工作量分布            | 类别                                  |
| ------ | ---- | --------------------- | ------------------------------------- |
| **P0** | 2    | S × 2                 | 阻塞修复 + 数据流打通                  |
| **P1** | 6    | S × 3 / M × 3         | 数据层 / 评分层 / 监控层 核心能力       |
| **P2** | 6    | S × 3 / M × 2 / L × 1 | 回测真实化 / 推送 / 定时 / 前端体验    |
| **P3** | 4    | M × 1 / L × 3         | API 化 / 数据库 / 日志持久化 / 分钟级   |
| **总计** | **18** | **S × 8 / M × 6 / L × 4** | —                                  |

## 下一次对话的默认入口

> "找一个 small todo 并完成它"

→ 优先选择当前未完成的 **S** 级任务，并按 **P0 → P1 → P2 → P3** 顺序推进。
完成一个 S 任务后请勾选本文件对应的 `- [ ]`，并在 commit / 对话末尾报告。
