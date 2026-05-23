// ─────────────────────────────────────────────────────────────
// Mining Alpha 示例数据 — Vercel/无后端部署时给访客看一眼"满数据态"
// ─────────────────────────────────────────────────────────────
//
// 形状严格匹配 /api/mining-alpha/* 的真实返回，让 hook 可以直接把这些
// 数据当成 backend response 灌进 setState。
//
// 数据完全是 mock：
//   - 用确定性 PRNG（mulberry32）生成 ~250 天的回测曲线 + regime 时序
//   - 因子号、ticker 用真实 universe 里出现过的（NVDA / TSLA / RKLB 等）
//   - 指标数值放在合理量级（年化 18-22%、Sharpe 1.5、回撤 -12% 等）
//
// 为什么不用 fetch 静态 JSON 文件？
//   - 动态 import 时 vite 会把这个模块拆成独立 chunk，
//     只在 demo 兜底时才 load，不占主 bundle 体积。
//   - 不需要担心 Vercel 路由 / 静态 asset 服务的复杂度。
// ─────────────────────────────────────────────────────────────

// 确定性 PRNG — 同一个 seed 永远生成同一序列，方便回归
const mulberry32 = (seed) => {
  let a = seed;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};

const DEMO_RUN_ID = "demo_2025_11";

// ─── /status ─────────────────────────────────────────────────
export const demoStatus = {
  output_dir: "/demo/runs/" + DEMO_RUN_ID,
  current_run_id: DEMO_RUN_ID,
  factor_count: 191,
  model_count: 5,
  files: {
    ic_report: true,
    selected_alphas: true,
    factor_correlation: true,
    feature_importance: true,
    predictions: true,
    backtest_report: true,
    equity_curve: true,
    equity_curve_png: true,
    fold_ic: true,
    regime: true,
    multi_topn: true,
    optuna_best: true,
  },
  history_runs: [
    { run_id: DEMO_RUN_ID, has_backtest: true, has_predictions: true },
    { run_id: "demo_2025_10", has_backtest: true, has_predictions: true },
    { run_id: "demo_2025_09", has_backtest: true, has_predictions: false },
  ],
};

// ─── /ic-report ───────────────────────────────────────────────
// 20 个 alpha，按 |ic_ir| 降序。alpha 号从 Alpha101/191 里挑常见的。
export const demoIC = [
  { alpha: 41,  ic_mean:  0.0312, ic_ir:  1.21, ic_t:  4.8, ic_pos_rate: 0.66, top_excess_mean:  0.0142, turnover: 0.22 },
  { alpha: 7,   ic_mean:  0.0289, ic_ir:  1.15, ic_t:  4.5, ic_pos_rate: 0.64, top_excess_mean:  0.0131, turnover: 0.19 },
  { alpha: 18,  ic_mean: -0.0264, ic_ir: -1.02, ic_t: -4.0, ic_pos_rate: 0.62, top_excess_mean: -0.0118, turnover: 0.25 },
  { alpha: 52,  ic_mean:  0.0241, ic_ir:  0.96, ic_t:  3.7, ic_pos_rate: 0.61, top_excess_mean:  0.0107, turnover: 0.18 },
  { alpha: 101, ic_mean:  0.0228, ic_ir:  0.92, ic_t:  3.6, ic_pos_rate: 0.60, top_excess_mean:  0.0098, turnover: 0.21 },
  { alpha: 83,  ic_mean: -0.0215, ic_ir: -0.88, ic_t: -3.4, ic_pos_rate: 0.59, top_excess_mean: -0.0091, turnover: 0.24 },
  { alpha: 12,  ic_mean:  0.0203, ic_ir:  0.83, ic_t:  3.2, ic_pos_rate: 0.58, top_excess_mean:  0.0088, turnover: 0.17 },
  { alpha: 65,  ic_mean:  0.0194, ic_ir:  0.79, ic_t:  3.1, ic_pos_rate: 0.58, top_excess_mean:  0.0082, turnover: 0.20 },
  { alpha: 23,  ic_mean: -0.0182, ic_ir: -0.74, ic_t: -2.9, ic_pos_rate: 0.57, top_excess_mean: -0.0076, turnover: 0.23 },
  { alpha: 95,  ic_mean:  0.0171, ic_ir:  0.70, ic_t:  2.7, ic_pos_rate: 0.56, top_excess_mean:  0.0071, turnover: 0.16 },
  { alpha: 34,  ic_mean:  0.0163, ic_ir:  0.66, ic_t:  2.6, ic_pos_rate: 0.56, top_excess_mean:  0.0067, turnover: 0.18 },
  { alpha: 77,  ic_mean:  0.0152, ic_ir:  0.62, ic_t:  2.4, ic_pos_rate: 0.55, top_excess_mean:  0.0061, turnover: 0.22 },
  { alpha: 5,   ic_mean: -0.0144, ic_ir: -0.58, ic_t: -2.3, ic_pos_rate: 0.55, top_excess_mean: -0.0057, turnover: 0.25 },
  { alpha: 56,  ic_mean:  0.0135, ic_ir:  0.55, ic_t:  2.2, ic_pos_rate: 0.54, top_excess_mean:  0.0053, turnover: 0.19 },
  { alpha: 88,  ic_mean:  0.0127, ic_ir:  0.51, ic_t:  2.0, ic_pos_rate: 0.54, top_excess_mean:  0.0049, turnover: 0.21 },
  { alpha: 14,  ic_mean:  0.0119, ic_ir:  0.48, ic_t:  1.9, ic_pos_rate: 0.53, top_excess_mean:  0.0045, turnover: 0.17 },
  { alpha: 71,  ic_mean: -0.0110, ic_ir: -0.45, ic_t: -1.8, ic_pos_rate: 0.53, top_excess_mean: -0.0041, turnover: 0.20 },
  { alpha: 28,  ic_mean:  0.0102, ic_ir:  0.41, ic_t:  1.6, ic_pos_rate: 0.52, top_excess_mean:  0.0037, turnover: 0.24 },
  { alpha: 60,  ic_mean:  0.0094, ic_ir:  0.38, ic_t:  1.5, ic_pos_rate: 0.51, top_excess_mean:  0.0033, turnover: 0.18 },
  { alpha: 99,  ic_mean:  0.0086, ic_ir:  0.35, ic_t:  1.4, ic_pos_rate: 0.51, top_excess_mean:  0.0029, turnover: 0.16 },
];

