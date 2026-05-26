// /api/stock-gene/lists — GET (list all) / POST (add new)
import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { loadData, addList } from '../_lib/stockGene.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method === 'GET') {
    const data = await loadData();
    return res.status(200).json({ lists: data.lists });
  }

  if (req.method === 'POST') {
    if (!KV_ENABLED) return res.status(503).json({ ok: false, detail: 'KV 未配置' });
    const body = await readJson(req);
    try {
      const list = await addList(body.name, body.color);
      return res.status(200).json({ ok: true, list });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
