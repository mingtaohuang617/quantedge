// /api/llm/rank-candidates  —  对一组候选股按"卡位独特性"打 1-5 分
//
// 输入: { supertrend_id, candidates: [{ticker, name?, sector?, industry?, marketCap?, summary?}] }
// 输出: { rankings: [{ticker, moat_score (1-5), reason}] }
// 限速：单次请求最多 10 个 candidates，避免 prompt 过长

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, clampInt, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';
import { listAllSupertrends } from '../_lib/watchlist10x.js';

const ENDPOINT = 'rank-candidates';
const TTL_SEC = 7 * 86400;
const MAX_BATCH = 10;

function fmtMcap(mc) {
  if (mc == null) return '?';
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`;
  return `${(mc / 1e6).toFixed(0)}M`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireReferer(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = await readJson(req);
  const { supertrend_id, candidates } = body;
  if (!supertrend_id || !Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ ok: false, error: 'supertrend_id + candidates[] required' });
  }
  if (candidates.length > MAX_BATCH) {
    return res.status(400).json({ ok: false, error: `max ${MAX_BATCH} candidates per request` });
  }

  const sts = await listAllSupertrends();
  const st = sts.find(s => s.id === supertrend_id);
  if (!st) {
    return res.status(400).json({ ok: false, error: `unknown supertrend_id: ${supertrend_id}` });
  }

  const candLines = candidates.map((c, i) => (
    `${i + 1}. ${c.ticker} (${c.name || '?'}) — ${c.sector || ''} / ${c.industry || ''} — 市值 ${fmtMcap(c.marketCap)}`
  )).join('\n');

  const prompt = [
    `你是产业研究助手。在"${st.name}"超级赛道下，按"卡位独特性"给以下 ${candidates.length} 只标的打分（1-5 整数）：`,
    '  5 = 独家或近垄断地位',
    '  4 = 有显著壁垒（专利、客户绑定、规模）',
    '  3 = 普通供应链位置',
    '  2 = 替代性强但有差异',
    '  1 = 几乎可任意替代',
    '',
    '候选清单：',
    candLines,
    '',
    '请严格输出 JSON：',
    '{',
    '  "rankings": [',
    '    { "ticker": "<>", "moat_score": <1-5>, "reason": "<≤30 字>" }',
    '  ]',
    '}',
    '不知道就给 3，但 ticker 必须与候选清单匹配。',
  ].join('\n');

  const cached = await llmCacheGet(ENDPOINT, DEFAULT_MODEL, prompt);
  if (cached) {
    return res.status(200).json({ ok: true, supertrend_id, ...cached.response, cached: true });
  }

  try {
    const { content, prompt_tokens, completion_tokens } = await chat(
      [{ role: 'user', content: prompt }],
      { json_mode: true, max_tokens: 800, temperature: 0.2 }
    );
    const parsed = safeJsonParse(content);
    const candTickers = new Set(candidates.map(c => c.ticker));
    parsed.rankings = (Array.isArray(parsed.rankings) ? parsed.rankings : [])
      .map(r => ({
        ticker: String(r.ticker || ''),
        moat_score: clampInt(r.moat_score, 1, 5, 3),
        reason: String(r.reason || '').slice(0, 100),
      }))
      .filter(r => r.ticker && candTickers.has(r.ticker));

    await llmCachePut(ENDPOINT, DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
      prompt_tokens, completion_tokens,
    });
    return res.status(200).json({ ok: true, supertrend_id, ...parsed, cached: false });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return res.status(503).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
