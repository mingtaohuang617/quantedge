// ─────────────────────────────────────────────────────────────
// Smart Beta 示例数据 — Vercel/无后端部署的 demo
// ─────────────────────────────────────────────────────────────
//
// 形状匹配 backend smart_beta.build_snapshot() 返回：
//   { as_of, risk:{risk_score, components}, core_weight, core_alloc,
//     sector_alloc, weights, sector_ranked:[], sector_selected:[],
//     fetch_errors:[] }
//
// 数值挑了一个"温和偏多 / 风险偏好 0.62"的代表性快照：
//   - L1 风险分 0.62 → Core 70%
//   - L2 balanced（SPY 60 + QQQ 25 + IWM 15）
//   - L3 Top 3：XLK / XLF / SOXX（科技 + 金融 + 半导体），equal weight
//
// Dynamic import 拆独立 chunk，只在 fallback 时下载。
// ─────────────────────────────────────────────────────────────

const CORE_WEIGHT = 0.70;
const SECTOR_WEIGHT = 1 - CORE_WEIGHT;

// L2 Core: balanced 预设 (SPY+QQQ+IWM 60/25/15)
const CORE_ALLOC = {
  SPY: CORE_WEIGHT * 0.60,
  QQQ: CORE_WEIGHT * 0.25,
  IWM: CORE_WEIGHT * 0.15,
};

// L3 Sector: Top 3 等权
const SECTOR_PICKS = ["XLK", "XLF", "SOXX"];
const SECTOR_ALLOC = SECTOR_PICKS.reduce((acc, t) => {
  acc[t] = SECTOR_WEIGHT / SECTOR_PICKS.length;
  return acc;
}, {});

const FINAL_WEIGHTS = { ...CORE_ALLOC, ...SECTOR_ALLOC };

// 行业评分排名（按总分降序，10 个候选 ETF）
const SECTOR_RANKED = [
  { ticker: "XLK",  name: "Technology Select Sector SPDR",       score: 82, expense_ratio: 0.0009,
    components: { trend: 88, relative: 75, flow: 70, sharpe: 72, rsi: 65 } },
  { ticker: "XLF",  name: "Financial Select Sector SPDR",        score: 74, expense_ratio: 0.0009,
    components: { trend: 78, relative: 72, flow: 68, sharpe: 65, rsi: 58 } },
  { ticker: "SOXX", name: "iShares Semiconductor ETF",           score: 71, expense_ratio: 0.0035,
    components: { trend: 80, relative: 80, flow: 75, sharpe: 60, rsi: 78 } },
  { ticker: "XLV",  name: "Health Care Select Sector SPDR",      score: 62, expense_ratio: 0.0009,
    components: { trend: 65, relative: 58, flow: 60, sharpe: 58, rsi: 52 } },
  { ticker: "XLI",  name: "Industrial Select Sector SPDR",       score: 60, expense_ratio: 0.0009,
    components: { trend: 62, relative: 55, flow: 58, sharpe: 60, rsi: 54 } },
  { ticker: "XLY",  name: "Consumer Discretionary SPDR",         score: 55, expense_ratio: 0.0009,
    components: { trend: 58, relative: 52, flow: 55, sharpe: 50, rsi: 56 } },
  { ticker: "XLC",  name: "Communication Services SPDR",         score: 52, expense_ratio: 0.0009,
    components: { trend: 55, relative: 48, flow: 50, sharpe: 52, rsi: 50 } },
  { ticker: "XLP",  name: "Consumer Staples Select Sector SPDR", score: 45, expense_ratio: 0.0009,
    components: { trend: 42, relative: 45, flow: 48, sharpe: 50, rsi: 42 } },
  { ticker: "XLU",  name: "Utilities Select Sector SPDR",        score: 38, expense_ratio: 0.0009,
    components: { trend: 35, relative: 38, flow: 42, sharpe: 40, rsi: 40 } },
  { ticker: "XLE",  name: "Energy Select Sector SPDR",           score: 32, expense_ratio: 0.0009,
    components: { trend: 28, relative: 35, flow: 38, sharpe: 30, rsi: 32 } },
];

export const demoSmartBeta = {
  as_of: "2024-12-30T00:00:00Z",
  // L1 风险评分 — 5 分制内部，归一到 0-1
  risk: {
    risk_score: 0.62, // 温和偏多
    components: {
      vix: 16.5,        // 低位
      trend: 0.78,      // SPY 在 50/200MA 之上
      credit: 0.65,     // HY spread 偏窄
      real_rate: 0.55,  // TIPS 中性
    },
  },
  // L1 → Core/Sector 总比例
  core_weight: CORE_WEIGHT,
  // L2 Core 内部权重
  core_alloc: CORE_ALLOC,
  // L3 Sector 内部权重（等权）
  sector_alloc: SECTOR_ALLOC,
  // 合并后最终权重
  weights: FINAL_WEIGHTS,
  // 行业评分排名表 + 选中标记
  sector_ranked: SECTOR_RANKED,
  sector_selected: SECTOR_PICKS,
  fetch_errors: [],
  // demo 模式标记（前端 UI 用）
  _demo: true,
};
