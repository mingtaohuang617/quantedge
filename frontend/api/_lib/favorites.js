// favorites — 自选股（关注列表）持久化（serverless / KV 侧）
//
// 与 backend/favorites.py 同一 API 契约：GET 读全集 / PUT 全量替换。
// 持久化：Vercel KV (Upstash Redis) key = "qe:favorites"
//   value: { version, tickers: [...], updated_at }
//
// tickers 只做去重 + 去空白 + 排序，**不改大小写**（必须与前端 ticker key 精确往返）。
// KV 未配置时 loadFavorites 返回空集合，saveFavorites throw（调用方给 503）。

import { KV_ENABLED, kvGetJson, kvSetJson } from './kv.js';

const KEY = 'qe:favorites';

function normalize(tickers) {
  const out = [];
  for (const t of tickers || []) {
    const tk = String(t).trim();
    if (tk && !out.includes(tk)) out.push(tk);
  }
  return out.sort();
}

export async function loadFavorites() {
  if (!KV_ENABLED) return { version: 1, tickers: [], updated_at: null };
  const data = await kvGetJson(KEY, { version: 1, tickers: [], updated_at: null });
  return {
    version: data.version ?? 1,
    tickers: normalize(data.tickers),
    updated_at: data.updated_at ?? null,
  };
}

export async function saveFavorites(tickers) {
  if (!KV_ENABLED) {
    const e = new Error('KV not configured');
    e.code = 'KV_DISABLED';
    throw e;
  }
  const data = {
    version: 1,
    tickers: normalize(tickers),
    updated_at: new Date().toISOString().slice(0, 19) + 'Z',
  };
  await kvSetJson(KEY, data);
  return data;
}
