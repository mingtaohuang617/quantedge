/**
 * QuantEdge Standalone Module
 * 纯前端独立运行：Yahoo Finance API (vite proxy / allorigins 代理) + localStorage
 * 无需后端服务器，适用于 GitHub Pages 部署
 */

const PROXY = "https://api.allorigins.win/get?url=";
const CACHE_KEY = "quantedge_standalone_stocks";

// ─── Yahoo Finance 请求（优先 vite proxy，降级 allorigins）──────
async function yahooFetch(url, timeout = 12000) {
  // 优先 vite dev proxy（本地开发时直连），降级 allorigins
  const path = url.replace("https://query1.finance.yahoo.com", "").replace("https://query2.finance.yahoo.com", "");
  try {
    const proxyUrl = path.startsWith("/v10/") ? `/yahoo-api${path.replace("/v10/", "/v10/")}` : null;
    if (proxyUrl) {
      const localRes = await fetch(proxyUrl.replace("query2", "query1"), { signal: AbortSignal.timeout(timeout) });
      if (localRes.ok) return await localRes.json();
    }
  } catch { /* vite proxy unavailable — fall through */ }
  const res = await fetch(PROXY + encodeURIComponent(url), {
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
  const json = await res.json();
  if (!json.contents) throw new Error("Proxy returned empty response");
  return JSON.parse(json.contents);
}

/** 通过 vite dev proxy 或 allorigins 获取 Yahoo Finance chart 数据 */
async function yahooChartFetch(path, timeout = 12000) {
  // 1. 优先 vite dev proxy（本地开发无 CORS 问题）
  try {
    const res = await fetch(`/yahoo-api${path}`, { signal: AbortSignal.timeout(timeout) });
    if (res.ok) return await res.json();
  } catch { /* vite proxy 不可用，降级 */ }
  // 2. 降级 allorigins CORS proxy
  return await yahooFetch(`https://query1.finance.yahoo.com${path}`, timeout);
}

// ─── Yahoo Finance range → 请求参数映射 ──────────────────
const RANGE_CONFIG = {
  "1D": { range: "1d",  interval: "5m" },
  "5D": { range: "5d",  interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
  "1Y": { range: "1y",  interval: "1d" },
  "5Y": { range: "5y",  interval: "1wk" },
  "ALL": { range: "max", interval: "1mo" },
};

// ─── 日期格式化工具 ──────────────────────────────────────
function formatDateKey(timestamp, rangeKey) {
  const d = new Date(timestamp * 1000);
  switch (rangeKey) {
    case "1D":
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    case "5D":
      return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    case "5Y":
    case "ALL":
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    default: // 1M, 6M, YTD, 1Y
      return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }
}

// ─── 获取单个范围的价格数据 ──────────────────────────────
async function fetchRangePrices(yfSym, rangeKey) {
  const cfg = RANGE_CONFIG[rangeKey];
  if (!cfg) return [];

  const path = `/v8/finance/chart/${yfSym}?interval=${cfg.interval}&range=${cfg.range}`;
  const data = await yahooChartFetch(path, 15000);
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const history = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const m = formatDateKey(timestamps[i], rangeKey);
    // 同日期/时间去重（保留最新值）
    if (history.length > 0 && history[history.length - 1].m === m) {
      history[history.length - 1].p = +(closes[i].toFixed(2));
    } else {
      history.push({ m, p: +(closes[i].toFixed(2)) });
    }
  }
  return history;
}

// ─── 搜索标的 ──────────────────────────────────────────
export async function searchTickers(query) {
  const results = [];
  const q = query.trim();
  if (!q) return results;

  // 1. Try Yahoo Finance search API
  try {
    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`
    );
    for (const quote of (data?.quotes || [])) {
      const symbol = quote.symbol || "";
      const market = symbol.endsWith(".HK") ? "HK"
        : (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) ? "CN" : "US";
      results.push({
        symbol: symbol.endsWith(".HK") ? symbol.replace(".HK", "").padStart(5, "0") + ".HK" : symbol,
        name: quote.shortname || quote.longname || symbol,
        market,
        currency: market === "HK" ? "HKD" : market === "CN" ? "CNY" : "USD",
        type: quote.quoteType === "ETF" ? "etf" : "stock",
        exchange: quote.exchange || "",
      });
    }
  } catch { /* ignore */ }

  // 2. Also try direct symbol match
  if (results.length === 0) {
    const directSymbols = [q.toUpperCase()];
    if (!q.includes(".")) directSymbols.push(q.toUpperCase() + ".HK");

    for (const sym of directSymbols) {
      try {
        const yfSym = sym.endsWith(".HK")
          ? sym.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK"
          : sym;
        const data = await yahooChartFetch(
          `/v8/finance/chart/${yfSym}?interval=1d&range=1d`, 10000
        );
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          const displaySym = sym.endsWith(".HK")
            ? sym.replace(".HK", "").padStart(5, "0") + ".HK" : sym;
          results.push({
            symbol: displaySym,
            name: meta.shortName || meta.symbol || displaySym,
            market: sym.endsWith(".HK") ? "HK" : "US",
            currency: meta.currency || "USD",
            type: meta.instrumentType === "ETF" ? "etf" : "stock",
            price: +(meta.regularMarketPrice.toFixed(2)),
          });
        }
      } catch { /* ignore */ }
    }
  }

  return results;
}

// ─── 获取单个标的完整数据（多时间范围）──────────────────
export async function fetchStockData(ticker) {
  // Determine Yahoo symbol
  let yfSym = ticker;
  if (ticker.endsWith(".HK")) {
    yfSym = ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK";
  }

  // 1. 先获取 1Y 日线数据（核心数据，用于基本面计算）
  const path1Y = `/v8/finance/chart/${yfSym}?interval=1d&range=1y`;
  const data = await yahooChartFetch(path1Y, 15000);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  // Current price — 使用 chartPreviousClose 作为降级值
  const price = +(meta.regularMarketPrice?.toFixed(2) || 0);
  const prevClose = +(meta.previousClose?.toFixed(2) || meta.chartPreviousClose?.toFixed(2) || 0);
  const rawChange = prevClose > 0 ? +((price - prevClose) / prevClose * 100).toFixed(2) : 0;
  const change = isFinite(rawChange) ? rawChange : 0;
  const currency = meta.currency || "USD";

  // Build 1Y price history（不降采样，保留全部日线数据）
  const priceHistory1Y = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const d = new Date(timestamps[i] * 1000);
    const m = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    if (priceHistory1Y.length > 0 && priceHistory1Y[priceHistory1Y.length - 1].m === m) {
      priceHistory1Y[priceHistory1Y.length - 1].p = +(closes[i].toFixed(2));
    } else {
      priceHistory1Y.push({ m, p: +(closes[i].toFixed(2)) });
    }
  }

  // 从 1Y 数据中截取 6M / 1M 子集
  const halfLen = Math.floor(priceHistory1Y.length / 2);
  const priceHistory6M = priceHistory1Y.slice(Math.max(0, halfLen));
  const monthLen = Math.floor(priceHistory1Y.length / 12);
  const priceHistory1M = priceHistory1Y.slice(Math.max(0, priceHistory1Y.length - Math.max(monthLen, 20)));

  // YTD: 从今年1月1日开始（用 findLastIndex 找最后一个 01/ 开头的数据点，即今年的1月）
  let ytdStart = -1;
  for (let i = priceHistory1Y.length - 1; i >= 0; i--) {
    if (priceHistory1Y[i].m.startsWith("01/")) { ytdStart = i; break; }
  }
  const priceHistoryYTD = ytdStart >= 0 ? priceHistory1Y.slice(ytdStart) : [...priceHistory1Y];

  // Compute RSI & Momentum
  const validCloses = closes.filter(c => c != null);
  const rsi = calcRSI(validCloses);
  const momentum = calcMomentum(validCloses);

  // 2. 并行获取 5Y 和 ALL 范围（长周期数据）
  const priceRanges = {
    "1M": priceHistory1M,
    "6M": priceHistory6M,
    "YTD": priceHistoryYTD,
    "1Y": priceHistory1Y,
  };

  // 并行获取 5Y + ALL + quoteSummary（三个请求互不依赖，一起发）
  const summaryUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${yfSym}?modules=summaryProfile,defaultKeyStatistics,financialData,price,summaryDetail`;
  const [prices5Y, pricesALL, summaryResult] = await Promise.allSettled([
    fetchRangePrices(yfSym, "5Y"),
    fetchRangePrices(yfSym, "ALL"),
    yahooFetch(summaryUrl, 10000),
  ]);
  if (prices5Y.status === "fulfilled" && prices5Y.value.length >= 2) {
    priceRanges["5Y"] = prices5Y.value;
  }
  if (pricesALL.status === "fulfilled" && pricesALL.value.length >= 2) {
    priceRanges["ALL"] = pricesALL.value;
  }

  // Parse fundamentals from quote summary
  let pe = null, roe = null, revenueGrowth = null, profitMargin = null;
  let marketCap = null, ebitda = null, revenue = null, eps = null, beta = null;
  let week52High = meta.fiftyTwoWeekHigh || null;
  let week52Low = meta.fiftyTwoWeekLow || null;
  let avgVolume = null;
  let shortName = meta.shortName || meta.symbol || ticker;
  let sector = "";
  let description = "";
  let isETF = meta.instrumentType === "ETF";
  let quoteType = meta.instrumentType || "EQUITY";

  try {
    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const result2 = summary?.quoteSummary?.result?.[0];
    if (result2) {
      const fin = result2.financialData || {};
      const stats = result2.defaultKeyStatistics || {};
      const profile = result2.summaryProfile || {};
      const priceData = result2.price || {};
      const detail = result2.summaryDetail || {};

      pe = fin.currentPrice?.raw && fin.earningsPerShare?.raw
        ? +(priceData.trailingPE?.raw?.toFixed(2)) || null : null;
      if (!pe) pe = detail.trailingPE?.raw ? +(detail.trailingPE.raw.toFixed(2)) : null;

      roe = fin.returnOnEquity?.raw ? +(fin.returnOnEquity.raw * 100).toFixed(1) : null;
      revenueGrowth = fin.revenueGrowth?.raw ? +(fin.revenueGrowth.raw * 100).toFixed(1) : null;
      profitMargin = fin.profitMargins?.raw ? +(fin.profitMargins.raw * 100).toFixed(1) : null;
      ebitda = fin.ebitda?.raw || null;
      revenue = fin.totalRevenue?.raw || null;
      eps = stats.trailingEps?.raw || null;
      beta = stats.beta?.raw ? +(stats.beta.raw.toFixed(2)) : null;
      marketCap = priceData.marketCap?.raw || null;
      avgVolume = detail.averageVolume?.raw || null;
      sector = profile.sector || "";
      description = (profile.longBusinessSummary || "").slice(0, 300);
      shortName = priceData.shortName || shortName;
      isETF = (priceData.quoteType === "ETF" || priceData.quoteType === "MUTUALFUND") || isETF;
    }
  } catch { /* summary fetch failed — ok, we have basics */ }

  // Compute score
  const { score, subScores } = isETF
    ? calcETFScore({ momentum })
    : calcStockScore({ pe, roe, revenueGrowth, profitMargin, momentum, rsi });

  // Sector translation
  const SECTOR_MAP = {
    Technology: "科技", "Consumer Cyclical": "消费/周期",
    "Consumer Defensive": "消费/必需品", "Financial Services": "金融",
    Healthcare: "医疗健康", Industrials: "工业", Energy: "能源",
    "Basic Materials": "基础材料", "Communication Services": "通信服务",
    "Real Estate": "房地产", Utilities: "公用事业",
  };
  const sectorCN = SECTOR_MAP[sector] || sector || (isETF ? "ETF" : "未知");

  const stockData = {
    ticker,
    name: shortName,
    market: ticker.endsWith(".HK") ? "HK" : "US",
    sector: sectorCN,
    currency,
    price,
    change,
    score,
    subScores,
    isETF,
    pe, roe, momentum, rsi,
    revenueGrowth, profitMargin,
    ebitda: fmtBig(ebitda),
    marketCap: fmtBig(marketCap),
    revenue: fmtBig(revenue),
    eps: typeof eps === "number" ? +eps.toFixed(2) : null,
    beta,
    week52High, week52Low,
    avgVolume: fmtBig(avgVolume),
    nextEarnings: null,
    priceHistory: priceHistory1Y,
    priceRanges,
    description,
    _fetchedAt: Date.now(),
  };

  // 3. 运行数据质量检查
  const dqReport = validateStockData(stockData);
  stockData._dataQuality = dqReport;
  if (dqReport.issues.length > 0) {
    console.warn(`[DQ] ${ticker} 数据质量问题:`, dqReport.issues.map(i => i.msg));
  }

  return stockData;
}

// ─── 基准指数价格数据获取（单范围）──────────────────────
export async function fetchBenchmarkPrices(ticker, range = "1Y") {
  let yfSym = ticker;
  if (ticker.endsWith(".HK")) {
    yfSym = ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK";
  }
  return await fetchRangePrices(yfSym, range);
}

// ═══════════════════════════════════════════════════════════
//  数据质量检查系统 (Data Quality Validation)
//  六维度：完整性、准确性、一致性、及时性、有效性、唯一性
// ═══════════════════════════════════════════════════════════

/**
 * 验证单个标的的数据质量
 * @param {object} stk - 标的数据对象
 * @returns {{ score: number, grade: string, issues: Array<{dim: string, severity: string, msg: string}> }}
 */
export function validateStockData(stk) {
  const issues = [];
  const scores = { completeness: 100, accuracy: 100, consistency: 100, timeliness: 100, validity: 100, uniqueness: 100 };

  if (!stk || !stk.ticker) {
    return { score: 0, grade: "F", issues: [{ dim: "validity", severity: "critical", msg: "无效的数据对象" }], scores };
  }

  // ── 1. 完整性 (Completeness) ──
  // 检查必要字段是否缺失
  const requiredFields = ["ticker", "name", "price", "priceHistory", "priceRanges"];
  for (const f of requiredFields) {
    if (stk[f] == null || stk[f] === "") {
      issues.push({ dim: "completeness", severity: "critical", msg: `缺少必要字段: ${f}` });
      scores.completeness -= 20;
    }
  }

  // 检查价格范围覆盖率
  const expectedRanges = ["1M", "6M", "YTD", "1Y", "5Y", "ALL"];
  const pr = stk.priceRanges || {};
  const missingRanges = expectedRanges.filter(r => !pr[r] || pr[r].length < 2);
  if (missingRanges.length > 0) {
    const sev = missingRanges.length >= 4 ? "high" : missingRanges.length >= 2 ? "medium" : "low";
    issues.push({ dim: "completeness", severity: sev, msg: `缺少时间范围数据: ${missingRanges.join(", ")}` });
    scores.completeness -= missingRanges.length * 8;
  }

  // 检查各范围的数据点数是否合理
  const minPointsExpected = { "1M": 15, "6M": 80, "YTD": 20, "1Y": 180, "5Y": 100, "ALL": 20 };
  for (const [range, minPts] of Object.entries(minPointsExpected)) {
    const pts = pr[range]?.length || 0;
    if (pts > 0 && pts < minPts) {
      issues.push({ dim: "completeness", severity: "medium",
        msg: `${range} 数据点不足: ${pts}个 (预期≥${minPts})` });
      scores.completeness -= 5;
    }
  }

  // 检查价格数据中的空值
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr)) continue;
    const nullCount = arr.filter(p => p.p == null || p.m == null).length;
    if (nullCount > 0) {
      issues.push({ dim: "completeness", severity: "high",
        msg: `${range} 存在 ${nullCount} 条空值记录` });
      scores.completeness -= nullCount * 3;
    }
  }

  // ── 2. 准确性 (Accuracy) ──
  // 检查价格异常值
  if (stk.price != null) {
    if (stk.price <= 0) {
      issues.push({ dim: "accuracy", severity: "critical", msg: `当前价格异常: $${stk.price}` });
      scores.accuracy -= 30;
    }
    if (stk.price > 1e6) {
      issues.push({ dim: "accuracy", severity: "high", msg: `价格异常偏高: $${stk.price}` });
      scores.accuracy -= 15;
    }
  }

  // 检查涨跌幅合理性
  if (stk.change != null && Math.abs(stk.change) > 50) {
    issues.push({ dim: "accuracy", severity: "medium",
      msg: `日涨跌幅异常: ${stk.change}% (超过±50%)` });
    scores.accuracy -= 10;
  }

  // 检查历史价格中的跳变（前后差异>50%视为异常）
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr) || arr.length < 3) continue;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].p > 0 && arr[i - 1].p > 0) {
        const pctChange = Math.abs(arr[i].p - arr[i - 1].p) / arr[i - 1].p;
        if (pctChange > 0.5 && !["5Y", "ALL"].includes(range)) {
          issues.push({ dim: "accuracy", severity: "medium",
            msg: `${range} 第${i}点价格跳变: ${arr[i - 1].p}→${arr[i].p} (${(pctChange * 100).toFixed(0)}%)` });
          scores.accuracy -= 5;
          break; // 只报告第一个
        }
      }
    }
  }

  // 52周高低验证
  if (stk.week52High && stk.week52Low) {
    if (stk.week52Low > stk.week52High) {
      issues.push({ dim: "accuracy", severity: "high", msg: `52周低>52周高: ${stk.week52Low} > ${stk.week52High}` });
      scores.accuracy -= 15;
    }
    if (stk.price > stk.week52High * 1.1 || stk.price < stk.week52Low * 0.9) {
      issues.push({ dim: "accuracy", severity: "low",
        msg: `当前价格超出52周范围: $${stk.price} (${stk.week52Low}-${stk.week52High})` });
      scores.accuracy -= 5;
    }
  }

  // ── 3. 一致性 (Consistency) ──
  // 检查不同范围数据的最新价格是否一致
  const latestPrices = {};
  for (const [range, arr] of Object.entries(pr)) {
    if (Array.isArray(arr) && arr.length > 0) {
      latestPrices[range] = arr[arr.length - 1].p;
    }
  }
  const priceValues = Object.values(latestPrices);
  if (priceValues.length >= 2) {
    const maxP = Math.max(...priceValues);
    const minP = Math.min(...priceValues);
    if (maxP > 0 && (maxP - minP) / maxP > 0.05) {
      issues.push({ dim: "consistency", severity: "medium",
        msg: `各范围最新价格不一致: ${Object.entries(latestPrices).map(([k, v]) => `${k}=$${v}`).join(", ")}` });
      scores.consistency -= 15;
    }
  }

  // 检查日期格式一致性
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const fmt = arr[0].m;
    const isLong = fmt.length >= 6 && fmt.indexOf("/") >= 4; // YYYY/MM
    const isShort = fmt.match(/^\d{2}\//); // MM/DD
    const isIntraday = fmt.includes(":"); // HH:MM or MM/DD HH:MM
    // 确保同一范围内格式统一
    for (let i = 1; i < arr.length; i++) {
      const curLong = arr[i].m.length >= 6 && arr[i].m.indexOf("/") >= 4;
      const curIntraday = arr[i].m.includes(":");
      if (curLong !== isLong || curIntraday !== isIntraday) {
        issues.push({ dim: "consistency", severity: "high",
          msg: `${range} 日期格式不一致: "${fmt}" vs "${arr[i].m}"` });
        scores.consistency -= 10;
        break;
      }
    }
  }

  // ── 4. 及时性 (Timeliness) ──
  if (stk._fetchedAt) {
    const ageHours = (Date.now() - stk._fetchedAt) / 3600000;
    if (ageHours > 24) {
      issues.push({ dim: "timeliness", severity: "medium",
        msg: `数据已过期: ${Math.round(ageHours)}小时前获取` });
      scores.timeliness -= Math.min(30, Math.round(ageHours / 2));
    }
  } else {
    issues.push({ dim: "timeliness", severity: "low", msg: "缺少数据获取时间戳" });
    scores.timeliness -= 10;
  }

  // 检查最新数据点是否在合理时间范围内
  const pr1Y = pr["1Y"] || pr["6M"] || stk.priceHistory;
  if (Array.isArray(pr1Y) && pr1Y.length > 0) {
    const lastDate = pr1Y[pr1Y.length - 1].m;
    const now = new Date();
    const curMM = String(now.getMonth() + 1).padStart(2, "0");
    const curDD = String(now.getDate()).padStart(2, "0");
    // 简单检查：最新数据点的月份是否为当前月或上个月
    if (lastDate.match(/^\d{2}\//)) {
      const dateMM = lastDate.substring(0, 2);
      const prevMM = String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0");
      if (dateMM !== curMM && dateMM !== prevMM) {
        issues.push({ dim: "timeliness", severity: "high",
          msg: `最新数据点过旧: ${lastDate} (当前 ${curMM}/${curDD})` });
        scores.timeliness -= 20;
      }
    }
  }

  // ── 5. 有效性 (Validity) ──
  // 检查 ticker 格式
  if (!/^[A-Z0-9.]+$/.test(stk.ticker)) {
    issues.push({ dim: "validity", severity: "high", msg: `Ticker 格式异常: ${stk.ticker}` });
    scores.validity -= 15;
  }

  // 检查 market 值
  if (!["US", "HK", "CN"].includes(stk.market)) {
    issues.push({ dim: "validity", severity: "medium", msg: `市场标识无效: ${stk.market}` });
    scores.validity -= 10;
  }

  // 检查评分范围
  if (stk.score != null && (stk.score < 0 || stk.score > 100)) {
    issues.push({ dim: "validity", severity: "high", msg: `评分超出有效范围: ${stk.score}` });
    scores.validity -= 15;
  }

  // 检查日期值域
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr)) continue;
    for (const pt of arr) {
      if (typeof pt.m !== "string" || pt.m.length < 4) {
        issues.push({ dim: "validity", severity: "high", msg: `${range} 日期格式无效: "${pt.m}"` });
        scores.validity -= 10;
        break;
      }
      if (typeof pt.p !== "number" || isNaN(pt.p)) {
        issues.push({ dim: "validity", severity: "high", msg: `${range} 价格值无效: ${pt.p}` });
        scores.validity -= 10;
        break;
      }
    }
  }

  // ── 6. 唯一性 (Uniqueness) ──
  // 检查同一范围内的日期重复
  for (const [range, arr] of Object.entries(pr)) {
    if (!Array.isArray(arr)) continue;
    const dates = new Set();
    let dupCount = 0;
    for (const pt of arr) {
      if (dates.has(pt.m)) dupCount++;
      dates.add(pt.m);
    }
    if (dupCount > 0) {
      issues.push({ dim: "uniqueness", severity: "medium",
        msg: `${range} 存在 ${dupCount} 条重复日期` });
      scores.uniqueness -= dupCount * 5;
    }
  }

  // 计算总分（各维度等权）
  for (const k of Object.keys(scores)) {
    scores[k] = Math.max(0, Math.min(100, scores[k]));
  }
  const totalScore = Math.round(
    Object.values(scores).reduce((s, v) => s + v, 0) / Object.keys(scores).length
  );

  const grade = totalScore >= 90 ? "A" : totalScore >= 75 ? "B" : totalScore >= 60 ? "C" : totalScore >= 40 ? "D" : "F";

  return { score: totalScore, grade, issues, scores };
}

