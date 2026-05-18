// /api/stock-gene/compare-peers — 横向对比需 self-hosted backend
import { requireReferer } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  return res.status(503).json({
    ok: false,
    error: 'scoring_requires_self_hosted_backend',
    detail: '横向对比需 self-hosted backend。详见 docs/STOCK_GENE_ONBOARDING.md',
  });
}
