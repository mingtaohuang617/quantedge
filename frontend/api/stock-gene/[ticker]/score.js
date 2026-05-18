// /api/stock-gene/[ticker]/score — 任一引擎评分均需 self-hosted backend
// engines 依赖 pandas/numpy，Vercel 函数环境跑不动，建议本地或部署到 Render/Railway
import { requireReferer } from '../../_lib/auth.js';

const SELF_HOST_MSG = `评分引擎需 self-hosted backend (pandas/numpy 计算)。
快速启动：cd backend && python server.py
或部署到 Render / Railway：详见 docs/STOCK_GENE_ONBOARDING.md`;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  // POST /api/stock-gene/{ticker}/score 或 value-score / signal-score / risk-score
  // Vercel 上一律 503
  return res.status(503).json({
    ok: false,
    error: 'scoring_requires_self_hosted_backend',
    detail: SELF_HOST_MSG,
  });
}
