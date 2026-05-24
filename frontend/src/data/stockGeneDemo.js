// ─────────────────────────────────────────────────────────────
// StockGene 示例数据 — Vercel/无后端部署的 demo
// ─────────────────────────────────────────────────────────────
//
// 形状匹配 backend stock_gene.load_watchlist() 返回：
//   { version: 2, lists: [...], items: [{ticker, last_result, last_value_result, ...}] }
//
// 每个 item 含 4 个引擎的结果（trend / value / signal / risk），让 4 个 tab
// 都能看到完整数据 + 引擎对比。Features 取最有代表性的 2-3 条让 ScoreDetail
// 面板不显得空。
//
// Dynamic import 拆独立 chunk，不污染本地 dev bundle。
// ─────────────────────────────────────────────────────────────

const CHECKED_AT = "2024-12-30T14:30:00Z";

// 帮手：构造一个引擎 result，feature 只放展示用的核心几条
const makeResult = (score, max_score, verdict, features = []) => ({
  score, max_score, verdict, checked_at: CHECKED_AT,
  features,
});

// 帮手：构造一个 demo item（全部 4 引擎评分）
const makeItem = ({ ticker, name, market, sector, tags = [], scores }) => ({
  ticker, name, market, sector, tags,
  notes: "",
  list_id: "default",
  added_at: "2024-11-01T00:00:00Z",
  last_result: scores.trend,
  last_checked_at: CHECKED_AT,
  last_value_result: scores.value,
  last_value_checked_at: CHECKED_AT,
  last_signal_result: scores.signal,
  last_signal_checked_at: CHECKED_AT,
  last_risk_result: scores.risk,
  last_risk_checked_at: CHECKED_AT,
});

// 8 demo 标的，覆盖 US 大票 + ETF + 一只 HK
export const demoStockGene = {
  version: 2,
  lists: [
    { id: "default", name: "默认", color: "indigo", created_at: "2024-11-01T00:00:00Z" },
    { id: "ai-leaders", name: "AI 龙头", color: "emerald", created_at: "2024-11-01T00:00:00Z" },
  ],
  items: [
    makeItem({
      ticker: "NVDA", name: "NVIDIA", market: "US", sector: "Semiconductors",
      tags: ["AI", "GPU"],
      scores: {
        trend:  makeResult(7, 8, "牛股潜质", [
          { id: "above_ma200", label: "股价在 200 日均线之上", pass: true, score: 1, value: "$140.22 vs MA200 $112.40 (+24.8%)" },
          { id: "rsi_healthy", label: "RSI 在 50-70 健康区间", pass: true, score: 1, value: "RSI=62.3" },
          { id: "rel_strength", label: "相对 SPY 强势", pass: true, score: 1, value: "RS=+18.4% (90d)" },
        ]),
        value:  makeResult(4, 6, "质量合格", [
          { id: "roe_high", label: "ROE > 15%", pass: true, score: 1, value: "ROE=82%" },
        ]),
        signal: makeResult(5, 6, "入场窗口", [
          { id: "breakout", label: "近 20D 突破", pass: true, score: 1, value: "突破前高 +2.1%" },
        ]),
        risk:   makeResult(3, 6, "中等风险", [
          { id: "high_beta", label: "Beta > 1.5", pass: false, score: 0, value: "β=1.78" },
        ]),
      },
    }),
    makeItem({
      ticker: "AAPL", name: "Apple", market: "US", sector: "Consumer Electronics",
      tags: ["MegaCap"],
      scores: {
        trend:  makeResult(6, 8, "中性偏强", []),
        value:  makeResult(5, 6, "优质标的", []),
        signal: makeResult(4, 6, "可关注", []),
        risk:   makeResult(5, 6, "低风险", []),
      },
    }),
    makeItem({
      ticker: "TSLA", name: "Tesla", market: "US", sector: "Auto", tags: ["EV"],
      scores: {
        trend:  makeResult(5, 8, "中性偏强", []),
        value:  makeResult(2, 6, "不推荐", []),
        signal: makeResult(3, 6, "观望", []),
        risk:   makeResult(2, 6, "高风险", []),
      },
    }),
    makeItem({
      ticker: "MSFT", name: "Microsoft", market: "US", sector: "Software", tags: ["AI"],
      scores: {
        trend:  makeResult(7, 8, "牛股潜质", []),
        value:  makeResult(5, 6, "优质标的", []),
        signal: makeResult(4, 6, "可关注", []),
        risk:   makeResult(5, 6, "低风险", []),
      },
    }),
    makeItem({
      ticker: "AVGO", name: "Broadcom", market: "US", sector: "Semiconductors", tags: ["AI"],
      scores: {
        trend:  makeResult(7, 8, "牛股潜质", []),
        value:  makeResult(4, 6, "质量合格", []),
        signal: makeResult(5, 6, "入场窗口", []),
        risk:   makeResult(4, 6, "风险可控", []),
      },
    }),
    makeItem({
      ticker: "AMD", name: "AMD", market: "US", sector: "Semiconductors", tags: ["AI"],
      scores: {
        trend:  makeResult(4, 8, "中性", []),
        value:  makeResult(3, 6, "中性", []),
        signal: makeResult(2, 6, "暂避", []),
        risk:   makeResult(2, 6, "高风险", []),
      },
    }),
    makeItem({
      ticker: "RKLB", name: "Rocket Lab", market: "US", sector: "Aerospace", tags: ["太空"],
      scores: {
        trend:  makeResult(6, 8, "中性偏强", []),
        value:  makeResult(1, 6, "不推荐", []),
        signal: makeResult(5, 6, "入场窗口", []),
        risk:   makeResult(1, 6, "高风险", []),
      },
    }),
    makeItem({
      ticker: "PLTR", name: "Palantir", market: "US", sector: "Software", tags: ["AI"],
      scores: {
        trend:  makeResult(7, 8, "牛股潜质", []),
        value:  makeResult(2, 6, "不推荐", []),
        signal: makeResult(4, 6, "可关注", []),
        risk:   makeResult(2, 6, "高风险", []),
      },
    }),
  ],
};