// ─── /backtest ────────────────────────────────────────────────
// 250 个交易日的策略 + 基准净值。策略略跑赢基准。
const buildCurves = () => {
  const rng = mulberry32(42);
  const N = 250;
  const startDate = new Date("2024-01-02");
  const strat = [];
  const bench = [];
  let s = 1.0, b = 1.0;
  for (let i = 0; i < N; i++) {
    // 策略：mean drift ~18% 年化 + vol 14%
    s *= 1 + (0.18 / 252) + (rng() - 0.48) * 0.014;
    // 基准：mean drift ~10% 年化 + vol 16%
    b *= 1 + (0.10 / 252) + (rng() - 0.48) * 0.016;
    const d = new Date(startDate.getTime() + i * 86400000 * 1.4); // 跳过周末粗略
    const date = d.toISOString().slice(0, 10);
    strat.push({ date, equity: +s.toFixed(4) });
    bench.push({ date, bench_equity: +b.toFixed(4) });
  }
  return { strat, bench };
};

const { strat: _eqCurve, bench: _benchCurve } = buildCurves();

export const demoBacktest = {
  metrics: {
    start_date: "2024-01-02",
    end_date: "2024-12-30",
    top_n: 50,
    cost: 0.001,
    has_tradeable_mask: true,
    annual_return: 0.182,
    annual_vol: 0.142,
    sharpe: 1.52,
    calmar: 2.18,
    max_drawdown: -0.083,
    monthly_win_rate: 0.667,
    alpha_annual: 0.078,
    ir_vs_benchmark: 1.18,
    turnover_annual: 1.32,
    total_return: 0.193,
  },
  equity_curve: _eqCurve,
  benchmark_curve: _benchCurve,
  multi_topn: [
    { top_n:  20, annual_return: 0.221, sharpe: 1.68, max_drawdown: -0.092, calmar: 2.40, alpha_annual: 0.117, ir_vs_benchmark: 1.45, monthly_win_rate: 0.70, turnover_annual: 1.85 },
    { top_n:  50, annual_return: 0.182, sharpe: 1.52, max_drawdown: -0.083, calmar: 2.19, alpha_annual: 0.078, ir_vs_benchmark: 1.18, monthly_win_rate: 0.67, turnover_annual: 1.32 },
    { top_n: 100, annual_return: 0.152, sharpe: 1.34, max_drawdown: -0.078, calmar: 1.95, alpha_annual: 0.048, ir_vs_benchmark: 0.89, monthly_win_rate: 0.63, turnover_annual: 1.05 },
    { top_n: 200, annual_return: 0.128, sharpe: 1.18, max_drawdown: -0.072, calmar: 1.78, alpha_annual: 0.024, ir_vs_benchmark: 0.55, monthly_win_rate: 0.60, turnover_annual: 0.78 },
  ],
};

