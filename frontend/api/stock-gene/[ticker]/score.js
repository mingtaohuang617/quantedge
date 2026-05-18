// /api/stock-gene/[ticker]/score - 也接 value-score / signal-score / risk-score（通过 vercel.json rewrites）
// 评分需 self-hosted backend（pandas/numpy 计算）
import { requireReferer } from '../../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  return res.status(503).json({
    ok: false,
    error: 'scoring_requires_self_hosted_backend',
    detail: '评分引擎需 self-hosted backend (pandas/numpy 计算)。详见 docs/STOCK_GENE_ONBOARDING.md',
  });
}
