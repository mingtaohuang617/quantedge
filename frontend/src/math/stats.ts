/**
 * 纯数学/统计 helper — 从 quant-platform.jsx 中抽出的无副作用函数。
 * 保持独立，便于单测 + 渐进迁移。
 */

/** 均值 */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 总体标准差（population std，除以 n）。与现有回测口径保持一致。 */
export function stdev(xs: readonly number[], mu?: number): number {
  if (xs.length === 0) return 0;
  const m = mu ?? mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / xs.length);
}

/** 下行标准差（仅包含负向偏离），用于 Sortino */
export function downsideStdev(xs: readonly number[], target = 0): number {
  if (xs.length === 0) return 0;
  let s = 0;
  let n = 0;
  for (const x of xs) {
    if (x < target) {
      s += (x - target) ** 2;
      n++;
    }
  }
  if (n === 0) return 0;
  return Math.sqrt(s / n);
}

/** 夏普比率 — 年化。无风险利率默认 0。 */
export function sharpeRatio(
  returns: readonly number[],
  periodsPerYear: number,
  riskFree = 0,
): number {
  if (returns.length === 0) return 0;
  const mu = mean(returns);
  const sigma = stdev(returns, mu);
  if (sigma === 0) return 0;
  return ((mu - riskFree) / sigma) * Math.sqrt(periodsPerYear);
}

/** 索提诺比率 — 年化，仅对下行波动敏感。 */
export function sortinoRatio(
  returns: readonly number[],
  periodsPerYear: number,
  target = 0,
): number {
  if (returns.length === 0) return 0;
  const mu = mean(returns);
  const downStd = downsideStdev(returns, target);
  if (downStd === 0) return 0;
  return ((mu - target) / downStd) * Math.sqrt(periodsPerYear);
}

/**
 * 卡玛比率 = 年化收益 / |最大回撤|。
 * annReturn / maxDD 都以小数形式（e.g. 0.12 表示 12%）或都以百分数形式传入都可，
 * 只要单位一致即可。
 */
export function calmarRatio(annReturn: number, maxDrawdown: number): number {
  if (maxDrawdown === 0) return 0;
  return Math.abs(annReturn / maxDrawdown);
}

/** 将净值序列转为日收益序列（ret_i = nav_i / nav_{i-1} - 1）。过滤非正值。 */
export function navToReturns(nav: readonly number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < nav.length; i++) {
    const prev = nav[i - 1];
    const curr = nav[i];
    if (prev > 0 && curr > 0) ret.push(curr / prev - 1);
  }
  return ret;
}

/**
 * 分位数（线性插值版本）。p ∈ [0, 1]。
 * 对已排序的数组更省资源可传 { sorted: true }。
 */
export function quantile(
  xs: readonly number[],
  p: number,
  opts: { sorted?: boolean } = {},
): number {
  if (xs.length === 0) return NaN;
  const sorted = opts.sorted ? xs : [...xs].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, p));
  const idx = clamped * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** HHI 集中度指数 — 权重应以 [0,1] 小数（如 0.25 = 25%）或全部为百分比（25, 25...）。
 * 返回值总是 0~1 范围（自动归一化，兼容两种输入）。 */
export function hhi(weights: readonly number[]): number {
  if (weights.length === 0) return 0;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const w of weights) h += (w / total) ** 2;
  return h;
}

/** 有效标的数 = 1 / HHI */
export function effectiveN(weights: readonly number[]): number {
  const h = hhi(weights);
  return h > 0 ? 1 / h : weights.length;
}

/**
 * Box-Muller 高斯采样 (μ=0, σ=1)。可注入 rng 以便测试时确定性。
 */
export function gaussian(rng: () => number = Math.random): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Monte Carlo 路径模拟结果类型 */
export interface MonteCarloBand {
  step: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  band5_95: [number, number];
  band25_75: [number, number];
}

export interface MonteCarloResult {
  bands: MonteCarloBand[];
  summary: {
    p5: number;
    p50: number;
    p95: number;
    probLoss: number; // 终值 < 起始值的概率（百分比）
    horizonDays: number;
  };
}

/**
 * 基于历史日收益的几何布朗运动模拟。
 * @param returns 日收益序列（小数形式）
 * @param horizon 预测步数
 * @param nPaths 路径数，默认 1000
 * @param initial 起始净值，默认 100
 * @param rng 可注入 RNG（测试用）
 */
export function monteCarlo(
  returns: readonly number[],
  horizon: number,
  nPaths = 1000,
  initial = 100,
  rng: () => number = Math.random,
): MonteCarloResult {
  const mu = mean(returns);
  const sigma = stdev(returns, mu);

  const paths: number[][] = [];
  for (let n = 0; n < nPaths; n++) {
    const path = [initial];
    for (let t = 0; t < horizon; t++) {
      const r = mu + sigma * gaussian(rng);
      path.push(path[path.length - 1] * (1 + r));
    }
    paths.push(path);
  }

  const bands: MonteCarloBand[] = [];
  for (let t = 0; t <= horizon; t++) {
    const col = paths.map((p) => p[t]).sort((a, b) => a - b);
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const p5 = round2(quantile(col, 0.05, { sorted: true }));
    const p25 = round2(quantile(col, 0.25, { sorted: true }));
    const p50 = round2(quantile(col, 0.5, { sorted: true }));
    const p75 = round2(quantile(col, 0.75, { sorted: true }));
    const p95 = round2(quantile(col, 0.95, { sorted: true }));
    bands.push({
      step: t,
      p5,
      p25,
      p50,
      p75,
      p95,
      band5_95: [p5, p95],
      band25_75: [p25, p75],
    });
  }

  const finalCol = paths.map((p) => p[horizon]).sort((a, b) => a - b);
  const probLoss = finalCol.filter((v) => v < initial).length / finalCol.length;

  return {
    bands,
    summary: {
      p5: Math.round(quantile(finalCol, 0.05, { sorted: true }) * 100) / 100,
      p50: Math.round(quantile(finalCol, 0.5, { sorted: true }) * 100) / 100,
      p95: Math.round(quantile(finalCol, 0.95, { sorted: true }) * 100) / 100,
      probLoss: Math.round(probLoss * 1000) / 10,
      horizonDays: horizon,
    },
  };
}
