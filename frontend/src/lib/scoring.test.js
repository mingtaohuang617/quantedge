import { describe, expect, it } from 'vitest';
import { compositeScore, scoreRadar, scoreUniverse, prepareInputs, assetMetadata, reweightUniverse } from './scoring.js';

describe('scoring v3 presentation contract', () => {
  it('composes the displayed tracks without cross-asset standardization', () => {
    expect(compositeScore(80, 96)).toBe(86.4);
    expect(compositeScore(null, 96)).toBeNull();
    expect(compositeScore(80, 96, { quality: -1, timing: 2 })).toBeNull();
    expect(compositeScore(80, null, { quality: 100, timing: 0 })).toBe(80);
  });
  it('radar reads the same scores, preserving missing values', () => {
    const points = scoreRadar({ subScores: { valuation: 60.2, profitability: 87.2, growth: 94.7, rsi: 88.8 }, rsi: 60.1, pe: 31.2 });
    expect(points.find(x => x.key === 'rsi').value).toBe(88.8);
    expect(points.find(x => x.key === 'valuation').value).toBe(60.2);
    expect(points.find(x => x.key === 'momentum').value).toBeNull();
  });
  it('does not accept cached legacy scores or fabricated crypto fundamentals', () => {
    const [s] = scoreUniverse([{ ticker: 'BTC-USD', score: 90, qualityScore: 90, timingScore: 90, pe: 2 }]);
    expect(s.score).toBeNull();
    expect(s.scoring.status).toBe('separate_dimensions');
  });
  it('classifies single-stock and index leverage separately, with inverse direction', () => {
    expect(assetMetadata({ isETF: true, leverage: '2x', underlyingType: 'stock' }).assetType).toBe('leveraged_stock_etf');
    expect(assetMetadata({ isETF: true, leverage: '-2x', underlyingType: 'index' }).direction).toBe('inverse');
    expect(assetMetadata({ isETF: true, etfType: '2倍杠杆ETF' }).assetType).toBe('unclassified_etf');
    expect(assetMetadata({ quoteType: 'ETF', isETF: false }).isETF).toBe(true);
  });
  it('rejects invalid bars instead of manufacturing a neutral trend', () => {
    expect(prepareInputs({}, [{ close: 1 }, { close: NaN }]).observations).toBe(0);
    expect(prepareInputs({}, []).rsi).toBeNull();
  });
  it('custom weights update coverage without modifying shared scores', () => {
    const source = { ticker: 'A', qualityScore: 80, timingScore: 96, score: 86.4, scoring: { status: 'ready', qualityCoverage: 80, timingCoverage: 100 } };
    const [view] = reweightUniverse([source], { quality: 30, timing: 70 });
    expect(view.score).toBe(91.2);
    expect(view.scoring.coverage).toBe(94);
    expect(source.score).toBe(86.4);
  });
});
