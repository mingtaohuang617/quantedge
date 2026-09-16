# TradingView 私有研究接入

## 当前阅读口径（2026-09-16）

19 个星标的生产日线验收已在 [PR #332 对应发布流程](https://github.com/mingtaohuang617/quantedge/actions/runs/35087647620) 通过，生产登录与行情凭据授权已完成。下方 2026-09-15 的“未发布、未授权、未取得名单”等文字是带日期的历史排障记录，不代表当前状态。全股票池实现见文末“全股票池日线快照”；实际发布结果以对应 CI 记录为准。

本轮仍仅提供 1D 数据和同周期指标，不自动覆盖财报、评分或回测输入。服务端发布快照是有明确采集日期的一次批量结果；逐只按需刷新仍可用，但没有新增每日定时采集任务。

## 历史排障记录（2026-09-15）

本轮星标队列验收（2026-09-15 18:26 香港时间）：隔离发布分支 45 个测试文件、733 项测试通过；桌面 1440px / 手机 390px 的固定星标样本操作与 axe 验收 2 项通过，构建与包体预算通过。SPY、NVDA 按明确 Cboe 来源实测均返回 100 根日线。用户实际星标名单未取得，因此真实关注集合尚未执行刷新；上述验证不得解释为“全部关注已更新”。原有 /api/status 无本地 Python 后端的连接错误不属于完整后端验收。

星标优先扩展（2026-09-15）：新增全部星标更新，以及先星标再遍历当前股票池的日线队列。名单来自 /api/watchlist/favorites 或明确标注的浏览器缓存；未知空名单不会猜测扩展。6 秒请求间隔，错误逐项记录，鉴权/配置/限流错误停止，成功摘要保存在本机 quantedge_daily_snapshots_v1，不改写原星标、财报、评分或回测源。US 无前缀代码明确使用 BATS/Cboe，港股/A 股按后缀映射；不支持的市场单独报告。

尚未读取用户实际星标名单，因此尚未执行“全部关注”的真实数据刷新；需要名单导出或可访问的已登录 QuantEdge 会话。云端凭据授权仍然待确认，无生产发布或秘密上传。

## 生产发布准备状态（2026-09-15 17:34 香港时间）

生产当前为 6c74535，尚未包含本地新研究工作区。已从该生产分支建立独立发布工作区 codex/tradingview-daily-production，只增加“日线研究”入口（?tab=dailyResearch），不携带平台重构、Futu 改动和数据库迁移。原工作区保持不变。

本发布分支：725 项单元/路由测试、2 项桌面/手机浏览器检查、构建、包体预算、导入及发布门禁检查通过。BTC 日线复测成功返回 100 根 K 线及指标；仍须 Preview 验证实际云端网络与子进程打包。

当前未提交、未推送、未部署，正式域名未改变。上传 TV_SESSION/TV_SIGNATURE 到用户 QuantEdge GitHub 加密 Secrets 的操作被自动安全审核拒绝，尚未传送凭据；需要用户明确授权凭据上传及 Vercel 服务端使用后才能继续。不得以其他方式绕过该拦截。

拟沿用现有 GitHub Actions：凭据通过 stdin 设置为 QUANTEDGE_TV_SESSION / QUANTEDGE_TV_SIGNATURE；只在 Preview / production 部署步骤注入服务端运行时，不带本机 TV_PROXY，不进入 VITE_ 变量或源码。Preview 和 production 均新增登录、拒绝小时请求及三市场日线实测；生产失败沿用现有回滚步骤。

接入日期：2026-09-15。版本：@mathieuc/tradingview 3.5.2。

## 范围

研究页提供按需 K 线快照及 TradingView 默认 RSI / MACD。没有替换回测、评分、组合估值或 Futu 期权数据。未实现交易、后台订阅或公共行情分发。

GET /api/private/market-data/tradingview?symbol=NASDAQ:AAPL&timeframe=1D

需要现有 QuantEdge 登录会话及允许的来源。仅支持 GET；每会话每分钟 12 次、每进程最多 2 个并发查询。成功快照缓存 15 秒，HTTP 响应仍为 private/no-store。失败不回退匿名或返回过期成功结果。上游工作进程最多 28 秒，完成或失败后关闭。

支持 NASDAQ / NYSE / AMEX / BATS / HKEX / SSE / SZSE / BINANCE，仅支持日线 1D，省略周期时默认 1D，最多返回 100 根日 K 线（倒序）。这是允许的代码格式，不代表每个代码都有数据权限。

2026-09-15 按用户要求收紧粒度：页面周期固定日线；接口、适配器及工作进程均拒绝非日线，不读取分钟、小时或 tick 数据。RSI/MACD 使用同一日线周期。采集时间和源端延迟属于元数据，不代表读取了日内行情。当日尚未收盘的日 K 线仍可能变化；当前没有额外限制为“仅已收盘日线”。本说明下方原始验证记录属于收紧前的历史测试。

日线改动验证（2026-09-15 17:20–17:22 香港时间）：9 项针对性测试、2 项桌面/手机浏览器测试、生产构建通过。腾讯通过本地真实 HTTP 返回 100 根日 K 线及对齐的日线 RSI/MACD。BTC 的 QuantEdge HTTP 请求连续两次超时；独立探针能够取回 BTC 日线与指标，说明尚需排查集成链路，不能认定为已稳定可用。未通过回退分钟线规避失败。仍未部署生产。

## 本地启用

服务端环境变量：QUANTEDGE_TRADINGVIEW_ENABLED=1、TV_SESSION、TV_SIGNATURE，必要时 TV_PROXY=http://127.0.0.1:7890。同时需要原有 QUANTEDGE_SESSION_SECRET 和 QuantEdge 登录。浏览器登录 TradingView 不会自动把会话交给 Node。

不要把 Cookie 填进网页输入框、VITE_ 变量、源码或 Git。现有测试目录 .env 可通过 Node 直接载入，无需复制秘密：

```powershell
# 在 frontend 目录；替换为自己的绝对路径。不输出 .env 内容。
$env:QUANTEDGE_TRADINGVIEW_ENABLED='1'
node --env-file='C:/path/to/tradingview-test/.env' node_modules/vite/bin/vite.js
```

Vite dev 和 preview 使用与生产相同的私有接口鉴权；其余 API 仍按原有代理配置工作。Vite 不会自动把 .env 的非 VITE 变量装入 process.env，故采用 Node --env-file 或启动环境。

## 数据口径

- resolved_symbol 是实际上游来源；NASDAQ 请求可能返回 BATS（Cboe），港股/A 股可能为 DLY 延迟源。
- delay_seconds 为上游声明值；未知保留 null，0 也不保证当前正在实时交易。
- bars[0].time 是 K 线起点，received_at 是采集时间，二者不能直接相减作为网络延迟。
- 指标按同一 K 线时间匹配，未闭合 K 线可能变化。无效数值和 Pine 占位值转为 null。
- 休市时可能返回上一交易时段价格。该非官方连接没有可用性保证；会话失效、权限限制或协议升级均可能失败。

## 上线边界

生产 CI 验收通过正常 /api/auth/invite 登录，邀请码仅从 GitHub 加密 Secret QUANTEDGE_SMOKE_INVITE_CODE 注入，Cookie 仅保留于验收进程内存。预览阶段先验证既有生产登录，正式发布后再逐只验证 19 个星标。禁止用生产密钥占位符签发会话；生产登录密钥不变。

预览验收使用每轮独立随机 QUANTEDGE_SESSION_SECRET，由 CI 掩码并仅注入该预览部署，不替换生产登录密钥。Vercel 拉取敏感变量时可能只返回占位符，不能用占位符签发测试会话。

构建时运行 scripts/prepare-tradingview-runtime.mjs，将行情子进程及其已安装依赖整理到 api/_lib/tradingview-runtime；该目录是忽略提交的构建产物，通过短 includeFiles 规则随函数部署，不依赖动态子进程的自动追踪。

默认关闭。生产部署和将个人 Cookie 配置到云端需单独确认，不能因为本地测试成功就宣称线上已启用。Node 运行环境须打包 api/_lib/tradingview-worker.cjs 和 npm 依赖，并允许子进程和出站 WSS/HTTPS。平台函数时限为 60 秒，大于内部 28 秒硬超时。本机 127.0.0.1 代理不能直接用于云端。

技术连通不等于市场数据使用许可。正式商业化、自动化处理或转发前需核对 TradingView 和交易所授权。凭据失效时在服务端更新，勿在错误日志中打印请求配置或 Cookie。

## 本轮验证记录

2026-09-15 17:08–17:16 香港时间：

- 新接口实际返回 BTC、腾讯、英伟达、贵州茅台的 K 线与 RSI/MACD；腾讯和茅台返回 DLY 源、900 秒延迟，英伟达返回 BATS/Cboe。
- BTC 首次超时、茅台首次上游错误，单独复测成功。不能由这轮测试推断持续服务 SLA。
- 本地真实 HTTP 链路验证：未登录 401；已签名 QuantEdge 会话查询 BTC、腾讯均 200、100 根 K 线，指标时间与最新 K 线相同。
- 51 个测试文件、755 项测试全部通过；新增桌面 1440px / 手机 390px 浏览器测试 2 项通过，面板 axe 无障碍检查通过。浏览器展示测试使用固定行情样本，与真实 HTTP 验证分开。
- 生产构建及包体预算通过，入口 gzip 73,326 字节；公网函数数仍为 11，未新增独立函数。
- 未启动全套 Python 后端，因此页面测试中原有 /api/status 代理产生连接失败，不计为全平台端到端验收。未部署生产、未转移个人 Cookie 到云端、未执行数据库迁移。

可重复运行真实本地接口测试（在 frontend 目录）：

```powershell
node --env-file='C:/path/to/tradingview-test/.env' scripts/test-tradingview-live.mjs BINANCE:BTCUSDT HKEX:700
```

测试脚本仅在自身进程设置临时 QuantEdge 会话密钥，监听 127.0.0.1:5187，完成后关闭，不改变既有登录配置。
## 全股票池日线快照（2026-09-16 扩展）

2026-09-16 22:09:33 香港时间完成本次批量采集：544 个平台代码，543 条有效日线摘要，1 个有官方依据的停止交易代码 EA；无其他缺失项、无超过 7 天的旧日线。600519.SS 与 600519.SH 是同一证券的两种代码，保留二者以兼容现有引用。每条有效结果验证最多 100 根原始日 K 线的 OHLC、倒序时间、指标时间对齐及 RSI/MACD 有限值与内部一致性。数据采集跨多个时刻，不是同步实时截面；每行保留自身采集时间和 K 线日期。

本地最终回归：773 项单元测试、49 项浏览器测试通过。全量快照发布仍须通过本 PR 的 Preview 和 main 生产门禁；采集完成不等于生产发布完成。

- 增加日本股票 `.T` → `TSE:` 映射；东京电子、丰田和索尼已用实际账户读取验证，返回源为 `TSE_DLY`，不是实时行情。
- EA 为有日期证据的停止交易例外：[发行人 2026-08-04 公告](https://www.ea.com/amp/news/ea-announces-completion-of-acquisition)及 [SEC 8-K](https://www.sec.gov/Archives/edgar/data/712515/000114036126031157/ef20079099_8k.htm)确认收购完成及股票停止交易。保留代码并显示公告，不展示旧缓存为当前日线，不把停止交易算作成功报价，也不继续对其刷新当前行情。未改动原评分股票池。
- `/api/private/market-data/daily-snapshots` 为只读、登录及同源保护接口。快照加载不覆盖收藏、财报或评分；本机更新版本较新时优先保留本机值。
- 快照保留原始采集时间与 K 线日期，未支持或失败标的独立列出。全量指发布股票池和服务端收藏的去重并集，不包括无法读取的浏览器额外自定义标的。
- GitHub 仓库公开，因此 `frontend/api/_lib/daily-data/` 已忽略，不提交批量行情数据、用户星标或任何凭据。经验证的快照压缩后拆分到 `QUANTEDGE_DAILY_SNAPSHOT_1` 至 `_4` 加密 Secrets，在可信部署任务中恢复并打包；不会加入公共前端资源，也不传入行情 worker 环境。
- 更新流程：全量采集报告完成 → `node frontend/scripts/build-daily-snapshot.mjs <report.json>` 检查 OHLC、时间顺序、指标与覆盖率 → `node frontend/scripts/upload-daily-snapshot.mjs` 上传加密快照 → 常规预览验收与发布。仍需遵守正式站发布确认，不因脚本存在而自动发布。
- CI 对发布快照逐项验证，并比较整个线上快照与构建输入一致；保留原有 19 星标在线测试，新增 3 个日本股票实测。
- 发布统一走现有 GitHub Actions 预构建通道。`vercel.json` 关闭旁路 Git 自动部署，避免未恢复加密快照、未通过门禁的版本抢先覆盖正式站；没有断开 GitHub 连接或改变账户权限。
- 本节是实现说明，不代表全量采集或生产发布已经完成。实际结果见当次验收记录。
