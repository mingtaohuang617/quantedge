// /api/watchlist/10x/screen  —  POST：候选筛选
//
// vercel routing：静态路径 /screen 优先于 dynamic /[ticker]
import { requireReferer, readJson } from '../../_lib/auth.js';
import { screenCandidates } from '../../_lib/watchlist10x.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = await readJson(req);
  try {
    const items = await screenCandidates({
      supertrend_ids: body.supertrend_ids || [],
      markets: body.markets || ['US', 'HK', 'CN'],
      max_market_cap_b: body.max_market_cap_b ?? null,
      min_market_cap_b: body.min_market_cap_b ?? null,
      include_etf: !!body.include_etf,
      exclude_in_watchlist: body.exclude_in_watchlist !== false,
      limit: Number.isInteger(body.limit) ? body.limit : 200,
      precise: !!body.precise,
      include_no_mcap: body.include_no_mcap !== false,
      // 价值型 5 维（v2.0；之前漏透传导致前端 PE/PB/股息/ROE/D/E 过滤完全无效）
      max_pe: body.max_pe ?? null,
      max_pb: body.max_pb ?? null,
      min_roe: body.min_roe ?? null,
      min_dividend_yield: body.min_dividend_yield ?? null,
      max_debt_to_equity: body.max_debt_to_equity ?? null,
      include_no_fundamentals: body.include_no_fundamentals !== false,
    });
    return res.status(200).json({ count: items.length, items });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
