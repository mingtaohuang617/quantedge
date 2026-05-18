// 通用 503 stub — 评分 / AI 解读 / 调度器写操作均需 self-hosted backend
// 通过 vercel.json rewrites 把多个 path 指向这里，把函数数量压回 Hobby plan 限制内
import { requireReferer } from '../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  return res.status(503).json({
    ok: false,
    error: 'scoring_requires_self_hosted_backend',
    detail: '该功能（评分 / AI 解读 / 定时刷新写操作）需 self-hosted backend，依赖 pandas/numpy。详见 docs/STOCK_GENE_ONBOARDING.md',
  });
}
