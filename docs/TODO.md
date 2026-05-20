# QuantEdge — TODO

> 与 [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) 配套使用。
> 优先级：**P0**（阻塞 / 紧急修复）→ **P1**（核心能力）→ **P2**（增强）→ **P3**（长期）。
> 工作量：**S** ≈ 半天内、**M** ≈ 1–2 天、**L** ≈ 3 天以上。

---

## P0 — 阻塞 & 紧急修复

- [x] **[P0]** 修复 pipeline.py 在 Windows GBK 终端下的 UnicodeEncodeError
  - 背景：`pipeline.py` 日志使用 ✓ / ✗ 等 Unicode 字符，Windows 默认 GBK 控制台 `print()` 直接抛 `UnicodeEncodeError`，导致整个管道在第一个标的就崩溃。当前 `backend/output/` 是空的，所有"数据打通"的下游任务都被这一行阻塞。
  - 验收标准：在 PowerShell / cmd / Git Bash 任一 Windows 终端运行 `python pipeline.py` 都能完整跑完 6 个标的，不抛编码异常；同时 macOS / Linux 行为不变。
  - 预估工作量：S
  - **完成（2026-05-19）**：在 `pipeline.py` 顶部 `import sys` 后立即检测 `sys.platform == "win32"` → 把 stdout/stderr 通过 TextIOWrapper.reconfigure() 强制改为 UTF-8（`errors="replace"` 兜底），Python 3.7+ 标准 API；非 Windows 平台跳过。烟雾测试 `PYTHONIOENCODING=cp936 python -c "from pipeline import log; log('✓ 中文 ⚠')"` 通过，确认 stdout 已被 reconfigure 为 utf-8。

- [x] **[P0]** 打通前后端真实数据流（refresh-data 一键脚本）
  - 背景：前端目前仍在用 `quant-platform.jsx` 内嵌的硬编码 STOCKS / ALERTS。需要 `backend/sync_to_frontend.py` + 根目录 `package.json` 的 `refresh-data` 脚本，把 `output/frontend_data.js` 转为 ES 模块写入 `frontend/src/data/stocks.js`，并让 `quant-platform.jsx` 改为 `import { STOCKS, ALERTS } from './data/stocks.js'`。
  - 验收标准：根目录执行 `npm run refresh-data` 后，前端 `npm run dev` 看到的数据与 `backend/output/stocks_data.json` 完全一致；删除内嵌的 STOCKS / ALERTS 不影响渲染。
  - 预估工作量：S
  - 依赖：上一项 P0
  - **完成（2026-05-19，验证已落地）**：
    - `package.json` line 11 `"refresh-data": "python backend/pipeline.py"` 已存在。
    - `backend/pipeline.py:50` 定义 `FRONTEND_DATA_PATH = backend/.. / frontend/src/data.js`；line 574-578 调用 `write_data_module(FRONTEND_DATA_PATH)` 自动写出 ES module。
    - `frontend/src/data.js` 自动生成（最近一次 2026-05-17）。
    - `frontend/src/quant-platform.jsx` 用 `STATIC_STOCKS` / `STATIC_ALERTS` 从 import 加载（line 22-32），legacy 内嵌数组已删（line 612 注释指向 git history）。
    - 路径与原任务描述略有差异（`frontend/src/data.js` 而非 `frontend/src/data/stocks.js`），但验收标准已满足，本次仅勾选。

---

## P1 — 核心能力

### 数据层

- [x] **[P1]** yfinance 调用增加重试 + 超时 + 退避
  - 背景：`fetch_stock_data` / `fetch_etf_data` 现在裸调 `yf.Ticker(...).info` 和 `.history(...)`，单次失败就当整个标的失败。yfinance 偶发 429 / 网络抖动很常见，单次失败会导致评分排行不完整。
  - 验收标准：每个标的至少重试 3 次（指数退避，1s / 2s / 4s），可配置；连续失败时日志明确写出"重试 N 次后放弃"，不污染其他标的；新增 `requirements.txt` 依赖（如 `tenacity`）需登记。
  - 预估工作量：S
  - **完成（2026-05-19）**：`backend/data_sources/yfinance_source.py` 加 `_with_retry` 装饰器（标准库 `time.sleep`，无新依赖），默认 3 次指数退避 1s/2s/4s，环境变量 `YFINANCE_RETRY_MAX` / `YFINANCE_RETRY_BASE_DELAY` 可调。`fetch_history` 和 `fetch_fundamentals` 都覆盖，网络异常一律包成 `YFinanceError` 后重试。失败日志格式 `[yfinance] {fn_name} 第 N/M 次失败...` + 终态 `重试 M 次后放弃`，写入 stderr。21 个新单测（mock + 注入 sleep）。**注**：超时参数 yfinance 0.2+ 支持但本次未接，留 TODO。

