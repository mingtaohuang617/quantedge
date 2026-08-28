# QuantEdge 后端运行时

状态日期：2026-08-28

## 1. 运行边界

Render 运行 FastAPI，业务路由只接受 Vercel BFF HMAC 签名。`/healthz` 是唯一公开探活路由。本地 loopback 和 FastAPI TestClient 保留未签名开发通道，生产不允许浏览器直连 Render。

## 2. 请求生命周期

1. 限制请求体为 256 KiB。
2. 验证 method、path、query、body hash、request_id 和 timestamp 的 HMAC。
3. 拒绝超过 60 秒时窗、重放 request_id 和路径越界。
4. 按资源类型执行 LLM、回测、调度和 Mining Alpha 并发上限。
5. 返回结构化响应，记录 request_id、route、status、latency_ms、cache、upstream 与脱敏错误。

## 3. 模块边界

| 模块 | 职责 | 持久化/产物 |
|---|---|---|
| `server.py` | HTTP 路由、安全中间件、并发门禁 | 无独立业务事实 |
| `pipeline.py` | 拉数、评分、告警、快照生成 | `backend/output/`、`frontend/src/data.js` |
| `data_sources/` | 市场路由、归一化、断路和缓存 | SQLite L0 |
| `factors.py` / `factors_lib/` | 股票与宏观纯计算 | 可重现输出 |
| `mining_alpha/` | 因子、IC、训练、回测与运行产物 | Parquet/JSON，以 run_id 分区 |
| `regime/` | HMM 三态、Bry-Boschan 与持续期 | 宏观快照 |
| `db.py` | SQLite 事实库与查询 | `backend/data/quantedge.db` |

## 4. 管理任务

Mining Alpha 等管理任务只接受 Pydantic 强类型字段和 step 级白名单。禁止 `extra_args`、任意命令片段和未校验路径。run_id 需同时通过格式、解析后目录边界和重复任务检查。

## 5. 版本与验证

- 根 `VERSION` 是唯一产品版本源。
- FastAPI OpenAPI version 在启动时读取 `VERSION`。
- `frontend/scripts/check-version.mjs` 确保根 package、前端 package 和 pyproject 声明与之一致。
- 后端变更最低验证是 Ruff、非网络 pytest、安全边界契约和 Mining Alpha 合成数据冒烟。
