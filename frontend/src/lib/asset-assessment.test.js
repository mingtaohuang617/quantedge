import { describe, expect, it } from 'vitest';
import { productAssessment, leverageScenarios } from './asset-assessment.js';
import { scoreUniverse, reweightUniverse } from './scoring.js';
import { SCORE_VERSION } from './scoring.js';

const fixture = () => ({
  ticker: 'TEST', isETF: true, underlyingType: 'index', leverage: '3x', leverageMultiple: 3, benchmark: 'Test Index',
  scoring: { priceAsOf: '2026-09-15' },
  productMetrics: Object.fromEntries([
    ['expenseRatio', .1, 'percent'], ['medianSpread30d', 5, 'bps'], ['dailyTrackingError', 5, 'bps'],
  ].map(([key, value, unit]) => [key, { value, unit, asOf: '2026-09-14', source: 'https://example.com/fund', method: 'sample_std_daily_difference', fundBasis: 'nav_total_return', observations: 30, targetMultiple: 3, benchmark: 'Test Index' }])),
});
describe('separate asset assessments', () => {
  it('does not advance an explicit historical evaluation date to a current observation', () => {
    const s = fixture(); s.evaluationAsOf = '2024-01-01'; s.productDataAsOf = '2026-09-16';
    expect(productAssessment(s).coverage).toBe(0);
    expect(productAssessment(s).asOf).toBe('2024-01-01');
    const result = scoreUniverse([{ ticker: 'TQQQ', evaluationAsOf: '2024-01-01', isETF: true, underlyingType: 'index', leverage: '3x' }])[0];
    expect(result.productMetrics).toBeUndefined();
    expect(result.scoring.validation.predictiveStatus).toBe('not_validated');
    expect(scoreUniverse([{ ticker: 'SOXS', evaluationAsOf: '2024-01-01' }])[0].classificationSource).toBeUndefined();
  });
  it('rejects expired fee waivers and observations unavailable at the evaluation time', () => {
    const s = fixture();
    s.productMetrics.expenseRatio.validThrough = '2026-09-14';
    expect(productAssessment(s).reasons.expenseRatio).toBe('expired');
    delete s.productMetrics.expenseRatio.validThrough;
    s.productMetrics.expenseRatio.availableAt = '2026-09-16';
    expect(productAssessment(s).reasons.expenseRatio).toBe('not_yet_available');
    s.productDataAsOf = '2026-09-16';
    expect(productAssessment(s).score).toBe(95);
    expect(s.scoring.priceAsOf).toBe('2026-09-15');
  });
  it('uses crypto-category peers and never ranks stablecoins by appreciation', () => {
    const assets = Array.from({ length: 9 }, (_, i) => ({ ticker: `COIN${i}`, assetType: 'crypto', market: 'CRYPTO', cryptoCategory: 'network',
      scoringInputs: { version: SCORE_VERSION, momentum: i / 10, trend: 80, rsi: 70, priceAsOf: '2026-09-15' } }));
    assets.push({ ...assets[0], ticker: 'STABLE', cryptoCategory: 'stablecoin' });
    const result = scoreUniverse(assets);
    expect(result.find(s => s.ticker === 'COIN0').timingScore).not.toBeNull();
    expect(result.find(s => s.ticker === 'COIN0').scoring.momentumPeers).toBe(9);
    expect(result.find(s => s.ticker === 'STABLE').timingScore).toBeNull();
    expect(result.every(s => s.score === null && s.qualityScore === null)).toBe(true);
  });
  it('scores execution quality without a leverage cap or a concentration penalty', () => {
    const s = fixture();
    expect(productAssessment(s).score).toBe(95);
    s.concentrationTop3 = 100;
    expect(productAssessment(s).score).toBe(95);
  });
  it.each([
    { asOf: '2026-09-16' }, { asOf: '2025-01-01' }, { asOf: '2026-13-01' },
    { source: '' }, { unit: 'percent' }, { value: Infinity }, { value: -1 },
    { targetMultiple: 1 }, { observations: 19 }, { benchmark: 'Another Index' },
  ])('rejects invalid or mismatched tracking evidence: %j', patch => {
    const s = fixture(); Object.assign(s.productMetrics.dailyTrackingError, patch);
    expect(productAssessment(s).score).toBeNull();
    expect(productAssessment(s).missing).toContain('dailyTrackingError');
  });
  it('cannot restore a cross-dimension total via user weights', () => {
    const [s] = scoreUniverse([fixture()]);
    expect(reweightUniverse([s], { quality: 0, timing: 100 })[0].score).toBeNull();
    expect(s.scoring.status).toBe('separate_dimensions');
  });
  it('shows daily compounding, including inverse paths, rather than a period multiple', () => {
    const roundTrip = leverageScenarios(3).find(s => s.path === 'round_trip' && s.days === 20);
    expect(roundTrip.benchmarkReturn).toBe(0);
    expect(roundTrip.productReturn).toBeLessThan(0);
    expect(leverageScenarios(-3).find(s => s.path === 'down' && s.days === 5).productReturn).toBeGreaterThan(0);
    expect(leverageScenarios(null)).toEqual([]);
  });
});
