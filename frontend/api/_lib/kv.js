// Upstash Redis (Vercel KV) 客户端 — REST 直连，无 SDK 依赖
//
// 启用方式：Vercel 项目 Settings → Storage → Create Database → KV
// 自动注入 KV_REST_API_URL / KV_REST_API_TOKEN，本文件零改动即生效
//
// 未配置时 KV_ENABLED=false，所有写操作 throw，调用方需先判断或 try/catch。
// 读操作 (kvGet*) 在未启用时直接返回 fallback。

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const KV_ENABLED = !!(KV_URL && KV_TOKEN);

async function _cmd(args, timeoutMs = 2000) {
  if (!KV_ENABLED) throw new Error('KV not configured (KV_REST_API_URL/TOKEN missing)');
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`KV ${args[0]} failed: HTTP ${r.status}`);
  const j = await r.json();
  return j.result;
}

export async function kvGet(key) {
  if (!KV_ENABLED) return null;
  try {
    return await _cmd(['GET', key]);
  } catch {
    return null;
  }
}

export async function kvSet(key, value, ttlSec) {
  if (ttlSec) return await _cmd(['SET', key, value, 'EX', String(ttlSec)]);
  return await _cmd(['SET', key, value]);
}

export async function kvDel(key) {
  return await _cmd(['DEL', key]);
}

// JSON 便捷 wrappers — watchlist / supertrends 等都是 JSON
export async function kvGetJson(key, fallback = null) {
  const v = await kvGet(key);
  if (v == null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export async function kvSetJson(key, obj, ttlSec) {
  return await kvSet(key, JSON.stringify(obj), ttlSec);
}