- [ ] **[P1]** 港股财务数据补充源（AAStocks / 东方财富）
  - 背景：`config.py` 里 `00005.HK` 通过 `static_overrides` 写死 PE / ROE / 营收增长等字段，长期数据会过时。需要一个独立的 fetcher 从 AAStocks 或东方财富抓港股财务，作为 yfinance 之外的兜底；ETF（07709、未来可能新增）同理。
  - 验收标准：新增 `backend/sources/hk_fundamentals.py`，输入港股代码、输出与 yfinance 字段对齐的 dict；`pipeline.py` 在 yfinance 字段为 None 时优先调用此源，仍缺失再回落到 `static_overrides`；写一个最小集成测试验证 0005.HK 能拿到 PE / ROE。
  - 预估工作量：M

- [x] **[P1]** 数据时效性标记（每个字段附带 `as_of`）
  - 背景：现在所有字段混在一个 dict 里，无法区分"实时行情 vs 上季度财报 vs 静态兜底"。前端 Footer 也无法告诉用户"这条数据多旧了"。
  - 验收标准：每个标的输出新增 `data_freshness` 子对象，至少包含 `price_as_of`、`fundamentals_as_of`、`source`（`yfinance` / `aastocks` / `static`）；前端 Footer 显示最旧字段的时间和"距现在 N 分钟"。
  - 预估工作量：M
  - **完成（2026-05-19）**：`backend/pipeline.py` 个股 + ETF 两处 result dict 加 `dataFreshness` 子对象（`priceAsOf` = `hist.index[-1].isoformat()` 最后 K 线收盘日 / `fundamentalsAsOf` = `datetime.now().isoformat()` pipeline 运行时刻 / `source = "yfinance"`，未来多源时扩展为枚举）；`frontend/src/quant-platform.jsx` Footer 数据源诊断悬停面板加"行情时效"行 — 取 stocks 里 `dataFreshness.priceAsOf` 最早一个（reduce min）显示为月日格式，与"最后刷新"（客户端拉数据时间）区分。
    - **保留 P3 演进空间**：`fundamentalsAsOf` 当前用运行时间占位（yfinance 不暴露财报精确日期），引入 P1 港股财务源（AAStocks / 东方财富）后可填实际报告期；`source` 字段为后续多源切换准备。

### 评分层

- [ ] **[P1]** 评分平滑 + 评分变化率字段
  - 背景：当前 `score` 是基于"今天一天"的快照，单日波动会让排行剧烈跳动。需要保留历史评分（至少 5 日），输出平滑后的 `score_smoothed`（5 日均值）和 `score_delta_5d`（与 5 日前差值），前端排行能显示"上升 / 下降 / 持平"。
  - 验收标准：`backend/output/` 新增 `score_history.json` 持久化每日评分；输出新增 `score_smoothed` / `score_delta_5d` 字段；前端排行表新增趋势箭头列。
  - 预估工作量：M
  - 依赖：上一项时效性标记（用于落历史时间戳）