/**
 * 批量验证所有标的数据质量
 * @param {Array} stocks - 标的数组
 * @returns {{ summary: object, details: Array }}
 */
export function validateAllStocks(stocks) {
  if (!Array.isArray(stocks)) return { summary: { total: 0 }, details: [] };

  const details = stocks.map(stk => ({
    ticker: stk.ticker,
    name: stk.name,
    ...validateStockData(stk),
  }));

  const total = details.length;
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  details.forEach(d => { grades[d.grade] = (grades[d.grade] || 0) + 1; });
  const avgScore = total > 0 ? Math.round(details.reduce((s, d) => s + d.score, 0) / total) : 0;

  // 按维度汇总问题
  const dimSummary = {};
  for (const d of details) {
    for (const issue of d.issues) {
      if (!dimSummary[issue.dim]) dimSummary[issue.dim] = { count: 0, critical: 0, high: 0 };
      dimSummary[issue.dim].count++;
      if (issue.severity === "critical") dimSummary[issue.dim].critical++;
      if (issue.severity === "high") dimSummary[issue.dim].high++;
    }
  }

  return {
    summary: { total, avgScore, grades, dimSummary },
    details: details.sort((a, b) => a.score - b.score), // 质量最差的排前面
  };
}

// ─── 评分逻辑 (移植自 backend/factors.py) ──────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const deltas = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  const last = deltas.slice(-period);
  let avgGain = 0, avgLoss = 0;
  for (const d of last) { if (d > 0) avgGain += d; else avgLoss -= d; }
  avgGain /= period; avgLoss /= period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

