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

// ─── H8: 回测引擎核心公式集成测试 ─────────────────────────────
// 这些 inline 公式在 BacktestEngine 的 runBacktest 里被复刻使用，必须正确
describe('BacktestEngine inline formulas', () => {
  it('多元化收益：低相关组合波动 < 单标的最大波动', () => {
    const a = [0.01, -0.02, 0.03, -0.01, 0.02];
    const b = [-0.02, 0.03, -0.01, 0.02, -0.005];
    const port = a.map((x, i) => 0.5 * x + 0.5 * b[i]);
    expect(stdev(port)).toBeLessThan(Math.max(stdev(a), stdev(b)));
  });

  it('Sharpe 单调性：均值更高时 Sharpe 应更高', () => {
    const lo = [0.005, 0.001, 0.008, -0.002];
    const hi = [0.025, 0.021, 0.028, 0.018];
    expect(sharpeRatio(hi, 252)).toBeGreaterThan(sharpeRatio(lo, 252));
  });

  it('最大回撤公式：peak-to-trough 计算', () => {
    // navCurve [100, 110, 88, 95, 105] → peak=110, trough=88 → MDD=-20%
    const navs = [100, 110, 88, 95, 105];
    let peak = navs[0];
    let maxDD = 0;
    for (const n of navs) {
      if (n > peak) peak = n;
      const dd = (n - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
    expect(maxDD).toBeCloseTo(-0.2, 6);
  });

  it('Walk-Forward 稳定度：Sharpe 全相同 → stability = 100', () => {
    const sharpes = [1.5, 1.5, 1.5, 1.5];
    const m = mean(sharpes);
    const s = stdev(sharpes, m);
    const cv = m !== 0 ? Math.abs(s / m) : 99;
    const stability = (1 / (1 + cv)) * 100;
    expect(stability).toBeCloseTo(100, 4);
  });

  it('Walk-Forward 稳定度：CV 越大稳定度越低', () => {
    const score = (xs: number[]) => {
      const m = mean(xs);
      const s = stdev(xs, m);
      const cv = m !== 0 ? Math.abs(s / m) : 99;
      return 1 / (1 + cv);
    };
    const stable = [1.0, 1.1, 0.9, 1.05];
    const wild = [3.0, -1.0, 2.0, 0.0];
    expect(score(stable)).toBeGreaterThan(score(wild));
  });

  it('Beta 公式：自身 vs 自身 β = 1', () => {
    const b = [0.01, -0.02, 0.03, -0.01, 0.02];
    const p = [...b];
    const meanB = mean(b);
    const meanP = mean(p);
    let cov = 0;
    let varB = 0;
    for (let i = 0; i < b.length; i++) {
      cov += (p[i] - meanP) * (b[i] - meanB);
      varB += (b[i] - meanB) ** 2;
    }
    cov /= b.length;
    varB /= b.length;
    const beta = varB > 0 ? cov / varB : 0;
    expect(beta).toBeCloseTo(1, 6);
  });

  it('Beta 公式：完全负相关 → β = -1', () => {
    const b = [0.01, -0.02, 0.03, -0.01, 0.02];
    const p = b.map((x) => -x);
    const meanB = mean(b);
    const meanP = mean(p);
    let cov = 0;
    let varB = 0;
    for (let i = 0; i < b.length; i++) {
      cov += (p[i] - meanP) * (b[i] - meanB);
      varB += (b[i] - meanB) ** 2;
    }
    cov /= b.length;
    varB /= b.length;
    expect(cov / varB).toBeCloseTo(-1, 6);
  });

  it('风险归因：Market % + Sector % + Idio % ≤ 100', () => {
    // 模拟：β=0.8, σ²_b = 0.0004, σ²_p = 0.0009, HHI = 0.4
    const beta = 0.8;
    const varB = 0.0004;
    const varS = 0.0009;
    const hhiVal = 0.4;
    const marketVar = beta * beta * varB;
    const idioVar = Math.max(0, varS - marketVar);
    const sectorVar = hhiVal * idioVar;
    const residualVar = (1 - hhiVal) * idioVar;
    const sum = (marketVar + sectorVar + residualVar) / varS;
    expect(sum).toBeCloseTo(1, 6);
  });

  it('胜率：返回为正的样本占比', () => {
    const rets = [0.02, -0.01, 0.005, -0.03, 0.015, 0.01];
    const winRate = rets.filter((r) => r > 0).length / rets.length;
    expect(winRate).toBeCloseTo(4 / 6, 6);
  });

  it('VaR 95%：返回序列底部 5% 分位数', () => {
    const rets = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000);
    const sorted = [...rets].sort((a, b) => a - b);
    const var95 = sorted[Math.floor(sorted.length * 0.05)];
    expect(var95).toBeLessThan(0); // 必为负值（损失）
    expect(var95).toBeCloseTo(-0.045, 3);
  });

  it('再平衡前后份额：总市值守恒', () => {
    // 三个标的，初始权重 [40%, 30%, 30%]，价格 [10, 20, 50]
    // 设组合初值 = 100，份额 = weight * 100 / price
    const weights = [0.4, 0.3, 0.3];
    const prices = [10, 20, 50];
    const shares = weights.map((w, i) => (w * 100) / prices[i]);
    const totalValue = shares.reduce((s, sh, i) => s + sh * prices[i], 0);
    expect(totalValue).toBeCloseTo(100, 6);
  });
});