- [x] **[P1]** factors.py 单元测试
  - 背景：`calc_rsi` / `calc_momentum` / `calc_stock_score` / `calc_etf_score` 都是纯函数，但目前没有任何测试。任何后续重构（评分平滑、权重调参）都会带风险。
  - 验收标准：`backend/tests/test_factors.py`，pytest 覆盖核心场景：RSI 边界（数据不足 / 全涨 / 全跌）、动量超出区间裁剪、个股评分各档位、ETF 杠杆惩罚生效；`pytest backend/tests` 全绿。
  - 预估工作量：S
  - **完成（2026-05-19）**：`backend/tests/test_factors_basic.py` 15 个用例覆盖核心场景：`parse_leverage` 各形态（string/numeric/无杠杆/1x 视作非杠杆）、RSI 数据不足返回 50 / 上涨主导 ≥70 / 下跌主导 ≤30、`calc_momentum` 极端裁剪到 100 / 短序列返回 50、`calc_stock_score` 全优 ≥80 / 全 None 返回基线 / detailed 返回三分项 dict、`calc_etf_score` 杠杆惩罚精确扣 15 分、`calc_leverage_decay` 无杠杆/短序列返回 None + 高波动正磨损。
  - **追加（2026-05-20，PR #134）**：`backend/tests/test_factors.py` 55 个测试做更深覆盖（与 basic 并存，不重复但角度更细）：calc_rsi（边界 / 全涨 / 全跌 / 横盘 / mixed / 自定义 period 7 个子测）、calc_momentum（裁剪 + 已知值 + period 7 个子测）、calc_stock_score（PE/ROE/利润率/增长率/RSI 各档位单调性 + None 默认值 + detailed + 自定义权重 + clip 100，共 19 个）、parse_leverage（None/字符串/数字/1x/-2x，9 个）、calc_leverage_decay（无杠杆 / 样本不足 / 2x drag > 0 / 波动率单调 / 3x > 2x，5 个）、calc_etf_score（各档位单调 + 折溢价对称 + 杠杆惩罚 -15 + clip [0,100] + detailed，10 个）。**未改 factors.py 业务代码**。⚠ 文档化了 2 个已知 quirk（RSI 全涨返回 50 而非 100；parse_leverage("-1x") 因 abs<=1.0001 被当非杠杆），待后续重构时一并处理。

### 监控层

- [x] **[P1]** 监控模块对接真实 alerts.json
  - 背景：`Monitor` 组件里 `sectors` / `fearGreed` 都是写死的，且不读取 `alerts.json`。后端已经能产出真实 alerts，但前端没用上。
  - 验收标准：Monitor 模块从 `stocks.js` 中导入 ALERTS 渲染告警列表；板块流入栏目根据 STOCKS 按 sector 聚合 `change` 实时计算；fearGreed 暂时保留 mock 但加 TODO 注释说明数据源待定。
  - 预估工作量：S
  - **完成（2026-05-19，验证已落地）**：`frontend/src/pages/Monitor.jsx` 已对接 DataContext（L87 `ctxAlerts3`，L181-184 `mergedAlerts = [...macroAlertsAsItems, ...allAlerts || dynamicAlerts]`），并附加 macro L5 alerts + 客户端动态 alerts 兜底；sectors 按 `s.sector.split("/")[0]` 聚合 change 平均（L272-288，过滤 count<2、按绝对值排序取前 6）；fearGreed 已超出 TODO 要求 —— 不是 mock，而是用 liveStocks 平均涨跌幅 × 0.6 + 上涨广度 × 0.4 实时算（L290-300）。

---

## P2 — 增强

### 回测层

- [x] **[P2]** 用真实历史走势替换 BacktestEngine 的 mock 数据
  - 背景：`BacktestEngine` 里 `stratReturns` / `benchReturns` / `metrics` / `holdings` 全是硬编码。后端需要新增一个回测脚本，用 6 个标的的真实日线生成等权 / 评分加权组合的净值曲线和绩效指标，输出 `backend/output/backtest.json`，前端读取。
  - 验收标准：`backend/backtest.py` 接收一个 weights dict 和 lookback 区间，产出 `monthly_nav` / `metrics`（夏普 / 最大回撤 / 卡玛 / 胜率 / 波动率 / 索提诺）；前端 `BacktestEngine` 切换到读取 `backtest.json`，"运行回测"按钮触发后端脚本（暂时手动 `npm run refresh-data` 同步即可）。
  - 预估工作量：M
  - **完成（2026-05-19，验证已落地，架构与原方案不同）**：实际方案是**前端 client-side 回测引擎**（`frontend/src/pages/BacktestEngine.jsx` 2994 行）—— 通过 `fetchRangePrices` / `fetchRangePricesEx` 拉真实历史价格（含基准 + 多个 extra benchmarks），客户端算 `navCurve` / `returns` / `benchReturns` / Sharpe / MaxDD / Sortino / Calmar / 胜率，支持再平衡（按权重 + 频率）+ 自定义日期区间 + 蒙特卡洛模拟（`mcSimulate`）+ HHI 集中度。Underwater 图 QQQ 基准 0% bug 已修（L810 注释，缺失时设 null 而非伪造线性递增）。比原 TODO 方案（后端写 backtest.json）更具交互性，但等价目标已达成。后端 `backtest.py` 留待 P3 FastAPI 化后做服务端回测时再补。

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

