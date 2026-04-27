# Changelog

All notable changes to QuantEdge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
