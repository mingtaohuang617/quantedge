// universeLoader — 加载 frontend/public/data/universe/*.json
//
// production 上 self-fetch VERCEL_URL 不可靠（deployment protection / TLS / cold cache
// 都可能让请求挂掉），改用 fs.readFile 直接读 lambda bundle 里的 JSON。
// 数据通过 frontend/vercel.json 的 functions.includeFiles 打进 lambda 一起 deploy。
//
// 内存缓存：同 lambda 实例 5 分钟，cold start 重置。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FILES = {
  US: 'universe_us.json',
  CN: 'universe_cn.json',
  HK: 'universe_hk.json',
};

const _cache = new Map();
const _CACHE_TTL_MS = 5 * 60 * 1000;

// lambda 内部路径推断：本文件位于 api/_lib/，数据在 public/data/universe/
const _here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(_here, '..', '..', 'public', 'data', 'universe');

async function _loadOne(market) {
  const m = market.toUpperCase();
  const fname = FILES[m];
  if (!fname) {
    return { meta: { market: m, error: 'unsupported market' }, items: [] };
  }

  const ck = `mkt:${m}`;
  const cached = _cache.get(ck);
  if (cached && (Date.now() - cached.ts < _CACHE_TTL_MS)) {
    return cached.data;
  }

  const filePath = join(DATA_DIR, fname);
  try {
    const text = await readFile(filePath, 'utf-8');
    const data = JSON.parse(text);
    _cache.set(ck, { ts: Date.now(), data });
    return data;
  } catch (e) {
    // 数据缺失（例如未部署或 includeFiles 没生效）— 静默降级到空 universe
    const data = {
      meta: { market: m, error: e.code || e.message, path: filePath },
      items: [],
    };
    _cache.set(ck, { ts: Date.now(), data });
    return data;
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
  for (const m of Object.keys(FILES)) {
    const data = await _loadOne(m);
    stats[m] = {
      count: (data.items || []).length,
      synced_at: data.meta?.synced_at || null,
      file: FILES[m],
      exists: (data.items || []).length > 0,
    };
  }
  return stats;
}