function calcMomentum(closes, period = 20) {
  if (closes.length < period + 1) return 50;
  const base = closes[closes.length - 1 - period];
  if (!base || base === 0) return 50;
  const ret = (closes[closes.length - 1] / base - 1) * 100;
  return +Math.max(0, Math.min(100, 50 + ret * 2.5)).toFixed(1);
}

function calcStockScore({ pe, roe, revenueGrowth, profitMargin, momentum, rsi }) {
  // PE score
  let peS = 20;
  if (pe != null && pe >= 0) {
    if (pe < 15) peS = 95; else if (pe < 25) peS = 80;
    else if (pe < 40) peS = 60; else if (pe < 80) peS = 40; else peS = 20;
  }
  // ROE score
  let roeS = 30;
  if (roe != null) {
    if (roe > 30) roeS = 95; else if (roe > 20) roeS = 80;
    else if (roe > 10) roeS = 60; else if (roe > 0) roeS = 40; else roeS = 15;
  }
  // Margin score
  let mS = 30;
  if (profitMargin != null) {
    if (profitMargin > 30) mS = 95; else if (profitMargin > 15) mS = 75;
    else if (profitMargin > 5) mS = 55; else if (profitMargin > 0) mS = 35; else mS = 15;
  }
  const fundamental = (peS + roeS + mS) / 3;

  // Technical
  let rsiS = 35;
  if (rsi >= 40 && rsi <= 60) rsiS = 70; else if (rsi >= 30 && rsi <= 70) rsiS = 55;
  const technical = (momentum + rsiS) / 2;

  // Growth
  let growth = 40;
  if (revenueGrowth != null) {
    if (revenueGrowth > 50) growth = 95; else if (revenueGrowth > 25) growth = 80;
    else if (revenueGrowth > 10) growth = 65; else if (revenueGrowth > 0) growth = 45; else growth = 20;
  }

  const score = +(fundamental * 0.4 + technical * 0.3 + growth * 0.3).toFixed(1);
  return {
    score: Math.max(0, Math.min(100, score)),
    subScores: {
      fundamental: +fundamental.toFixed(1),
      technical: +technical.toFixed(1),
      growth: +growth.toFixed(1),
    },
  };
}

function calcETFScore({ momentum }) {
  const score = +(50 * 0.4 + momentum * 0.35 + 50 * 0.25).toFixed(1);
  return {
    score: Math.max(0, Math.min(100, score)),
    subScores: { cost: 50, liquidity: 50, momentum: +momentum.toFixed(1), risk: 50 },
  };
}

function fmtBig(n) {
  if (n == null) return null;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// ─── localStorage 持久化 ──────────────────────────────
export function loadStandaloneStocks() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveStandaloneStocks(stocks) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(stocks));
  } catch { /* full */ }
}

// ─── 检查是否为独立模式 (无后端) ──────────────────────
export async function checkStandaloneMode() {
  try {
    const res = await fetch("/api/status", { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return !data?.status; // has backend
  } catch {
    return true; // no backend = standalone mode
  }
}
