// 宏观调整评分 — 把当前市场温度作为持仓评分的修正项
//
// 核心思路：
//   bull 市（temp > 50）→ 动量股有溢价，加分；价值股折价，减分
//   bear 市（temp < 50）→ 价值股有溢价，加分；动量股折价，减分
//   中性（temp ≈ 50）→ 无调整
//
// 公式：
//   temp_norm    = (temp - 50) / 50           // [-1, 1]：bear=-1, bull=+1
//   momentum_lean = (technical - fundamental) / 100   // [-1, 1]：value=-1, momentum=+1
//   adjustment  = temp_norm * momentum_lean * MAX_ADJUST_PT
//
// 上限 ±10 分（避免 macro 完全压过个股 alpha）。
//
// 解读：同号相乘 → 加分（bull × momentum 或 bear × value）；异号 → 减分。
const MAX_ADJUST_PT = 10;

export function macroDelta(stock, temp) {
  if (temp == null) return null;
  const f = stock?.subScores?.fundamental;
  const tech = stock?.subScores?.technical;
  // 缺少 sub-scores 或者是 ETF（无 fundamental/technical 拆分）→ 不调整
  if (f == null || tech == null) return null;
  const tempNorm = (temp - 50) / 50;
  const momLean = (tech - f) / 100;
  const adjust = tempNorm * momLean * MAX_ADJUST_PT;
  // + 0 normalizes -0 → 0 (JS quirk: −X * 0 yields −0 with Object.is(−0, 0) === false)
  return Math.round(adjust * 10) / 10 + 0;
}

export function macroAdjustedScore(stock, temp) {
  const baseScore = stock?.score;
  if (baseScore == null) return null;
  const delta = macroDelta(stock, temp);
  if (delta == null) return baseScore;
  return Math.round((baseScore + delta) * 10) / 10;
}

// 解读文案（中文 key，UI 通过 t() 翻译）
export function macroAdjustExplain(stock, temp) {
  const delta = macroDelta(stock, temp);
  if (delta == null) return null;
  if (Math.abs(delta) < 0.5) return null;  // 小于 0.5 视为零，不显示
  const f = stock.subScores.fundamental;
  const tech = stock.subScores.technical;
  const isBull = temp >= 50;
  const isMomentum = tech > f;
  if (delta > 0) {
    return isBull
      ? "牛市中动量风格当下加分"
      : "熊市中价值风格当下加分";
  } else {
    return isBull
      ? "牛市中价值风格当下不利"
      : "熊市中动量风格当下不利";
  }
}
