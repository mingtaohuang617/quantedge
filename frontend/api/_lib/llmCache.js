// LLM 响应缓存 — 存 KV，key 含 prompt 哈希
//
// 设计：
//   - cache_key = sha256(endpoint|model|prompt) 前 24 字符
//   - value: { endpoint, model, response, ts, ticker?, prompt_tokens?, completion_tokens? }
//   - TTL 由调用方传入，未启用 KV 时静默 no-op
import { kvGet, kvSet, KV_ENABLED } from './kv.js';
import { createHash } from 'node:crypto';

function _hashKey(endpoint, model, prompt) {
  const h = createHash('sha256')
    .update(`${endpoint}|${model}|${prompt}`)
    .digest('hex')
    .slice(0, 24);
  return `qe:llm:${endpoint}:${h}`;
}

export async function llmCacheGet(endpoint, model, prompt) {
  if (!KV_ENABLED) return null;
  const v = await kvGet(_hashKey(endpoint, model, prompt));
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function llmCachePut(endpoint, model, prompt, response, ttlSec = 86400, meta = {}) {
  if (!KV_ENABLED) return;
  const payload = {
    endpoint,
    model,
    response,
    ts: Date.now(),
    ...meta,
  };
  try {
    await kvSet(_hashKey(endpoint, model, prompt), JSON.stringify(payload), ttlSec);
  } catch {
    // 缓存失败不影响主流程
  }
}
