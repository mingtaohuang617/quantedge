# Changelog

All notable changes to QuantEdge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
