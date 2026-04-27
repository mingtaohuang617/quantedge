// Vercel Serverless Function — Yahoo Finance 代理
// URL: /api/yahoo?path=/v8/finance/chart/NVDA?interval=1d&range=1y
// 也支持 query2: /api/yahoo?host=query2&path=/v10/finance/quoteSummary/NVDA?modules=...

// 同源/白名单校验：避免 endpoint 被第三方滥用消耗 Vercel 配额
const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  // Vercel 生产域名通过 VERCEL_URL 自动注入
  ...(process.env.VERCEL_URL ? [process.env.VERCEL_URL] : []),
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

export default async function handler(req, res) {
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
  // path 已经是 URL-decoded（Vercel 自动处理），重新拼接 query string
  // 但因为 path 可能已经包含 ?xxx=yyy，我们直接拼到 host 后
  let cleanPath = path.startsWith('/') ? path : '/' + path;
  const targetUrl = `https://${targetHost}${cleanPath}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        // 模拟正常浏览器，避免被 Yahoo 拒
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      // Vercel serverless 默认 10s 超时
      signal: AbortSignal.timeout(8000),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    // Yahoo 通常返回 JSON
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: 'upstream fetch failed', message: err.message, target: targetUrl });
  }
}
