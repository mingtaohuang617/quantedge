# Changelog

All notable changes to QuantEdge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **10x 猎手 5 大指数全覆盖** (PR #117)：让标普500 / 纳斯达克100 / 恒生 / 恒生科技 / 沪深300 里的每只股票都至少命中 1 个 supertrend
  - **新增 4 个 growth supertrend**（4 → 8 个 growth，11 个 total）：
    - `consumer_internet` 消费互联网（AMZN/META/NFLX/UBER/BABA/美团/快手 等）
    - `ev_auto` 电动车与新能源汽车（TSLA/RIVN/比亚迪/蔚来/小鹏/宁德 等）
    - `biotech` 生物科技与创新药（LLY/NVO/REGN/VRTX/MRNA/恒瑞/迈瑞 等）
    - `defense_aerospace` 国防航天（BA/RTX/LMT/NOC/GD/GE 等）
  - **关键词 100+ 扩充**（覆盖 Yahoo Chinese / 英文行业翻译变体）：
    - 油气勘探与开发 / Independent Power / Insurance—Diversified / Capital Markets / Asset Management / Railroads / Footwear & Accessories / Discount Stores / Home Improvement Retail / 一般药品制造商 / Drug Manufacturers - General / 生物制药 / 化学制药 / 医疗设备 / 消费电子 / 数据中心 REIT / 综合企业 / 公共运输 / 航运及港口 / 地产发展商 / 物业服务及管理 / 工程机械 等
  - **`patch_index_members.py`** — 5 大指数代表股 sector 数据手填（~300 票 US + ~30 HK + ~75 CN），使用 `_expand()` helper 批量定义同 sector 的 ticker 组
  - **`BUILTIN_SUPERTRENDS_FALLBACK`** Screener10x.jsx 扩到 11 个（standalone fallback 与 sector_mapping 对齐）
  - **screen limit 200 → 2000** (PR #105)：之前 limit=200 + marketCap 升序排序导致 MU/NVDA/AVGO 等 mega-cap 永远进不了候选；改 5 处 limit
  - **name fallback 兼顾 broad 模式** (PR #108)：之前 sector 空的 TSM/EQIX 在默认 broad 模式下永远 0 命中；移除 `precise and` 守卫
  - 测试：vitest 374 passed / backend pytest test_sector_mapping + test_watchlist_10x 全过
  - Audit 命中率（5 大指数）：SPX 500 88% / NDX ~95% / HSI 97% / HSTECH 100% / CSI 300 99%

## [0.8.0] - 2026-05-19 — UI/UX optimization sprint

> 本版本聚焦 UI/UX 体验深度抛光，基于两份独立 design critique PDF
> （克制派 + 高级感派）+ design-critique skill 推动，覆盖 Phase 0-5
> 主体 + 多轮微调。功能特性照常累积（详见后续 Added 区）。

### UI/UX — 主体优化（PR #91）

- **色彩语义化收敛**：7 色 accent 折叠到 5 角色（`--sem-brand` indigo→cyan 渐变 / `--sem-up` / `--sem-down` / `--sem-warn` / `--sem-neutral`）
  - Badge 组件 `info/violet/cyan` 三种 variant 折叠到 neutral / brand，移除 sky / fuchsia / emerald 装饰用法
  - sector chip 多色编码（TAG_COLORS）保留 — 是合法的数据编码
  - 视觉残留 sky/violet/rose/emerald = 0（量化评分页验证）
- **字号纪律 5 档制**：删除 64 处 `text-[8px]`（< WCAG 12px 阈值），收敛到 9 / 10 / 11 / 12 / 16 五档
- **回测引擎 QQQ bug 修复**：基准数据缺失时 5 处 null-safety 取代假基准线（之前 `100 + i*线性递增` 伪造导致 Underwater 显示假 0% 平直线）
- **KPI 卡 vs 基准副标**：回测 6 张 KPI 卡（总收益 / 年化 / α / 终值 / 夏普 / 最大回撤）全部加 vs 基准副标
  - 新增 `annBenchReturn` + `benchSharpe` 计算
  - baseline 行（横评表）补全
- **全局键盘流**：⌘K 命令面板（已存在，新接通 ShortcutsModal） / 1-7 切 tab / J K 上下标的 / R 刷新 / / 聚焦搜索 / ? 速查表 / ⌘. 切深浅
- **DataFreshnessPill 持久状态条**：header 右侧四态显示（实时 / 缓存 / 离线 / 过期）+ 一键刷新，30s 自动重算"多久前"
- **顶部 Tab 紧凑化**：gap-0.5 + px-1.5 + size-12 让 8 个 tab 横向无溢出
- **ticker tape 自适应**：侧边栏模式 flex-1 拉长（200-900px）；常规模式响应式（260/300/360/420px）
- **市场指数条分层**：核心 always / HSI VIX lg+ / 板块热力 xl+，去掉 overflow-x-auto 不再横向滚动
- **移动端底部 Tab Bar**：`fixed bottom-0` 替代顶部 squeeze，iOS 风 icon + 微标签 + safe-area-inset-bottom
- **空状态 CTA**：回测无标的时显示「添加 3 只以上标的开始回测」+ 两个引导按钮
- **抛光层**：sidebar tab 下划线（与顶部呼应）/ ambient drift 42s / btn-tactile 2 通道（颜色 + 位移）/ 主价格 28px 金属渐变（白→slate-300）/ K 线 1.1s stroke 描边 / number spinner 隐藏 / 模态命中区 ≥24px / scroll-spy 详情 5 锚点 / CompareModal 4 标的对比 winner 高亮

### UI/UX — 顶部 Tab 2 行短标签（PR #92）

- 8 tab + 4 字中文 label 在 ~1900 宽屏溢出问题修复
- `TAB_CFG` 每条加 `short: ["量化","评分"]` 字段
- 顶部 nav 渲染：`lang === 'zh'` + `c.short` 存在时 flex-col 堆叠 2 行；英文 fallback 单行
- `aria-label` / `title` 保留完整 label（无障碍 + hover tooltip）
- 字号 11→10，py 收紧避免 2 行后超高
- 8 个 4 字 tab 横向节省 ~50% 宽度

### UI/UX — i18n 清理 + 移动端底栏短标签（PR #97）

- `i18n.jsx` 5 处 `Duplicate key` 警告全部消除（运行时行为不变，删 shadow 定义）
  - `'天'` / `'未知'` / `'胜率'` / `'宏观调整'` / `'权重'` 各有 2 处
  - vite build 日志从 5 warnings → 0 warnings
- `MobileBottomNav` 复用 TAB_CFG.short，修复「Mining Alpha」/「10x 猎手」375px 移动屏溢出
  - flex-col + leading-[1.05] + tracking-tight 让 2 行紧贴
  - 单 tab 高度 ~49px，main pb-14 (56px) 覆盖足够

### UI/UX — 表格抛光 + 8px 清理（PR #98）

- **横评表/CompareModal 第一列横向 sticky**：
  - `BacktestEngine 策略横评表` 指标列横向滚动时锁定在左
  - `CompareModal KPI 表` 同样处理
  - `sticky left-0 z-20 bg-[var(--bg-card)]`（z 高于顶部 sticky thead 的 z-10）+ group-hover 联动 bg 跨列高亮
- **13 处 text-[8px] → text-[9px]**（main 合并后 stock-gene 子组件 + ValueDCFCalculator / WatchlistCard 残留）

### Vercel 部署调研 + 文档化（PR #104）

- 确认 Vercel **Hobby plan 硬上限 12 个 serverless function**
- 项目当前 22 函数（llm 4 + stock-gene 10 + universe 1 + watchlist 6 + yahoo 1），刚好踩线
- `.vercelignore` 排除 stock-gene 10 个 → 部署的函数 = 12 贴顶
- 影响：生产 `quantedge-chi.vercel.app` 上 stock-gene tab = demo 模式
- 团队决策：保持现状。`.vercelignore` 注释写入完整根因 + 3 个恢复方案（升级 Pro / catch-all 合并 / 现状）

---

### Added
- **Finnhub free tier US fundamentals enrich** (PR #96)：替代被 Yahoo 限频严重的 yfinance .info，用 Finnhub 免费 API 给全市场 12k 美股拉 PE/PB/股息/ROE/D/E
  - `backend/data_sources/finnhub_source.py`：`fetch_fundamentals_finnhub(symbol)` 单只拉 + `enrich_us_fundamentals_finnhub(items)` 批量；字段映射 `peNormalizedAnnual / pbAnnual / dividendYieldIndicatedAnnual / roeRfy / totalDebt/totalEquityAnnual`；429 限频自动 sleep 20s + retry；401/403 鉴权失败立即终止；网络错误返回 None 不阻断
  - `backend/universe/enrich_us_finnhub.py`：standalone 脚本（不掺入 sync_us 复杂流程），支持 `--limit` 测试 + `--force` 覆盖已有 + `--sleep` 调速；checkpoint 每 100 个保存 + Ctrl+C 优雅退出保留进度
  - `backend/.env.example`：加 `FINNHUB_API_KEY` 模板（注册 https://finnhub.io free）
  - 测试：backend pytest +15 例（mock httpx，零网络）— 字段映射 / 429 retry / 鉴权失败 / network error / only_missing 跳过 / force 覆盖 / limit
  - 性能：60 calls/min × 60 = 3600/h；12k 票 ≈ 3.3 小时跑完；vs yfinance .info 实测 fill rate 0.1% 不可用
- **10x 猎手 价值型 DCF 估值计算器** (PR #86 + #87)：TenxItemEditor 价值型 strategy 时内嵌两阶段 DCF + 敏感性矩阵
  - `frontend/src/lib/dcf.js`：`calcDCF` 两阶段模型（短期 N 年 FCF 折现 + Gordon Growth 终值）+ `marginOfSafety` 计算 + `calcSensitivityMatrix` 3×3 (r ± 1% × g1 ± 2%)
  - `frontend/src/components/ValueDCFCalculator.jsx`：collapsible UI；5 个输入（FCF/g1/N/g2/r）；useMemo 实时算；安全边际三档配色（≥33% emerald / 0-33% cyan / 高估 red）；「应用到目标价」一键回填 form.target_price；敏感性矩阵 toggle 展开 3×3 grid，配色按 vs base 偏差（emerald/cyan/gray/amber）+ 中心格 ring 标识
  - `frontend/src/components/TenxItemEditor.jsx`：加 `currentPrice` 可选 prop；仅 `form.strategy === "value"` 时渲染 DCF
  - 测试：vitest +44 例（26 数学：DCF 输入校验/数学正确性/敏感性矩阵；18 组件：折叠/展开/输入/三档配色/矩阵 toggle/中心格 ring）
- **10x 猎手 WatchlistCard 抽出 + 30 组件测试** (PR #85)：从 Screener10x.jsx 抽出独立组件便于测试，文件从 1444 → 1177 行（-19%）
  - `frontend/src/components/WatchlistCard.jsx`：纯 presentational 组件（262 行），原代码字节级 copy（不改逻辑）
  - 测试：WatchlistCard.test.jsx 23 例（strategy badge / L1·L2 strategy-aware / 卡位↔护城河 label / 价格预警 above·near·below tone / 复盘 badge urgent·warn·info / 可证伪条件警示框 / 归档 opacity / moat 星标 / 回调）；AddSupertrendDialog.test.jsx 追加 7 例 strategy radio
- **10x 猎手 smoke fundamentals v3** (PR #84)：手扩 28 → 116 代表股，覆盖 3 个 value 赛道 × 3 个市场 × 主要行业；yfinance .info 全市场 enrich 被 Yahoo 限频严重（实测 fill rate 0.1%），手扩 patch 是当前唯一可用解
  - US 14→57 / CN 8→35 / HK 7→24
  - 加银行（GS/MS/USB/C 等）/ 保险（MET/PRU/AIG 等）/ 公用（DUK/SO/AEP/NEE）/ 烟草（PM）/ 消费稳健（WMT/COST/KHC/CL）/ 工业（CAT/DE/UNP）/ 化工钢铁建材（DOW/LYB/NUE/VMC）/ A 股价值龙头（中国移动/长江电力/海螺水泥/五粮液/海天/伊利）/ HK 蓝筹（汇丰/恒生/友邦/平安 H/中海油 H）+ 成长对照（NVDA/TSLA/AAPL/腾讯/阿里）
- **10x 猎手 AI 一键串联** (PR #83)：替代两步点击（「AI 校验赛道」+「AI 排序」），一键并发跑 top 5 校验 + top 10 排序
  - `frontend/src/pages/Screener10x.jsx:handleAiPipeline`：用 `Promise.allSettled` 并发；进度显示 `loading {matched}/{total}`；amber 主色按钮夹在 AI 排序按钮左侧
- **10x 猎手 React 组件测试 setup + 15 个初始测试** (PR #82)：搭 vitest jsdom 环境，让组件可单测
  - 装 `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`
  - `frontend/src/test-setup.js` 加载 `@testing-library/jest-dom/vitest` matchers
  - `frontend/vite.config.js`：`test.setupFiles` + `test.environmentMatchGlobs` 让 `.test.jsx` 走 jsdom（`.test.js` 仍 node env 保持快）
  - TenxItemEditor.test.jsx 10 例（strategy 切换字段标签 / BOTTLENECK_OPTIONS / placeholder）+ AddSupertrendDialog.test.jsx 8 例（open/close / 校验 / save / AI 生成）
- **10x 猎手 一键已复盘按钮** (PR #78)：观察项卡片加 ✓ 按钮，PUT `llm_thesis_cached_at = now` 重置「N 天未复盘」badge，不必重新跑 AI 草稿
  - `frontend/src/pages/Screener10x.jsx:handleMarkReviewed` + WatchlistCard 加 `onMarkReviewed` prop
- **10x 猎手 generate-keywords value strategy + dialog radio** (PR #77)：自定义赛道关键词生成按 strategy 切 prompt；添加赛道对话框加成长/价值 radio 选择
  - `frontend/api/llm/generate-keywords.js`：split `buildPromptGrowth` + `buildPromptValue`，value prompt 强调防御性/周期性/必需品行业关键词；cache key prefix 区分（`generate-keywords` vs `generate-keywords-value`）
  - `frontend/src/components/AddSupertrendDialog.jsx`：加 strategy radio + 透传到 POST body + LLM 调用；接 `defaultStrategy` prop 跟随调用方 tab
- **10x 猎手 AI 排序 rank-candidates value strategy** (PR #76)：候选股 AI 打分支持价值型语义（护城河强度 / 价值确信度，而非卡位独特性）
  - `frontend/api/llm/rank-candidates.js`：split `buildPromptGrowth` (卡位独特性 1-5) + `buildPromptValue` (价值确信度 1-5)；value 模式 candidate lines 携带 5 维财务字段；每个 value 赛道给 LLM 维度提示（高股息=股息持续性 / 周期=PB vs 历史 / 消费稳健=穿越周期 ROE）
- **10x 猎手 N 天未复盘 badge** (PR #75)：观察项卡片显示「⏰ Xd」badge，提醒用户重看 thesis 是否仍成立
  - `reviewState` useMemo：取 `added_at` 和 `llm_thesis_cached_at` 较新者算 daysAgo
  - 三档：< 7d 不显示；7-30d info（灰）；30-90d warn（amber）；≥ 90d urgent（red + animate-pulse）；archived 项一律不提醒
- **10x 猎手 卡位假设可证伪化字段** (PR #74)：Druckenmiller / 桥水 pre-mortem 纪律 — 让用户写明「什么条件触发我承认 thesis 错了」
  - `backend/watchlist_10x.py` + `frontend/api/_lib/watchlist10x.js`：`falsification_condition` 字段（默认空字符串），CRUD 透传
  - `frontend/src/components/TenxItemEditor.jsx`：加输入框 + strategy-aware placeholder（成长 = 瓶颈解除 / 价值 = 现金流断裂）
  - WatchlistCard：填了显示 ⚠ amber 警示框
  - backend pytest +4 例
- **10x 猎手 AI 校验赛道支持 value strategy** (PR #70)：`/api/llm/match-supertrend` 按当前候选股 strategy 自动路由到对应 prompt 框架（Graham 安全边际 vs 双层瓶颈）
  - `frontend/api/llm/match-supertrend.js`：split `buildPromptGrowth` + `buildPromptValue`；value prompt 喂 5 维财务字段；cache key prefix `match-supertrend-value` 与 growth 隔离
- **10x 猎手 价格预警 badge** (PR #72)：观察项卡片实时拉 Yahoo 当前价，与 target_price / stop_loss 对比变色
  - `frontend/src/pages/Screener10x.jsx`：`_tickerToYahoo` ticker 翻译（.HK 5 位零填充 / .SH → .SS）+ `fetchCurrentPrice`（chart endpoint 单只）+ `pricesByTicker` state；`items` 变化时拉 missing 价格（不重复）
  - WatchlistCard：`priceAlerts` useMemo 算 gap%；target above/near/far 三档（emerald/cyan/灰）；stop below/near/safe（red+animate-pulse / amber / 灰）；tooltip 显示「当前价 vs 目标」距离百分比
- **fix(10x): screen endpoint 透传价值型 5 维过滤参数** (PR #67)：`frontend/api/watchlist/10x/screen.js` 漏传 6 个字段（max_pe / max_pb / min_roe / min_dividend_yield / max_debt_to_equity / include_no_fundamentals），导致前端 5 维 filter 实际无效；补齐
- **fix(e2e): cmdk smoke selector 收窄消除 flaky** (PR #68)：`tests-e2e/smoke.spec.ts` 把 `text=/动量成长|动量/` 改为 `text=动量成长`，避免匹中 ScoringDashboard 里的隐藏 span
- **macro 看板系列** (PR #61-#66 / #69 / #71)：宏观信号深度集成到 journal / scoring / monitor
  - PR #61：投资日志每只持仓加 macro context card（当前 regime / temperature）
  - PR #62：scoring 加「按 macro-adjusted score 排序」（regime tilt 调整）
  - PR #63：日志 AI 复盘 prompt 注入 macro context（让 LLM 知道当前是 risk-on/off）
  - PR #64：portfolio macro sensitivity card — regime flip 时整组合估值变化模拟
  - PR #65：transactions 买入前 macro style fit 警告（成长股 in risk-off 时弹提示）
  - PR #66：sector × regime exposure panel（看持仓在不同 regime 下的 sector 暴露）
  - PR #69：macro L5 alert 历史回测面板（验证 alert 信号的历史准确率）
  - PR #71：monitor 注入 macro L5 alerts + 临时 F&G badge
- **monitor: severity + type filter chips** (PR #73)：alerts 列表加严重度 / 类型过滤 chip，长列表时快速聚焦
- **stock-gene: dual-engine detector** (PR #81)：新增「股票基因」检测器 — bull pattern（8 个动量/趋势因子）+ value health（6 个估值/财务因子）；新 page `frontend/src/pages/StockGene.jsx` + backend `stock_gene.py` + LLM context 模块
- **qol: NAV clock per-min + HTML meta + global focus-visible** (PR #79)：导航栏时钟按分钟刷新；HTML meta 完善；全局 focus-visible 焦点环统一
  - `frontend/src/components/AddSupertrendDialog.jsx`：接 `defaultStrategy` prop；POST `/supertrends` 透传 `strategy` 字段（backend / serverless 早已支持，只是前端原来漏传）；头部加 strategy 标识 chip（与 WatchlistCard badge 同款配色）
  - `frontend/src/pages/Screener10x.jsx`：
    - WatchlistCard 加 strategy badge 「成」/「值」（indigo / emerald 颜色区分）
    - L1/L2 badge tooltip 按 strategy 切：成长 = 共识层 / 深度认知；价值 = 深度低估 / 合理估值
    - L1/L2 颜色按"稀有度"映射：罕见的层级（growth-L2 / value-L1）= 紫色突出；普通 = 蓝色
    - 「卡位」label 按 strategy 全场切「卡位」/「护城河」：WatchlistCard 底部 star meter + 候选股表头 AI 列 + AI 排序按钮 tooltip
    - AddSupertrendDialog 调用传 `defaultStrategy={activeStrategy}`
  - 测试：vitest 272 pass / audit / build / preview eval 验证 tab 切换 → dialog badge → AI 排序 tooltip 全部按 strategy 切换
- **10x 猎手 价值型 PR-B UI + LLM**（v2.0 第二阶段）：完成成长/价值同页 tab 切换 + 价值型 LLM thesis
  - `backend/llm.py:value_thesis`：Graham 安全边际框架 LLM prompt — 8 字段（价值赛道 / 估值点位 / 估值点位_int / 内在价值 / 护城河 / 卡位等级_int / 风险 / 推演结论）；cache key prefix `value-thesis` 与成长型 `10x-thesis` 隔离；额外把 PE/PB/股息率/ROE/D/E 5 维数字喂给 LLM
  - `backend/server.py`：新增 `POST /api/llm/value-thesis` endpoint + `ValueThesisReq` 含 5 维财务字段
  - `frontend/api/llm/value-thesis.js`：vercel serverless port，含 yahoo profile 业务描述兜底（与 10x-thesis 同模式）
  - `frontend/src/pages/Screener10x.jsx`：
    - 顶栏加「成长型 / 价值型」tab 切换；切 tab 清空赛道选择避免脏状态
    - 左栏赛道列表按 `activeStrategy` 过滤（成长 4 / 价值 3）
    - 中栏筛选条件按 strategy 切换：成长型保留 `max_market_cap_b`；价值型显示 5 维 input（PE/PB/ROE/股息/D/E）
    - 候选行：价值型额外列展示 PE / PB / 股息率 / ROE
    - `runScreen` 按 strategy 选择参数集（成长型不带 5 维；价值型不带 max_market_cap_b）
    - `BUILTIN_SUPERTRENDS_FALLBACK` 扩展到 7 个（含 strategy 字段）
  - `frontend/src/components/TenxItemEditor.jsx`：
    - 启用价值型 strategy（去掉 `disabled: true`）
    - 字段标签按 strategy 切换：成长「瓶颈层级 (L1 共识 / L2 深度认知)」/「卡位等级」；价值「估值点位 (L1 深度低估 / L2 合理估值)」/「护城河等级」
    - 「AI 生成草稿」按钮根据 strategy 路由 `/llm/10x-thesis` 或 `/llm/value-thesis`，预填规则相同（_int 字段自动填 bottleneck_layer / moat_score）
  - 测试：backend pytest 新增 2 例 value_thesis（cache 命中 + 字段缺失容错；mock LLM，零网络）
- **10x 猎手 价值型 PR-A 数据基础**（v2.0 第一阶段；UI 在 PR-B）：让 watchlist 同时支持成长/价值两条策略
  - `backend/sector_mapping.py`：每个 supertrend 加 `strategy: "growth" | "value"` 字段；新增 3 个价值赛道 `value_div`（高股息蓝筹）/ `value_cyclical`（周期价值：银行/保险/化工/钢铁）/ `value_consumer`（消费稳健：食品饮料/必需消费）
  - `backend/data_sources/yfinance_source.py:fetch_fundamentals`：拉单只 PE/PB/股息率/ROE/D/E（同 `.info` 调用零额外 IO）
  - `backend/data_sources/tushare_source.py:fetch_fundamentals_cn`：单次 daily_basic + fina_indicator 拉全 A 股；非交易日回滚 5 天
  - `backend/data_sources/futu_source.py:fetch_fundamentals_hk`：批量 200 / sleep 1s 拉港股 PE/PB/股息率（同 snapshot）
  - `backend/universe/sync_us.py / sync_cn.py / sync_hk.py`：加 `--enrich-fundamentals` flag；US 走 yfinance .info，CN 走 tushare，HK 走富途 snapshot
  - `backend/watchlist_10x.py:screen_candidates` 加 5 维过滤参数：`max_pe / max_pb / min_roe / min_dividend_yield / max_debt_to_equity` + `include_no_fundamentals` 默认 True（缺字段保留，与 `include_no_mcap` 同模式）；PE<=0 亏损公司一律剔除
  - `backend/watchlist_10x.py:add_supertrend(strategy=...)` 用户赛道支持指定 growth/value
  - `backend/server.py`：`ScreenReq` 加 5 个字段；`GET /api/watchlist/10x/supertrends?strategy=` 按策略过滤
  - `frontend/api/_lib/sectorMapping.js` + `watchlist10x.js`：JS port 同步（5 维过滤逻辑 1:1）
  - `frontend/api/watchlist/10x/supertrends.js`：endpoint 透传 `?strategy=`
  - 测试：backend pytest 新增 15 例（5 维筛选 + 价值赛道分类 + strategy 过滤），frontend vitest 新增 14 例
- **10x 猎手** v1.0 — 三段式工作流（赛道勾选 → 候选筛选 → 观察列表 + AI thesis 草稿）
  - `backend/universe/`：US/HK/CN 候选股池同步（NASDAQ Symbol Directory + 富途 OpenD/yfinance enrich）— Sprint 1 (9514231) + 富途接入 (071f0a4, bbdf282)
  - `backend/sector_mapping.py`：行业字符串 → 4 个内置超级赛道（AI 算力 / 半导体 / 光通信 / 算力中心）— Sprint 2 (f859406) + 关键词对齐修正 (5d7d675)
  - `backend/watchlist_10x.py`：watchlist CRUD + screen_candidates + 用户自定义赛道管理 — Sprint 3 (9ea4ee2)
  - `backend/server.py`：9 个 10x 相关 REST 端点 — Sprint 3 (9ea4ee2)
  - `backend/llm.py:tenx_thesis`：DeepSeek 生成 5 段卡位分析（超级趋势 / 瓶颈层 / 卡位逻辑 / 风险 / 推演结论），24h 缓存
  - `frontend/src/pages/Screener10x.jsx` + `frontend/src/components/TenxItemEditor.jsx`：三栏页面 + 编辑模态框 — Sprint 4 (3cfe193)
- **10x 猎手 v1.5** — 精严 / 宽泛模式切换：精严仅用核心赛道关键词（光通信/硅光/AI/HBM），宽泛扩展到通讯设备/应用软件等大池 (0202dcf)
- **10x 猎手 P0 修复**：
  - 用户自定义赛道支持自带关键词（`keywords_zh` / `keywords_en`），加完赛道实际可参与筛选 — 之前 `add_supertrend()` 只存 id/name/note，导致用户赛道在 `screen_candidates` 永远命中 0 只股
  - `screen_candidates(include_no_mcap=True)` 新参数，缺市值（`marketCap=None`）标的默认保留 — 避免设了市值上限后静默丢失 A 股池
  - `backend/tests/test_watchlist_10x.py` 新增 5 个 case 覆盖上述行为
  - `frontend/src/pages/Screener10x.jsx` 候选 0 行空状态文案在精严模式下提示"关闭精严模式"
- **10x 猎手 P1 优化**：
  - mcap input 加 300ms debounce（双 state 拆分：`maxMcapInput` 即时显示 + `maxMcapB` 喂 `runScreen`）— 用户连改多个数字仅触发 1 次后端
  - 删除 `useEffect[items.length]` 冗余：`handleSaved` 新增路径本地 splice 候选省 1 次 screen；`handleDelete` 显式 `runScreen` 让 ticker 回到候选
  - LLM `tenx_thesis` 返回结构化数字字段：`瓶颈层级_int` (1-2) 和 `卡位等级_int` (1-5)，前端 `TenxItemEditor` 在"AI 生成草稿"时自动预填到 `bottleneck_layer` / `moat_score`，免去用户手填
  - `backend/llm.py` 新增 `_clamp_int` helper + `backend/tests/test_llm_helpers.py` 7 个 case 覆盖 LLM 数字字段容错
- **10x 猎手 命中诊断（match_reasons）**：候选股不再只显示"命中了什么赛道"，还能查"因为哪个字段哪个关键词命中"
  - `backend/sector_mapping.py` 新增 `classify_sector_with_reasons` / `name_matches_strict_with_reasons`（旧函数 delegate，零 behavior change）
  - `backend/watchlist_10x.py:screen_candidates` 在每个候选 item 加 `match_reasons: dict[trend_id, [{field, value, keywords}]]`；A 股池 `sector==industry` 同值时去重
  - `frontend/api/_lib/sectorMapping.js` + `watchlist10x.js` 1:1 同步到 JS 移植版
  - `frontend/src/pages/Screener10x.jsx`：候选行赛道标签加 hover tooltip，鼠标悬停显示 `板块="Semiconductors" 含 Semiconductor` 这种诊断文案 — 用户能立刻验证 AI 算力 / 半导体 / 自定义赛道 keyword 是否命中预期
  - 新增测试：backend pytest 13 例（`classify_sector_with_reasons` 7 + `name_matches_strict_with_reasons` 5 + `screen_candidates.match_reasons` 7）；frontend vitest 13 例
- **10x 猎手 观察项归档（archived）**：长期使用的 watchlist 不会无限膨胀；不想看的票"归档"而不是"删除"，保留 thesis / 卡位 / LLM 缓存
  - `backend/watchlist_10x.py`：item 加 `archived: bool = False`；`list_items(include_archived=False)` 默认仅 active；老数据无字段时按 active 处理（兼容）
  - `backend/server.py`：`GET /api/watchlist/10x?include_archived=true` 控制返回集；`PUT /{ticker}` 接受 `archived` 字段；`screen_candidates.exclude_in_watchlist` 含归档项（已观察过的票不再回到候选）
  - `frontend/api/_lib/watchlist10x.js` + `frontend/api/watchlist/10x.js`：JS port + endpoint 透传
  - `frontend/src/pages/Screener10x.jsx`：右栏顶部「显示归档」toggle；每张观察卡片加「归档」/「恢复」按钮；归档项 opacity-60 + 角标"归档"视觉区分
- **10x 猎手 watchlist 备份/恢复**：导出 JSON 文件 + 导入 (merge/replace) — 防 KV 数据丢失 / 跨设备迁移
  - `backend/watchlist_10x.py`：`export_data()` 含时间戳；`import_data(payload, mode)` 支持 merge（按 ticker / id 去重，payload 覆盖）和 replace（清空再写）；导入时与内置 supertrend id 冲突的用户赛道自动跳过（保护内置语义）
  - `backend/server.py`：`GET /api/watchlist/10x/export` + `POST /api/watchlist/10x/import`
  - `frontend/api/_lib/watchlist10x.js`：JS port；`frontend/api/watchlist/10x/export.js` + `import.js` Vercel endpoint
  - `frontend/src/pages/Screener10x.jsx`：观察列表顶栏加 ⬇ 导出 / ⬆ 导入 按钮；导入用 `<input type=file hidden>` + `window.prompt` 选 merge/replace；返回 stats（添加/更新数）
  - 测试：backend pytest 8 例 + frontend vitest 7 例
- **10x 猎手 production backend**（Vercel Serverless + KV + DeepSeek）：让线上完整可用，不再仅"演示模式"
  - **基础 helpers** (`frontend/api/_lib/`)：`kv.js` (Upstash REST) / `auth.js` (referer 白名单) / `sectorMapping.js` (1:1 移植 backend) / `universeLoader.js` (self-fetch + 内存 cache) / `watchlist10x.js` (KV 持久化业务) / `deepseek.js` / `llmCache.js`
  - **Watchlist endpoints**：`/api/watchlist/10x` (GET/POST) / `/api/watchlist/10x/{ticker}` (PUT/DELETE) / `/api/watchlist/10x/screen` (POST) / `/api/watchlist/10x/supertrends` (GET/POST)
  - **LLM endpoints**：`/api/llm/10x-thesis` (含 yahoo profile 业务描述兜底) / `/api/llm/match-supertrend` (赛道智能匹配) / `/api/llm/rank-candidates` (候选股按卡位独特性 1-5 打分) / `/api/llm/generate-keywords` (赛道关键词起草)
  - **Universe endpoint**：`/api/universe/stats`
  - **前端**：`AddSupertrendDialog.jsx` 新组件 — 添加自定义赛道（含 AI 关键词生成按钮），左栏底部接入 `+ 自定义赛道` 按钮
  - **数据上线**：新增 `backend/export_universe_to_frontend.py` 把 `backend/output/universe_*.json` 复制到 `frontend/public/data/universe/`（git track），vercel 部署带数据，serverless self-fetch
  - **测试**：vitest 56 例（`sectorMapping` 21 / `watchlist10x` 24 / `deepseek` 11）
  - **配置**：`frontend/.env.example` 模板 + README 加 Vercel 部署 4 步流程
  - **环境变量**：`DEEPSEEK_API_KEY`（必需，LLM）/ `KV_REST_API_URL` + `KV_REST_API_TOKEN`（必需，watchlist 持久化）/ `QUANTEDGE_ALLOWED_HOSTS`（可选，自定义域名）
- 项目根 `package.json` 提供 `dev` / `refresh-data` / `serve-api` / `test` / `lint:py` 等便捷脚本
- `pyproject.toml` 集中配置 ruff + pytest
- `.github/workflows/ci.yml`：push/PR 自动跑 ruff + pytest + vitest + vite build
- `backend/.env.example` 模板（含 ITICK_API_KEY）
- `backend/logging_config.py` — RotatingFileHandler 替代无限增长的 server.log
- `backend/tests/test_factors_basic.py`（15 例，覆盖 RSI / 动量 / 评分 / 杠杆 ETF）
- `backend/tests/test_data_sources.py`（network 标记，CI 默认跳过）
- `frontend/src/standalone.test.js`（resolveSector / validateStockData 基础用例）
- `docs/ARCHITECTURE.md` 描述四条数据加载路径与多源容错链
- `frontend/api/yahoo.js` 加 referer 白名单防止公网滥用
- `vite.config.js` `sourcemap: 'hidden'` 便于线上排错

### Changed
- `screen_candidates`：当用户设了市值上限/下限，缺市值（`marketCap=None`）标的的处理由"默认排除"改为"默认保留"。需要旧行为时显式传 `include_no_mcap=False`
- `frontend/quant-platform.jsx` 移入 `frontend/src/`，与其余前端源码一致
- `pipeline.py` 不再写 `output/frontend_data.js`（与 `frontend/src/data.js` 完全重复）
- `main.jsx` 的 Recharts 0×0 警告过滤简化为 dev-only，不再篡改生产环境的 console
- `tickers_custom.json` 改为本地态（gitignore），新增 `tickers_custom.example.json` 模板

### Notes
- 首次接入 ruff，存量代码有 23 处 lint 提示（unused-import / redundant-open-modes 等），CI 暂以 `continue-on-error` 模式运行 — 待后续清理后改为强制
- Batch 4 中"拆 quant-platform.jsx (6775 行)" / "拆 server.py (975 行)" / "STOCKS/ALERTS Context 化" / "data.js → fetch JSON" 四项属于 M-L 级重构，需独立 PR 单独验证，此次未执行

### Removed
- 根目录残留的旧版本文件：`pipeline.py` / `config.py` / `factors.py` / `quant-platform.jsx` / `requirements.txt`（与 `backend/` `frontend/` 实际版本不同步，已淘汰）
- 迁移期归档：`files.zip` / `quant-pipeline.tar.gz` / 根 `output/` / 根 `__pycache__/`

## [0.6.0] - 2026-04 (pre-changelog era)

- Enterprise-grade UI/UX overhaul（commit `e0f5f82`）
- 多源数据路由 (iTick / Futu / AKShare / yfinance)
- Vercel 部署 + serverless Yahoo proxy
