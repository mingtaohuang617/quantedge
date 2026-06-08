// 宏观调整评分 — 把当前市场温度作为持仓评分的修正项
//
// 核心思路（双轨模型）：
//   bull 市（temp > 50）→ 时机型（动量）有溢价，加分；质量型（价值）折价，减分
//   bear 市（temp < 50）→ 质量型（价值）有溢价，加分；时机型（动量）折价，减分
//   中性（temp ≈ 50）→ 无调整
//
// 公式：
//   temp_norm     = (temp - 50) / 50            // [-1, 1]：bear=-1, bull=+1
//   momentum_lean = (timing - quality) / 100    // [-1, 1]：quality 重=-1(价值), timing 重=+1(动量)
//   adjustment    = temp_norm * momentum_lean * MAX_ADJUST_PT
//
// 上限 ±10 分（避免 macro 完全压过个股 alpha）。
//
// 解读：同号相乘 → 加分（bull × 时机 或 bear × 质量）；异号 → 减分。
// 仅作用于个股；ETF 有独立的 4 类评分，不参与宏观风格轮动。
const MAX_ADJUST_PT = 10;

export function macroDelta(stock, temp) {
  if (temp == null) return null;
  // 宏观风格轮动只作用于个股；ETF 不参与
  if (stock?.isETF) return null;
  const q = stock?.qualityScore;
  const tm = stock?.timingScore;
  // 缺少双轨分 → 不调整
  if (q == null || tm == null) return null;
  const tempNorm = (temp - 50) / 50;
  const momLean = (tm - q) / 100;   // 质量重=负(价值倾向)，时机重=正(动量倾向)
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
  const isBull = temp >= 50;
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