// ─── /top-holdings ────────────────────────────────────────────
export const demoTopHoldings = {
  as_of: "2024-12-30",
  n_new: 4, n_held: 14, n_dropped: 2,
  holdings: [
    { ticker: "NVDA", score: 0.842, status: "held" },
    { ticker: "RKLB", score: 0.798, status: "new" },
    { ticker: "AAPL", score: 0.776, status: "held" },
    { ticker: "MSFT", score: 0.754, status: "held" },
    { ticker: "TSLA", score: 0.731, status: "held" },
    { ticker: "AVGO", score: 0.708, status: "new" },
    { ticker: "AMZN", score: 0.685, status: "held" },
    { ticker: "META", score: 0.662, status: "held" },
    { ticker: "AMD",  score: 0.641, status: "held" },
    { ticker: "ANET", score: 0.624, status: "new" },
    { ticker: "GOOG", score: 0.605, status: "held" },
    { ticker: "MU",   score: 0.589, status: "held" },
    { ticker: "SMCI", score: 0.572, status: "held" },
    { ticker: "PLTR", score: 0.558, status: "held" },
    { ticker: "ASML", score: 0.541, status: "held" },
    { ticker: "TSM",  score: 0.528, status: "held" },
    { ticker: "ARM",  score: 0.515, status: "held" },
    { ticker: "MRVL", score: 0.501, status: "new" },
    { ticker: "INTC", score: 0.489, status: "held" },
    { ticker: "QCOM", score: 0.475, status: "held" },
    // 2 个被剔除的
    { ticker: "ORCL", score: null, status: "dropped" },
    { ticker: "CSCO", score: null, status: "dropped" },
  ],
};

// ─── /regime ──────────────────────────────────────────────────
// 跟 backtest 同样 250 天，3 个 regime 区段：bull→neutral→bear→bull
const buildRegime = () => {
  const out = [];
  const dates = _eqCurve.map(p => p.date);
  for (let i = 0; i < dates.length; i++) {
    let label, bull, neu, bear;
    if (i < 90) { label = "bull";    bull = 0.72; neu = 0.20; bear = 0.08; }
    else if (i < 150) { label = "neutral"; bull = 0.30; neu = 0.55; bear = 0.15; }
    else if (i < 200) { label = "bear";    bull = 0.10; neu = 0.30; bear = 0.60; }
    else              { label = "bull";    bull = 0.65; neu = 0.25; bear = 0.10; }
    out.push({ date: dates[i], label, bull_prob: bull, neutral_prob: neu, bear_prob: bear });
  }
  return out;
};
export const demoRegime = buildRegime();

// ─── /fold-ic ─────────────────────────────────────────────────
export const demoFoldIC = [
  { fold: 1, test_start: "2022-01-03", test_end: "2022-06-30", test_ic_mean: 0.0274, test_ic_ir: 0.82, best_iter: 195 },
  { fold: 2, test_start: "2022-07-01", test_end: "2022-12-30", test_ic_mean: 0.0185, test_ic_ir: 0.54, best_iter: 168 },
  { fold: 3, test_start: "2023-01-03", test_end: "2023-06-30", test_ic_mean: 0.0312, test_ic_ir: 0.95, best_iter: 224 },
  { fold: 4, test_start: "2023-07-03", test_end: "2023-12-29", test_ic_mean: 0.0257, test_ic_ir: 0.76, best_iter: 201 },
  { fold: 5, test_start: "2024-01-02", test_end: "2024-06-28", test_ic_mean: 0.0298, test_ic_ir: 0.88, best_iter: 217 },
];

// ─── /ic-heatmap ──────────────────────────────────────────────
const buildHeatmap = () => {
  const rng = mulberry32(7);
  const alphas = demoIC.slice(0, 20).map(r => r.alpha);
  const months = [];
  for (let y = 2023; y <= 2024; y++) {
    for (let m = 1; m <= 12; m++) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }
  const cells = [];
  for (const a of alphas) {
    const center = demoIC.find(r => r.alpha === a).ic_mean;
    for (const month of months) {
      // 月度 IC 在 alpha 自己 ic_mean 附近浮动，加入一些 outlier
      const noise = (rng() - 0.5) * 0.04;
      cells.push({ alpha: a, month, ic: +(center + noise).toFixed(4) });
    }
  }
  return { alphas, months, cells };
};
export const demoHeatmap = buildHeatmap();

// ─── /feature-importance ──────────────────────────────────────
export const demoImportance = demoIC.slice(0, 20).map((r, i) => ({
  feature: `alpha_${r.alpha}`,
  importance: +(800 - i * 35 + (i % 3) * 12).toFixed(1),
}));

// ─── /alerts ──────────────────────────────────────────────────
export const demoAlerts = [
  { severity: "high", message: "Alpha 41 近 5 日 IC 由 +0.031 跌至 +0.018，监控触发", checked_at: "2024-12-30T16:00:00Z" },
  { severity: "medium", message: "Top-N=20 切片月度换手率突破 1.85（高于历史 90 分位）", checked_at: "2024-12-30T16:00:00Z" },
];
