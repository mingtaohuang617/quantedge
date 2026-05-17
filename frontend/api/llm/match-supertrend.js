// /api/llm/match-supertrend  —  让 LLM 判断"这只股属于哪些超级赛道"
//
// 用途：sector_mapping 关键词未命中时的兜底（例如富途/yfinance 板块名不对齐）
// 输入: { ticker, name?, sector?, industry?, summary?, candidate_ids?,
//        pe?, pb?, dividend_yield?, roe?, debt_to_equity? }
// 输出: { matched: [supertrend_ids...], reason, confidence }
//
// v2.0：按 candidates 的 strategy 自动切换 prompt 框架
//   - growth-only / mixed: '超级趋势 + 卡位公司' 框架
//   - value-only:           'Graham 价值赛道' 框架（看稳定现金流 / 估值 / 护城河）
//
// cache key prefix 按 mode 隔离，避免成长/价值 tab 同 ticker 拿错框架缓存。

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';
import { listAllSupertrends } from '../_lib/watchlist10x.js';

const TTL_SEC = 7 * 86400;

function buildPromptGrowth(stock, candidates) {
  const candidateLines = candidates
    .map(s => `- ${s.id}: ${s.name}（${s.note || ''}）`)
    .join('\n');
  return [
    '你是产业研究助手。根据以下标的的行业、业务描述，从候选超级赛道里挑出它实际属于哪些（可多选，可一个都不选）。',
    '判断框架：超级趋势 → 产业链卡位（小市值卡位 / 不可替代 / 未被完全理解）',
    '',
    `标的: ${stock.ticker} (${stock.name || '?'})`,
    `行业: ${stock.sector || '未知'} / ${stock.industry || '未知'}`,
    stock.summary ? `业务描述: ${String(stock.summary).slice(0, 300)}` : '业务描述: （未提供）',
    '',
    '候选赛道：',
    candidateLines,
    '',
    '请严格输出 JSON：',
    '{',
    '  "matched": ["<supertrend_id_1>", "<supertrend_id_2>"],',
    '  "reason": "<≤80 字 简述判断依据>",',
    '  "confidence": <0-1 浮点 — 整体判断置信度>',
    '}',
    '若信息不足，matched 输出 []，confidence 给 0.3 以下。',
  ].join('\n');
}

function buildPromptValue(stock, candidates) {
  const candidateLines = candidates
    .map(s => `- ${s.id}: ${s.name}（${s.note || ''}）`)
    .join('\n');
  const finText = (stock.pe != null || stock.dividend_yield != null || stock.roe != null)
    ? `财务: PE=${stock.pe ?? '?'} · 股息率=${stock.dividend_yield != null ? (stock.dividend_yield * 100).toFixed(1) + '%' : '?'} · ROE=${stock.roe != null ? (stock.roe * 100).toFixed(1) + '%' : '?'}`
    : '财务: （未提供）';
  return [
    '你是价值投资研究助手。根据以下标的的行业、业务描述、财务指标（如有），从候选价值赛道里挑出它实际属于哪些（可多选，可一个都不选）。',
    '判断框架：Graham 价值赛道 — 稳定现金流 / 可预测业务 / 合理估值 / 护城河',
    '  - 高股息蓝筹：股息率 > 4% 持续 5 年+；防御性行业（公用事业 / 电信 / 烟草 / 大行）',
    '  - 周期价值：周期性强 + 低 PB 入场（银行 / 保险 / 化工 / 钢铁 / 有色）',
    '  - 消费稳健：穿越周期 ROE > 15%；必需消费（食品饮料 / 日用品 / 烟草）',
    '',
    `标的: ${stock.ticker} (${stock.name || '?'})`,
    `行业: ${stock.sector || '未知'} / ${stock.industry || '未知'}`,
    finText,
    stock.summary ? `业务描述: ${String(stock.summary).slice(0, 300)}` : '业务描述: （未提供）',
    '',
    '候选赛道：',
    candidateLines,
    '',
    '请严格输出 JSON：',
    '{',
    '  "matched": ["<supertrend_id_1>", "<supertrend_id_2>"],',
    '  "reason": "<≤80 字 简述判断依据，结合财务指标>",',
    '  "confidence": <0-1 浮点 — 整体判断置信度>',
    '}',
    '若行业明显不符合任何价值赛道特征（如纯成长股 / 亏损企业），matched 输出 []。',
    '若信息不足，matched 输出 []，confidence 给 0.3 以下。',
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
  const { ticker, name, sector, industry, summary, candidate_ids } = body;
  if (!ticker) return res.status(400).json({ ok: false, error: 'ticker required' });

  const allTrends = await listAllSupertrends();
  const candidates = Array.isArray(candidate_ids) && candidate_ids.length
    ? allTrends.filter(s => candidate_ids.includes(s.id))
    : allTrends;
  if (candidates.length === 0) {
    return res.status(400).json({ ok: false, error: 'no candidate supertrends' });
  }

  // 按 candidates 的 strategy 选 prompt 框架。candidates 全 value → value 模式；
  // 否则用 growth（含 mixed — 默认 growth 框架，prompt 也能 cover 一般场景）
  const strategies = new Set(candidates.map(c => c.strategy || 'growth'));
  const mode = strategies.size === 1 && [...strategies][0] === 'value' ? 'value' : 'growth';

  const stockMeta = {
    ticker, name, sector, industry, summary,
    // 价值型场景透传财务字段（前端 Screener10x 已 enrich 5 维，growth 时无害）
    pe: body.pe, pb: body.pb,
    dividend_yield: body.dividend_yield,
    roe: body.roe, debt_to_equity: body.debt_to_equity,
  };
  const prompt = mode === 'value'
    ? buildPromptValue(stockMeta, candidates)
    : buildPromptGrowth(stockMeta, candidates);

  // cache key prefix 按 mode 隔离，避免同 ticker 在成长/价值 tab 拿错框架缓存
  const endpoint = mode === 'value' ? 'match-supertrend-value' : 'match-supertrend';

  const cached = await llmCacheGet(endpoint, DEFAULT_MODEL, prompt);
  if (cached) {
    return res.status(200).json({ ok: true, ticker, ...cached.response, cached: true });
  }

  try {
    const { content, prompt_tokens, completion_tokens } = await chat(
      [{ role: 'user', content: prompt }],
      { json_mode: true, max_tokens: 300, temperature: 0.2 }
    );
    const parsed = safeJsonParse(content);
    if (!Array.isArray(parsed.matched)) parsed.matched = [];
    parsed.matched = parsed.matched.filter(id => candidates.some(c => c.id === id));
    parsed.reason = String(parsed.reason || '').slice(0, 200);
    const conf = Number(parsed.confidence);
    parsed.confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;

    await llmCachePut(endpoint, DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
      ticker, prompt_tokens, completion_tokens,
    });
    return res.status(200).json({ ok: true, ticker, ...parsed, cached: false });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return res.status(503).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
