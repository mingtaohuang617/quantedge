// ─────────────────────────────────────────────────────────────
// 两阶段 DCF（Discounted Cash Flow）估值 — 纯计算函数
// ─────────────────────────────────────────────────────────────
// 模型：
//   阶段 1（前 N 年）：FCF 按短期增长率 g1 增长
//   阶段 2（永续）：用 Gordon Growth 公式 → FCF_(N+1) / (r - g2)
//   内在价值 = 阶段 1 现值累加 + 阶段 2 终值现值（折回 t=0）
//
// 输入都是「每股」单位，输出也是每股内在价值。
// 适用场景：消费稳健 / 公用事业 / 银行 — 现金流稳定预测性强的标的。
// 不适用：周期股（FCF 大起大落）/ 成长股（永续增速假设无意义）。
// ─────────────────────────────────────────────────────────────

const DEFAULTS = {
  shortTermYears: 5,
  terminalGrowth: 0.025,
  discountRate: 0.10,
};

/**
 * 两阶段 DCF 估值。
 *
 * @param {object} params
 * @param {number} params.fcfPerShare      当前每股自由现金流（必须 > 0）
 * @param {number} params.shortTermGrowth  短期增长率（年化小数；0.08 = 8%）
 * @param {number} [params.shortTermYears=5]   短期阶段年数（1-20）
 * @param {number} [params.terminalGrowth=0.025] 永续增长率（默认 2.5%）
 * @param {number} [params.discountRate=0.10]    折现率（WACC，默认 10%）
 *
 * @returns {object} {
 *   intrinsicValue,      // 每股内在价值（terminalValuePV + cumulativeShortPV）
 *   terminalValuePV,     // 永续终值现值（折回 t=0）
 *   shortTermPV,         // 短期 N 年现值之和
 *   yearlyFcf: number[], // 每年预测 FCF（长度 = shortTermYears）
 *   yearlyPV: number[],  // 每年现值
 *   error?: string,      // 输入非法时返回错误描述（其它字段 undefined）
 * }
 */
export function calcDCF({
  fcfPerShare,
  shortTermGrowth,
  shortTermYears = DEFAULTS.shortTermYears,
  terminalGrowth = DEFAULTS.terminalGrowth,
  discountRate = DEFAULTS.discountRate,
}) {
  // 输入校验
  if (!Number.isFinite(fcfPerShare) || fcfPerShare <= 0) {
    return { error: '每股 FCF 必须 > 0' };
  }
  if (!Number.isFinite(shortTermGrowth)) {
    return { error: '短期增长率必须是数字' };
  }
  if (!Number.isFinite(discountRate) || discountRate <= 0) {
    return { error: '折现率必须 > 0' };
  }
  if (!Number.isFinite(terminalGrowth)) {
    return { error: '永续增长率必须是数字' };
  }
  if (terminalGrowth >= discountRate) {
    return { error: '永续增长率必须 < 折现率（否则 Gordon 公式发散）' };
  }
  if (!Number.isInteger(shortTermYears) || shortTermYears < 1 || shortTermYears > 20) {
    return { error: '短期年数应为 1-20 的整数' };
  }

  // 阶段 1：未来 N 年逐年 FCF + 现值
  const yearlyFcf = [];
  const yearlyPV = [];
  let shortTermPV = 0;
  for (let t = 1; t <= shortTermYears; t++) {
    const fcf = fcfPerShare * Math.pow(1 + shortTermGrowth, t);
    const pv = fcf / Math.pow(1 + discountRate, t);
    yearlyFcf.push(fcf);
    yearlyPV.push(pv);
    shortTermPV += pv;
  }

  // 阶段 2：Gordon Growth 终值
  //   TV = FCF_(N+1) / (r - g)
  //   FCF_(N+1) = FCF_N * (1 + g2)
  const finalFcf = yearlyFcf[yearlyFcf.length - 1];
  const terminalFcfNext = finalFcf * (1 + terminalGrowth);
  const terminalValue = terminalFcfNext / (discountRate - terminalGrowth);
  // 终值折回 t=0
  const terminalValuePV = terminalValue / Math.pow(1 + discountRate, shortTermYears);

  const intrinsicValue = shortTermPV + terminalValuePV;

  return {
    intrinsicValue,
    terminalValuePV,
    shortTermPV,
    yearlyFcf,
    yearlyPV,
  };
}

/**
 * 安全边际：(内在价值 - 当前价) / 内在价值
 *   > 0   : 当前价 < 内在价值（有安全边际，潜在买入）
 *   = 0   : 当前价 = 内在价值（公允）
 *   < 0   : 当前价 > 内在价值（高估）
 *
 * 经典 Graham 阈值：≥ 33% 才算有"足够"安全边际。
 *
 * @param {number} intrinsicValue 内在价值（每股）
 * @param {number} currentPrice   当前价（每股）
 * @returns {number|null} 安全边际（小数，0.33 = 33%）；输入非法返回 null
 */
export function marginOfSafety(intrinsicValue, currentPrice) {
  if (!Number.isFinite(intrinsicValue) || intrinsicValue <= 0) return null;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  return (intrinsicValue - currentPrice) / intrinsicValue;
}

export const DCF_DEFAULTS = DEFAULTS;
