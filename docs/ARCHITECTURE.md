# QuantEdge 架构与数据流

状态日期：2026-08-28

配套阅读：[项目背景](PROJECT_CONTEXT.md)、[安全威胁模型](SECURITY_THREAT_MODEL.md)、[部署与运维](DEPLOYMENT.md)。

## 1. 生产拓扑

```text
浏览器 React SPA
  │ 仅同源 /api，HttpOnly 会话 Cookie，写请求附 CSRF token
  ▼
Vercel Serverless BFF
  ├─ /api/auth/invite
  ├─ /api/auth/session
  ├─ /api/auth/logout
  ├─ /api/yahoo
  ├─ 专用 serverless handlers
  └─ /api/[...path] 受控反向代理
       │ HMAC 绑定 method、path、query、body hash、request_id、timestamp
       ▼
Render FastAPI
  ├─ /healthz 公开健康检查
  ├─ 评分、回测、组合、宏观、Stock Gene、Mining Alpha
  ├─ SQLite 与 output 文件
  └─ Yahoo、FRED、Tushare、Futu、Finnhub、DeepSeek 等受控上游
```

生产浏览器不得直连 Render，也不得使用公共 CORS 代理。Render 除 `/healthz` 外只接受 BFF 内部签名。开发环境的 Vite `/api` 代理可访问本机 FastAPI；FastAPI 只对 loopback 和 TestClient 保留未签名本地通道。

## 2. 认证与工作区

当前产品维持单一私有工作区，不迁移现有数据。

- 邀请码只保存在 Vercel 的 `QUANTEDGE_INVITE_CODE`。
- 登录成功签发八小时 HttpOnly、Secure、SameSite=Lax Cookie。
- 会话声明包含固定 `workspace_id=private-default`，由现有 WorkspaceContext 消费。
- GET 会话接口返回用户、工作区、过期时间与内存 CSRF token。
- 所有非安全方法必须通过精确 Origin 检查、有效会话与 CSRF 校验。
- 注销清除会话 Cookie。

未来多用户化只能扩展 WorkspaceContext 与持久化授权模型，不能把客户端传入的 workspace_id 直接作为授权依据。

## 3. 数据加载与契约

生产优先级如下：

| 优先级 | 路径 | 约束 |
|---|---|---|
| 1 | 同源 Vercel BFF | 生产唯一在线 API 入口 |
| 2 | 项目内静态数据 | 只用于明确标注的 demo 或 fallback |
| 3 | IndexedDB 或 localStorage | 只保存允许的客户端偏好和有时点的数据 |
| 4 | 显式不可用状态 | 不使用公共代理伪造可用性 |

BFF 通用成功响应：

```json
{
  "data": {},
  "meta": {
    "as_of": "2026-08-28T00:00:00.000Z",
    "source": "backend",
    "cache_status": "bypass",
    "stale": false,
    "quality": "verified",
    "schema_version": "1.0",
    "request_id": "uuid"
  }
}
```

非 2xx 使用 `error.code`、`error.message`、`error.request_id` 与 `meta.request_id`。前端 `apiFetch` 对非 2xx 抛出 ApiError，不再把错误对象当作成功数据。

Yahoo 报价执行 network-first：30 秒以内可标记 fresh；上游失败时最多回退五分钟，超过上限返回不可用；Service Worker 不缓存任何 `/api/` 请求。

## 4. 后端边界

FastAPI 中间件统一处理：

- 256 KiB 请求体上限。
- BFF HMAC 签名、60 秒时窗、请求体摘要与 request_id 重放检查。
- LLM、回测、调度和 Mining Alpha 的独立并发上限。
- request_id、route、status、latency_ms、cache 与 upstream 结构化日志。

Mining Alpha 管理任务只接受 Pydantic 强类型字段。每个 step 都有独立字段白名单，额外字段被拒绝；run_id 必须通过格式和解析后路径边界校验；任务在启动线程前同步预占状态，重复提交返回 409。

## 5. 前端模块

```text
src/
├─ quant-platform.jsx      主壳、认证门、导航与共享 provider
├─ pages/                  功能页 lazy route
├─ components/             可复用 UI 与业务组件
├─ hooks/                  数据获取与交互状态
├─ lib/                    纯函数、数据服务与算法
├─ data/                   功能级 demo 数据
├─ data.js                 历史 pipeline fallback，待按市场继续分片
├─ i18n.jsx                简体中文、英文、繁体中文词典
└─ main.jsx                应用入口、可选 Sentry 与 Service Worker
```

主壳、评分页、回测页仍是后续拆分重点。组合回测旋钮的外观、拖动方向、0.1 精度、刻度点击与 pointer-lock 属于兼容性保留项。

## 6. 部署与版本

- 前端与 BFF：Vercel，项目根目录 `frontend/`。
- 后端：Render，健康检查 `/healthz`。
- CI：GitHub Actions，Python 3.11 与 Node 22。
- 项目版本：`pyproject.toml`。
- 前端版本：`frontend/package.json`。
- 后端运行时 API 版本：`backend/server.py` 的 FastAPI version，后续统一从项目版本生成。
- UI 展示版本：后续统一从构建期 Git SHA 与 package version 注入。

## 7. 安全与数据不变量

- 密钥不得使用 `VITE_` 前缀或进入静态 bundle。
- 生产 API 只走同源 BFF。
- 公共 CORS 代理不得进入降级链。
- 报价必须携带可核验时点和 stale 状态。
- 非 2xx 不得进入成功数据分支。
- 管理任务不得接受自由命令参数。
- 新增后端根路由必须同步 BFF 白名单、安全测试与数据契约测试。
- 新增 lazy route 必须通过单路由 150 KB gzip 预算。
