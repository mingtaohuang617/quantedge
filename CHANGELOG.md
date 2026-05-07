# Changelog

All notable changes to QuantEdge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **10x 猎手** v1.0 — 三段式工作流（赛道勾选 → 候选筛选 → 观察列表 + AI thesis 草稿）
  - `backend/universe/`：US/HK/CN 候选股池同步（NASDAQ Symbol Directory + 富途 OpenD/yfinance enrich）— Sprint 1 (9514231) + 富途接入 (071f0a4, bbdf282)
  - `backend/sector_mapping.py`：行业字符串 → 4 个内置超级赛道（AI 算力 / 半导体 / 光通信 / 算力中心）— Sprint 2 (f859406) + 关键词对齐修正 (5d7d675)
  - `backend/watchlist_10x.py`：watchlist CRUD + screen_candidates + 用户自定义赛道管理 — Sprint 3 (9ea4ee2)
  - `backend/server.py`：9 个 10x 相关 REST 端点 — Sprint 3 (9ea4ee2)
  - `backend/llm.py:tenx_thesis`：DeepSeek 生成 5 段卡位分析（超级趋势 / 瓶颈层 / 卡位逻辑 / 风险 / 推演结论），24h 缓存
  - `frontend/src/pages/Screener10x.jsx` + `frontend/src/components/TenxItemEditor.jsx`：三栏页面 + 编辑模态框 — Sprint 4 (3cfe193)
- **10x 猎手 v1.5** — 精严 / 宽泛模式切换：精严仅用核心赛道关键词（光通信/硅光/AI/HBM），宽泛扩展到通讯设备/应用软件等大池 (0202dcf)
- **10x 猎手 P0 修复**（本次）：
  - 用户自定义赛道支持自带关键词（`keywords_zh` / `keywords_en`），加完赛道实际可参与筛选 — 之前 `add_supertrend()` 只存 id/name/note，导致用户赛道在 `screen_candidates` 永远命中 0 只股
  - `screen_candidates(include_no_mcap=True)` 新参数，缺市值（`marketCap=None`）标的默认保留 — 避免设了市值上限后静默丢失 A 股池
  - `backend/tests/test_watchlist_10x.py` 新增 5 个 case 覆盖上述行为
  - `frontend/src/pages/Screener10x.jsx` 候选 0 行空状态文案在精严模式下提示"关闭精严模式"
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
