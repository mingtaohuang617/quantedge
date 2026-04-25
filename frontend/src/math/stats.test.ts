import { describe, it, expect } from 'vitest';
import {
  mean,
  stdev,
  downsideStdev,
  sharpeRatio,
  sortinoRatio,
  calmarRatio,
  navToReturns,
  quantile,
  hhi,
  effectiveN,
  gaussian,
  monteCarlo,
} from './stats';

const closeTo = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

describe('mean', () => {
  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });
  it('computes arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('handles negatives', () => {
    expect(mean([-2, 0, 2])).toBe(0);
  });
});

describe('stdev (population)', () => {
  it('returns 0 for empty array', () => {
    expect(stdev([])).toBe(0);
  });
  it('returns 0 for constant array', () => {
    expect(stdev([5, 5, 5])).toBe(0);
  });
  it('matches population std formula (n divisor)', () => {
    // var = ((1-2)^2 + (2-2)^2 + (3-2)^2) / 3 = 2/3
    expect(closeTo(stdev([1, 2, 3]), Math.sqrt(2 / 3))).toBe(true);
  });
  it('accepts pre-computed mean', () => {
    expect(closeTo(stdev([1, 2, 3], 2), Math.sqrt(2 / 3))).toBe(true);
  });
});

describe('downsideStdev', () => {
  it('returns 0 if no values below target', () => {
    expect(downsideStdev([0.1, 0.2, 0.3])).toBe(0);
  });
  it('computes std of negative-only deviations', () => {
    // values < 0: -0.1, -0.2 → std = sqrt(((-0.1)^2 + (-0.2)^2)/2) = sqrt(0.025)
    expect(closeTo(downsideStdev([-0.1, -0.2, 0.3]), Math.sqrt(0.025))).toBe(true);
  });
});

describe('sharpeRatio', () => {
  it('returns 0 when sigma is 0', () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 252)).toBe(0);
  });
  it('annualizes correctly', () => {
    // mu = 0.01, sigma = sqrt(2/3)*0.01 (approx), periodsPerYear=252
    const ret = [0, 0.01, 0.02];
    const expected = (mean(ret) / stdev(ret)) * Math.sqrt(252);
    expect(closeTo(sharpeRatio(ret, 252), expected)).toBe(true);
  });
  it('subtracts risk-free rate', () => {
    const ret = [0.01, 0.02, 0.03];
    const rf = 0.001;
    const expected = ((mean(ret) - rf) / stdev(ret)) * Math.sqrt(12);
    expect(closeTo(sharpeRatio(ret, 12, rf), expected)).toBe(true);
  });
});

describe('sortinoRatio', () => {
  it('returns 0 when no downside variance', () => {
    expect(sortinoRatio([0.01, 0.02, 0.03], 252)).toBe(0);
  });
  it('uses only downside std', () => {
    const ret = [-0.02, 0.01, 0.03];
    const expected = (mean(ret) / downsideStdev(ret)) * Math.sqrt(252);
    expect(closeTo(sortinoRatio(ret, 252), expected)).toBe(true);
  });
});

describe('calmarRatio', () => {
  it('returns 0 when maxDD is 0', () => {
    expect(calmarRatio(0.1, 0)).toBe(0);
  });
  it('returns absolute ratio', () => {
    expect(calmarRatio(0.2, -0.1)).toBe(2);
    expect(calmarRatio(-0.1, -0.2)).toBe(0.5);
  });
});

describe('navToReturns', () => {
  it('returns empty for short series', () => {
    expect(navToReturns([100])).toEqual([]);
    expect(navToReturns([])).toEqual([]);
  });
  it('computes simple returns', () => {
    const r = navToReturns([100, 110, 99]);
    expect(r.length).toBe(2);
    expect(closeTo(r[0], 0.1)).toBe(true);
    expect(closeTo(r[1], -0.1)).toBe(true);
  });
  it('skips non-positive values', () => {
    const r = navToReturns([100, 0, 110, 121]);
    // 0 should break the chain — only 110→121 remains
    expect(r.length).toBe(1);
    expect(closeTo(r[0], 0.1)).toBe(true);
  });
});

