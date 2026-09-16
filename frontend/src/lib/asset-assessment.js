// Descriptive product diagnostics, separate from expected-return rankings.
// Inputs must carry a source, observation date and an explicit unit.
export const ASSESSMENT_VERSION = '1.1.0';
import specs from './product-policy.json' with { type: 'json' };
const rounded = x => Math.floor(x * 10 + .5 + 1e-9) / 10;
const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? Date.parse(s) / 86400000 : null;
export function productAssessment(stock) {
  const dates = [day(stock.scoring?.priceAsOf), day(stock.productDataAsOf)].filter(d => d != null);
  const reference = dates.length ? Math.max(...dates) : null, fields = {}, missing = [], reasons = {};
  for (const [key, spec] of Object.entries(specs)) {
    const raw = stock.productMetrics?.[key];
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length ? raw : null;
    const observed = day(entry?.asOf);
    const available = day(entry?.availableAt ?? entry?.asOf), expiry = day(entry?.validThrough);
    const valid = reference != null && observed != null && reference >= observed && reference - observed <= spec.maxAge
      && available != null && available <= reference && (!entry?.validThrough || (expiry != null && reference <= expiry))
      && typeof entry?.value === 'number' && Number.isFinite(entry.value) && entry.value >= 0 && entry.value <= spec.limit
      && entry.unit === spec.unit && typeof entry.source === 'string' && /^https:\/\//.test(entry.source)
      && (key !== 'dailyTrackingError' || (entry.method === 'sample_std_daily_difference' && entry.fundBasis === 'nav_total_return' && (!stock.targetReturnBasis || entry.benchmarkBasis === stock.targetReturnBasis) && Number.isFinite(entry.observations) && entry.observations >= 20 && Number.isFinite(stock.leverageMultiple) && !!stock.benchmark && entry.targetMultiple === stock.leverageMultiple && entry.benchmark === stock.benchmark));
    const index = valid ? spec.thresholds.findIndex(t => entry.value <= t) : -1;
    fields[key] = valid ? { ...entry, score: [95, 80, 60, 40, 20][index < 0 ? 4 : index] } : null;
    if (!valid) {
      missing.push(key);
      reasons[key] = !entry ? 'missing' : expiry != null && reference > expiry ? 'expired' : observed != null && reference - observed > spec.maxAge ? 'stale' : available != null && reference < available ? 'not_yet_available' : 'invalid';
    }
  }
  // All three execution dimensions are mandatory; AUM and concentration are not substitutes.
  const score = missing.length ? null : rounded(Object.entries(specs).reduce((sum, [key, spec]) => sum + fields[key].score * spec.weight, 0));
  return { score, asOf: reference == null ? null : new Date(reference * 86400000).toISOString().slice(0, 10), reasons, coverage: rounded(Object.entries(specs).reduce((sum, [key, spec]) => sum + (fields[key] ? spec.weight * 100 : 0), 0)), fields, missing };
}

export function leverageScenarios(multiple) {
  if (!Number.isFinite(multiple) || multiple === 1 || multiple === 0 || Math.abs(multiple) > 5) return [];
  return ['up', 'down', 'round_trip'].flatMap(path => [1, 5, 20].map(days => {
    let benchmark = 1, product = 1;
    for (let i = 0; i < days; i++) {
      const r = path === 'up' ? .01 : path === 'down' ? -.01 : i % 2 ? 1 / 1.01 - 1 : .01;
      benchmark *= 1 + r; product *= 1 + multiple * r;
    }
    return { path, days, benchmarkReturn: rounded((benchmark - 1) * 100), productReturn: rounded((product - 1) * 100) };
  }));
}

export function attachAssessments(stocks) {
  for (const stock of stocks) {
    if (stock.assetType === 'stock') { delete stock.assetAssessment; continue; }
    const candidates = stocks.filter(s => s.ticker === stock.underlyingSymbol && s !== stock && s.assetType === 'stock');
    const underlying = stock.underlyingType === 'stock' && candidates.length === 1 ? candidates[0] : null;
    stock.assetAssessment = {
      version: ASSESSMENT_VERSION, mode: stock.assetType === 'crypto' ? 'crypto_research' : 'product_research',
      product: stock.isETF ? productAssessment(stock) : null,
      underlying: underlying ? { ticker: underlying.ticker, qualityScore: underlying.qualityScore, timingScore: underlying.timingScore, priceAsOf: underlying.scoring.priceAsOf } : null,
      scenarios: stock.isETF ? leverageScenarios(stock.leverageMultiple) : [],
      cryptoCategory: stock.assetType === 'crypto' ? (['monetary', 'network', 'application', 'stablecoin'].includes(stock.cryptoCategory) ? stock.cryptoCategory : 'unknown') : null,
    };
    if (stock.productDataAsOf && stock.isETF) {
      const fee = stock.assetAssessment.product.fields.expenseRatio;
      stock.expenseRatio = fee?.value ?? null;
      stock.expenseRatioAsOf = fee?.asOf ?? null;
      // Legacy volatility estimates have no verified split/return basis; do not display them as current drag.
      stock.decayRate = null;
    }
    // Product quality and price trend have different meanings: never synthesize a buy score.
    stock.score = stock.qualityScore = stock.rank = stock.scoreSmoothed = stock.scoreDelta5d = stock.scoreHistoryVersion = null;
    stock.scoring.compositeEligible = false;
    stock.scoring.status = 'separate_dimensions';
    stock.scoring.qualityCoverage = 0;
    stock.scoring.coverage = stock.assetAssessment.product?.coverage ?? 0;
    stock.scoring.qualityDeduction = 0;
    stock.scoring.warnings = stock.scoring.warnings.filter(w => !w.includes('规模为流动性代理') && !w.includes('该资产类型尚未启用'));
    for (const key of ['cost', 'liquidity', 'diversification']) if (key in stock.subScores) stock.subScores[key] = null;
  }
  return stocks;
}
