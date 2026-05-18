// 两阶段 DCF 计算测试 — 纯函数，验证数学正确性 + 边界条件
import { describe, it, expect } from 'vitest';
import { calcDCF, marginOfSafety, DCF_DEFAULTS } from './dcf.js';

describe('calcDCF — 输入校验', () => {
  it('fcfPerShare <= 0 返回 error', () => {
    expect(calcDCF({ fcfPerShare: 0, shortTermGrowth: 0.05 }).error).toMatch(/FCF/);
    expect(calcDCF({ fcfPerShare: -1, shortTermGrowth: 0.05 }).error).toMatch(/FCF/);
  });

  it('fcfPerShare 不是有限数返回 error', () => {
    expect(calcDCF({ fcfPerShare: NaN, shortTermGrowth: 0.05 }).error).toBeTruthy();
    expect(calcDCF({ fcfPerShare: Infinity, shortTermGrowth: 0.05 }).error).toBeTruthy();
  });

  it('terminalGrowth >= discountRate 返回 error（Gordon 发散）', () => {
    const r = calcDCF({
      fcfPerShare: 3,
      shortTermGrowth: 0.05,
      terminalGrowth: 0.10,
      discountRate: 0.10,
    });
    expect(r.error).toMatch(/永续增长率必须 </);
  });

  it('shortTermYears 越界返回 error', () => {
    expect(calcDCF({ fcfPerShare: 3, shortTermGrowth: 0.05, shortTermYears: 0 }).error).toMatch(/1-20/);
    expect(calcDCF({ fcfPerShare: 3, shortTermGrowth: 0.05, shortTermYears: 25 }).error).toMatch(/1-20/);
    expect(calcDCF({ fcfPerShare: 3, shortTermGrowth: 0.05, shortTermYears: 5.5 }).error).toMatch(/1-20/);
  });

  it('discountRate <= 0 返回 error', () => {
    expect(calcDCF({ fcfPerShare: 3, shortTermGrowth: 0.05, discountRate: 0 }).error).toMatch(/折现率/);
    expect(calcDCF({ fcfPerShare: 3, shortTermGrowth: 0.05, discountRate: -0.05 }).error).toMatch(/折现率/);
  });
});

describe('calcDCF — 数学正确性', () => {
  it('经典案例：FCF=3, g1=8%, N=5, g2=2.5%, r=10% → 内在价值 ~50', () => {
    const r = calcDCF({
      fcfPerShare: 3,
      shortTermGrowth: 0.08,
      shortTermYears: 5,
      terminalGrowth: 0.025,
      discountRate: 0.10,
    });
    expect(r.error).toBeUndefined();
    // 手算验证：
    //   yr1: 3*1.08=3.24, PV=3.24/1.10≈2.945
    //   yr2: 3*1.08^2=3.499, PV/1.10^2≈2.892
    //   ...yr5
    //   shortTermPV ≈ 14.5
    //   yr5 FCF: 3*1.08^5≈4.408
    //   TV = 4.408 * 1.025 / (0.10 - 0.025) = 4.518 / 0.075 ≈ 60.24
    //   TV_PV = 60.24 / 1.10^5 ≈ 37.41
    //   total ≈ 14.5 + 37.41 ≈ 51.9
    expect(r.intrinsicValue).toBeGreaterThan(45);
    expect(r.intrinsicValue).toBeLessThan(60);
    // 短期 + 终值之和 ≈ intrinsicValue
    expect(r.shortTermPV + r.terminalValuePV).toBeCloseTo(r.intrinsicValue, 6);
  });

  it('yearlyFcf 长度 = shortTermYears', () => {
    const r = calcDCF({ fcfPerShare: 1, shortTermGrowth: 0.05, shortTermYears: 7 });
    expect(r.yearlyFcf.length).toBe(7);
    expect(r.yearlyPV.length).toBe(7);
  });

  it('FCF 加倍 → 内在价值加倍（线性）', () => {
    const a = calcDCF({ fcfPerShare: 3, shortTermGrowth: 0.05 });
    const b = calcDCF({ fcfPerShare: 6, shortTermGrowth: 0.05 });
    expect(b.intrinsicValue / a.intrinsicValue).toBeCloseTo(2, 5);
  });

  it('高增长 + 低折现 → 显著更高内在价值', () => {
    const low = calcDCF({
      fcfPerShare: 3,
      shortTermGrowth: 0.02,
      terminalGrowth: 0.02,
      discountRate: 0.12,
    });
    const high = calcDCF({
      fcfPerShare: 3,
      shortTermGrowth: 0.12,
      terminalGrowth: 0.04,
      discountRate: 0.08,
    });
    expect(high.intrinsicValue).toBeGreaterThan(low.intrinsicValue * 3);
  });

  it('使用默认参数（仅传 FCF + g1）', () => {
    const r = calcDCF({ fcfPerShare: 3, shortTermGrowth: 0.08 });
    expect(r.error).toBeUndefined();
    expect(r.intrinsicValue).toBeGreaterThan(0);
    // 默认 N=5, terminalGrowth=2.5%, discountRate=10%
    expect(r.yearlyFcf.length).toBe(DCF_DEFAULTS.shortTermYears);
  });

  it('yearlyFcf 单调递增（短期增长率 > 0）', () => {
    const r = calcDCF({ fcfPerShare: 1, shortTermGrowth: 0.10, shortTermYears: 5 });
    for (let i = 1; i < r.yearlyFcf.length; i++) {
      expect(r.yearlyFcf[i]).toBeGreaterThan(r.yearlyFcf[i - 1]);
    }
  });

  it('shortTermGrowth=0 → yearlyFcf 全相等', () => {
    const r = calcDCF({ fcfPerShare: 5, shortTermGrowth: 0, shortTermYears: 3 });
    expect(r.yearlyFcf[0]).toBeCloseTo(5, 6);
    expect(r.yearlyFcf[1]).toBeCloseTo(5, 6);
    expect(r.yearlyFcf[2]).toBeCloseTo(5, 6);
  });
});

describe('marginOfSafety', () => {
  it('intrinsic 100, current 70 → 30%', () => {
    expect(marginOfSafety(100, 70)).toBeCloseTo(0.30, 6);
  });

  it('intrinsic 100, current 100 → 0%（公允）', () => {
    expect(marginOfSafety(100, 100)).toBeCloseTo(0, 6);
  });

  it('intrinsic 100, current 130 → -30%（高估）', () => {
    expect(marginOfSafety(100, 130)).toBeCloseTo(-0.30, 6);
  });

  it('intrinsic = 0 → null', () => {
    expect(marginOfSafety(0, 50)).toBeNull();
  });

  it('intrinsic = NaN → null', () => {
    expect(marginOfSafety(NaN, 50)).toBeNull();
  });

  it('currentPrice = null → null', () => {
    expect(marginOfSafety(100, null)).toBeNull();
  });

  it('currentPrice = 0 → null', () => {
    expect(marginOfSafety(100, 0)).toBeNull();
  });
});
