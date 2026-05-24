// /api/stock-gene  —  GET (list items + lists)  /  POST (add item)
// 路径 stock-gene/index.js 而不是 stock-gene.js：避免与同名目录冲突，
// 在 Vercel 上 file + directory 同名时 directory 会赢导致 file 被忽略。
import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { loadData, addItem } from '../_lib/stockGene.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method === 'GET') {
    const data = await loadData();
    return res.status(200).json({
      version: data.version,
      lists: data.lists,
      items: data.items,
    });
  }

  if (req.method === 'POST') {
    if (!KV_ENABLED) {
      return res.status(503).json({
        ok: false,
        detail: 'KV 未配置：Vercel Settings → Storage → Create Database → KV → Connect 后即可使用',
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
