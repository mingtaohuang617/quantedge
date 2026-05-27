// ─────────────────────────────────────────────────────────────
// Mining Alpha demo 数据 — Vercel/无后端部署的兜底
// ─────────────────────────────────────────────────────────────
//
// 形状匹配 useMiningAlphaData() 9 个 setter 的服务端响应：
//   status / ic / importance / backtest / topHoldings / regime /
//   foldIC / heatmap / alerts
//
// 动态 import 拆独立 chunk，不污染主 bundle。
// 数据用 deterministic PRNG（mulberry32 seed=42）生成，保证 build 间一致。
// ─────────────────────────────────────────────────────────────

const RUN_ID = "demo-2024-12";
const AS_OF = "2024-12-30";

// ── deterministic PRNG ───────────────────────────────────────
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);

// 业务日期序列（近 250 个交易日，跳周末）
function buildBizDates(n) {
  const out = [];
  const d = new Date("2024-01-01");
  while (out.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const dates = buildBizDates(250);

// ── status ───────────────────────────────────────────────────
const status = {
  output_dir: "/demo/output/mining_alpha",
  current_run_id: RUN_ID,
  factor_count: 191,
  model_count: 1,
  files: {
    ic_report: true, selected_alphas: true, factor_correlation: true,
    feature_importance: true, predictions: true, backtest_report: true,
    equity_curve: true, equity_curve_png: false, fold_ic: true,
    regime: true, multi_topn: true, optuna_best: true,
  },
  history_runs: [
    { run_id: RUN_ID, created_at: "2024-12-30T00:00:00Z" },
  ],
};

// ── IC 报告（前 20 alpha by |IR|）────────────────────────────
const ic = Array.from({ length: 20 }, (_, i) => {
  const alphaNum = 191 - i * 9;
  const ir = 0.42 - i * 0.018 + (rnd() - 0.5) * 0.04;
  const sign = i % 5 === 4 ? -1 : 1;
  return {
    alpha_num: alphaNum,
    ic_mean: +(sign * (0.085 - i * 0.003)).toFixed(4),
    ic_std: +(0.14 + rnd() * 0.04).toFixed(4),
    ir: +(sign * ir).toFixed(3),
    abs_ir: +Math.abs(ir).toFixed(3),
    t_stat: +(sign * (4.2 - i * 0.15)).toFixed(2),
    win_rate: +(0.58 - i * 0.008).toFixed(3),
    n_obs: 245,
  };
});

// ── feature importance ───────────────────────────────────────
// FeatureImportanceChart 读 {feature, importance}
const importance = Array.from({ length: 20 }, (_, i) => ({
  feature: `α${ic[i].alpha_num}`,
  importance: +(2400 - i * 95 + rnd() * 50).toFixed(1),
  split: 145 - i * 5 + Math.floor(rnd() * 10),
}));

// ── backtest equity + benchmark curves + metrics ─────────────
// EquityCurveChart 读 equity_curve/{date, equity} + benchmark_curve/{date, bench_equity}
let stratNav = 1.0;
let benchNav = 1.0;
const equity_curve = [];
const benchmark_curve = [];
for (let i = 0; i < dates.length; i++) {
  const stratRet = 0.00085 + (rnd() - 0.5) * 0.013;
  const benchRet = 0.00045 + (rnd() - 0.5) * 0.015;
  stratNav *= 1 + stratRet;
  benchNav *= 1 + benchRet;
  equity_curve.push({ date: dates[i], equity: +stratNav.toFixed(4) });
  benchmark_curve.push({ date: dates[i], bench_equity: +benchNav.toFixed(4) });
}

const backtest = {
  run_id: RUN_ID,
  metrics: {
    annual_return: 0.218,
    annual_vol: 0.127,
    sharpe: 1.72,
    calmar: 2.81,
    max_drawdown: -0.078,
    monthly_win_rate: 0.583,
    alpha_annual: 0.095,
    ir_vs_benchmark: 1.18,
    turnover_annual: 3.40,
    total_return: +(stratNav - 1).toFixed(4),
    benchmark_annual: 0.123,
    benchmark_max_dd: -0.118,
    benchmark: "CSI500",
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    top_n: 50,
    cost: 0.002,
    has_tradeable_mask: true,
    n_trades: 1248,
  },
  equity_curve,
  benchmark_curve,
  multi_topn: [20, 30, 50, 80, 100].map((n) => {
    const scale = 50 / n;
    return {
      top_n: n,
      annual_return: +(0.218 * scale).toFixed(4),
      sharpe: +(1.72 / Math.sqrt(scale)).toFixed(2),
      max_drawdown: +(-0.078 * scale).toFixed(4),
      calmar: +(2.81 / scale).toFixed(2),
      alpha_annual: +(0.095 * scale).toFixed(4),
      ir_vs_benchmark: +(1.18 / Math.sqrt(scale)).toFixed(2),
      monthly_win_rate: +(0.583 - (n - 50) * 0.001).toFixed(3),
      turnover_annual: +(3.40 + (50 - n) * 0.03).toFixed(2),
    };
  }),
};

// ── top holdings (Top 20 by predicted return) ────────────────
const TICKERS = [
  "NVDA", "AVGO", "MSFT", "AAPL", "META", "GOOGL", "AMZN", "TSLA",
  "AMD", "PLTR", "ORCL", "CRM", "NOW", "NFLX", "MA", "V",
  "JPM", "BAC", "WMT", "COST",
];
const holdings = TICKERS.map((ticker, i) => {
  const status = i < 4 ? "new" : i >= 17 ? "dropped" : "held";
  return {
    ticker,
    score: status === "dropped" ? null : +(0.85 - i * 0.018 + (rnd() - 0.5) * 0.02).toFixed(3),
    rank: i + 1,
    status,
    weight: status === "dropped" ? 0 : +(1 / 17).toFixed(4),
    prev_rank: status === "new" ? null : status === "dropped" ? 18 + i - 17 : i + 1 + Math.floor((rnd() - 0.5) * 4),
  };
});
const topHoldings = {
  as_of: AS_OF,
  run_id: RUN_ID,
  holdings,
  n_new: holdings.filter(h => h.status === "new").length,
  n_held: holdings.filter(h => h.status === "held").length,
  n_dropped: holdings.filter(h => h.status === "dropped").length,
};

// ── regime（HMM 三态时间序列）────────────────────────────────
const regime = dates.map((d, i) => {
  // 前 1/3 bull → 中 1/3 neutral → 末段 bear → 反弹 bull
  let label = "bull";
  if (i > 80 && i < 160) label = "neutral";
  else if (i >= 160 && i < 215) label = "bear";
  else if (i >= 215) label = "bull";
  return { date: d, label };
});

// ── 5-fold walk-forward IC ───────────────────────────────────
// FoldICTable 读 {fold, test_start, test_end, test_ic_mean, test_ic_ir, best_iter}
const foldIC = Array.from({ length: 5 }, (_, i) => ({
  fold: i + 1,
  test_start: dates[40 + i * 40],
  test_end: dates[Math.min(40 + i * 40 + 40, dates.length - 1)],
  test_ic_mean: +(0.072 + (rnd() - 0.5) * 0.025).toFixed(4),
  test_ic_ir: +(0.38 + (rnd() - 0.5) * 0.18).toFixed(3),
  best_iter: 120 + Math.floor(rnd() * 80),
}));

// ── IC heatmap (top 20 alpha × 24 months) ────────────────────
const heatmapMonths = Array.from({ length: 24 }, (_, i) => {
  const m = (i % 12) + 1;
  const y = 2023 + Math.floor(i / 12);
  return `${y}-${String(m).padStart(2, "0")}`;
});
// ICHeatmap 读 {alphas, months, cells:[{alpha, month, ic}]}
const heatmapAlphas = ic.slice(0, 20).map(r => r.alpha_num);
const heatmapCells = [];
heatmapAlphas.forEach((alpha, idx) => {
  const trend = ic[idx].ic_mean;
  heatmapMonths.forEach((month) => {
    heatmapCells.push({
      alpha,
      month,
      ic: +(trend + (rnd() - 0.5) * 0.12).toFixed(4),
    });
  });
});
const heatmap = {
  alphas: heatmapAlphas,
  months: heatmapMonths,
  cells: heatmapCells,
};

// ── alerts ───────────────────────────────────────────────────
const alerts = [
  {
    severity: "high",
    message: "α101 近 20 日 IC 滚动均值跌至 -0.02（前值 +0.07），关注是否失效",
    ts: "2024-12-28T15:30:00Z",
  },
  {
    severity: "medium",
    message: "策略 5 日回撤 -1.8%，未触发风控阈值（-3%）",
    ts: "2024-12-27T16:00:00Z",
  },
];

export const demoMiningAlpha = {
  status, ic, importance, backtest, topHoldings, regime, foldIC, heatmap, alerts,
};
