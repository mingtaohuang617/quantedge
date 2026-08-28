# QuantEdge 部署与运维

状态日期：2026-08-28

## 结论

生产由 Vercel 托管 SPA 与同源 BFF，Render 承载 FastAPI。浏览器只访问 Vercel；Render 只接受带内部签名的 BFF 请求，唯独 `/healthz` 可公开探活。

任何生产部署都必须先通过 CI、Preview 冒烟和移动端检查，并保留上一条 Ready deployment 作为回滚点。数据库迁移、权限变更、付费资源、外部遥测和不可逆删除需要单独确认。

## 1. 必填环境变量

Vercel：

```env
QUANTEDGE_INVITE_CODE=
QUANTEDGE_SESSION_SECRET=
QUANTEDGE_BACKEND_URL=
QUANTEDGE_BFF_SECRET=
QUANTEDGE_ALLOWED_HOSTS=
```

Render：

```env
QUANTEDGE_BFF_SECRET=
QUANTEDGE_ENV=production
```

要求：

- `QUANTEDGE_SESSION_SECRET` 与 `QUANTEDGE_BFF_SECRET` 必须不同且至少 32 字符。
- Vercel 与 Render 的 BFF secret 必须完全一致。
- 邀请码和密钥不得使用 `VITE_` 前缀，不得提交到仓库。
- 自定义生产域名加入 `QUANTEDGE_ALLOWED_HOSTS`，多个 hostname 用逗号分隔。
- 不存在现成 Sentry DSN 时不得新开外部遥测。

## 2. 本地安装与验证

```bash
python -m pip install -r backend/requirements.txt
python -m ruff check backend
python -m pytest backend/tests -m "not network" --tb=short

cd frontend
npm ci --no-audit --no-fund
npm run audit:i18n:all
npm run check:version
npm test
npm run build
npm run test:e2e
```

Python 版本为 3.11，Node 版本为 22。Python 直接依赖、测试工具、前端依赖与 Vercel CLI 都必须使用仓库锁定版本。

## 3. CI 与发布顺序

- backend：精确依赖安装、Ruff 硬门禁、非网络测试、Mining Alpha 合成数据冒烟。
- frontend：npm ci、依赖审计、import/i18n/版本一致性审计、710 项 Vitest、生产 build、bundle budget。
- e2e：Chromium、移动端、响应式、axe serious/critical、旋钮与侧栏交互。
- preview：部署 Preview，检查认证、核心页面、核心 API、Service Worker 与 5xx。
- production：只从通过全部门禁的 main 发布。
- post-deploy：核验生产域名、deployment Ready、核心路径、近期错误日志和 Git SHA。

发布失败时回滚上一条 Ready deployment 或上一提交。若前端资产与旧 Service Worker 冲突，递增 `frontend/public/sw.js` 的 VERSION 后重新构建；不得让 Service Worker 缓存 `/api/`。

## 4. 认证验证

部署前至少覆盖：

- 未登录访问 `/api/auth/session` 返回 401。
- 错误邀请码返回 401，连续失败触发 429。
- 登录响应设置 HttpOnly、Secure、SameSite=Lax Cookie。
- 过期或被篡改 Cookie 返回 401。
- 写请求缺失 CSRF 返回 403。
- 伪造 Origin 返回 403。
- 注销后浏览器 Cookie 被清除。
- 直接访问 Render 业务 API 返回 401。
- `/healthz` 返回 200。

邀请码只能在 Vercel 环境变量中轮换。修改环境变量后需重新部署，不修改前端代码。

## 5. 报价与缓存验证

- 正常上游：`X-Cache-Status` 为 BYPASS 或 MISS，`X-Data-Stale=false`。
- 失败回退且缓存年龄不超过 30 秒：HIT-FRESH。
- 失败回退且缓存年龄在 30 秒至 5 分钟：FALLBACK 且 `X-Data-Stale=true`。
- 缓存超过 5 分钟：返回 502，不得继续展示为实时。
- Service Worker 的 Cache Storage 中不得新增 `/api/` 响应。

KV 不是必需组件。若未来需要跨实例限流、会话吊销或缓存，新增共享存储属于付费资源与架构变更，必须先确认。

## 6. Sentry

代码仅在已存在 `VITE_SENTRY_DSN` 且为生产构建时异步加载 Sentry。未配置 DSN 时不发送任何外部遥测。

如项目已经有 DSN，可配置：

```env
VITE_SENTRY_DSN=
VITE_SENTRY_TRACES_RATE=0.1
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

release 由 package version 与 CI Git SHA 自动生成。有完整的 Sentry 构建凭据时才生成 sourcemap；上传到既有私有项目后从静态产物删除。没有现成 DSN 或构建凭据时保持关闭，不新增外部遥测。

## 7. 常用运维命令

```bash
git rev-parse origin/main
git status --short

cd frontend
npx vercel@59.9.1 pull --yes --environment=preview
npx vercel@59.9.1 build
npx vercel@59.9.1 deploy --prebuilt

npx vercel@59.9.1 ls
npx vercel@59.9.1 inspect DEPLOYMENT_URL
npx vercel@59.9.1 logs DEPLOYMENT_URL
```

生产部署使用同一固定 CLI 版本并加 `--prod`。不要在未保存上一条 Ready deployment URL 时覆盖生产。

## 8. 故障定位

| 现象 | 先检查 |
|---|---|
| 登录循环 | session endpoint 状态、Set-Cookie 属性、允许域名、系统时间 |
| 写请求 403 | Origin 与 X-CSRF-Token |
| Render API 401 | 两端 BFF secret、时间偏差、签名路径与查询串 |
| 行情显示 stale | X-Data-As-Of、缓存年龄、Yahoo 上游状态 |
| 429 | X-RateLimit-Remaining、Retry-After、当前重任务 |
| 页面白屏 | deployment SHA、动态 chunk、Service Worker 版本、浏览器 console |
| CI 通过但未发布 | deploy-prod job、Vercel secrets、deployment inspect |
| 生产 5xx | request_id 关联 Vercel 与 Render 日志，确认 route、status、latency、upstream |
