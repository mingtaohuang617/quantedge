// /api/stock-gene/alerts — 从 score_history 计算评分变化预警
import { requireReferer } from '../_lib/auth.js';
import { getAlerts } from '../_lib/stockGene.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const minDelta = Math.min(Math.max(parseInt(req.query.min_delta, 10) || 1, 1), 8);
  const alerts = await getAlerts({ days, min_delta: minDelta });
  return res.status(200).json({ alerts });
}
