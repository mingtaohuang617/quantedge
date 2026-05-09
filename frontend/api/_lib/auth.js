// 同源/白名单校验 — 防止 endpoint 被第三方滥用
//
// VERCEL_URL                    = 当前 deployment 随机 URL（每次部署变）
// VERCEL_PROJECT_PRODUCTION_URL = production alias 域名（恒定）
// VERCEL_BRANCH_URL             = 分支 alias（preview）
// QUANTEDGE_ALLOWED_HOSTS       = 逗号分隔的额外 hostname（自定义域名等）

const ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  ...(process.env.VERCEL_URL ? [process.env.VERCEL_URL] : []),
  ...(process.env.VERCEL_PROJECT_PRODUCTION_URL ? [process.env.VERCEL_PROJECT_PRODUCTION_URL] : []),
  ...(process.env.VERCEL_BRANCH_URL ? [process.env.VERCEL_BRANCH_URL] : []),
  ...(process.env.QUANTEDGE_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
]);

export function isAllowedReferer(req) {
  const ref = req.headers.referer || req.headers.origin;
  if (!ref) return false;
  try {
    return ALLOWED_HOSTS.has(new URL(ref).hostname);
  } catch {
    return false;
  }
}

/** Guard：不通过则写 403 并返回 false。在 handler 入口调用：
 *   if (!requireReferer(req, res)) return;
 */
export function requireReferer(req, res) {
  if (!isAllowedReferer(req)) {
    res.status(403).json({ error: 'forbidden: referer not in allowlist' });
    return false;
  }
  return true;
}

/** 解析 JSON body — vercel functions 自动 parse，但 fallback 处理一下。 */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}
