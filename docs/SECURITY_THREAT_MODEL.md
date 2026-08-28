# QuantEdge 安全威胁模型

审计日期：2026-08-28

适用范围：QuantEdge 私有单工作区、Vercel 前端与 BFF、Render FastAPI、Yahoo Finance 与 LLM 等上游。本轮不迁移现有业务数据，也不开放多租户。

## 结论

浏览器不再持有邀请码或直连 Render。生产请求必须先通过 Vercel 同源 BFF 的会话、Origin、CSRF、请求体、速率与并发检查，再由 BFF 对完整方法、路径、查询参数和请求体摘要签名。Render 除健康检查外拒绝未签名请求。

当前剩余的主要风险是限流、并发计数与重放记录仍为单进程内存状态。它足以保护当前私有低并发工作区，但不能作为公开注册或多实例扩容后的最终边界。引入共享限流存储属于外部服务与运行成本变更，需单独批准。

## 资产与信任边界

| 资产 | 机密性 | 完整性 | 可用性 |
|---|---:|---:|---:|
| 邀请码、会话签名密钥、BFF 内部签名密钥 | 高 | 高 | 中 |
| 组合、交易、日志、评分与研究数据 | 高 | 高 | 高 |
| 行情及其时点、来源、缓存状态 | 中 | 高 | 高 |
| LLM 配额、回测、调度与 Mining Alpha 计算资源 | 中 | 高 | 高 |
| 部署与错误日志 | 高 | 高 | 中 |

信任边界如下：

```text
浏览器
  │ 同源 Cookie、Origin、CSRF
  ▼
Vercel BFF
  │ HMAC 签名、时间窗、请求体摘要、request_id
  ▼
Render FastAPI
  │ 固定上游协议
  ├─ Yahoo Finance
  ├─ DeepSeek
  └─ 其他受控数据源
```

## 主要攻击路径与控制

| 攻击路径 | 前置条件 | 影响 | 已实施控制 | 剩余风险 |
|---|---|---|---|---|
| 从前端包提取邀请码 | 能下载公开静态资源 | 绕过私有访问 | 邀请码仅从 `QUANTEDGE_INVITE_CODE` 读取；服务端恒定时间比较；失败限流 | 环境变量泄露仍可导致失守 |
| 伪造跨站请求 | 用户已登录且访问恶意站点 | 修改组合、触发任务、消耗配额 | 精确 Origin 白名单；SameSite=Lax；写请求必须携带会话内 CSRF token | 浏览器或同源 XSS 仍可代用户操作 |
| 窃取或篡改会话 | 获得 Cookie 或能修改 Cookie | 越权访问私有工作区 | HttpOnly、Secure、SameSite=Lax；HMAC；八小时过期；版本、主体、工作区与时间边界校验 | 注销主要依赖清除 Cookie；跨实例即时吊销尚未持久化 |
| 绕过 BFF 直连 Render | 知道 Render URL | 读取或修改内部 API | 生产除 `/healthz` 外必须校验 HMAC；签名绑定方法、完整路径、查询串、请求体摘要与 request_id；60 秒时窗与重放检查 | 单进程重放表不跨实例共享 |
| 路径穿越或命令参数注入 | 能控制 API 路径或任务参数 | 读取任意文件、执行任意参数 | BFF 根路由白名单；拒绝反斜杠、空段、点段；run_id 正则与解析后目录约束；Pydantic 强类型字段白名单，禁止额外字段 | 新增管理路由时必须同步白名单和测试 |
| 重复或高成本任务 | 已登录会话 | 成本激增、服务不可用 | BFF 分资源速率与并发上限；Render 二次并发上限；Mining Alpha 同步预占任务状态并返回 409 | 限流与并发状态为单实例内存 |
| 过期报价被展示为实时 | Yahoo 超时、缓存或 Service Worker 命中 | 错误投资判断 | 报价 network-first；30 秒内为 fresh；仅在上游失败时回退且不超过 5 分钟；Service Worker 不再缓存 `/api/` | UI 尚需在所有页面一致展示 meta 状态 |
| 上游错误被当作成功数据 | 上游非 2xx 或返回异常载荷 | 页面展示错误结论 | 前端统一对非 2xx 抛结构化错误；BFF 保留上游状态并附 request_id | 旧的专用 handler 尚需逐步统一完整 data/meta 契约 |
| 公共 CORS 代理泄露请求 | 本地或生产降级链触发 | 数据泄露、内容篡改 | 删除 corsproxy.io 与 allorigins 降级；浏览器仅访问同源 API | Yahoo 上游可用性下降时只允许有界缓存或显式失败 |

## 已验证的安全不变量

- 未登录请求返回 401。
- 伪造 Origin 返回 403。
- 缺失或错误 CSRF 返回 403。
- 过期或被篡改的会话不可用。
- Render 生产模式下未签名直连返回 401。
- 过期签名、请求体被修改和重复 request_id 被拒绝。
- 路径穿越 run_id 被拒绝。
- Mining Alpha 额外字段与不属于当前 step 的字段被拒绝。
- 已运行任务再次提交返回 409。
- 超过请求体上限返回 413。

对应自动化覆盖位于 `frontend/api/_lib/auth.test.js` 与 `backend/tests/test_security_boundary.py`。

## 运维要求

- Vercel 必须分别配置 `QUANTEDGE_INVITE_CODE`、`QUANTEDGE_SESSION_SECRET`、`QUANTEDGE_BFF_SECRET` 和 `QUANTEDGE_BACKEND_URL`。
- Render 必须配置同值的 `QUANTEDGE_BFF_SECRET`，并设置 `QUANTEDGE_ENV=production`。
- 两个签名密钥必须各自独立、至少 32 字符，不得使用 `VITE_` 前缀。
- 健康检查只使用 `/healthz`。其他 Render 路由出现 unsigned local fallback 视为生产配置错误。
- 不在浏览器控制台、响应体或常规日志中记录邀请码、Cookie、CSRF token、签名和原始上游错误体。
- 公开注册、多工作区或多实例扩容前，必须先把会话吊销、失败限流和重放记录迁移到共享存储，并重新完成威胁模型与渗透测试。

## 证据定位

- Origin、会话、Cookie、CSRF 与限流：`frontend/api/_lib/auth.js:11`
- 邀请码服务端校验：`frontend/api/auth/_invite.js:14`
- BFF 路由白名单、成本限制与签名：`frontend/api/_lib/backendProxy.js:7`
- Render 签名校验、请求体上限、重放和并发：`backend/server.py:611`
- Mining Alpha 强类型参数与重复任务防护：`backend/server.py:2784`
- 报价 network-first 与五分钟回退上限：`frontend/api/yahoo.js:60`
- Service Worker API 缓存禁用：`frontend/public/sw.js:37`

## 工具状态说明

本次已按项目代码完成威胁建模和自动化验证。正式 Codex Security 扫描入口在 Windows 中文路径上因插件使用系统 GBK 解码而在创建扫描 ID 前失败，错误为 `UnicodeDecodeError`，随后触发空值 `AttributeError`。因此本文件不是对正式扫描已成功完成的替代声明；修复插件编码后仍需重新运行正式扫描。
