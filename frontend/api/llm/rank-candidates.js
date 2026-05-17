// /api/llm/rank-candidates  —  对一组候选股按 strategy 打 1-5 分
//
// 输入: { supertrend_id, candidates: [{ticker, name?, sector?, industry?, marketCap?,
//        pe?, pb?, dividend_yield?, roe?, debt_to_equity?, summary?}] }
// 输出: { rankings: [{ticker, moat_score (1-5), reason}] }
// 限速：单次请求最多 10 个 candidates，避免 prompt 过长
//
// v2.0：按 supertrend.strategy 自动切 prompt 框架
//   - growth：评卡位独特性（产业链不可替代性）
//   - value：评 value conviction（业绩可预测 + 估值 + 护城河，结合 5 维财务）
// cache key prefix 按 mode 隔离（rank-candidates / rank-candidates-value）。

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, clampInt, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';
import { listAllSupertrends } from '../_lib/watchlist10x.js';

const TTL_SEC = 7 * 86400;
const MAX_BATCH = 10;

function fmtMcap(mc) {
  if (mc == null) return '?';
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`;
  return `${(mc / 1e6).toFixed(0)}M`;
}

function fmtPct(v) {
  return typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '?';
}

function fmtNum(v, prec = 1) {
  return typeof v === 'number' ? v.toFixed(prec) : '?';
}

function buildPromptGrowth(st, candidates) {
  const lines = candidates.map((c, i) => (
    `${i + 1}. ${c.ticker} (${c.name || '?'}) — ${c.sector || ''} / ${c.industry || ''} — 市值 ${fmtMcap(c.marketCap)}`
  )).join('\n');
  return [
    `你是产业研究助手。在"${st.name}"超级赛道下，按"卡位独特性"给以下 ${candidates.length} 只标的打分（1-5 整数）：`,
    '  5 = 独家或近垄断地位',
    '  4 = 有显著壁垒（专利、客户绑定、规模）',
    '  3 = 普通供应链位置',
    '  2 = 替代性强但有差异',
    '  1 = 几乎可任意替代',
    '',
    '候选清单：',
    lines,
    '',
    '请严格输出 JSON：',
    '{',
    '  "rankings": [',
    '    { "ticker": "<>", "moat_score": <1-5>, "reason": "<≤30 字>" }',
    '  ]',
    '}',
    '不知道就给 3，但 ticker 必须与候选清单匹配。',
  ].join('\n');
}

function buildPromptValue(st, candidates) {
  const lines = candidates.map((c, i) => {
    const fin = (c.pe != null || c.dividend_yield != null || c.roe != null)
      ? ` — PE=${fmtNum(c.pe)} · 股息=${fmtPct(c.dividend_yield)} · ROE=${fmtPct(c.roe)}` +
        ` · PB=${fmtNum(c.pb, 2)} · D/E=${fmtNum(c.debt_to_equity, 2)}`
      : '';
    return `${i + 1}. ${c.ticker} (${c.name || '?'}) — ${c.sector || ''} / ${c.industry || ''} — 市值 ${fmtMcap(c.marketCap)}${fin}`;
  }).join('\n');
  const dimensionHint =
    st.name === '高股息蓝筹' ? '股息持续性（股息率 > 4% 是否能持续）'
    : st.name === '周期价值' ? '周期位置（当前 PB vs 历史均值）'
    : 'ROE 穿越周期的稳定性';
  return [
    `你是价值投资研究助手。在"${st.name}"价值赛道下，按 'value conviction' 给以下 ${candidates.length} 只标的打分（1-5 整数）：`,
    '  5 = 极强 conviction（业绩可预测 + 估值显著低于历史 + 护城河深 + 财务健康）',
    '  4 = 强（满足其中 3 项）',
    '  3 = 一般（满足 2 项）',
    '  2 = 弱（仅 1 项有亮点，其他存疑）',
    '  1 = 价值陷阱风险（低估值 + 业务持续恶化）',
    '',
    '评估维度（结合下方 5 维财务一起判断）：',
    `  - ${dimensionHint}`,
    '  - 估值合理度（PE/PB vs 同行业均值）',
    '  - 现金流可预测性（业务波动小）',
    '  - 财务健康（D/E 适中、ROE 持续）',
    '',
    '候选清单：',
    lines,
    '',
    '请严格输出 JSON：',
    '{',
    '  "rankings": [',
    '    { "ticker": "<>", "moat_score": <1-5>, "reason": "<≤30 字 结合财务指标>" }',
    '  ]',
    '}',
    '不知道就给 3，但 ticker 必须与候选清单匹配。注意：moat_score 字段名保持不变（前端通用），价值语义是 conviction 强度。',
  ].join('\n');
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

  // 按 supertrend.strategy 选 prompt 框架（growth/value）
  const mode = st.strategy === 'value' ? 'value' : 'growth';
  const prompt = mode === 'value'
    ? buildPromptValue(st, candidates)
    : buildPromptGrowth(st, candidates);

  // cache key prefix 按 mode 隔离（避免同 ticker 列表在两 strategy 拿错框架缓存）
  const endpoint = mode === 'value' ? 'rank-candidates-value' : 'rank-candidates';

  const cached = await llmCacheGet(endpoint, DEFAULT_MODEL, prompt);
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

    await llmCachePut(endpoint, DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
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
