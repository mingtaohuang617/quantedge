// /api/watchlist/10x  —  GET (list items + supertrends)  /  POST (add item)
import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { loadData, mergeSupertrends, addItem } from '../_lib/watchlist10x.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method === 'GET') {
    const data = await loadData();
    const includeArchived = req.query?.include_archived === 'true' || req.query?.include_archived === '1';
    const allItems = data.items || [];
    const items = includeArchived ? allItems : allItems.filter(it => !it.archived);
    return res.status(200).json({
      items,
      supertrends: mergeSupertrends(data),
    });
  }

  if (req.method === 'POST') {
    if (!KV_ENABLED) {
      return res.status(503).json({
        ok: false,
        detail: 'KV 未配置：在 Vercel Settings → Storage → Create Database 启用 KV 后重试',
      });
    }
    const body = await readJson(req);
    try {
      const item = await addItem(body.ticker, body);
      return res.status(200).json({ ok: true, item });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
