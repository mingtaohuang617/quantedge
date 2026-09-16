// Browser implementation of backend/scoring.py; policy and cross-runtime fixtures are shared.
import policy from './scoring-policy.json' with { type: 'json' };
import { attachAssessments } from './asset-assessment.js';
import { productEnrichment } from './product-data.js';
export const SCORE_VERSION = policy.version;
export const ASSET_LABELS = { stock: '股票', index_etf: '指数 ETF', other_etf: '其他 ETF', leveraged_stock_etf: '单股杠杆 ETF', leveraged_index_etf: '指数杠杆 ETF', leveraged_other_etf: '其他杠杆 ETF', unclassified_etf: '待分类 ETF', crypto: '加密货币' };
export const number = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().replaceAll(',', '').toUpperCase().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))([KMBT])?$/);
  return m ? Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] || 1) : null;
};
const round = (n, places = 1) => n == null ? null : Math.floor(n * 10 ** places + .5 + 1e-9) / 10 ** places;
const sane = (v, lo, hi) => { const n = number(v); return n != null && n >= lo && n <= hi ? n : null; };
const mean = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const pct = (v, pool) => (pool.filter(x => x < v).length + .5 * pool.filter(x => x === v).length) / pool.length * 100;
const weighted = (values, weights) => { const entries = Object.entries(weights).filter(([k]) => values[k] != null); const coverage = entries.reduce((s, [, w]) => s + w, 0); return [coverage ? entries.reduce((s, [k, w]) => s + values[k] * w, 0) / coverage : null, coverage]; };
export function assetMetadata(s) {
  const verified = { ...(policy.verifiedAssets?.[s.ticker] || {}), ...productEnrichment(s) };
  s = { ...s, ...verified };
  const crypto = s.assetType === 'crypto' || s.quoteType === 'CRYPTOCURRENCY' || s.market === 'CRYPTO' || /-(USD|USDT)$/.test(s.ticker || '');
  const leverage = number(String(s.leverage ?? '').toLowerCase().replace('x', ''));
  let underlying = s.underlyingType || null;
  const benchmark = s.benchmark || '';
  if (!underlying) {
    if (/Gold|WTI|Crude|Silver|黄金|原油|白银/i.test(benchmark)) underlying = 'commodity';
    else if (/Index|指数/i.test(benchmark)) underlying = 'index';
    else if (/\([A-Z]+\)|KRX:/.test(benchmark)) underlying = 'stock';
  }
  const lev = leverage != null && leverage !== 0 && leverage !== 1;
  const etf = !crypto && (!!s.isETF || s.quoteType === 'ETF');
  const assetType = crypto ? 'crypto' : etf && lev ? ({ stock: 'leveraged_stock_etf', index: 'leveraged_index_etf' }[underlying] || 'leveraged_other_etf') : etf && (/杠杆|反向|[23]倍/.test(s.etfType || '') || leverage === 0) ? 'unclassified_etf' : etf ? underlying === 'index' ? 'index_etf' : 'other_etf' : 'stock';
  return { ...verified, isETF: etf, assetType, underlyingType: underlying, underlyingSymbol: s.underlyingSymbol || null, leverageMultiple: lev ? leverage : assetType === 'unclassified_etf' ? null : 1, direction: lev && leverage < 0 ? 'inverse' : 'long' };
}
export function prepareInputs(stock, bars) {
  const dates = bars.map(b => b.date || b.trade_date);
  const valid = bars.length > 0 && bars.every(b => number(b.close) != null && number(b.close) > 0) && (!dates.every(Boolean) || dates.every((d, i) => !i || d > dates[i - 1]));
  const c = valid ? bars.map(b => number(b.close)) : [], n = c.length;
  let momentum = null, trend = null, rsi = null, decay = null;
  if (n >= 25) { const a = []; if (n > 63) a.push(c.at(-1) / c.at(-64) - 1); if (n > 126) a.push(c.at(-22) / c.at(-127) - 1); momentum = a.length ? mean(a) : c.at(-1) / c.at(-22) - 1; }
  if (n >= 200) { const ma50 = mean(c.slice(-50)), ma200 = mean(c.slice(-200)); const lean = (a, b) => Math.tanh((a / b - 1) / .05); trend = Math.max(0, Math.min(100, 50 + 17 * lean(c.at(-1), ma50) + 17 * lean(c.at(-1), ma200) + 16 * lean(ma50, ma200))); }
  if (n >= 15) { const diffs = c.slice(-14).map((v, i) => v - c[n - 15 + i]); const gain = diffs.reduce((s, v) => s + Math.max(0, v), 0), loss = diffs.reduce((s, v) => s + Math.max(0, -v), 0); const raw = round(!gain && !loss ? 50 : !loss ? 100 : 100 - 100 / (1 + gain / loss)); rsi = Math.max(0, Math.min(100, 100 - 2.2 * Math.abs(raw - 55))); }
  const L = assetMetadata(stock).leverageMultiple;
  if (n >= 30 && L != null && L !== 1) { const ret = c.slice(1).map((v, i) => v / c[i] - 1), m = mean(ret); const variance = ret.reduce((s, v) => s + (v - m) ** 2, 0) / (ret.length - 1); decay = round((L * L - L) / 2 * variance / (L * L) * 252 * 100, 2); }
  return { version: SCORE_VERSION, momentum, trend, rsi, decay, observations: n, priceAsOf: valid ? dates.at(-1) || null : null };
}
export function compositeScore(q, t, weights = policy.composite) {
  const a = number(weights.quality), b = number(weights.timing);
  if (a == null || b == null || a < 0 || b < 0 || a + b <= 0 || (a > 0 && !Number.isFinite(q)) || (b > 0 && !Number.isFinite(t))) return null;
  return round(((q ?? 0) * a + (t ?? 0) * b) / (a + b));
}