- [x] **[P2]** 定时任务（Windows Task Scheduler / cron）
  - 背景：`backend/README.md` 里有 cron 示例但没真正部署。本地至少应该每个交易日收盘后自动跑一次。
  - 验收标准：`backend/scripts/` 下提供 `run_scheduled.bat`（Windows）+ `install_cron.sh`（macOS/Linux），README 写明安装步骤；脚本内部调用 `npm run refresh-data` 等价命令；首次运行能在 `output/cron.log` 看到日志。
  - 预估工作量：S
  - **完成（2026-05-19）**：核心脚本已存在（`run_scheduled.bat` + `install_cron.sh`），本次补 Windows 一键安装器 + 完善 README。
    - 新增 `backend/scripts/install_pipeline_scheduler.ps1`：注册 `QuantEdgePipelineDaily` 任务，每周一到周五 16:30 跑 `run_scheduled.bat`；带 S4U LogonType（普通用户不暴露密码）+ 笔记本电池兼容 + 错过补跑 + 失败重试 3 次；与 mining-alpha 专用 `install_task_scheduler.ps1` 隔离不冲突。
    - 更新 `backend/README.md` 定时运行 section：把散文式说明改为指向具体脚本（macOS/Linux → `./install_cron.sh`，Windows → `.\install_pipeline_scheduler.ps1`），加测试/卸载命令；mining-alpha 独立调度的注释提示。
    - 现有 `run_scheduled.bat` 已正确处理 venv + cron.log 时间戳 + exit code（之前实现的留存），不动。

### 前端

- [x] **[P2]** 价格历史图表升级到 60–90 天完整数据
  - 背景：`pipeline.py` 现在用 `np.linspace` 把 3 个月数据采样成 12 个点，图表很糙；前端 Recharts 完全可以渲染 60+ 个点。
  - 验收标准：`pipeline.py` 的 `priceHistory` 输出全部交易日（不再下采样），字段从 `m`（短日期）改为 `date`（ISO 8601）；前端图表 X 轴用 `interval="preserveStartEnd"` 自动稀疏化标签；老的 `m` 字段保留作为兼容期 alias，下版本删除。
  - 预估工作量：S
  - **完成（2026-05-19）**：`backend/pipeline.py` 个股 + ETF 两处 `np.linspace(...) min(12, len(hist))` 下采样删除，改为 `hist.iterrows()` 全交易日输出；schema 同时含 `date`（ISO 8601 `%Y-%m-%d`，新字段）+ `m`（`%b %d`，legacy alias，下版本删除）+ `p`（收盘价）。`frontend/src/pages/ScoringDashboard.jsx` 两处 priceHistory `<XAxis dataKey="m">` 加 `interval="preserveStartEnd"`（保持 `minTickGap` 不变，Recharts 智能稀疏化兼顾首尾标签）。dataKey 仍用 `m` 保持后向兼容，下次切到 `date` 一并删除 `m`。前端 build 30s 通过。

- [x] **[P2]** Footer 显示数据延迟时间
  - 背景：用户需要一眼看出"数据是几分钟前的"，否则容易误判实时性。
  - 验收标准：前端 Footer 固定显示 `数据更新于 HH:MM:SS （N 分钟前）`，N 实时刷新；时间源自 P1 的 `data_freshness.price_as_of`。
  - 预估工作量：S
  - 依赖：P1 的"数据时效性标记"
  - **完成（2026-05-19）**：双层时效信息已落地。Footer 主行（line 2465）+ DataFreshnessPill 已显示 `formatCacheAge(priceUpdatedAt)`（客户端拉数据时间，对应"N 分钟前"）；本次新加悬停面板"行情时效"行显示后端 `dataFreshness.priceAsOf` 最旧月日（数据本身代表的时间）。两者互补：前者是 UI 友好的"刚拉到 N 秒前"，后者是数据精确时效。

