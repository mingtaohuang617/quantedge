// Vercel Serverless Function — Yahoo Finance 代理
// URL: /api/yahoo?path=/v8/finance/chart/NVDA?interval=1d&range=1y
// 也支持 query2: /api/yahoo?host=query2&path=/v10/finance/quoteSummary/NVDA?modules=...
//
// C15: 内置 Vercel KV (Upstash Redis REST) 缓存层 — 命中率 0% → 80%+
// 启用步骤：在 Vercel 控制台 Storage → Create Database → KV → 选择 quantedge 项目 → Connect
// 自动注入 KV_REST_API_URL / KV_REST_API_TOKEN 环境变量，本文件零改动即生效
// 未配置时自动降级到无缓存（行为与之前完全一致）

// ── 同源/白名单校验：避免 endpoint 被第三方滥用消耗 Vercel 配额 ──
// VERCEL_URL                    = 当前 deployment 的随机 URL（每次部署变）
// VERCEL_PROJECT_PRODUCTION_URL = production alias 域名（恒定，如 quantedge-chi.vercel.app）
// VERCEL_BRANCH_URL             = 分支 alias（preview 部署）
// 三者都加进白名单，覆盖 production + preview + 本地 dev 全场景
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  ...(process.env.VERCEL_URL ? [process.env.VERCEL_URL] : []),
  ...(process.env.VERCEL_PROJECT_PRODUCTION_URL ? [process.env.VERCEL_PROJECT_PRODUCTION_URL] : []),
  ...(process.env.VERCEL_BRANCH_URL ? [process.env.VERCEL_BRANCH_URL] : []),
  ...(process.env.QUANTEDGE_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
]);

function isAllowedReferer(req) {
  const ref = req.headers.referer || req.headers.origin;
  if (!ref) return false;
  try {
    return ALLOWED_HOSTS.has(new URL(ref).hostname);
  } catch {
    return false;
  }
}

// ── C15: KV 缓存（Upstash Redis REST），无 SDK 直接 fetch ──
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_ENABLED = !!(KV_URL && KV_TOKEN);

// 不同 endpoint 不同 TTL（行情类要新鲜，模块类可缓久）
function ttlForPath(path) {
  if (path.includes('/v8/finance/chart')) return 300;        // K线 5 min
  if (path.includes('quoteSummary')) return 120;             // 财务数据 2 min
  if (path.includes('search') || path.includes('autoc')) return 600; // 搜索 10 min
  return 180; // 默认 3 min
}

async function kvGet(key) {
  if (!KV_ENABLED) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result || null; // string 或 null
  } catch { return null; }
}

async function kvSet(key, value, ttlSec) {
  if (!KV_ENABLED) return;
  try {
    // Upstash REST 单命令格式：POST ${URL} body=["SET", key, val, "EX", ttl]
    await fetch(KV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['SET', key, value, 'EX', String(ttlSec)]),
      signal: AbortSignal.timeout(1500),
    });
  } catch { /* 缓存失败不影响主流程 */ }
}

export default async function handler(req, res) {
  // 浏览器 CDN：保留之前的 stale-while-revalidate
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!isAllowedReferer(req)) {
    res.status(403).json({ error: 'forbidden: referer not in allowlist' });
    return;
  }

  const { path, host = 'query1' } = req.query;
  if (!path || typeof path !== 'string') {
    res.status(400).json({ error: 'missing path query param' });
    return;
  }

  const targetHost = host === 'query2' ? 'query2.finance.yahoo.com' : 'query1.finance.yahoo.com';
  let cleanPath = path.startsWith('/') ? path : '/' + path;
  const targetUrl = `https://${targetHost}${cleanPath}`;
  const cacheKey = `yh:${host}:${cleanPath}`;
  const ttl = ttlForPath(cleanPath);

  // ── C15: 优先尝试 KV 缓存 ──
  if (KV_ENABLED) {
    const cached = await kvGet(cacheKey);
    if (cached) {
      // KV 中存的是 JSON 字符串（直接是 Yahoo 返回的 body）
      res.status(200);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Cache-Status', 'HIT');
      res.setHeader('X-Cache-TTL', String(ttl));
      res.send(cached);
      return;
    }
  }

  // ── 未命中：拉上游 ──
  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    res.setHeader('X-Cache-Status', KV_ENABLED ? 'MISS' : 'BYPASS');
    if (KV_ENABLED) res.setHeader('X-Cache-TTL', String(ttl));

    // 仅在成功 + JSON 时写缓存（避免缓存 500 / HTML 错误页）
    if (upstream.status === 200 && ct.includes('json') && text.length > 50) {
      // fire-and-forget，不阻塞响应
      kvSet(cacheKey, text, ttl);
    }

    res.send(text);
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', message: err.message, target: targetUrl });
  }
}
