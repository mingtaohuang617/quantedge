// /api/smart-beta/snapshot  —  反向代理 Smart Beta 路由到 Render 后端 FastAPI
//
// 后端 (Render free tier) cold start ~30s + 15min sleep；后端有 30min 内置缓存，
// 第一次访问慢（可能逼近 60s），命中缓存后秒回。
//
// 环境变量（必填）：
//   QUANTEDGE_BACKEND_URL   Render 部署 URL，例如 https://quantedge-xxx.onrender.com
//
// 用法：GET /api/smart-beta/snapshot?core_preset=balanced&k=3&weight_mode=equal[&current_holdings=XLK,XLF]
//
// 同源校验：referer 必须在 ALLOWED_HOSTS 内（防滥用 Vercel 配额）。
import { requireReferer } from '../_lib/auth.js';

export const config = {
  // Hobby plan 上限；后端首次拉数据 + cold start 可能逼近，命中后端缓存后秒回。
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

  // 透传所有 query 参数到后端
  let url;
  try {
    url = new URL('/api/smart-beta/snapshot', BACKEND_URL);
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
      // 留 5s 给响应处理，避免触发 Vercel 60s 硬超时
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
        ? '后端冷启动中（Render free tier 15min sleep 唤醒约 30s）。请 30s 后重试 — '
        + '首次成功后 30 min 内 cache 命中，会秒回。'
        : `请检查 QUANTEDGE_BACKEND_URL 是否正确：${BACKEND_URL}`,
    });
  }
}