describe('quantile', () => {
  it('returns NaN for empty', () => {
    expect(quantile([], 0.5)).toBeNaN();
  });
  it('returns min for p=0, max for p=1', () => {
    expect(quantile([3, 1, 2], 0)).toBe(1);
    expect(quantile([3, 1, 2], 1)).toBe(3);
  });
  it('interpolates linearly', () => {
    // For [1,2,3,4]: median (p=0.5) → idx=1.5 → (2+3)/2 = 2.5
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it('clamps p out-of-range', () => {
    expect(quantile([1, 2, 3], -0.5)).toBe(1);
    expect(quantile([1, 2, 3], 1.5)).toBe(3);
  });
});

describe('hhi', () => {
  it('returns 1 for fully concentrated portfolio', () => {
    expect(hhi([100])).toBe(1);
    expect(hhi([1])).toBe(1);
  });
  it('returns 0.25 for 4 equal weights', () => {
    expect(closeTo(hhi([25, 25, 25, 25]), 0.25)).toBe(true);
    expect(closeTo(hhi([0.25, 0.25, 0.25, 0.25]), 0.25)).toBe(true);
  });
  it('handles empty/zero weights', () => {
    expect(hhi([])).toBe(0);
    expect(hhi([0, 0, 0])).toBe(0);
  });
});

describe('effectiveN', () => {
  it('equals N for equal weights', () => {
    expect(closeTo(effectiveN([25, 25, 25, 25]), 4)).toBe(true);
  });
  it('drops to ~1 when concentrated', () => {
    expect(closeTo(effectiveN([90, 5, 5]), 1 / hhi([90, 5, 5]))).toBe(true);
  });
});

describe('gaussian', () => {
  it('produces finite numbers', () => {
    for (let i = 0; i < 100; i++) {
      expect(Number.isFinite(gaussian())).toBe(true);
    }
  });
  it('approximates mean ~0 over many samples (statistical, with seeded RNG)', () => {
    // 简单线性同余 RNG，避免依赖系统随机性
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const samples: number[] = [];
    for (let i = 0; i < 5000; i++) samples.push(gaussian(rng));
    const mu = mean(samples);
    const sigma = stdev(samples);
    expect(Math.abs(mu)).toBeLessThan(0.1); // 5000 个样本，均值应接近 0
    expect(Math.abs(sigma - 1)).toBeLessThan(0.1); // 标准差接近 1
  });
});

describe('monteCarlo', () => {
  it('returns horizon+1 bands and required percentiles', () => {
    const ret = [0.001, 0.002, -0.001, 0.0015];
    const result = monteCarlo(ret, 10, 50);
    expect(result.bands.length).toBe(11); // 0..horizon inclusive
    for (const b of result.bands) {
      expect(b.p5).toBeLessThanOrEqual(b.p25);
      expect(b.p25).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p75);
      expect(b.p75).toBeLessThanOrEqual(b.p95);
    }
    expect(result.summary.horizonDays).toBe(10);
    expect(result.summary.probLoss).toBeGreaterThanOrEqual(0);
    expect(result.summary.probLoss).toBeLessThanOrEqual(100);
  });
  it('first band is exactly the initial value', () => {
    const result = monteCarlo([0.01, -0.01], 5, 20, 100);
    expect(result.bands[0].p5).toBe(100);
    expect(result.bands[0].p95).toBe(100);
  });
  it('is deterministic with seeded RNG', () => {
    let seed = 123;
    const makeRng = () => {
      let s = seed;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    };
    const a = monteCarlo([0.001, 0.002, -0.001], 5, 20, 100, makeRng());
    const b = monteCarlo([0.001, 0.002, -0.001], 5, 20, 100, makeRng());
    expect(a.summary).toEqual(b.summary);
  });
});
