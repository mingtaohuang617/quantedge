import { describe, it, expect } from 'vitest';
import {
  compoundFinalValue,
  compoundSeries,
  inflationAdjusted,
  monteCarloAnnual,
  formatBigNumber,
} from './compound';

const closeTo = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

// 简单线性同余 RNG — 让蒙特卡洛测试可重复
function seededRng(seed = 42): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('compoundFinalValue', () => {
  it('returns principal when years = 0', () => {
    expect(compoundFinalValue(100, 0.1, 0)).toBe(100);
  });
  it('matches (1+r)^n for unit principal', () => {
    expect(closeTo(compoundFinalValue(1, 0.10, 10), Math.pow(1.10, 10))).toBe(true);
  });
  it('classic 10% × 10 years ≈ 2.5937', () => {
    expect(Math.abs(compoundFinalValue(1, 0.10, 10) - 2.5937) < 1e-3).toBe(true);
  });
  it('doubles for 100% over 1 year', () => {
    expect(compoundFinalValue(50, 1.00, 1)).toBe(100);
  });
});

describe('compoundSeries', () => {
  it('length = years + 1', () => {
    expect(compoundSeries(100, 0.05, 5)).toHaveLength(6);
  });
  it('first element = principal, last element = final value', () => {
    const s = compoundSeries(100, 0.05, 5);
    expect(s[0]).toBe(100);
    expect(closeTo(s[5], 100 * Math.pow(1.05, 5))).toBe(true);
  });
  it('monotonically increasing for positive rate', () => {
    const s = compoundSeries(1, 0.07, 10);
    for (let i = 1; i < s.length; i++) {
      expect(s[i] > s[i - 1]).toBe(true);
    }
  });
});

describe('inflationAdjusted', () => {
  it('returns nominal when years = 0', () => {
    expect(inflationAdjusted(1000, 0, 0.03)).toBe(1000);
  });
  it('when nominal rate = inflation rate, real value = original principal', () => {
    // 10 年 5% 名义增长，5% 通胀 → 实际购买力等于原本金
    const nominal = compoundFinalValue(1000, 0.05, 10);
    const real = inflationAdjusted(nominal, 10, 0.05);
    expect(closeTo(real, 1000, 1e-6)).toBe(true);
  });
  it('higher inflation reduces real value', () => {
    const a = inflationAdjusted(1000, 10, 0.02);
    const b = inflationAdjusted(1000, 10, 0.05);
    expect(a > b).toBe(true);
  });
});

describe('monteCarloAnnual', () => {
  it('bands length = years + 1', () => {
    const r = monteCarloAnnual(100, 0.10, 0.15, 10, 200, seededRng(1));
    expect(r.bands).toHaveLength(11);
  });
  it('year 0 band all equal principal', () => {
    const r = monteCarloAnnual(100, 0.10, 0.15, 10, 200, seededRng(1));
    expect(r.bands[0].p05).toBe(100);
    expect(r.bands[0].p50).toBe(100);
    expect(r.bands[0].p95).toBe(100);
  });
  it('p05 <= p50 <= p95 at every year', () => {
    const r = monteCarloAnnual(100, 0.10, 0.20, 20, 500, seededRng(7));
    for (const b of r.bands) {
      expect(b.p05 <= b.p50).toBe(true);
      expect(b.p50 <= b.p95).toBe(true);
    }
  });
  it('summary p05 <= p50 <= p95', () => {
    const r = monteCarloAnnual(100, 0.10, 0.20, 20, 500, seededRng(7));
    expect(r.summary.p05 <= r.summary.p50).toBe(true);
    expect(r.summary.p50 <= r.summary.p95).toBe(true);
  });
  it('zero volatility collapses to deterministic compound', () => {
    const r = monteCarloAnnual(100, 0.10, 0.0001, 10, 200, seededRng(3));
    const det = compoundFinalValue(100, 0.10, 10);
    // p05 / p50 / p95 应该都接近确定值
    expect(Math.abs(r.summary.p50 - det) / det < 0.01).toBe(true);
    expect(r.summary.probLoss < 0.01).toBe(true);
  });
  it('high volatility yields non-trivial ruin probability', () => {
    const r = monteCarloAnnual(100, 0.10, 0.60, 10, 1000, seededRng(11));
    expect(r.summary.ruinProb > 0).toBe(true);
    expect(r.summary.probLoss > r.summary.ruinProb).toBe(true);
  });
});

describe('formatBigNumber', () => {
  it('small numbers as fixed decimals', () => {
    expect(formatBigNumber(1.234)).toBe('1.23');
  });
  it('thousands with locale separator (no suffix)', () => {
    expect(formatBigNumber(12345).includes('345')).toBe(true);
  });
  it('millions get M suffix', () => {
    expect(formatBigNumber(2.5e6)).toBe('2.50M');
  });
  it('billions get B suffix', () => {
    expect(formatBigNumber(3e9)).toBe('3.00B');
  });
  it('trillions get T suffix', () => {
    expect(formatBigNumber(1.5e12)).toBe('1.50T');
  });
  it('beyond trillions uses scientific', () => {
    expect(formatBigNumber(1e16).includes('e+')).toBe(true);
  });
});
