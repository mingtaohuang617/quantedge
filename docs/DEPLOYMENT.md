# Deployment & Operations

## 部署架构

| 组件 | 平台 | 状态 |
|---|---|---|
| Frontend SPA | Vercel (`vercel.app/quantedge`) | ✅ 自动 |
| `/api/yahoo` 代理 | Vercel Serverless Function | ✅ 自动随前端部署 |
| Backend (可选) | 本地 / 独立服务 | 仅独立模式不需要 |

## 一、首次部署 / CI/CD 配置

### 1.1 GitHub Actions（已在 `.github/workflows/ci.yml`）

每次 push/PR 自动跑：
- backend pytest
- frontend vitest（52 单测）
- frontend Vite build
- Playwright E2E（7 关键路径）

`push main` 额外触发 Vercel 自动部署。

### 1.2 配置 Vercel 自动部署 secrets

GitHub repo → **Settings → Secrets and variables → Actions** 添加：

| Secret | 怎么拿 |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens → "Create" |
| `VERCEL_ORG_ID` | `cat frontend/.vercel/project.json` → `orgId` |
| `VERCEL_PROJECT_ID` | 同上 → `projectId` |

未配置时 `deploy-prod` 作业会优雅失败（不影响测试结果），可以先只跑 CI，后续再配。

---

## 二、可选环境变量（按需开启）

在 Vercel 控制台 **Settings → Environment Variables** 配置。配置后需重新部署生效。

### 2.1 Sentry 错误监控（H7）

```
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
VITE_SENTRY_TRACES_RATE=0.1   # 可选，默认 10%
VITE_APP_VERSION=quantedge@v0.7.0   # 可选，方便区分版本
```

**步骤：**
1. https://sentry.io 注册免费账号（5K events/月免费）
2. 创建 React 项目 → 拿 DSN
3. 填到 Vercel env vars → redeploy
4. 之后任何 React 渲染错误 / `pageerror` 会自动上报

未配置时 Sentry chunk（152 KB gzip）**不会下载** — 完全零开销。

### 2.2 Vercel KV 缓存（C15）

`/api/yahoo` 默认每次请求都直连 Yahoo（命中率 0%，每次 800-1500 ms）。
配置 KV 后，相同 ticker+range 的请求 5 分钟内直接从 Redis 返回（命中率约 80%，<50 ms）。

**步骤：**
1. Vercel 项目 → **Storage → Create Database → KV**
2. 选择"Connect to Project" → quantedge
3. 自动注入 `KV_REST_API_URL` + `KV_REST_API_TOKEN` 环境变量
4. Redeploy

**验证：** DevTools Network → 任一 `/api/yahoo` 请求 → Response Headers 看 `X-Cache-Status`：
- `HIT` ＝ 从 KV 返回（快）
- `MISS` ＝ 这次拉了上游 + 顺手存进 KV（下次会 HIT）
- `BYPASS` ＝ KV 未配置（与改造前行为一致）

**TTL 策略**（在 `api/yahoo.js`）：
- K线 (`/v8/finance/chart/...`) — 5 min
- 财务 (`quoteSummary`) — 2 min
- 搜索 (`autoc` / `search`) — 10 min
- 其他默认 — 3 min

**成本：** Vercel KV Free tier 30K commands/month + 256MB 存储，足够日常。超额按量计费。

---

## 三、常用运维命令

```bash
# 本地全套测试（unit + E2E）
cd frontend
npm test              # vitest（52 单测，<1s）
npm run test:e2e      # Playwright（7 E2E，~10s，自动启 preview server）
npm run test:e2e:ui   # 带浏览器调试 UI

# 手动部署到 Vercel（应急用，正常 push main 自动跑）
cd /path/to/quantedge   # 项目根目录（不是 frontend）
vercel --prod --yes

# 检查部署状态
vercel ls
vercel inspect <deployment-url>
```

---

## 四、邀请码 / 权限

当前邀请码：`MintoInvest`（在 `frontend/src/quant-platform.jsx` `INVITE_CODE` 常量中）

修改后需要重新部署。后续考虑改成 ENV var 或后端验证。

---

## 五、故障排查

| 现象 | 检查 |
|---|---|
| 页面打不开 / 白屏 | DevTools Console 看是否 `ReferenceError`（被 Sentry / E2E 抓出）|
| `/api/yahoo` 返回 403 | Referer 不在白名单。生产域名需要在 Vercel env vars 加 `QUANTEDGE_ALLOWED_HOSTS` |
| Yahoo 数据"离线" | DevTools Network 看 `/api/yahoo` 响应 — 502 = 上游超时；403 = 白名单；HIT/MISS = 正常 |
| CI 跑了但没部署 | GitHub Actions → 看 deploy-prod 作业，secrets 是否齐 |
| E2E 在 CI 失败但本地过 | Playwright report artifact 7 天保留，下载看 trace |
