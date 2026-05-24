/**
 * 复利 & 长期年化场景的纯函数。
 * stats.ts 的 monteCarlo 是基于历史日收益序列的；这里专门针对
 * "年化 μ + 年化波动 σ + 年数 N" 的长期推演场景。
 */
import { gaussian, quantile } from "./stats";

/** 复利终值：principal × (1+r)^years */
export function compoundFinalValue(
  principal: number,
  annualRate: number,
  years: number,
): number {
  return principal * Math.pow(1 + annualRate, years);
}

/** 逐年净值序列，长度 = years + 1（含第 0 年起始本金）。 */
export function compoundSeries(
  principal: number,
  annualRate: number,
  years: number,
): number[] {
  return Array.from({ length: years + 1 }, (_, i) =>
    principal * Math.pow(1 + annualRate, i),
  );
}

/** 通胀调整后的实际购买力：nominal / (1+inflation)^years */
export function inflationAdjusted(
  nominal: number,
  years: number,
  inflationRate = 0.03,
): number {
  return nominal / Math.pow(1 + inflationRate, years);
}

export interface MonteCarloAnnualResult {
  /** 每年的 5/50/95 分位（含第 0 年 = 起始本金）— 用于面积带 */
  bands: { year: number; p05: number; p50: number; p95: number }[];
  /** 终值汇总 */
  summary: {
    p05: number;
    p50: number;
    p95: number;
    /** 终值低于起始本金的路径占比，0~1 */
    probLoss: number;
    /** 终值低于起始本金一半的路径占比，0~1（"破产"概率） */
    ruinProb: number;
  };
}

/**
 * 基于"年化对数收益 ~ N(μ - σ²/2, σ²)"的几何布朗运动年度模拟。
 * 用对数空间累加再 exp，避免长年限下数值漂移。
 * @param principal 起始本金
 * @param mu        年化期望收益（小数，如 0.10 = 10%）
 * @param sigma     年化波动率（小数，如 0.15 = 15%）
 * @param years     年数
 * @param paths     模拟路径数，默认 1000
 * @param rng       可注入 RNG（测试用）
 */
export function monteCarloAnnual(
  principal: number,
  mu: number,
  sigma: number,
  years: number,
  paths = 1000,
  rng: () => number = Math.random,
): MonteCarloAnnualResult {
  // 对数收益的均值，需要 - σ²/2 修正（Itô）
  const logMu = Math.log(1 + mu) - 0.5 * sigma * sigma;

  // 列存储：cols[t] = 第 t 年所有路径的终值
  const cols: number[][] = Array.from({ length: years + 1 }, () => []);
  for (let n = 0; n < paths; n++) {
    let logNav = Math.log(principal);
    cols[0].push(principal);
    for (let t = 1; t <= years; t++) {
      logNav += logMu + sigma * gaussian(rng);
      cols[t].push(Math.exp(logNav));
    }
  }

  const bands = cols.map((col, t) => {
    const sorted = [...col].sort((a, b) => a - b);
    return {
      year: t,
      p05: quantile(sorted, 0.05, { sorted: true }),
      p50: quantile(sorted, 0.50, { sorted: true }),
      p95: quantile(sorted, 0.95, { sorted: true }),
    };
  });

  const finalCol = [...cols[years]].sort((a, b) => a - b);
  const lossCount = finalCol.filter((v) => v < principal).length;
  const ruinCount = finalCol.filter((v) => v < principal * 0.5).length;

  return {
    bands,
    summary: {
      p05: quantile(finalCol, 0.05, { sorted: true }),
      p50: quantile(finalCol, 0.50, { sorted: true }),
      p95: quantile(finalCol, 0.95, { sorted: true }),
      probLoss: lossCount / finalCol.length,
      ruinProb: ruinCount / finalCol.length,
    },
  };
}

/**
 * 大数字格式化 — 用于复利终值显示。
 * 1.23 → "1.23"
 * 1234 → "1,234"
 * 1.23e6 → "1.23M"
 * 1.23e9 → "1.23B"
 * 1.23e12 → "1.23T"
 * 1.23e15 → "1.23e+15"（超出常用区间用科学计数法）
 */
export function formatBigNumber(v: number, digits = 2): string {
  if (!isFinite(v)) return "∞";
  const abs = Math.abs(v);
  if (abs < 1000) return v.toFixed(digits);
  if (abs < 1e6) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs < 1e9) return (v / 1e6).toFixed(digits) + "M";
  if (abs < 1e12) return (v / 1e9).toFixed(digits) + "B";
  if (abs < 1e15) return (v / 1e12).toFixed(digits) + "T";
  return v.toExponential(digits);
}
