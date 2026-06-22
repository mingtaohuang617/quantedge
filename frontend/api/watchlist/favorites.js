// /api/watchlist/favorites  —  GET (读全集) / PUT (全量替换)
//
// 自选股（评分页星标）的服务端持久化。轻量：仅 ticker 集合。
// 生产走 Vercel KV；本地 dev 走 FastAPI 同名路由（backend/favorites.py）。
// 全量替换设计：前端内存里本就持有完整 Set，PUT 整集 → 幂等、无合并冲突。
import { requireReferer, readJson } from '../_lib/auth.js';
import { KV_ENABLED } from '../_lib/kv.js';
import { loadFavorites, saveFavorites } from '../_lib/favorites.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method === 'GET') {
    const data = await loadFavorites();
    // kv 标志让前端区分"服务端空集合"vs"KV 未启用"——后者不触发首次种子上云
    return res.status(200).json({ ...data, kv: KV_ENABLED });
  }

  if (req.method === 'PUT') {
    if (!KV_ENABLED) {
      return res.status(503).json({
        ok: false,
        detail: 'KV 未配置：在 Vercel Settings → Storage → Create Database 启用 KV 后重试',
      });
    }
    const body = await readJson(req);
    const tickers = Array.isArray(body.tickers) ? body.tickers : [];
    try {
      const data = await saveFavorites(tickers);
      return res.status(200).json({ ok: true, ...data });
    } catch (e) {
      return res.status(400).json({ ok: false, detail: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'method not allowed' });
}
