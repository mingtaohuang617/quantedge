// /api/watchlist/10x/import — POST 从导出的 JSON 恢复
//
// body: { mode: "merge" | "replace", user_supertrends: [], items: [] }
// 返回 stats: { ok, mode, items_added, items_updated, supertrends_added, supertrends_updated }

import { requireReferer, readJson } from '../../_lib/auth.js';
import { KV_ENABLED } from '../../_lib/kv.js';
import { importData } from '../../_lib/watchlist10x.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  if (!KV_ENABLED) {
    return res.status(503).json({
      ok: false,
      detail: 'KV 未配置：在 Vercel Settings → Storage → Create Database 启用 KV 后重试',
    });
  }

  const body = await readJson(req);
  const mode = body.mode || 'merge';
  const payload = {
    user_supertrends: body.user_supertrends || [],
    items: body.items || [],
  };

  try {
    const stats = await importData(payload, mode);
    return res.status(200).json({ ok: true, ...stats });
  } catch (e) {
    return res.status(400).json({ ok: false, detail: String(e.message || e) });
  }
}
