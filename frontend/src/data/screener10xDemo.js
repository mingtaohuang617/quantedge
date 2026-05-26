// ─────────────────────────────────────────────────────────────
// 10x 猎手示例数据 — Vercel/无后端部署的 demo
// ─────────────────────────────────────────────────────────────
//
// 之前 demo 模式只展示赛道按钮，items / candidates 都是 0，用户
// 看不到这个 tab 实际能干什么。补 10 个 candidate + 2 个 watchlist
// item 让漏斗"全宇宙 → 匹配赛道 → AI 已审 → 你的观察"四段都有数。
//
// Dynamic import 拆独立 chunk，只在 fallback 时下载。
// ─────────────────────────────────────────────────────────────

// 10 个候选股，覆盖 AI 算力 / 半导体 / 光通信 / 算力中心赛道
// 字段对齐 backend /watchlist/10x/screen 响应：
//   ticker, name, market, exchange, sector, industry, marketCap, pe, pb,
//   dividend_yield, roe（后两个对成长股可空）
export const demoCandidates = [
  { ticker: "NVDA",  name: "NVIDIA",          market: "US", exchange: "NASDAQ", sector: "Semiconductors",   industry: "Semiconductors",            marketCap: 3_200_000_000_000, pe: 65.2, pb: 48.5, dividend_yield: 0.0003, roe: 0.95 },
  { ticker: "AVGO",  name: "Broadcom",        market: "US", exchange: "NASDAQ", sector: "Semiconductors",   industry: "Semiconductors",            marketCap: 1_120_000_000_000, pe: 32.4, pb: 12.8, dividend_yield: 0.0125, roe: 0.42 },
  { ticker: "AMD",   name: "AMD",             market: "US", exchange: "NASDAQ", sector: "Semiconductors",   industry: "Semiconductors",            marketCap:   220_000_000_000, pe: 88.7, pb:  4.6, dividend_yield: null,    roe: 0.06 },
  { ticker: "SMCI",  name: "Super Micro",     market: "US", exchange: "NASDAQ", sector: "Technology",       industry: "Computer Hardware",         marketCap:    23_000_000_000, pe: 18.5, pb:  4.2, dividend_yield: null,    roe: 0.31 },
  { ticker: "MU",    name: "Micron",          market: "US", exchange: "NASDAQ", sector: "Semiconductors",   industry: "Memory Chips",              marketCap:    98_000_000_000, pe: 12.1, pb:  2.3, dividend_yield: 0.0055, roe: 0.18 },
  { ticker: "MARS",  name: "ARK Space ETF",   market: "US", exchange: "BATS",   sector: "ETF",              industry: "Aerospace & Defense ETF",   marketCap:     1_200_000_000, pe: null, pb: null, dividend_yield: null,    roe: null },
  { ticker: "ARM",   name: "Arm Holdings",    market: "US", exchange: "NASDAQ", sector: "Semiconductors",   industry: "Semiconductors",            marketCap:   135_000_000_000, pe: 220.0, pb: 25.3, dividend_yield: null,   roe: 0.10 },
  { ticker: "0981.HK", name: "中芯国际",        market: "HK", exchange: "HKEX",   sector: "Technology",       industry: "Semiconductors",            marketCap:    35_000_000_000, pe: 42.0, pb:  1.8, dividend_yield: null,    roe: 0.04 },
  { ticker: "688981.SH", name: "中芯国际(A)",   market: "CN", exchange: "SSE",    sector: "Technology",       industry: "Semiconductors",            marketCap:    70_000_000_000, pe: 95.0, pb:  4.5, dividend_yield: null,    roe: 0.05 },
  { ticker: "SOXX",  name: "iShares Semi ETF",market: "US", exchange: "NASDAQ", sector: "ETF",              industry: "Semiconductors ETF",         marketCap:    14_000_000_000, pe: null, pb: null, dividend_yield: 0.0098, roe: null },
];

// 用户已加入观察的 2 个 demo items
export const demoWatchlistItems = [
  {
    ticker: "NVDA", name: "NVIDIA", market: "US", exchange: "NASDAQ",
    sector: "Semiconductors", industry: "Semiconductors",
    marketCap: 3_200_000_000_000,
    added_at: "2024-10-15T00:00:00Z",
    archived: false,
    target_price: 165.00,
    stop_loss: 110.00,
    thesis: "AI 算力龙头，Blackwell 架构与 CUDA 生态护城河。",
    strategy: "growth",
  },
  {
    ticker: "MU", name: "Micron", market: "US", exchange: "NASDAQ",
    sector: "Semiconductors", industry: "Memory Chips",
    marketCap: 98_000_000_000,
    added_at: "2024-11-20T00:00:00Z",
    archived: false,
    target_price: 145.00,
    stop_loss: 78.00,
    thesis: "HBM 周期上行 + DRAM 价格触底反弹。",
    strategy: "growth",
  },
];
