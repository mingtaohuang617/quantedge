// /api/llm/10x-thesis  —  生成卡位/价值 thesis 草稿（按 supertrend.strategy 自动路由）
//
// 移植自 backend/llm.py:tenx_thesis + value_thesis。
// 为了控制 Vercel Hobby plan 的 12 lambda 上限，合并 growth + value 两套
// thesis 到同一个 endpoint，按 supertrend.strategy ("growth" | "value") 选 prompt 集。
//
// - growth: '成长型十倍股' 框架（5 段 + 瓶颈层级_int / 卡位等级_int）
// - value: 'Graham 安全边际' 框架（6 段 + 估值点位_int / 卡位等级_int）
//
// 业务描述兜底：body 未提供 description/summary 时，self-fetch /api/yahoo
// 拉 longBusinessSummary。
//
// 缓存：KV，TTL 24h，cache key prefix 按 strategy 隔离（避免成长/价值缓存污染）。

import { requireReferer, readJson } from '../_lib/auth.js';
import { chat, safeJsonParse, clampInt, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';
import { listAllSupertrends } from '../_lib/watchlist10x.js';

const TTL_SEC = 86400;

/** 通过 self-fetch /api/yahoo proxy 拉 longBusinessSummary。失败返回 null，不抛错。 */
async function fetchYahooSummary(ticker) {
  const u = process.env.VERCEL_URL || process.env.QUANTEDGE_PUBLIC_BASE;
  if (!u || !ticker) return null;
  const base = u.startsWith('http') ? u : `https://${u}`;
  const path = `/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`;
  const proxyUrl = `${base}/api/yahoo?host=query2&path=${encodeURIComponent(path)}`;
  try {
    const r = await fetch(proxyUrl, {
      headers: { Referer: `${base}/` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary || null;
  } catch {
    return null;
  }
}

function fmtMcap(mc) {
  if (mc == null) return '未知';
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`;
  return `${(mc / 1e6).toFixed(0)}M`;
}

function fmtPct(v) {
  return typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '?';
}

function fmtNum(v, prec = 1) {
  return typeof v === 'number' ? v.toFixed(prec) : '?';
}

function buildGrowthPrompt(stock, supertrend) {
  const ticker = stock.ticker || '?';
  const name = stock.name || '';
  const sector = stock.sector || stock.industry || '';
  const desc = (stock.descriptionCN || stock.description || stock.summary || '').slice(0, 300);
  const stName = supertrend.name || supertrend.id;
  const stNote = supertrend.note || '';

  return [
    "你是产业研究助手，按 '成长型十倍股' 策略给出客观分析。",
    "策略框架：超级趋势 → 双层瓶颈（共识层 / 深度认知层）→ 关键卡位公司（小市值 + 不可替代 + 未被完全理解）→ 第一性原理推演（订单概率 / 产能 / 管理层 / 瓶颈依赖度）。",
    "",
    `标的: ${ticker} (${name})`,
    `行业/分类: ${sector}`,
    `市值: ${fmtMcap(stock.marketCap)}`,
    `所属超级趋势: ${stName}（${stNote}）`,
    `业务描述: ${desc || '（缺失）'}`,
    "",
    "请严格输出 JSON，所有字段都要有：",
    '{',
    '  "超级趋势": "<这只票为什么属于这条超级趋势，≤30 字>",',
    '  "瓶颈层": "<判断它卡在共识层(1)还是深度认知层(2)，简述理由，≤40 字>",',
    '  "瓶颈层级_int": <1 或 2，与"瓶颈层"判断对应；不确定时填 2>,',
    '  "卡位逻辑": "<它在产业链什么位置、为什么不可替代，≤60 字>",',
    '  "卡位等级_int": <1-5 整数；3=普通供应链位置，4=有壁垒，5=独家或近垄断；不确定时填 3>,',
    '  "风险": "<最大风险点，≤30 字>",',
    '  "推演结论": "<基于第一性原理的概率性判断，不给买卖建议，≤60 字>"',
    '}',
    "要求：客观、不夸张；不知道就承认不确定，但 _int 字段必须给整数（不确定时给提示中的中位值）。",
  ].join('\n');
}

function buildValuePrompt(stock, supertrend) {
  const ticker = stock.ticker || '?';
  const name = stock.name || '';
  const sector = stock.sector || stock.industry || '';
  const desc = (stock.descriptionCN || stock.description || stock.summary || '').slice(0, 300);
  const stName = supertrend.name || supertrend.id;
  const stNote = supertrend.note || '';

  return [
    "你是价值投资研究助手，按 'Graham 安全边际' 策略给出客观分析。",
    "策略框架：识别价值赛道 → 评估估值点位（PE/PB/股息率/ROE 当前 vs 历史/同行）" +
    " → 估算内在价值（DCF 简化 / 净资产 / 股息折现） → 计算安全边际 → 第一性原理：业务可预测性 + 护城河 + 资本回报。",
    "",
    `标的: ${ticker} (${name})`,
    `行业/分类: ${sector}`,
    `市值: ${fmtMcap(stock.marketCap)}`,
    `PE: ${fmtNum(stock.pe)} · PB: ${fmtNum(stock.pb, 2)} · 股息率: ${fmtPct(stock.dividend_yield)} · ROE: ${fmtPct(stock.roe)} · D/E: ${fmtNum(stock.debt_to_equity, 2)}`,
    `所属价值赛道: ${stName}（${stNote}）`,
    `业务描述: ${desc || '（缺失）'}`,
    "",
    "请严格输出 JSON，所有字段都要有：",
    '{',
    '  "价值赛道": "<为什么属于这条价值赛道，≤30 字>",',
    '  "估值点位": "<PE/PB/股息率/ROE 当前 vs 历史/同行对标，≤60 字>",',
    '  "估值点位_int": <1 或 2；1=深度低估（PE<10 或 PB<1 或 股息>5%），2=合理估值；不确定填 2>,',
    '  "内在价值": "<DCF 简化 / 净资产法 / 股息折现 给出粗略数字 + 计算逻辑，≤80 字>",',
    '  "护城河": "<品牌/规模/网络效应/转换成本/牌照壁垒，≤40 字>",',
    '  "卡位等级_int": <1-5 整数；价值型语义=护城河强度；3=普通龙头，4=显著壁垒，5=近乎垄断；不确定填 3>,',
    '  "风险": "<价值陷阱 / 行业衰退 / 资本效率下降 / 高负债，≤30 字>",',
    '  "推演结论": "<建议关注价 / 触发买入区间，不给具体买卖建议，≤60 字>"',
    '}',
    "要求：客观、不夸张；不知道就承认不确定，但 _int 字段必须给整数（不确定时给提示中的中位值）。结合给出的 PE/PB/股息率/ROE/D/E 数字一起判断，不要忽略。",
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
  const ticker = body.ticker;
  const supertrend_id = body.supertrend_id;
  if (!ticker || !supertrend_id) {
    return res.status(400).json({ ok: false, error: 'ticker + supertrend_id required' });
  }

  const sts = await listAllSupertrends();
  const st = sts.find(s => s.id === supertrend_id);
  if (!st) {
    return res.status(400).json({ ok: false, error: `unknown supertrend_id: ${supertrend_id}` });
  }

  // 业务描述兜底
  const stockMeta = { ...body };
  if (!stockMeta.description && !stockMeta.descriptionCN && !stockMeta.summary) {
    const summary = await fetchYahooSummary(ticker);
    if (summary) stockMeta.summary = summary;
  }

  // 按 strategy 选 prompt 集（默认 growth 兼容旧调用）
  const strategy = st.strategy === 'value' ? 'value' : 'growth';
  const prompt = strategy === 'value'
    ? buildValuePrompt(stockMeta, st)
    : buildGrowthPrompt(stockMeta, st);

  // cache key prefix 按 strategy 隔离（避免成长/价值缓存碰撞）
  const endpoint = strategy === 'value' ? 'value-thesis' : '10x-thesis';

  const cached = await llmCacheGet(endpoint, DEFAULT_MODEL, prompt);
  if (cached) {
    return res.status(200).json({ ok: true, ticker, thesis: cached.response, cached: true });
  }

  try {
    const { content, prompt_tokens, completion_tokens } = await chat(
      [{ role: 'user', content: prompt }],
      { json_mode: true, max_tokens: strategy === 'value' ? 700 : 600, temperature: 0.3 }
    );
    const parsed = safeJsonParse(content);

    if (strategy === 'value') {
      for (const k of ['价值赛道', '估值点位', '内在价值', '护城河', '风险', '推演结论']) {
        if (!(k in parsed)) parsed[k] = '';
      }
      parsed['估值点位_int'] = clampInt(parsed['估值点位_int'], 1, 2, 2);
      parsed['卡位等级_int'] = clampInt(parsed['卡位等级_int'], 1, 5, 3);
    } else {
      for (const k of ['超级趋势', '瓶颈层', '卡位逻辑', '风险', '推演结论']) {
        if (!(k in parsed)) parsed[k] = '';
      }
      parsed['瓶颈层级_int'] = clampInt(parsed['瓶颈层级_int'], 1, 2, 2);
      parsed['卡位等级_int'] = clampInt(parsed['卡位等级_int'], 1, 5, 3);
    }

    await llmCachePut(endpoint, DEFAULT_MODEL, prompt, parsed, TTL_SEC, {
      ticker, prompt_tokens, completion_tokens,
    });
    return res.status(200).json({ ok: true, ticker, thesis: parsed, cached: false });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return res.status(503).json({ ok: false, error: 'DEEPSEEK_API_KEY 未配置' });
    }
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
