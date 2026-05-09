// universeLoader — 加载 frontend/public/data/universe/*.json
//
// 数据流：
//   1. 用户跑 backend/universe/sync_us.py 等填充 backend/output/universe_*.json
//   2. 用户跑 backend/export_universe_to_frontend.py 复制到 frontend/public/data/universe/
//   3. git push → vercel 部署 → CDN 服务静态文件
//   4. serverless function self-fetch 这些 JSON
//
// 内存缓存：同 lambda 实例 5 分钟，cold start 重置。

const PATHS = {
  US: '/data/universe/universe_us.json',
  CN: '/data/universe/universe_cn.json',
  HK: '/data/universe/universe_hk.json',
};

const _cache = new Map();
const _CACHE_TTL_MS = 5 * 60 * 1000;

function _baseUrl() {
  // production / preview：VERCEL_URL 是当前 deployment 的 hostname（不含 protocol）
  const u = process.env.VERCEL_URL;
  if (u) return `https://${u}`;
  // 自定义域名：QUANTEDGE_PUBLIC_BASE 优先级最高
  if (process.env.QUANTEDGE_PUBLIC_BASE) return process.env.QUANTEDGE_PUBLIC_BASE;
  // dev fallback：vite 默认 5173
  return 'http://localhost:5173';
}

async function _loadOne(market) {
  const m = market.toUpperCase();
  const path = PATHS[m];
  if (!path) {
    return { meta: { market: m, error: 'unsupported market' }, items: [] };
  }

  const ck = `mkt:${m}`;
  const cached = _cache.get(ck);
  if (cached && (Date.now() - cached.ts < _CACHE_TTL_MS)) {
    return cached.data;
  }

  const url = `${_baseUrl()}${path}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) {
      // 数据缺失（404）— 静默降级到空 universe，不中断 screen 调用
      const data = { meta: { market: m, error: `HTTP ${r.status}` }, items: [] };
      _cache.set(ck, { ts: Date.now(), data });
      return data;
    }
    const data = await r.json();
    _cache.set(ck, { ts: Date.now(), data });
    return data;
  } catch (e) {
    return { meta: { market: m, error: e.message }, items: [] };
  }
}

/** 合并多市场 universe，返回扁平 items 列表。 */
export async function loadUniverse(markets = ['US', 'HK', 'CN']) {
  const out = [];
  for (const m of markets) {
    const data = await _loadOne(m);
    out.push(...(data.items || []));
  }
  return out;
}

/** 给 /api/universe/stats 用：每个市场 count + synced_at。 */
export async function universeStats() {
  const stats = {};
  for (const m of Object.keys(PATHS)) {
    const data = await _loadOne(m);
    stats[m] = {
      count: (data.items || []).length,
      synced_at: data.meta?.synced_at || null,
      path: PATHS[m],
      exists: (data.items || []).length > 0,
    };
  }
  return stats;
}