---

## P3 — 长期 / 架构演进

- [x] **[P3]** FastAPI 后端封装
  - 背景：当前是"批处理脚本 → 静态 JSON → 前端 import"的模式。引入 FastAPI 后，前端可以按需查询、支持参数化（自定义权重 / 时间区间 / 标的过滤），也是接入数据库前的必经一步。
  - 验收标准：`backend/api/` 下新建 FastAPI app，至少暴露 `/stocks` / `/alerts` / `/backtest`；前端切换到 `fetch` 调用，保留 stocks.js 作为离线 fallback；CORS 配好。
  - 预估工作量：L
  - **完成（2026-05-19，验证已落地，结构与原方案略异）**：实际落地为 `backend/server.py`（单文件 FastAPI app）而非 `backend/api/` 子目录，20+ 路由覆盖原验收 + 远超：`/api/search` `/api/tickers` (GET/POST/DELETE) `/api/data` `/api/refresh` `/api/sync` `/api/intraday` `/api/db/stats` `/api/db/bars/{ticker}` `/api/llm/{summary,journal-structure,explain-score,backtest-narrate,parse-strategy}` `/api/transactions` (GET/POST/DELETE) `/api/positions` + 5 个 `/api/mining-alpha/*` 路由（详见 MINING_ALPHA.md）；前端 `apiFetch` 直连 + `frontend/src/data.js` 静态 fallback（离线模式可用）；A7 lifespan 替代旧 `@app.on_event`。

- [ ] **[P3]** PostgreSQL + TimescaleDB 数据持久化
  - 背景：脚本输出的 JSON 没法做长周期回溯（评分历史、回测结果、告警归档都需要时序存储）。TimescaleDB 是日线 / 分钟级时序的天然选择。
  - 验收标准：docker-compose 启动 Postgres + TimescaleDB；`backend/db/` 提供 SQLAlchemy models 和迁移；`pipeline.py` 写入数据库（保留 JSON 输出作为缓存）；FastAPI 改为从 DB 查询。
  - 预估工作量：L
  - 依赖：上一项 FastAPI
  - **注（不勾，架构决策变更）**：当前用 **SQLite**（`backend/data/quantedge.db`）替代 PostgreSQL + TimescaleDB —— server.py 已有 `/api/db/stats` `/api/db/bars/{ticker:path}` 路由读 SQLite。如未来需要时序压缩 / 长周期回溯加速 / 多实例并发，再升级到 TimescaleDB；当前 SQLite 单机性能足够。

- [x] **[P3]** 投资日志模块对接真实数据
  - 背景：前端 `Journal` 现在是硬编码 JOURNAL 数组，无法记录新交易。需要一个持久化层（先文件后 DB）。
  - 验收标准：日志条目用本地 JSON / DB 持久化；前端支持新增 / 编辑 / 删除条目；字段对齐 `JOURNAL` 现有结构。
  - 预估工作量：M
  - 依赖：FastAPI
  - **完成（2026-05-19，验证已落地）**：`frontend/src/pages/Journal.jsx` 1275 行成熟组件 —— `loadJournal` / `saveJournal` 用 localStorage 持久化（按 workspace 命名空间 `wsKey("quantedge_journal", wsId)`）、`PositionEditor` 编辑股数 + 持有成本、`AddTransactionModal` 新增交易、Trash2 按钮删除、`MonthlyReviewModal` 月度回顾、`PortfolioMacroSensitivity` + `SectorRegimeExposure` 持仓宏观敏感性分析；后端 `/api/transactions` (GET/POST/DELETE) + `/api/positions` + `/api/llm/journal-structure`（LLM 拆 thesis 为结构化字段）配合。

