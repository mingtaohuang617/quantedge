// ─────────────────────────────────────────────────────────────
// yahoo — Yahoo Finance 代理调用共享 helper
// ─────────────────────────────────────────────────────────────
//
// 提取自 Screener10x.jsx 和 StockDetailPanel.jsx 的重复实现（PR #161）。
// quant-platform.jsx / standalone.js 因为有自己的缓存 + 兜底逻辑，仍各自处理；
// 本 lib 给点 ticker → 拉一次 chart 这类一次性短调用复用。
//
// 公共路径：所有调用走 `/api/yahoo?host=query1&path=...` 代理避开 CORS
// （production = Vercel serverless function, dev = vite proxy）。
//
// 不会做：
//   - 不缓存（调用方决定，参见 lib/priceCache.js）
//   - 不重试（Yahoo 偶发 429 重试无意义，直接 fallback）
// ─────────────────────────────────────────────────────────────

/**
 * 把 ticker 规范化成 Yahoo Finance 标准代码。
 *
 * 规则：
 *   - 5 位港股 .HK：去前导 0 + padStart(4) 还原；如 "00700.HK" → "0700.HK"
 *   - .SH 上交所 → .SS（Yahoo 用 .SS 表示 Shanghai）
 *   - 其他（美股 / .SZ / .BJ）原样返回
 *   - null / undefined / "" → null
 *
 * @param {string|null|undefined} ticker
 * @returns {string|null}
 */
export function tickerToYahoo(ticker) {
  if (!ticker) return null;
  if (ticker.endsWith(".HK")) {
    const num = ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0");
    return num + ".HK";
  }
  if (ticker.endsWith(".SH")) return ticker.replace(".SH", ".SS");
  // .SZ / .BJ / 美股纯 ticker 保留原样
  return ticker;
}

/**
 * 构造 Yahoo `/v8/finance/chart/` 代理 URL。
 *
 * @param {string} yfSym Yahoo 标准代码（来自 tickerToYahoo）
 * @param {string} interval 1d / 1wk / 1mo / 1m / 5m / 15m / 1h
 * @param {string} range 1d / 5d / 1mo / 3mo / 6mo / 1y / 5y / max
 * @returns {string} 完整 URL（同源代理）
 */
export function yahooChartUrl(yfSym, interval = "1d", range = "1d") {
  const path = `/v8/finance/chart/${encodeURIComponent(yfSym)}?interval=${interval}&range=${range}`;
  return `/api/yahoo?host=query1&path=${encodeURIComponent(path)}`;
}

/**
 * 拉 ticker 的 chart 数据。失败（网络 / 4xx / 5xx / timeout / 非法 ticker）一律返回 null。
 *
 * @param {string} ticker 原始 ticker（会自动转 Yahoo 代码）
 * @param {object} [opts]
 * @param {string} [opts.interval="1d"]
 * @param {string} [opts.range="1d"]
 * @param {number} [opts.timeoutMs=8000]
 * @returns {Promise<object|null>} chart.result[0] 或 null
 */
export async function fetchYahooChart(ticker, opts = {}) {
  const { interval = "1d", range = "1d", timeoutMs = 8000 } = opts;
  const yfSym = tickerToYahoo(ticker);
  if (!yfSym) return null;
  const url = yahooChartUrl(yfSym, interval, range);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.chart?.result?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * 拉单 ticker 的当前价（regularMarketPrice）。失败返回 null。
 * 内部走 fetchYahooChart range=1d interval=1d，取 meta.regularMarketPrice。
 *
 * @param {string} ticker
 * @returns {Promise<number|null>}
 */
export async function fetchCurrentPrice(ticker) {
  const result = await fetchYahooChart(ticker, { interval: "1d", range: "1d" });
  const px = result?.meta?.regularMarketPrice;
  return typeof px === "number" ? px : null;
}

/**
 * 拉 ticker 的收盘价数组（用于 sparkline）。失败返回 null。
 *
 * @param {string} ticker
 * @param {string} [range="1mo"] 想要的时间范围
 * @returns {Promise<number[]|null>}
 */
export async function fetchPriceHistory(ticker, range = "1mo") {
  const result = await fetchYahooChart(ticker, { interval: "1d", range });
  const closes = result?.indicators?.quote?.[0]?.close;
  return Array.isArray(closes) ? closes : null;
}
