// /api/smart-beta/backtest — 反向代理 Smart Beta 回测路由到 Render 后端
//
// 回测开销大（拉 N 只 ETF × 数年历史 + 月度滚动 build_snapshot），首次可能
// 接近 60s，后端 1 小时缓存命中后秒回。
//
// 用法：GET /api/smart-beta/backtest?start_date=2022-01-01[&end_date=...&core_preset=...&k=...&weight_mode=...]
import { requireReferer } from '../_lib/auth.js';

export const config = {
  maxDuration: 60,
};

const BACKEND_URL = process.env.QUANTEDGE_BACKEND_URL;

export default async function handler(req, res) {
  if (!requireReferer(req, res)) return;

  if (!BACKEND_URL) {
    return res.status(503).json({
      error: 'QUANTEDGE_BACKEND_URL not configured',
      hint: '在 Vercel dashboard → Settings → Environment Variables 设置 '
          + 'QUANTEDGE_BACKEND_URL = <Render 后端 URL>，然后重新部署。',
    });
  }

  let url;
  try {
    url = new URL('/api/smart-beta/backtest', BACKEND_URL);
  } catch {
    return res.status(503).json({
      error: 'QUANTEDGE_BACKEND_URL is malformed',
      detail: BACKEND_URL,
    });
  }
  for (const [k, v] of Object.entries(req.query || {})) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  try {
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(55000),
      headers: { Accept: 'application/json' },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.send(text);
  } catch (e) {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'Backend timeout' : 'Backend proxy failed',
      detail: String(e?.message || e),
      hint: isTimeout
        ? '回测首次开销大（拉 ETF 历史 + 月度滚动），请 30s 后重试 — '
        + '后端命中 1h 缓存后秒回。'
        : `请检查 QUANTEDGE_BACKEND_URL 是否正确：${BACKEND_URL}`,
    });
  }
}