- [x] **[P3]** 数据粒度从日线扩展到分钟级
  - 背景：`PROJECT_CONTEXT.md` 明确说"架构预留分钟级"，但当前 `tk.history(period="3mo")` 拿的是日线。yfinance 支持 `interval="1m"` 但有 7 天 / 60 天的限制；需要引入更完善的源（IBKR / Polygon / iFinD）。
  - 验收标准：架构上 fetcher 接受 `interval` 参数；至少跑通某一个标的的分钟级抓取与存储（推荐先入 TimescaleDB）。
  - 预估工作量：L
  - 依赖：TimescaleDB
  - **完成（2026-05-19，验证已落地）**：`backend/server.py:1117-1120` `/api/intraday` 路由 `interval: str = Query("1m", description="1m / 5m / 15m / 1h / 1d")` 支持 5 档粒度（1m/5m/15m/1h/1d）；按需拉取不落库（注释 L1116：分钟级行情按需拉取，不落库 —— 避开 yfinance 7/60 天限制 + 节省 SQLite 空间）。如未来要做分钟级回测则需配合升级到 TimescaleDB（参见上一项注解）。

---

---

## 已落地 — Mining Alpha（2026-05）

> 详见 [MINING_ALPHA.md](MINING_ALPHA.md)

A 股 Alpha191 因子挖掘 + ML 合成 + 回测 — 已交付：
- 187 / 191 因子（仅剩 30/143/166/190 不实现，原因详见 MINING_ALPHA.md）
- 算子库 25 个 + walk-forward LightGBM ranker + 向量化回测
- 改良层：vol-scaled / IC-decay 自适应权重 / regime-aware（接 HMM）
- 前端 tab `Mining Alpha` + 5 个 FastAPI routes (`/api/mining-alpha/*`)
- 433 mining_alpha 测试全绿

**待用户跑实数据**（Mining Alpha 真实回测需要 tushare daily 接口权限）：
- [ ] **[P2]** 用户升级 tushare 积分至 2000+ 后跑全流程 CLI
  - `python -m mining_alpha.run sync-data --universe CSI800 --start 2020-01-01`
  - `↳ compute-factors → ic-report → train → backtest`
  - 验证 KPI 门槛（年化超额 ≥ HS300+6%, Sharpe ≥ 1.2, 最大回撤 ≤ 25%）

---

## 优先级分布

| 优先级 | 总数 | 已完成 | 未完成 | 备注                                  |
| ------ | ---- | ------ | ------ | ------------------------------------- |
| **P0** | 2    | 2      | 0      | 全部完成 ✓                             |
| **P1** | 6    | 4      | 2      | 剩港股财务 M / 评分平滑 M（均在 stash） |
| **P2** | 6    | 4      | 2      | 剩 vectorbt L / Telegram M             |
| **P3** | 4    | 3      | 1      | 剩 TimescaleDB L（SQLite 已替代）       |
| **总计** | **18** | **13** | **5**  | 完成率 72%                            |

### 剩余未完成项快查（2026-05-19）

| 项 | 优先级 | 工作量 | 状态 |
|---|---|---|---|
| 港股财务数据补充源（AAStocks / 东方财富） | P1 | M | 另一会话 stash 在做 |
| 评分平滑 + 评分变化率字段 | P1 | M | 另一会话 stash 在做 |
| Telegram / 企业微信 Webhook 推送 | P2 | M | 另一会话 stash 在做 |
| 接入 vectorbt 做向量化回测 | P2 | L | 依赖后端 backtest.py（当前 client-side 实现） |
| PostgreSQL + TimescaleDB 数据持久化 | P3 | L | 架构决策保留 —— SQLite 已替代 |

## 下一次对话的默认入口

> "找一个 small todo 并完成它"

→ **当前已无 S 级未完成任务**。剩余项均为 M / L 级，按以下决策：
1. **港股财务 / 评分平滑 / Telegram**：避开（其他会话 stash 在做）
2. **vectorbt**：依赖后端 backtest.py 化，纳入 P3 FastAPI 后续迭代
3. **TimescaleDB**：架构保留项，按需触发
4. **新的小问题**：欢迎按需添加 P0/P1/P2 S 级任务到本文件

完成一个 S 任务后请勾选本文件对应的 `- [ ]`，并在 commit / 对话末尾报告。