// Custom weights are a view of the same factors, not a mutation of shared cached scores.
export function reweightUniverse(stocks, weights) {
  const result = stocks.map(s => {
    const score = s.scoring?.compositeEligible === false || s.scoring?.status === 'unsupported' ? null : compositeScore(s.qualityScore, s.timingScore, weights);
    const total = weights.quality + weights.timing;
    return { ...s, score,
      scoreSmoothed: weights.quality === policy.composite.quality && weights.timing === policy.composite.timing ? s.scoreSmoothed : null,
      scoreDelta5d: weights.quality === policy.composite.quality && weights.timing === policy.composite.timing ? s.scoreDelta5d : null,
      scoring: { ...s.scoring, weights, status: s.scoring?.compositeEligible === false ? 'separate_dimensions' : s.scoring?.status === 'unsupported' ? 'unsupported' : score == null ? 'insufficient_data' : 'ready',
        coverage: s.scoring?.compositeEligible === false ? s.scoring.coverage : total > 0 ? round(((s.scoring?.qualityCoverage ?? 0) * weights.quality + (s.scoring?.timingCoverage ?? 0) * weights.timing) / total, 0) : 0 } };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const counts = {};
  for (const s of result) { const key = `${s.assetType}/${s.market}/${s.direction}`; counts[key] = (counts[key] || 0) + 1; s.rank = s.score == null ? null : counts[key]; }
  return result;
}
const valAbs = (ey, by) => mean([ey == null ? null : ey >= .08 ? 85 : ey >= .05 ? 70 : ey >= .033 ? 55 : ey >= .0125 ? 40 : 25, by == null ? null : by >= .67 ? 80 : by >= .4 ? 65 : by >= .2 ? 50 : 35]) ?? 50;
const profAbs = (roe, margin) => mean([roe == null ? null : roe >= 25 ? 90 : roe >= 15 ? 72 : roe >= 8 ? 55 : roe >= 0 ? 40 : 20, margin == null ? null : margin >= 25 ? 88 : margin >= 12 ? 70 : margin >= 5 ? 52 : margin >= 0 ? 38 : 18]) ?? 50;
const growAbs = g => g == null ? 50 : g >= 30 ? 90 : g >= 15 ? 72 : g >= 5 ? 55 : g >= 0 ? 40 : 25;

export function scoreUniverse(stocks) {
  const rows = stocks.map(source => {
    const s = { ...source, ...assetMetadata(source) };
    const inp = s.scoringInputs?.version === SCORE_VERSION ? s.scoringInputs : {};
    const pe = sane(s.pe, .5, 1500), pb = sane(s.pb, 0, 100), mc = number(s.marketCap), rev = number(s.revenue);
    const currencyOK = !!s.financialCurrency && s.financialCurrency === s.marketCapCurrency;
    const raw = { ey: pe ? 1 / pe : null, by: pb ? 1 / pb : null, sy: mc > 0 && rev != null && rev >= 0 && currencyOK ? rev / mc : null, roe: sane(s.roe, -300, 500), margin: sane(s.profitMargin, -200, 100), grow: sane(s.revenueGrowth, -100, 2000) };
    return { s, inp, raw };
  });
  for (const { s, inp, raw } of rows) {
    const previousScore = s.score;
    const cryptoTrend = s.assetType === 'crypto' && ['monetary', 'network', 'application'].includes(s.cryptoCategory);
    const kind = s.assetType, supported = cryptoTrend || ['stock', 'index_etf', 'other_etf', 'leveraged_stock_etf', 'leveraged_index_etf'].includes(kind);
    const group = s.gicsSector || s.yfSector || 'unknown';
    const same = rows.filter(({ s: p }) => group !== 'unknown' && p.assetType === kind && (p.gicsSector || p.yfSector || 'unknown') === group && p.market === s.market);
    const peers = {}, warnings = []; let sub, q, coverage, deduction = 0;
    if (kind === 'stock') {
      const factor = (key, anchor) => { if (raw[key] == null) { peers[key] = 0; return null; } const pool = same.map(p => p.raw[key]).filter(v => v != null); peers[key] = pool.length; if (pool.length < policy.minimumPeers) return anchor; return anchor == null ? pct(raw[key], pool) : (1 - policy.anchorWeight) * pct(raw[key], pool) + policy.anchorWeight * anchor; };
      const vals = [factor('ey', valAbs(raw.ey, null)), factor('by', valAbs(null, raw.by)), factor('sy', null)], prof = [factor('roe', profAbs(raw.roe, null)), factor('margin', profAbs(null, raw.margin))];
      sub = { valuation: mean(vals), profitability: mean(prof), growth: factor('grow', growAbs(raw.grow)) };
      coverage = [...vals, ...prof, sub.growth].filter(v => v != null).length / 6;
      [q] = weighted(sub, policy.quality);
      if (coverage + 1e-9 < policy.minimumCoverage || Object.values(sub).filter(v => v != null).length < 2) q = null;
      if (Object.values(peers).some(n => n < policy.minimumPeers)) warnings.push('部分因子同类样本不足，使用绝对锚或暂缺');
      if (!s.financialCurrency || !s.marketCapCurrency) warnings.push('财务币种未完整标注，营收／市值因子暂不参与');
    } else {
      sub = { cost: null, liquidity: null, diversification: null };
      q = null; coverage = 0;
    }
    const mp = rows.filter(({ s: p, inp: i }) => p.assetType === kind && p.market === s.market && p.direction === s.direction && (kind !== 'crypto' || p.cryptoCategory === s.cryptoCategory) && i.momentum != null).map(p => p.inp.momentum);
    Object.assign(sub, { momentum: inp.momentum != null && mp.length >= policy.minimumPeers ? pct(inp.momentum, mp) : null, trend: inp.trend ?? null, rsi: inp.rsi ?? null });
    let [t, tc] = weighted(sub, policy.timing);
    if (tc + 1e-9 < policy.minimumCoverage) t = null;
    if (!supported) { q = t = null; sub = Object.fromEntries(Object.keys(sub).map(k => [k, null])); warnings.push('该资产类型尚未启用专属模型'); }
    s.qualityScore = round(q); s.timingScore = round(t);
    s.score = compositeScore(s.qualityScore, s.timingScore);
    s.subScores = Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, round(v)]));
    if (s.scoreHistoryVersion !== SCORE_VERSION || previousScore !== s.score) {
      s.scoreSmoothed = s.scoreDelta5d = null; s.scoreHistoryVersion = null;
    }
    s.scoring = { version: SCORE_VERSION, status: s.score != null ? 'ready' : supported ? 'insufficient_data' : 'unsupported', coverage: supported ? round(100 * (.6 * coverage + .4 * tc), 0) : 0, qualityCoverage: supported ? round(100 * coverage, 0) : 0, timingCoverage: supported ? round(100 * tc, 0) : 0, peerGroup: `${s.market || 'unknown'} / ${kind} / ${group}`, factorPeerCounts: peers, momentumPeers: mp.length, priceAsOf: inp.priceAsOf || null, financialPeriod: s.financialPeriod || null, financialPublishedAt: s.financialPublishedAt || null, warnings, qualityDeduction: round(deduction), weights: policy.composite, horizon: '多月趋势描述，非买点或上涨概率' };
  }
  const result = attachAssessments(rows.map(r => r.s)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), counts = {};
  for (const s of result) { const key = `${s.assetType}/${s.market}/${s.direction}`; counts[key] = (counts[key] || 0) + 1; s.rank = s.score == null ? null : counts[key]; }
  return result;
}

export const scoreRadar = stock => (stock.isETF ? ['cost', 'liquidity', 'diversification', 'momentum', 'trend', 'rsi'] : ['valuation', 'profitability', 'growth', 'momentum', 'trend', 'rsi']).map(key => ({ key, value: stock.subScores?.[key] ?? null, fullMark: 100 }));

export function formatAmount(value) {
  const v = number(value);
  if (v == null) return '—';
  for (const [scale, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (Math.abs(v) >= scale) return `${round(v / scale, 2)}${suffix}`;
  }
  return String(round(v, 2));
}
