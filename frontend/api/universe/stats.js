// /api/universe/stats  —  GET：返回每市场 universe 加载情况
import { requireReferer } from '../_lib/auth.js';
import { universeStats } from '../_lib/universeLoader.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const stats = await universeStats();
  return res.status(200).json(stats);
}
