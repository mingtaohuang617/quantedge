import { readJson, requireReferer } from '../_lib/auth.js';
import { chat, DEFAULT_MODEL } from '../_lib/deepseek.js';
import { llmCacheGet, llmCachePut } from '../_lib/llmCache.js';
import policy from '../../src/lib/scoring-policy.json' with { type: 'json' };

const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
export function buildScorePrompt(stock) {
  const scoring = stock?.scoring || {};
  if (stock?.assetType !== 'stock' || stock.isETF || scoring.status === 'separate_dimensions') {
    throw new Error('仅股票完整综合分支持此解读；其他资产分别解释各维度');
  }
  if (!/^[A-Za-z0-9.^=_/-]{1,32}$/.test(stock.ticker || '')) throw new Error('标的代码无效');
  const { score, qualityScore: quality, timingScore: timing } = stock;
  if (![score, quality, timing].every(valid)) throw new Error('缺少有效综合分、质量分或趋势分');
  if (scoring.version !== policy.version || stock.modelVersion !== scoring.version) throw new Error('评分版本缺失或不一致');
  const { quality: qw, timing: tw } = stock.weights || {};
  if (![qw, tw].every(valid) || qw + tw <= 0) throw new Error('权重无效');
  const wq = qw / (qw + tw);
  if (Math.abs(score - (quality * wq + timing * (1 - wq))) > .11) throw new Error('综合分与分项及权重不一致');
  const factors = Object.fromEntries(['valuation', 'profitability', 'growth', 'momentum', 'trend', 'rsi']
    .map(key => [key, valid(stock.subScores?.[key]) ? stock.subScores[key] : null]));
  return `股票 ${stock.ticker} 综合分 ${score}/100 = 质量 ${quality} × ${(wq * 100).toFixed(1)}% + 趋势 ${timing} × ${((1 - wq) * 100).toFixed(1)}%。\n`
    + `模型 ${scoring.version}；分项：${JSON.stringify(factors)}。\n`
    + '用 1–2 句解释哪些分项贡献较高，缺失项明确缺失。评分为实验性描述，尚未通过完整样本外验证；'
    + '不能宣称已验证有效，不能将覆盖率解释为准确率、收益率或上涨概率，不给买卖指令。'
    + '不使用资产规模替代流动性，不编造财报日期、来源或回测结果。纯文本，不超过 100 字。';
}

export default async function explainScore(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!requireReferer(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  }
  let body, prompt;
  try {
    body = await readJson(req);
    prompt = buildScorePrompt(body);
  } catch {
    return res.status(400).json({ ok: false, code: 'invalid_score_contract', error: '评分类型、数据、版本或权重不满足解读条件' });
  }
  const language = req.query?.lang || body.lang;
  prompt += language === 'en' ? '\nRespond in English.' : ['zh-TW', 'tw'].includes(language) ? '\n請用繁體中文回答。' : '\n请用简体中文回答。';
  try {
    const cached = req.query?.force === 'true' ? null : await llmCacheGet('explain-score-v3', DEFAULT_MODEL, prompt);
    if (cached?.response?.text) return res.status(200).json({ ok: true, ticker: body.ticker, explanation: cached.response.text, cached: true });
    const result = await chat([{ role: 'user', content: prompt }], { max_tokens: 220, temperature: .3 });
    const text = String(result.content || '').trim();
    if (!text) throw new Error('empty response');
    await llmCachePut('explain-score-v3', DEFAULT_MODEL, prompt, { text }, 86400, { ticker: body.ticker });
    return res.status(200).json({ ok: true, ticker: body.ticker, explanation: text, cached: false });
  } catch {
    return res.status(503).json({ ok: false, error: '评分解读暂不可用，请稍后重试' });
  }
}
