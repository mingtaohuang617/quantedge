import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from "react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, PieChart, Pie, Cell, Legend, ComposedChart, ReferenceLine, ReferenceArea } from "recharts";
import { TrendingUp, TrendingDown, Search, Bell, BookOpen, BarChart3, Activity, Settings, ChevronRight, ChevronDown, ChevronLeft, Star, AlertTriangle, Clock, Target, Zap, Filter, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Plus, X, Check, Eye, EyeOff, Layers, Globe, Briefcase, Info, Database, Trash2, Loader, ExternalLink, Sun, Moon, Calendar, User, LogOut, Mail, Lock, Shield, KeyRound, UserCircle, Share2, GripVertical, Maximize2 } from "lucide-react";
import { searchTickers as standaloneSearch, fetchStockData, fetchBenchmarkPrices, fetchRangePrices, validateStockData, validateAllStocks, loadStandaloneStocks, saveStandaloneStocks, checkStandaloneMode, resolveSector, STOCK_CN_NAMES, STOCK_CN_DESCS } from "./src/standalone.js";
import { LangProvider, useLang } from "./src/i18n.jsx";
import { monteCarlo as mcSimulate, navToReturns as mcNavToReturns, hhi as hhiCalc, effectiveN as effN } from "./src/math/stats.ts";

let STATIC_STOCKS = [];
let STATIC_ALERTS = [];
try {
  const mod = await import("./src/data.js");
  STATIC_STOCKS = mod.STOCKS || [];
  STATIC_ALERTS = mod.ALERTS || [];
} catch { /* data.js not available in standalone build */ }

// Mutable references — updated by DataProvider on API load
let STOCKS = [...STATIC_STOCKS];
let ALERTS = [...STATIC_ALERTS];

// ─── API helpers ──────────────────────────────────────
const API_BASE = "/api";
const apiFetch = async (path, opts = {}) => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    return await res.json();
  } catch (e) {
    console.warn("API unavailable:", e.message);
    return null;
  }
};

// ─── localStorage 缓存工具 ──────────────────────────────
const CACHE_KEY = "quantedge_data";
const CACHE_PRICES_PREFIX = "quantedge_price_";
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return cached;
  } catch { return null; }
}

function saveCache(stocks, alerts, lastRefresh) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      stocks, alerts, lastRefresh,
      timestamp: Date.now(),
    }));
  } catch { /* localStorage full — ignore */ }
}

function isCacheStale(cached) {
  if (!cached || !cached.timestamp) return true;
  return Date.now() - cached.timestamp > CACHE_MAX_AGE;
}

function formatCacheAge(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Yahoo Finance 前端直接刷新价格（绕过后端，用于快速更新） ──
// 多代理链式降级（与 standalone.js 保持一致；Vercel 自建代理优先）
const _YF_PROXIES = [
  { build: (u) => {
    const url = new URL(u);
    const host = url.hostname.includes("query2") ? "query2" : "query1";
    return `/api/yahoo?host=${host}&path=${encodeURIComponent(url.pathname + url.search)}`;
  }, parse: (t) => JSON.parse(t) },
  { build: (u) => "https://corsproxy.io/?" + encodeURIComponent(u), parse: (t) => JSON.parse(t) },
  { build: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u), parse: (t) => JSON.parse(t) },
  { build: (u) => "https://api.allorigins.win/get?url=" + encodeURIComponent(u), parse: (t) => { const j = JSON.parse(t); if (!j.contents) throw new Error("empty"); return JSON.parse(j.contents); } },
];
async function _fetchYahooChart(chartPath, timeout = 10000) {
  // 本地 vite proxy 优先
  try {
    const r = await fetch(`/yahoo-api${chartPath}`, { signal: AbortSignal.timeout(Math.min(timeout, 5000)) });
    if (r.ok) return await r.json();
  } catch {}
  const fullUrl = `https://query1.finance.yahoo.com${chartPath}`;
  let lastErr;
  for (const p of _YF_PROXIES) {
    try {
      const r = await fetch(p.build(fullUrl), { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return p.parse(await r.text());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all proxies failed");
}
async function fetchYahooPrices(tickers) {
  const results = {};

  // Batch: fetch in parallel, max 6 concurrent
  const chunks = [];
  for (let i = 0; i < tickers.length; i += 6) chunks.push(tickers.slice(i, i + 6));

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (ticker) => {
      // Determine Yahoo symbol: HK stocks need 4-digit format
      let yfSym = ticker;
      if (ticker.endsWith(".HK")) {
        const num = ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0");
        yfSym = num + ".HK";
      }
      const chartPath = `/v8/finance/chart/${yfSym}?interval=1d&range=1d`;
      try {
        const parsed = await _fetchYahooChart(chartPath, 10000);
        const meta = parsed?.chart?.result?.[0]?.meta;
        if (meta && meta.regularMarketPrice != null) {
          const mktPrice = meta.regularMarketPrice;
          const prevCl = meta.previousClose || meta.chartPreviousClose || 0;
          const chg = prevCl > 0 ? +((mktPrice - prevCl) / prevCl * 100).toFixed(2) : 0;
          results[ticker] = {
            price: +(mktPrice.toFixed(2)),
            prevClose: prevCl > 0 ? +(prevCl.toFixed(2)) : null,
            change: isFinite(chg) ? chg : 0,
            high52w: meta.fiftyTwoWeekHigh,
            low52w: meta.fiftyTwoWeekLow,
            volume: meta.regularMarketVolume,
            currency: meta.currency,
            timestamp: Date.now(),
          };
        }
      } catch { /* skip failed ticker */ }
    }));
  }
  return results;
}

// ─── Global Data Context ──────────────────────────────
const DataContext = createContext(null);
const useData = () => useContext(DataContext);

function DataProvider({ children }) {
  // 1. 先尝试从 localStorage 读取缓存（即时显示）
  const cached = loadCache();
  const standaloneStocks = loadStandaloneStocks();
  // 合并 cache、standalone、STATIC 三方数据（取并集，确保 data.js 的标的不会丢失）
  const initialStocks = (() => {
    const cacheStocks = cached?.stocks?.length > 0 ? cached.stocks : [];
    const standStocks = standaloneStocks.length > 0 ? standaloneStocks : [];
    if (cacheStocks.length === 0 && standStocks.length === 0) return STATIC_STOCKS;
    // 以数量最多的为基底，合并其他来源
    const sources = [cacheStocks, standStocks, STATIC_STOCKS].sort((a, b) => b.length - a.length);
    const base = [...sources[0]];
    const baseTickers = new Set(base.map(s => s.ticker));
    for (let i = 1; i < sources.length; i++) {
      for (const s of sources[i]) {
        if (!baseTickers.has(s.ticker)) { base.push(s); baseTickers.add(s.ticker); }
      }
    }
    base.sort((a, b) => (b.score || 0) - (a.score || 0));
    base.forEach((s, i) => { s.rank = i + 1; });
    return base;
  })();
  const [stocks, setStocks] = useState(initialStocks);
  const [alerts, setAlerts] = useState(cached?.alerts || STATIC_ALERTS);
  const [apiOnline, setApiOnline] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(cached?.lastRefresh || "");
  const [priceUpdatedAt, setPriceUpdatedAt] = useState(cached?.timestamp || 0);
  const [priceRefreshing, setPriceRefreshing] = useState(false);

  // 2. 检测模式 + 加载数据
  useEffect(() => {
    (async () => {
      const isStandalone = await checkStandaloneMode();
      setStandalone(isStandalone);

      if (!isStandalone) {
        // ── 有后端：从 API 加载，然后合并 standalone 额外数据 ──
        const data = await apiFetch("/data");
        if (data && data.stocks && data.stocks.length > 0) {
          // 合并后端数据和 standalone 中额外的标的
          const apiTickers = new Set(data.stocks.map(s => s.ticker));
          const extraStandalone = standaloneStocks.filter(s => !apiTickers.has(s.ticker));
          const merged = extraStandalone.length > 0
            ? [...data.stocks, ...extraStandalone].sort((a, b) => b.score - a.score)
            : data.stocks;
          if (extraStandalone.length > 0) {
            merged.forEach((s, i) => { s.rank = i + 1; });
            console.log(`[QuantEdge] 合并 ${extraStandalone.length} 个 standalone 额外标的，总计 ${merged.length}`);
          }
          setStocks(merged);
          setAlerts(data.alerts || []);
          setLastRefresh(data.lastRefresh || "");
          setApiOnline(true);
          saveCache(merged, data.alerts, data.lastRefresh);
          saveStandaloneStocks(merged);
          setPriceUpdatedAt(Date.now());

          if (isCacheStale(cached)) {
            console.log("[QuantEdge] 缓存超过24小时，触发后端全量刷新...");
            const res = await apiFetch("/refresh", { method: "POST" });
            if (res?.success) setRefreshing(true);
          }
        }
      } else {
        // ── 独立模式：从 localStorage 加载 ──
        console.log("[QuantEdge] 独立模式 — 无后端，使用 localStorage");
        if (standaloneStocks.length > 0) {
          setPriceUpdatedAt(standaloneStocks[0]?._fetchedAt || Date.now());
        }
      }

      // ── 启动数据质量检查（使用已加载的数据，避免依赖异步更新的模块变量） ──
      const stocksForDQ = isStandalone ? (standaloneStocks.length > 0 ? standaloneStocks : STATIC_STOCKS) : STOCKS;
      setTimeout(() => {
        const currentStocks = stocksForDQ.length > 0 ? stocksForDQ : STOCKS;
        if (currentStocks.length > 0) {
          const dqReport = validateAllStocks(currentStocks);
          const { summary } = dqReport;
          const problemStocks = dqReport.details.filter(d => d.grade === "D" || d.grade === "F");
          console.log(`[DQ] 数据质量总览: ${summary.total}个标的, 平均分${summary.avgScore}, A:${summary.grades.A} B:${summary.grades.B} C:${summary.grades.C} D:${summary.grades.D} F:${summary.grades.F}`);
          if (problemStocks.length > 0) {
            console.warn(`[DQ] ${problemStocks.length}个标的数据质量较差:`, problemStocks.map(s => `${s.ticker}(${s.grade},${s.score}分)`));
          }
        }
      }, 2000);
    })();

    // Poll status every 5s while refreshing (only when backend exists)
    const interval = setInterval(async () => {
      if (standalone) return;
      const status = await apiFetch("/status");
      if (status) {
        setApiOnline(true);
        if (status.refreshing !== refreshing) setRefreshing(status.refreshing);
        if (!status.refreshing && refreshing) {
          const data = await apiFetch("/data");
          if (data?.stocks?.length > 0) {
            setStocks(data.stocks);
            setAlerts(data.alerts || []);
            setLastRefresh(data.lastRefresh || "");
            saveCache(data.stocks, data.alerts, data.lastRefresh);
            setPriceUpdatedAt(Date.now());
          }
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshing, standalone]);

  // 2.5 启动时修正行业分类（用映射表补全"未知"行业）
  useEffect(() => {
    setStocks(prev => {
      let changed = false;
      const next = prev.map(s => {
        if (s.sector && s.sector !== "未知" && s.sector !== "Technology") return s;
        const resolved = resolveSector(s.ticker, "", s.isETF);
        if (resolved !== s.sector) { changed = true; return { ...s, sector: resolved }; }
        return s;
      });
      if (changed) {
        console.log("[QuantEdge] 行业分类已修正");
        saveCache(next, alerts, lastRefresh);
        if (standalone) saveStandaloneStocks(next);
      }
      return changed ? next : prev;
    });
  }, []); // 只在首次加载运行

  // 3. 前端快速价格刷新（Yahoo Finance 直接调用）
  const quickPriceRefresh = useCallback(async () => {
    setPriceRefreshing(true);
    try {
      const tickers = stocks.map(s => s.ticker);
      const prices = await fetchYahooPrices(tickers);
      const updated = Object.keys(prices).length;
      if (updated > 0) {
        setStocks(prev => {
          const next = prev.map(s => {
            const p = prices[s.ticker];
            if (!p || p.price == null) return s;
            // 只用有效值更新，避免覆盖为 NaN/undefined
            const updatedChange = (p.change != null && isFinite(p.change)) ? p.change : s.change;
            return { ...s, price: p.price, change: updatedChange,
              week52High: p.high52w ?? s.week52High, week52Low: p.low52w ?? s.week52Low };
          });
          saveCache(next, alerts, lastRefresh);
          if (standalone) saveStandaloneStocks(next);
          return next;
        });
        setPriceUpdatedAt(Date.now());
        console.log(`[QuantEdge] 快速刷新: ${updated}/${tickers.length} 个标的`);
      }
    } catch (e) { console.warn("[QuantEdge] 快速刷新失败:", e); }
    setPriceRefreshing(false);
  }, [stocks, alerts, lastRefresh, standalone]);

  const refreshData = useCallback(async () => {
    if (standalone) {
      // 独立模式：先快速刷新价格，再逐个重新拉取完整数据（含历史价格）
      setRefreshing(true);
      await quickPriceRefresh();
      // 逐个重新获取完整数据（包含多时间范围价格）
      let updated = 0;
      for (const stk of stocks) {
        try {
          const freshData = await fetchStockData(stk.ticker);
          if (freshData) {
            setStocks(prev => {
              const next = prev.map(s => s.ticker === freshData.ticker ? { ...s, ...freshData, rank: s.rank } : s);
              saveStandaloneStocks(next);
              return next;
            });
            updated++;
          }
        } catch (e) {
          console.warn(`[QuantEdge] 刷新 ${stk.ticker} 失败:`, e.message);
        }
      }
      console.log(`[QuantEdge] 完整刷新: ${updated}/${stocks.length} 个标的`);
      setPriceUpdatedAt(Date.now());
      setRefreshing(false);
      return { success: true };
    }
    // 有后端：先快速刷新前端价格（立即可见），再触发后端全量刷新
    await quickPriceRefresh();
    const res = await apiFetch("/refresh", { method: "POST" });
    if (res?.success) setRefreshing(true);
    return res;
  }, [standalone, quickPriceRefresh, stocks]);

  // 添加标的：优先后端，独立模式用前端 Yahoo 直接拉
  const addTicker = useCallback(async (tickerData) => {
    if (!standalone) {
      const res = await apiFetch("/tickers", {
        method: "POST", body: JSON.stringify(tickerData),
      });
      if (res?.success && res.data) {
        setStocks(prev => {
          const filtered = prev.filter(s => s.ticker !== res.data.ticker);
          const updated = [...filtered, res.data].sort((a, b) => b.score - a.score);
          updated.forEach((s, i) => { s.rank = i + 1; });
          saveCache(updated, alerts, lastRefresh);
          return updated;
        });
      }
      return res;
    }

    // ── 独立模式：前端直接从 Yahoo Finance 获取 ──
    try {
      const data = await fetchStockData(tickerData.ticker);
      setStocks(prev => {
        const filtered = prev.filter(s => s.ticker !== data.ticker);
        const updated = [...filtered, data].sort((a, b) => b.score - a.score);
        updated.forEach((s, i) => { s.rank = i + 1; });
        saveStandaloneStocks(updated);
        saveCache(updated, [], "");
        return updated;
      });
      setPriceUpdatedAt(Date.now());
      return { success: true, data };
    } catch (e) {
      console.error("[QuantEdge] 独立模式添加失败:", e);
      return { success: false, message: e.message };
    }
  }, [standalone, alerts, lastRefresh]);

  const removeTicker = useCallback(async (tickerKey) => {
    if (!standalone) {
      const res = await apiFetch(`/tickers/${tickerKey}`, { method: "DELETE" });
      if (!res?.success) return res;
    }
    setStocks(prev => {
      const next = prev.filter(s => s.ticker !== tickerKey);
      saveCache(next, alerts, lastRefresh);
      if (standalone) saveStandaloneStocks(next);
      return next;
    });
    return { success: true };
  }, [standalone, alerts, lastRefresh]);

  // 批量添加标的（并行分块，跳过已有）
  const batchAddTickers = useCallback(async (tickers, concurrency = 4) => {
    const existing = new Set(stocks.map(s => s.ticker));
    const toAdd = tickers.filter(t => !existing.has(t));
    console.log(`[BatchAdd] 待添加 ${toAdd.length} 个（已存在 ${tickers.length - toAdd.length} 个，跳过）`);
    if (toAdd.length === 0) return;
    let done = 0, failed = 0;
    const newStocks = [];
    for (let i = 0; i < toAdd.length; i += concurrency) {
      const chunk = toAdd.slice(i, i + concurrency);
      const results = await Promise.allSettled(chunk.map(t => fetchStockData(t)));
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") { newStocks.push(r.value); done++; }
        else { failed++; console.warn(`[BatchAdd] ${chunk[idx]} 失败:`, r.reason?.message); }
      });
      console.log(`[BatchAdd] 进度 ${done + failed}/${toAdd.length}  成功${done} 失败${failed}`);
    }
    if (newStocks.length > 0) {
      setStocks(prev => {
        const existingTickers = new Set(prev.map(s => s.ticker));
        const deduped = newStocks.filter(s => !existingTickers.has(s.ticker));
        const merged = [...prev, ...deduped].sort((a, b) => b.score - a.score);
        merged.forEach((s, i) => { s.rank = i + 1; });
        saveStandaloneStocks(merged);
        saveCache(merged, [], "");
        return merged;
      });
      setPriceUpdatedAt(Date.now());
    }
    console.log(`[BatchAdd] 完成！成功 ${done}，失败 ${failed}`);
    return { done, failed };
  }, [stocks]);

  // 批量刷新所有标的（并发控制，更新缓存）
  const batchRefreshAll = useCallback(async (concurrency = 4) => {
    const tickers = stocks.map(s => s.ticker);
    console.log(`[BatchRefresh] 开始刷新 ${tickers.length} 个标的，并发 ${concurrency}`);
    let done = 0, failed = 0, failedList = [];
    for (let i = 0; i < tickers.length; i += concurrency) {
      const chunk = tickers.slice(i, i + concurrency);
      const results = await Promise.allSettled(chunk.map(t => fetchStockData(t)));
      const freshBatch = [];
      results.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value) { freshBatch.push(r.value); done++; }
        else { failed++; failedList.push(chunk[idx]); console.warn(`[BatchRefresh] ${chunk[idx]} 失败:`, r.reason?.message); }
      });
      if (freshBatch.length > 0) {
        setStocks(prev => {
          const next = [...prev];
          freshBatch.forEach(fresh => {
            const idx = next.findIndex(s => s.ticker === fresh.ticker);
            if (idx >= 0) next[idx] = { ...next[idx], ...fresh, rank: next[idx].rank };
          });
          saveStandaloneStocks(next);
          saveCache(next, [], "");
          return next;
        });
      }
      console.log(`[BatchRefresh] 进度 ${done + failed}/${tickers.length}  成功${done} 失败${failed}`);
    }
    setPriceUpdatedAt(Date.now());
    console.log(`[BatchRefresh] 完成！成功 ${done}，失败 ${failed}`, failedList.length ? '失败列表: ' + failedList.join(',') : '');
    return { done, failed, failedList };
  }, [stocks]);

  // 从 standalone localStorage 合并已有数据（无需重新抓取）
  const mergeStandaloneStocks = useCallback(() => {
    const saved = loadStandaloneStocks();
    if (!saved || saved.length === 0) return 0;
    let added = 0;
    setStocks(prev => {
      const existing = new Set(prev.map(s => s.ticker));
      const newOnes = saved.filter(s => !existing.has(s.ticker));
      if (newOnes.length === 0) return prev;
      added = newOnes.length;
      const merged = [...prev, ...newOnes].sort((a, b) => b.score - a.score);
      merged.forEach((s, i) => { s.rank = i + 1; });
      saveStandaloneStocks(merged);
      saveCache(merged, [], "");
      return merged;
    });
    return added;
  }, [alerts, lastRefresh]);

  // 暴露批量操作到 window（方便控制台调用）
  useEffect(() => { window.__batchAdd = batchAddTickers; window.__batchRefresh = batchRefreshAll; window.__mergeStandalone = mergeStandaloneStocks; }, [batchAddTickers, batchRefreshAll, mergeStandaloneStocks]);

  // Keep module-level refs in sync
  useEffect(() => { STOCKS = stocks; ALERTS = alerts; }, [stocks, alerts]);

  return (
    <DataContext.Provider value={{
      stocks, setStocks, alerts, apiOnline: apiOnline || standalone, refreshing, lastRefresh,
      refreshData, addTicker, removeTicker, batchAddTickers,
      priceUpdatedAt, priceRefreshing, quickPriceRefresh,
      standalone,
    }}>
      {children}
    </DataContext.Provider>
  );
}

// ─── Legacy data removed — see git history for _STOCKS_LEGACY / _ALERTS_LEGACY ───

const JOURNAL = [
  {
    id: 1, ticker: "RKLB", name: "Rocket Lab", anchorPrice: 56.00, anchorDate: "2026-04-01",
    currentPrice: 70.01,
    thesis: "Neutron火箭Q4首飞是关键催化剂。积压订单$1.85B同比+73%，SDA Tranche III $816M合同为公司史上最大。SpaceX IPO预计6月，太空板块整体受益。年营收$602M增长38%，但仍亏损，等待规模效应。",
    tags: ["航天", "国防", "SpaceX"], etf: "N/A", sector: "航天"
  },
  {
    id: 2, ticker: "SNDK", name: "Sandisk", anchorPrice: 600.00, anchorDate: "2026-04-01",
    currentPrice: 836.64,
    thesis: "NAND闪存超级周期，AI驱动企业级SSD需求爆发。Bernstein目标价$1,250，甚至看到$3,000的可能性。4/30财报是验证点。从WD分拆后独立运营，NAND价格上涨10%直接利好。",
    tags: ["存储", "NAND", "AI"], etf: "DRAM", sector: "存储"
  },
  {
    id: 3, ticker: "NVDA", name: "NVIDIA", anchorPrice: 165.00, anchorDate: "2026-03-29",
    currentPrice: 181.47,
    thesis: "AI算力需求持续扩大，但短期面临$175-185区间震荡。伊朗局势若缓和将是催化剂。头肩顶形态需关注，若跌破颈线有15%下行风险。5月底财报前定位期开始。PE 37已不算便宜。",
    tags: ["AI", "半导体", "数据中心"], etf: "SMH", sector: "半导体"
  },
  {
    id: 4, ticker: "00005.HK", name: "汇丰控股", anchorPrice: 120.00, anchorDate: "2026-03-22",
    currentPrice: 134.40,
    thesis: "高股息防御标的，股息率约6.5%。业务重组接近尾声，AI裁员降本。Morningstar公允值HK$149。风险在于全球利率下行压缩息差，以及中东局势对贸易融资的影响。",
    tags: ["银行", "高股息", "防御"], etf: "N/A", sector: "银行"
  }
];

const SECTOR_ETF_MAP = {
  "半导体": { etf: "SMH", name: "VanEck Semiconductor ETF" },
  "存储": { etf: "DRAM", name: "Roundhill Memory ETF" },
  "航天": { etf: "ARKX", name: "ARK Space Exploration ETF" },
  "银行": { etf: "XLF", name: "Financial Select SPDR" },
  "软件": { etf: "IGV", name: "iShares Software ETF" },
  "互联网": { etf: "FDN", name: "First Trust Dow Jones Internet" },
  "医疗": { etf: "XLV", name: "Health Care Select SPDR" },
  "消费": { etf: "XLP", name: "Consumer Staples Select SPDR" },
  "零售": { etf: "XRT", name: "SPDR S&P Retail ETF" },
  "能源": { etf: "XLE", name: "Energy Select SPDR" },
  "工业": { etf: "XLI", name: "Industrial Select SPDR" },
  "通信": { etf: "XLC", name: "Communication Services SPDR" },
  "科技": { etf: "XLK", name: "Technology Select SPDR" },
  "公用事业": { etf: "XLU", name: "Utilities Select SPDR" },
};
// 行业前缀匹配（"半导体/EDA" → 匹配 "半导体"）
const matchSectorETF = (sector) => {
  if (!sector) return null;
  if (SECTOR_ETF_MAP[sector]) return SECTOR_ETF_MAP[sector];
  const prefix = sector.split("/")[0];
  return SECTOR_ETF_MAP[prefix] || null;
};

// ─── Shared Constants ────────────────────────────────────
const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  backdropFilter: "blur(20px)",
  border: "0.5px solid var(--tooltip-border)",
  borderRadius: "10px",
  fontSize: "11px",
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: "tabular-nums",
  boxShadow: "var(--tooltip-shadow)",
  color: "var(--text-primary)",
  padding: "8px 12px",
};

const TAG_COLORS = {
  "航天": { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20" },
  "国防": { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20" },
  "AI": { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
  "半导体": { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  "存储": { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  "NAND": { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  "数据中心": { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
  "银行": { bg: "bg-emerald-500/10", text: "text-up", border: "border-emerald-500/20" },
  "高股息": { bg: "bg-emerald-500/10", text: "text-up", border: "border-emerald-500/20" },
  "防御": { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/20" },
  "SpaceX": { bg: "bg-fuchsia-500/10", text: "text-fuchsia-400", border: "border-fuchsia-500/20" },
};

// ─── 安全格式化涨跌幅（防止 NaN/undefined 显示异常） ─────────
const safeChange = (v) => {
  if (v == null || !isFinite(v)) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
};
const fmtChange = (v) => {
  const n = safeChange(v);
  return n.toFixed(2);
};

// ─── 港股显示名称（优先 中文名/英文名），非港股保持 ticker ─────────
// 用于"近期财报、实时监控、投资日志"三处：港股以名称示人，更易识别。
const displayTicker = (ticker, stock, lang) => {
  if (!ticker || !ticker.endsWith(".HK")) return ticker;
  const name = lang === 'zh'
    ? (stock?.nameCN || STOCK_CN_NAMES[ticker] || stock?.name)
    : (stock?.name || STOCK_CN_NAMES[ticker]);
  return name || ticker;
};

// ─── Auth Context ────────────────────────────────────────
const AUTH_KEY = "quantedge_auth";

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveAuth(user) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(user)); } catch {}
}

function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch {}
}

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadAuth());

  const login = useCallback((userData) => {
    setUser(userData);
    saveAuth(userData);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearAuth();
  }, []);

  const updateProfile = useCallback((updates) => {
    setUser(prev => {
      const next = { ...prev, ...updates };
      saveAuth(next);
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── AuthPage（邀请码登录） ───────────────────────────────
const INVITE_CODE = "MintoInvest";

const AuthPage = () => {
  const { login } = useAuth();
  const { t } = useLang();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!code.trim()) return setError(t("请输入邀请码"));

    if (code.trim() !== INVITE_CODE) {
      setError(t("邀请码无效，请检查后重试"));
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    setLoading(true);
    await new Promise(r => setTimeout(r, 600));

    login({
      id: "u_" + Date.now(),
      name: "Investor",
      email: "user@quantedge.pro",
      avatar: null,
      plan: "pro",
      joinedAt: new Date().toISOString(),
    });
    setLoading(false);
  };

  return (
    <div className="w-full h-screen flex items-center justify-center overflow-hidden relative" style={{ background: "var(--bg-gradient)", fontFamily: "'DM Sans', 'Noto Sans SC', sans-serif" }}>
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/[0.07] rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-violet-500/[0.05] rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/[0.03] rounded-full blur-[150px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/30 mb-4">
            <Briefcase size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">QuantEdge</h1>
          <p className="text-sm text-[#a0aec0] mt-1">{t('综合量化投资平台')}</p>
        </div>

        {/* 卡片 */}
        <div className={`glass-card p-6 ${shake ? "animate-shake" : ""}`}>
          <div className="text-center mb-5">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 mb-3">
              <KeyRound size={18} className="text-indigo-400" />
            </div>
            <h2 className="text-sm font-semibold text-white">{t('输入邀请码')}</h2>
            <p className="text-[11px] text-[#778] mt-1">{t('本平台为内测阶段，需凭邀请码访问')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="relative">
                <Shield size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#667]" />
                <input
                  type="text" value={code} onChange={e => { setCode(e.target.value); setError(""); }}
                  placeholder={t("请输入邀请码")}
                  autoFocus autoCorrect="off" autoCapitalize="none" spellCheck={false}
                  className="w-full bg-white/5 border border-white/8 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-[#556] outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 focus:shadow-[0_0_20px_rgba(99,102,241,0.15)] transition-all font-mono tracking-wider text-center"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-down/10 border border-down/20 text-down text-xs">
                <AlertTriangle size={12} className="shrink-0" />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 shadow-lg shadow-indigo-500/25 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <><Loader size={14} className="animate-spin" /> {t('验证中...')}</> : <><Lock size={14} /> {t('进入平台')}</>}
            </button>
          </form>
        </div>

        {/* 底部信息 */}
        <div className="text-center mt-6 text-[10px] text-[#556]">
          <span>© 2024–2026 QuantEdge · </span>
          <button type="button" className="text-[#778] hover:text-[#a0aec0] transition-colors">{t('隐私政策')}</button>
          <span> · </span>
          <button type="button" className="text-[#778] hover:text-[#a0aec0] transition-colors">{t('服务条款')}</button>
        </div>
      </div>
    </div>
  );
};

// ─── UserProfilePanel（用户信息面板） ─────────────────────
const ToggleSwitch = ({ checked, onChange }) => (
  <button onClick={onChange} className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-indigo-500" : "bg-white/10"}`}>
    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "left-[18px]" : "left-0.5"}`} />
  </button>
);

const UserProfilePanel = ({ open, onClose, theme, toggleTheme }) => {
  const { user, logout, updateProfile } = useAuth();
  const { stocks, apiOnline, priceUpdatedAt } = useData();
  const { t, lang, setLang } = useLang();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  if (!open || !user) return null;

  const handleSaveName = () => {
    if (editName.trim()) updateProfile({ name: editName.trim() });
    setEditing(false);
  };

  const memberDays = Math.max(1, Math.floor((Date.now() - new Date(user.joinedAt).getTime()) / 86400000));

  // 真实统计数据
  const journalCount = (() => { try { const j = localStorage.getItem("quantedge_journal"); return j ? JSON.parse(j).length : 0; } catch { return 0; } })();
  const cacheSize = (() => {
    let total = 0;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith("quantedge")) total += (localStorage.getItem(k) || "").length; } } catch {}
    return total > 1048576 ? (total / 1048576).toFixed(1) + " MB" : (total / 1024).toFixed(0) + " KB";
  })();

  const handleClearCache = () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    const authBak = localStorage.getItem(AUTH_KEY);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith("quantedge") && k !== AUTH_KEY) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
    if (authBak) localStorage.setItem(AUTH_KEY, authBak);
    setClearConfirm(false);
    setExportMsg(lang === 'en' ? "Cache cleared. Refresh to apply." : "缓存已清除，刷新后生效");
    setTimeout(() => setExportMsg(""), 3000);
  };

  const handleExport = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      user: { name: user.name, joinedAt: user.joinedAt },
      stocks: stocks.map(s => ({ ticker: s.ticker, name: s.name, market: s.market, score: s.score })),
      journal: (() => { try { return JSON.parse(localStorage.getItem("quantedge_journal")) || []; } catch { return []; } })(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `quantedge-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    setExportMsg(lang === 'en' ? "Data exported" : "数据已导出");
    setTimeout(() => setExportMsg(""), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-xs h-full bg-[#0f1019] border-l border-white/8 shadow-2xl flex flex-col animate-slide-in-right" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">{t('账户信息')}</h2>
          <button onClick={onClose} className="p-1 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all">
            <X size={16} />
          </button>
        </div>

        {/* 主体内容 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin", scrollbarColor: "#333 transparent" }}>
          {/* Avatar + Name */}
          <div className="flex flex-col items-center text-center pt-3 pb-1">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-lg font-bold shadow-lg shadow-indigo-500/20 mb-2.5">
              {(user.name || "U").charAt(0).toUpperCase()}
            </div>
            {editing ? (
              <div className="flex items-center gap-1.5 mb-1">
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditing(false); }}
                  className="bg-white/5 border border-indigo-500/30 rounded-md px-2 py-1 text-sm text-white outline-none focus:border-indigo-500/50 w-36 text-center" />
                <button onClick={handleSaveName} aria-label="保存名称" className="p-1 rounded text-up hover:bg-up/10"><Check size={14} /></button>
                <button onClick={() => setEditing(false)} aria-label="取消编辑" className="p-1 rounded text-[#778] hover:bg-white/10"><X size={14} /></button>
              </div>
            ) : (
              <button onClick={() => { setEditing(true); setEditName(user.name); }}
                className="text-sm font-semibold text-white hover:text-indigo-400 transition-colors flex items-center gap-1.5 group mb-0.5">
                {user.name}
                <svg className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </button>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Star size={8} /> Early Access
            </span>
          </div>

          {/* 实时统计 */}
          <div className="grid grid-cols-4 gap-1.5">
            {[
              [`${memberDays}`, t("天")],
              [`${stocks.length}`, t("标的")],
              [`${journalCount}`, t("日志")],
              [cacheSize, t("缓存")],
            ].map(([val, label]) => (
              <div key={label} className="text-center py-2 rounded-lg bg-white/[0.03] border border-white/5">
                <div className="text-xs font-bold font-mono tabular-nums text-white leading-tight">{val}</div>
                <div className="text-[8px] text-[#667] mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* 偏好设置 — 可操作 */}
          <div className="space-y-0.5">
            <div className="text-[9px] uppercase tracking-wider text-[#556] font-medium px-1 pb-1">{t('偏好设置')}</div>

            {/* 主题切换 */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-all">
              <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center text-[#a0aec0]">
                {theme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white">{t('深色模式')}</div>
              </div>
              <ToggleSwitch checked={theme === "dark"} onChange={toggleTheme} />
            </div>

            {/* 语言 / Language */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-all">
              <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center text-[#a0aec0]">
                <Globe size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white">{t('语言')}</div>
              </div>
              <div className="flex items-center gap-0.5 bg-white/5 rounded-md border border-white/5 p-0.5">
                <button onClick={() => setLang('zh')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${lang === 'zh' ? 'bg-indigo-500 text-white shadow-sm' : 'text-[#a0aec0] hover:text-white'}`}>
                  中文
                </button>
                <button onClick={() => setLang('en')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${lang === 'en' ? 'bg-indigo-500 text-white shadow-sm' : 'text-[#a0aec0] hover:text-white'}`}>
                  EN
                </button>
              </div>
            </div>
          </div>

          {/* 数据源状态 */}
          <div className="space-y-0.5">
            <div className="text-[9px] uppercase tracking-wider text-[#556] font-medium px-1 pb-1">{t('数据源')}</div>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={13} className="text-[#a0aec0]" />
                  <span className="text-xs font-medium text-white">Yahoo Finance</span>
                </div>
                <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${apiOnline ? "bg-up/10 text-up border border-up/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? "bg-up" : "bg-amber-400"}`} />
                  {apiOnline ? t("在线") : t("离线")}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#667]">{t('最近更新')}</span>
                <span className="text-[#a0aec0] font-mono tabular-nums">
                  {priceUpdatedAt ? new Date(priceUpdatedAt).toLocaleString(lang === 'en' ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#667]">{lang === 'en' ? 'Mode' : '模式'}</span>
                <span className="text-[#a0aec0]">{apiOnline ? t("API 直连") : t("独立模式 · 本地缓存")}</span>
              </div>
            </div>
          </div>

          {/* 数据管理 */}
          <div className="space-y-0.5">
            <div className="text-[9px] uppercase tracking-wider text-[#556] font-medium px-1 pb-1">{t('数据管理')}</div>
            <div className="space-y-1.5">
              <button onClick={handleExport} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-white/5 transition-all group">
                <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center text-[#a0aec0] group-hover:text-indigo-400 transition-colors">
                  <ExternalLink size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white">{t('导出数据')}</div>
                  <div className="text-[10px] text-[#667]">{t('标的列表 + 投资日志 → JSON')}</div>
                </div>
              </button>
              <button onClick={handleClearCache} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-white/5 transition-all group">
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${clearConfirm ? "bg-down/10 border-down/20 text-down" : "bg-white/[0.03] border-white/5 text-[#a0aec0] group-hover:text-amber-400"}`}>
                  <Trash2 size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-medium ${clearConfirm ? "text-down" : "text-white"}`}>
                    {clearConfirm ? t("确认清除？再次点击执行") : t("清除缓存")}
                  </div>
                  <div className="text-[10px] text-[#667]">{t('清除本地缓存数据')} ({cacheSize})</div>
                </div>
              </button>
            </div>
            {exportMsg && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-up/10 border border-up/20 text-up text-[10px] mt-1.5">
                <Check size={11} /> {exportMsg}
              </div>
            )}
          </div>

          {/* 关于 */}
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 space-y-1.5 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-[#667]">{t('版本')}</span>
              <span className="text-[#a0aec0] font-mono">v0.6.0</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#667]">{t('许可')}</span>
              <span className="text-[#a0aec0]">{t('Early Access · 邀请制')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#667]">{t('联系')}</span>
              <span className="text-indigo-400">support@quantedge.pro</span>
            </div>
          </div>
        </div>

        {/* 重新查看引导 */}
        <div className="px-4 py-3 border-t border-white/5">
          <button
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("quantedge:showOnboarding")); }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-500/10 text-indigo-300 text-xs font-medium border border-indigo-400/20 hover:bg-indigo-500/20 transition-all active:scale-[0.98]"
          >
            <BookOpen size={13} />
            {t('查看新手引导')}
          </button>
        </div>

        {/* 退出登录 */}
        <div className="px-4 py-3 border-t border-white/5">
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-down/10 text-down text-xs font-medium border border-down/20 hover:bg-down/20 transition-all active:scale-[0.98]">
            <LogOut size={13} />
            {t('退出登录')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Components ───────────────────────────────────────────
const Badge = ({ children, variant = "default", size = "md", dot = false }) => {
  const s = {
    default: "bg-white/5 text-[#a0aec0] border border-white/8",
    success: "bg-up/10 text-up border border-up/20",
    danger: "bg-down/10 text-down border border-down/20",
    warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    info: "bg-sky-500/10 text-sky-400 border border-sky-500/20",
    accent: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
    violet: "bg-violet-500/10 text-violet-400 border border-violet-500/20",
    cyan: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
  };
  const sz = size === "sm" ? "px-1.5 py-px text-[9px]" : size === "lg" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1 rounded font-medium ${sz} ${s[variant]}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
};

// 多标的对比模态框
const COMPARE_COLORS = ["#6366f1", "#06b6d4", "#f59e0b", "#ec4899"];
const CompareModal = ({ open, onClose, stocks }) => {
  const { t, lang } = useLang();
  const [overlay, setOverlay] = useState(true);
  if (!open || !stocks || stocks.length === 0) return null;
  // 统一 6 维度（个股）
  const axes = [
    { key: "pe", label: t("PE估值"), fn: s => s.pe && s.pe > 0 ? Math.max(0, 100 - s.pe * 0.8) : 20 },
    { key: "roe", label: "ROE", fn: s => s.roe ? Math.min(100, Math.max(0, s.roe * 0.8)) : 10 },
    { key: "mom", label: t("动量"), fn: s => s.momentum ?? 0 },
    { key: "rsi", label: "RSI", fn: s => s.rsi ?? 0 },
    { key: "rev", label: t("营收增长"), fn: s => s.revenueGrowth ? Math.min(100, s.revenueGrowth * 0.6) : 0 },
    { key: "mar", label: t("利润率"), fn: s => s.profitMargin ? Math.min(100, Math.max(0, s.profitMargin * 1.5)) : 0 },
  ];
  const radarData = axes.map(a => {
    const row = { factor: a.label };
    stocks.forEach(s => { row[s.ticker] = +a.fn(s).toFixed(1); });
    return row;
  });

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[90vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-cyan-300" />
            <h2 className="text-sm font-semibold text-white">{t('标的对比')}</h2>
            <span className="text-[10px] text-[#a0aec0]">{stocks.length}</span>
          </div>
          <button onClick={onClose} className="text-[#a0aec0] hover:text-white transition-colors p-1 rounded hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* 雷达叠加 */}
          <div className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-[#a0aec0]">{t('因子雷达')}</span>
              <div className="flex items-center gap-3">
                {stocks.map((s, i) => (
                  <span key={s.ticker} className="flex items-center gap-1 text-[10px] font-mono text-white">
                    <span className="w-2 h-2 rounded-full" style={{ background: COMPARE_COLORS[i] }} />
                    {s.ticker}
                  </span>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="factor" tick={{ fill: "#9ca3af", fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                {stocks.map((s, i) => (
                  <Radar key={s.ticker} name={s.ticker} dataKey={s.ticker}
                    stroke={COMPARE_COLORS[i]} fill={COMPARE_COLORS[i]} fillOpacity={0.08} strokeWidth={1.8} />
                ))}
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          {/* KPI 表 */}
          <div className="glass-card p-3 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-[10px] text-[#a0aec0] border-b border-white/8">
                  <th className="py-2 pr-2 font-medium">{t('指标')}</th>
                  {stocks.map((s, i) => (
                    <th key={s.ticker} className="py-2 px-2 font-medium font-mono" style={{ color: COMPARE_COLORS[i] }}>{s.ticker}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {[
                  [t("名称"), s => lang === 'zh' ? (s.nameCN || STOCK_CN_NAMES[s.ticker] || s.name) : s.name, "font-sans text-[10px] text-[#a0aec0]"],
                  [t("现价"), s => `${s.currency === "HKD" ? "HK$" : "$"}${s.price}`, "text-white"],
                  [t("涨跌"), s => `${safeChange(s.change) >= 0 ? "+" : ""}${fmtChange(s.change)}%`, s => safeChange(s.change) >= 0 ? "text-up" : "text-down"],
                  [t("评分"), s => s.score?.toFixed(1), "text-indigo-300 font-semibold"],
                  ["PE", s => s.pe?.toFixed(1) ?? "—", "text-white"],
                  ["ROE", s => s.roe ? `${s.roe.toFixed(1)}%` : "—", "text-white"],
                  [t("动量"), s => s.momentum?.toFixed(0) ?? "—", "text-white"],
                  ["RSI", s => s.rsi?.toFixed(0) ?? "—", "text-white"],
                  [t("营收增长"), s => s.revenueGrowth ? `${s.revenueGrowth.toFixed(1)}%` : "—", "text-white"],
                  [t("利润率"), s => s.profitMargin ? `${s.profitMargin.toFixed(1)}%` : "—", "text-white"],
                ].map(([label, fn, klass]) => (
                  <tr key={label} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="py-1.5 pr-2 text-[#a0aec0]">{label}</td>
                    {stocks.map(s => {
                      const v = fn(s);
                      const c = typeof klass === "function" ? klass(s) : klass;
                      return <td key={s.ticker} className={`py-1.5 px-2 ${c}`}>{v}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// 文本匹配高亮 — 高亮搜索命中部分
const Highlight = ({ text, query }) => {
  if (!text) return null;
  const q = (query || "").trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/25 text-amber-200 rounded px-0.5 font-semibold">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
};

// 数字滚动动画 — 平滑过渡到新值
const CountUp = ({ value, duration = 600, decimals = 2, prefix = "", suffix = "", className = "" }) => {
  const [display, setDisplay] = useState(value ?? 0);
  const prevRef = useRef(value ?? 0);
  useEffect(() => {
    const from = prevRef.current;
    const to = value ?? 0;
    if (from === to || !Number.isFinite(to)) { setDisplay(to); prevRef.current = to; return; }
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{prefix}{Number(display).toFixed(decimals)}{suffix}</span>;
};

const ScoreBar = ({ score, max = 100 }) => {
  const s = score ?? 0;
  const pct = Math.min(100, Math.max(0, (s / max) * 100));
  const varName = s >= 80 ? "up" : s >= 60 ? "amber" : "down";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, var(--accent-${varName}-soft), var(--accent-${varName}))` }} />
      </div>
      <span className="text-xs font-mono tabular-nums w-8 text-right" style={{ color: `var(--accent-${varName})` }}>{s}</span>
    </div>
  );
};

const TAB_CFG = [
  { id: "scoring", label: "量化评分", icon: BarChart3 },
  { id: "backtest", label: "组合回测", icon: Activity },
  { id: "monitor", label: "实时监控", icon: Bell },
  { id: "journal", label: "投资日志", icon: BookOpen },
];

// ─── Scoring ──────────────────────────────────────────────
const SkeletonBlock = ({ className = "" }) => <div className={`skeleton ${className}`} />;

// 极简纯 SVG 迷你走势图（行内使用，性能优于 Recharts）
const MiniSparkline = ({ data, w = 56, h = 16 }) => {
  if (!data || data.length < 2) {
    return <span className="inline-block bg-white/[0.02] rounded shrink-0" style={{ width: w, height: h }} />;
  }
  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 1;
  const lastUp = data[data.length - 1] >= data[0];
  const color = lastUp ? "#00E5A0" : "#FF6B6B";
  let pts = "";
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((data[i] - min) / range) * (h - 2) - 1;
    pts += (i ? " " : "") + x.toFixed(1) + "," + y.toFixed(1);
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" points={pts} opacity="0.85" />
    </svg>
  );
};

// 提取 5D 走势数据（用于 MiniSparkline）
const get5DSparkData = (stk) => {
  const candidates = stk.priceRanges?.["5D"];
  let pts;
  if (Array.isArray(candidates) && candidates.length >= 2) {
    pts = candidates;
  } else if (Array.isArray(stk.priceHistory) && stk.priceHistory.length >= 2) {
    pts = stk.priceHistory.slice(-7);
  } else {
    return [];
  }
  return pts.map(d => d.p).filter(p => p != null && p !== 0 && Number.isFinite(p));
};

// 可靠的尺寸测量 hook — 用 callback ref，元素挂载时立即触发测量+ResizeObserver
const useContainerSize = () => {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observerRef = useRef(null);
  const measureCallback = useCallback((node) => {
    // cleanup previous observer
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setSize(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
    };
    measure();
    requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    observerRef.current = ro;
  }, []);
  return [measureCallback, size];
};

const ScoringDashboard = () => {
  const { t, lang } = useLang();
  const [sel, setSel] = useState(null);
  const [mkt, setMkt] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL"); // ALL | STOCK | ETF | LEV
  const [mktOpen, setMktOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const filterRef = useRef(null);
  useEffect(() => {
    if (!mktOpen && !typeOpen) return;
    const onDown = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) { setMktOpen(false); setTypeOpen(false); } };
    const onKey = (e) => { if (e.key === 'Escape') { setMktOpen(false); setTypeOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [mktOpen, typeOpen]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("score"); // score | change | name
  const [weights, setWeights] = useState({ fundamental: 40, technical: 30, growth: 30 });
  const [showW, setShowW] = useState(false);
  const [chartRange, setChartRange] = useState("YTD"); // 1D|5D|1M|6M|YTD|1Y|5Y|ALL
  const [loading, setLoading] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false); // mobile: toggle list vs detail
  // 关注列表 — 持久化到 localStorage
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('quantedge_favorites') || '[]')); } catch { return new Set(); }
  });
  const [showFavOnly, setShowFavOnly] = useState(false);
  const toggleFav = useCallback((ticker) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      try { localStorage.setItem('quantedge_favorites', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  // 视图模式 — 列表 / 板块聚合
  const [viewMode, setViewMode] = useState("list"); // "list" | "sector"
  // 卡片密度 — 标准 / 紧凑
  const [density, setDensity] = useState(() => localStorage.getItem("quantedge_density") || "standard"); // "standard" | "compact"
  useEffect(() => { localStorage.setItem("quantedge_density", density); }, [density]);
  // 详情面板左列卡片顺序 — 支持拖拽排序
  const DEFAULT_CARD_ORDER = ['radar', 'range52w', 'scoreBreakdown'];
  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("quantedge_card_order") || 'null');
      if (Array.isArray(saved) && saved.length === DEFAULT_CARD_ORDER.length && DEFAULT_CARD_ORDER.every(k => saved.includes(k))) return saved;
    } catch {}
    return DEFAULT_CARD_ORDER;
  });
  useEffect(() => { try { localStorage.setItem("quantedge_card_order", JSON.stringify(cardOrder)); } catch {} }, [cardOrder]);
  const [draggingCard, setDraggingCard] = useState(null);
  const handleCardDrop = useCallback((targetKey) => {
    setCardOrder(prev => {
      if (!draggingCard || draggingCard === targetKey) return prev;
      const next = prev.filter(k => k !== draggingCard);
      const targetIdx = next.indexOf(targetKey);
      next.splice(targetIdx, 0, draggingCard);
      return next;
    });
    setDraggingCard(null);
  }, [draggingCard]);
  const resetCardOrder = useCallback(() => setCardOrder(DEFAULT_CARD_ORDER), []);
  // 对比列表 — Set<ticker>，最多 4 只
  const [compareSet, setCompareSet] = useState(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const toggleCompare = useCallback((ticker) => {
    setCompareSet(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else if (next.size < 4) next.add(ticker);
      return next;
    });
  }, []);
  // Quick-add state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddQuery, setQuickAddQuery] = useState("");
  const [quickAddResults, setQuickAddResults] = useState([]);
  const [quickAddSearching, setQuickAddSearching] = useState(false);
  const [quickAdding, setQuickAdding] = useState(null); // ticker key being added
  const [earningsExpanded, setEarningsExpanded] = useState(false);
  // 图表基准叠加 + 全屏
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState([]);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  // 市场指数 (SPX / NDX / HSI / VIX)
  const [indices, setIndices] = useState([]); // [{ sym, close, pct }]
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [indicesTime, setIndicesTime] = useState(null);
  const fetchIndices = useCallback(async () => {
    setIndicesLoading(true);
    const defs = [
      { sym: "SPX", yf: "^GSPC" },
      { sym: "NDX", yf: "^NDX" },
      { sym: "HSI", yf: "^HSI" },
      { sym: "VIX", yf: "^VIX" },
    ];
    try {
      const results = await Promise.allSettled(defs.map(d => fetchRangePrices(d.yf, "5D")));
      const next = defs.map((d, i) => {
        const r = results[i];
        if (r.status !== "fulfilled" || !r.value || r.value.length < 2) return { ...d, close: null, pct: null };
        const pts = r.value;
        const close = pts[pts.length - 1].p;
        const prev = pts[pts.length - 2].p;
        const pct = prev ? ((close - prev) / prev) * 100 : 0;
        return { ...d, close, pct: +pct.toFixed(2) };
      });
      setIndices(next);
      setIndicesTime(Date.now());
    } catch { /* 静默失败 */ }
    setIndicesLoading(false);
  }, []);
  useEffect(() => {
    fetchIndices();
    const iv = setInterval(fetchIndices, 60_000);
    return () => clearInterval(iv);
  }, [fetchIndices]);
  const { stocks: ctxStocks, setStocks: ctxSetStocks, addTicker, removeTicker, apiOnline, standalone } = useData() || {};
  // 使用 context 中的 stocks（响应式），而非模块级 STOCKS（可能过时）
  const liveStocks = ctxStocks || STOCKS;
  // 保持 sel 与 liveStocks 同步：初始化 + 数据更新时刷新 sel 对象
  useEffect(() => {
    if (!liveStocks || liveStocks.length === 0) return;
    if (!sel) {
      setSel(liveStocks[0]);
    } else {
      // 当 stocks 数据更新时（如 priceRanges 变化），用最新对象替换 sel
      const fresh = liveStocks.find(s => s.ticker === sel.ticker);
      if (fresh && fresh !== sel) setSel(fresh);
    }
  }, [liveStocks]);

  // 按需加载图表数据：选中股票或切换 chartRange 时，缺失对应维度则拉取
  useEffect(() => {
    if (!sel || !sel.ticker) return;
    const hasCurRange = sel.priceRanges && sel.priceRanges[chartRange] && sel.priceRanges[chartRange].length >= 2;
    if (hasCurRange) return;
    let cancelled = false;
    (async () => {
      try {
        let yfSym = sel.ticker;
        if (sel.ticker.endsWith(".HK")) {
          yfSym = sel.ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK";
        }
        // 首次加载（完全无数据）→ 并行拉常用 4 档；否则仅拉当前缺的维度
        const hasAny = sel.priceRanges && Object.keys(sel.priceRanges).length > 0;
        const toFetch = hasAny ? [chartRange] : ["1M", "6M", "YTD", "1Y", chartRange];
        // 去重（首次加载可能已含 chartRange）
        const uniq = [...new Set(toFetch)];
        const results = await Promise.allSettled(uniq.map(r => fetchRangePrices(yfSym, r)));
        if (cancelled) return;
        const ranges = {};
        uniq.forEach((r, i) => {
          if (results[i].status === "fulfilled" && results[i].value?.length) ranges[r] = results[i].value;
        });
        if (Object.keys(ranges).length === 0) return;
        // 更新 sel 和 liveStocks 中对应的股票（priceHistory 始终保 1Y 作为降级兜底）
        const nextHistory = ranges["1Y"] || sel.priceHistory;
        if (ctxSetStocks) {
          ctxSetStocks(prev => prev.map(s => s.ticker === sel.ticker ? { ...s, priceRanges: { ...(s.priceRanges || {}), ...ranges }, priceHistory: nextHistory } : s));
        }
        setSel(s => s && s.ticker === sel.ticker ? { ...s, priceRanges: { ...(s.priceRanges || {}), ...ranges }, priceHistory: nextHistory } : s);
        // 触发 resize 强制 Recharts ResponsiveContainer 重新测量尺寸
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
          });
        });
      } catch { /* 静默失败 */ }
    })();
    return () => { cancelled = true; };
  }, [sel?.ticker, chartRange]);

  // Right-click context menu
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, ticker, name }
  const ctxMenuRef = useCallback(node => { /* ref only for positioning */ }, []);
  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e) => {
      // Don't close if clicking inside the context menu itself
      const menu = document.getElementById("ctx-menu");
      if (menu && menu.contains(e.target)) return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);
  useEffect(() => { setCtxMenu(null); }, [sel?.ticker]);

  // 外部触发选中（命令面板）
  useEffect(() => {
    const handler = (e) => {
      const want = e.detail?.ticker;
      if (!want) return;
      const stk = liveStocks.find(s => s.ticker === want);
      if (stk) { setSel(stk); setMobileShowDetail(true); }
    };
    window.addEventListener("quantedge:selectStock", handler);
    return () => window.removeEventListener("quantedge:selectStock", handler);
  }, [liveStocks]);
  const handleContextMenu = (e, stk) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, ticker: stk.ticker, name: stk.name });
  };
  const handleDeleteTicker = async () => {
    if (!ctxMenu) return;
    const key = ctxMenu.ticker;
    const name = ctxMenu.name;
    setCtxMenu(null);
    if (removeTicker) {
      const res = await removeTicker(key);
      if (res?.success) {
        // If we deleted the currently selected stock, switch to first available
        if (sel?.ticker === key) {
          setTimeout(() => { if (liveStocks.length > 0) setSel(liveStocks[0]); }, 50);
        }
      }
    }
  };

  // Skeleton on ticker change
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 180);
    return () => clearTimeout(t);
  }, [sel?.ticker]);

  // 根据选择的时间维度获取图表数据（含收益率百分比）
  const chartData = useMemo(() => {
    if (!sel) return [];
    // 优先使用 priceRanges 中对应维度的数据；若为空数组（新上市标的等）则降级到 priceHistory
    const candidate = sel.priceRanges?.[chartRange];
    const rawAll = (Array.isArray(candidate) && candidate.length > 0)
      ? candidate
      : (sel.priceHistory || []);
    // Filter out null/0 prices (sanitized NaN values)
    const raw = rawAll.filter(d => d.p != null && d.p !== 0);
    if (raw.length === 0) return [];
    const basePrice = raw[0].p;
    return raw.map(d => ({
      ...d,
      pct: +((d.p - basePrice) / basePrice * 100).toFixed(2),
    }));
  }, [sel, chartRange]);

  // 区间收益率
  const periodReturn = useMemo(() => {
    if (chartData.length < 2) return null;
    return chartData[chartData.length - 1].pct;
  }, [chartData]);

  // ESC 键关闭图表全屏
  useEffect(() => {
    if (!chartFullscreen) return;
    const onKey = (e) => { if (e.key === "Escape") setChartFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartFullscreen]);

  // 基准指数数据加载（开启时拉取对应市场基准）
  useEffect(() => {
    if (!showBenchmark || !sel) { setBenchmarkData([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const benchSym = sel.market === "HK" ? "^HSI" : "^GSPC";
        const raw = await fetchRangePrices(benchSym, chartRange);
        if (cancelled || !raw || raw.length < 2) return;
        const base = raw[0].p;
        setBenchmarkData(raw.map(d => ({ m: d.m, bpct: +((d.p - base) / base * 100).toFixed(2) })));
      } catch { /* 静默失败 */ }
    })();
    return () => { cancelled = true; };
  }, [showBenchmark, sel?.ticker, sel?.market, chartRange]);

  // 合并基准到图表数据
  const chartDataWithBench = useMemo(() => {
    if (!showBenchmark || benchmarkData.length === 0) return chartData;
    const benchMap = new Map(benchmarkData.map(b => [b.m, b.bpct]));
    return chartData.map(d => ({ ...d, bpct: benchMap.get(d.m) ?? null }));
  }, [chartData, benchmarkData, showBenchmark]);

  // 自己测量图表容器尺寸，避免 ResponsiveContainer 在 StrictMode 下的初次挂载 bug
  const [chartContainerRef, chartSize] = useContainerSize();

  const benchmarkLabel = sel?.market === "HK" ? "HSI" : "SPX";

  const filtered = useMemo(() => {
    let list = liveStocks;
    // 市场筛选
    if (mkt !== "ALL") list = list.filter(s => s.market === mkt);
    // 类型筛选
    if (typeFilter === "STOCK") list = list.filter(s => !s.isETF);
    else if (typeFilter === "ETF") list = list.filter(s => s.isETF && !s.leverage);
    else if (typeFilter === "LEV") list = list.filter(s => s.isETF && s.leverage);
    // 关注列表筛选
    if (showFavOnly) list = list.filter(s => favorites.has(s.ticker));
    // 搜索
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(s =>
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (STOCK_CN_NAMES[s.ticker] && STOCK_CN_NAMES[s.ticker].includes(q)) ||
        (s.sector && s.sector.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q))
      );
    }
    // 排序
    if (sortBy === "score") return [...list].sort((a, b) => b.score - a.score);
    if (sortBy === "change") return [...list].sort((a, b) => b.change - a.change);
    if (sortBy === "name") return [...list].sort((a, b) => a.ticker.localeCompare(b.ticker));
    return [...list].sort((a, b) => b.score - a.score);
  }, [liveStocks, mkt, typeFilter, searchTerm, sortBy, showFavOnly, favorites]);

  // 板块聚合 — 基于 filtered 结果
  const sectorGroups = useMemo(() => {
    const groups = {};
    filtered.forEach(s => {
      const sec = s.sector || "其他";
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(s);
    });
    return Object.entries(groups).map(([name, stocks]) => ({
      name,
      stocks,
      count: stocks.length,
      avgScore: stocks.reduce((a, s) => a + (s.score || 0), 0) / stocks.length,
      avgChange: stocks.reduce((a, s) => a + safeChange(s.change), 0) / stocks.length,
      top: [...stocks].sort((a, b) => b.score - a.score).slice(0, 3),
    })).sort((a, b) => b.avgScore - a.avgScore);
  }, [filtered]);

  // 统计 — 根据市场筛选动态计算
  const counts = useMemo(() => {
    const base = mkt === "ALL" ? liveStocks : liveStocks.filter(s => s.market === mkt);
    return {
      all: base.length,
      stocks: base.filter(s => !s.isETF).length,
      etfs: base.filter(s => s.isETF && !s.leverage).length,
      lev: base.filter(s => s.isETF && s.leverage).length,
    };
  }, [liveStocks, mkt]);

  // 行业中位数 — 用于"vs 行业中位"对比
  const sectorMedians = useMemo(() => {
    if (!sel) return null;
    const median = (arr) => {
      const a = arr.filter(v => v != null && Number.isFinite(v)).sort((x, y) => x - y);
      if (a.length === 0) return null;
      const m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    const peers = liveStocks.filter(s => s.sector === sel.sector && s.isETF === sel.isETF && s.ticker !== sel.ticker);
    if (peers.length === 0) return null;
    if (sel.isETF) {
      return {
        cost: median(peers.map(s => s.subScores?.cost)),
        liquidity: median(peers.map(s => s.subScores?.liquidity)),
        momentum: median(peers.map(s => s.subScores?.momentum)),
        risk: median(peers.map(s => s.subScores?.risk)),
        peerCount: peers.length,
      };
    }
    return {
      fundamental: median(peers.map(s => s.subScores?.fundamental)),
      technical: median(peers.map(s => s.subScores?.technical)),
      growth: median(peers.map(s => s.subScores?.growth)),
      peerCount: peers.length,
    };
  }, [sel, liveStocks]);

  const radar = sel ? (sel.isETF ? [
    { factor: t("费率优势"), value: sel.expenseRatio <= 0.5 ? 90 : sel.expenseRatio <= 1 ? 70 : sel.expenseRatio <= 2 ? 40 : 20, fullMark: 100 },
    sel.leverage
      ? { factor: t("波动磨损"), value: sel.decayRate == null ? 50 : sel.decayRate < 5 ? 90 : sel.decayRate < 15 ? 60 : sel.decayRate < 30 ? 35 : 15, fullMark: 100 }
      : { factor: t("折溢价"), value: Math.abs(sel.premiumDiscount || 0) < 1 ? 95 : Math.abs(sel.premiumDiscount || 0) < 5 ? 70 : Math.abs(sel.premiumDiscount || 0) < 10 ? 40 : 20, fullMark: 100 },
    { factor: t("规模(AUM)"), value: parseFloat(sel.aum) > 1000 ? 90 : parseFloat(sel.aum) > 100 ? 60 : 30, fullMark: 100 },
    { factor: t("动量"), value: sel.momentum, fullMark: 100 },
    { factor: t("流动性"), value: sel.adv && sel.adv !== "N/A" ? 70 : 40, fullMark: 100 },
    { factor: t("集中度风险"), value: sel.concentrationTop3 > 70 ? 25 : sel.concentrationTop3 > 50 ? 50 : 80, fullMark: 100 },
  ] : [
    { factor: t("PE估值"), value: sel.pe && sel.pe > 0 ? Math.max(0, 100 - sel.pe * 0.8) : 20, fullMark: 100 },
    { factor: "ROE", value: sel.roe ? Math.min(100, Math.max(0, sel.roe * 0.8)) : 10, fullMark: 100 },
    { factor: t("动量"), value: sel.momentum, fullMark: 100 },
    { factor: "RSI", value: sel.rsi, fullMark: 100 },
    { factor: t("营收增长"), value: sel.revenueGrowth ? Math.min(100, sel.revenueGrowth * 0.6) : 0, fullMark: 100 },
    { factor: t("利润率"), value: sel.profitMargin ? Math.min(100, Math.max(0, sel.profitMargin * 1.5)) : 0, fullMark: 100 },
  ]) : [];

  // Quick-add search
  const quickAddSearch = useCallback(async (q) => {
    if (!q.trim()) { setQuickAddResults([]); return; }
    setQuickAddSearching(true);
    try {
      const existing = new Set(liveStocks.map(s => s.ticker));
      if (standalone) {
        // 独立模式：前端直接搜索 Yahoo Finance
        const results = await standaloneSearch(q.trim());
        setQuickAddResults(results.map(r => ({
          ...r,
          alreadyAdded: existing.has(r.symbol),
        })).slice(0, 6));
      } else {
        const res = await apiFetch(`/search?q=${encodeURIComponent(q.trim())}`);
        if (res?.results) {
          setQuickAddResults(res.results.map(r => ({
            ...r,
            alreadyAdded: r.alreadyAdded || existing.has(r.symbol),
          })).slice(0, 6));
        }
      }
    } catch { setQuickAddResults([]); }
    setQuickAddSearching(false);
  }, [standalone, liveStocks]);

  // Debounced quick-add search
  useEffect(() => {
    if (!quickAddQuery.trim()) { setQuickAddResults([]); return; }
    const t = setTimeout(() => quickAddSearch(quickAddQuery), 400);
    return () => clearTimeout(t);
  }, [quickAddQuery, quickAddSearch]);

  const handleQuickAdd = async (result) => {
    setQuickAdding(result.symbol);
    try {
      // For HK stocks, ticker is 5-digit (00005.HK), yf_symbol is 4-digit (0005.HK)
      const sym = result.symbol;
      const isHK = sym.endsWith(".HK");
      const yfSym = isHK ? sym.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK" : sym;
      const tickerData = {
        ticker: sym,
        name: result.name,
        yf_symbol: yfSym,
        market: result.market || (isHK ? "HK" : "US"),
        sector: result.sector || "未知",
        currency: result.currency || (isHK ? "HKD" : "USD"),
        type: result.type || "stock",
      };
      const res = await addTicker(tickerData);
      if (res?.success) {
        setQuickAddQuery("");
        setQuickAddResults([]);
        setQuickAddOpen(false);
      }
    } catch {}
    setQuickAdding(null);
  };

  return (<div className="flex flex-col h-full min-h-0">
    {/* ── 市场指数条 ── */}
    <div className="hidden md:flex items-center gap-3 px-3 py-1.5 mb-2 glass-card text-[10px] flex-shrink-0 overflow-x-auto">
      <span className="flex items-center gap-1.5 text-[#a0aec0] shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" />
        <span className="font-medium">{t('市场开盘中')}</span>
      </span>
      <span className="text-white/10 shrink-0">|</span>
      {indices.length === 0 && indicesLoading ? (
        <span className="text-[#667] font-mono animate-pulse">{t('指数加载中…')}</span>
      ) : indices.map(idx => (
        <div key={idx.sym} className="flex items-center gap-1.5 shrink-0">
          <span className="text-[#a0aec0] font-medium">{idx.sym}</span>
          <span className="font-mono tabular-nums text-white">{idx.close != null ? idx.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</span>
          {idx.pct != null && (
            <span className={`font-mono tabular-nums ${idx.pct >= 0 ? 'text-up' : 'text-down'}`}>
              {idx.pct >= 0 ? '+' : ''}{idx.pct.toFixed(2)}%
            </span>
          )}
        </div>
      ))}
      <span className="ml-auto flex items-center gap-2 text-[9px] text-[#778] shrink-0">
        <Clock size={9} className="opacity-60" />
        {indicesTime ? new Date(indicesTime).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
        <button onClick={fetchIndices} disabled={indicesLoading} className="p-1 rounded hover:bg-white/10 active:scale-95 transition-all disabled:opacity-40" title={t('刷新')}>
          <RefreshCw size={10} className={`${indicesLoading ? 'animate-spin' : ''} text-[#a0aec0]`} />
        </button>
      </span>
    </div>
    <div className="flex-1 flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-4 min-h-0 overflow-auto md:overflow-hidden">
      {/* Right-click context menu */}
      {ctxMenu && (
        <div id="ctx-menu" className="fixed z-50 glass-card border border-white/15 shadow-2xl shadow-black/50 py-1 min-w-[160px] animate-slide-up" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="px-3 py-1.5 text-[10px] text-[#778] border-b border-white/8 truncate max-w-[200px]">{ctxMenu.ticker} · {ctxMenu.name}</div>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { setSel(liveStocks.find(s => s.ticker === ctxMenu.ticker) || sel); setCtxMenu(null); }}
            className="w-full text-left px-3 py-2 text-[11px] text-[#c8cdd3] hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors"
          >
            <Eye size={12} /> {t('查看详情')}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { toggleFav(ctxMenu.ticker); setCtxMenu(null); }}
            className="w-full text-left px-3 py-2 text-[11px] text-amber-300 hover:bg-amber-500/10 flex items-center gap-2 transition-colors"
          >
            <Star size={12} className={favorites.has(ctxMenu.ticker) ? "fill-amber-400" : ""} />
            {favorites.has(ctxMenu.ticker) ? t('移出关注') : t('加入关注')}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { toggleCompare(ctxMenu.ticker); setCtxMenu(null); }}
            disabled={!compareSet.has(ctxMenu.ticker) && compareSet.size >= 4}
            className="w-full text-left px-3 py-2 text-[11px] text-cyan-300 hover:bg-cyan-500/10 flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Layers size={12} />
            {compareSet.has(ctxMenu.ticker) ? t('移出对比') : (compareSet.size >= 4 ? t('对比已满(4)') : t('加入对比'))}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleDeleteTicker}
            className="w-full text-left px-3 py-2 text-[11px] text-down hover:bg-down/10 flex items-center gap-2 transition-colors"
          >
            <Trash2 size={12} /> {t('删除标的')}
          </button>
        </div>
      )}
      <div className={`md:col-span-5 flex flex-col gap-2 md:min-h-0 ${mobileShowDetail ? "hidden md:flex" : "flex"}`}>
        {/* 移动端置顶区：搜索 + 筛选 + 排序 一起粘在顶部 */}
        <div className="sticky top-0 z-10 flex flex-col gap-2 -mx-1 px-1 py-1 bg-[#0b0b14]/85 backdrop-blur-md md:static md:mx-0 md:p-0 md:bg-transparent md:backdrop-blur-none">
        {/* 搜索栏 + 新增标的 */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a0aec0]" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t("搜索标的 / 代码 / 板块...")}
              autoCorrect="off" autoCapitalize="none" spellCheck={false}
              className="w-full bg-white/5 border border-white/8 rounded-lg pl-8 pr-8 py-2 md:py-1.5 text-xs text-white placeholder-[#667] outline-none focus:border-indigo-500/50 focus:bg-white/[0.07] focus:ring-1 focus:ring-indigo-500/30 focus:shadow-[0_0_20px_rgba(99,102,241,0.15)] transition-all"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#778] hover:text-white transition-colors">
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => {
              setQuickAddOpen(true);
              // 滚动到底部的快速添加输入框，让用户能立刻看到搜索结果
              setTimeout(() => {
                const target = document.querySelector('[data-quickadd-panel]');
                target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 50);
            }}
            title={t("新增标的")}
            className="shrink-0 flex items-center gap-1 px-2.5 py-2 md:py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 hover:text-indigo-200 hover:shadow-[0_0_12px_rgba(99,102,241,0.2)] active:scale-95 transition-all"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">{t('新增')}</span>
          </button>
        </div>
        {/* 市场 + 类型 筛选 — 折叠下拉（仿 "持仓 ▼" 设计） */}
        <div className="flex items-center gap-1">
          <div ref={filterRef} className="flex items-center gap-1">
            {/* 市场下拉 */}
            <div className="relative shrink-0">
              <button
                onClick={() => { setMktOpen(v => !v); setTypeOpen(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all active:scale-95 ${
                  mkt !== "ALL" || mktOpen
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                    : "bg-white/5 text-[#a0aec0] border-white/8 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{mkt === "ALL" ? t("全部") : mkt === "US" ? t("美股") : t("港股")}</span>
                <ChevronDown size={10} className={`transition-transform ${mktOpen ? "rotate-180" : ""}`} />
              </button>
              {mktOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 glass-card p-1 min-w-[80px] animate-slide-up">
                  {[["ALL", t("全部")], ["US", t("美股")], ["HK", t("港股")]].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setMkt(key); setMktOpen(false); }}
                      className={`w-full text-left px-2 py-1.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                        mkt === key ? "bg-indigo-500/20 text-indigo-300" : "text-[#a0aec0] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 类型下拉 */}
            <div className="relative shrink-0">
              <button
                onClick={() => { setTypeOpen(v => !v); setMktOpen(false); }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all active:scale-95 ${
                  typeFilter !== "ALL" || typeOpen
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                    : "bg-white/5 text-[#a0aec0] border-white/8 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="tabular-nums">
                  {typeFilter === "ALL" ? `${t("全部")} ${counts.all}`
                    : typeFilter === "STOCK" ? `${t("个股")} ${counts.stocks}`
                    : typeFilter === "ETF" ? `ETF ${counts.etfs}`
                    : `${t("杠杆")} ${counts.lev}`}
                </span>
                <ChevronDown size={10} className={`transition-transform ${typeOpen ? "rotate-180" : ""}`} />
              </button>
              {typeOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 glass-card p-1 min-w-[100px] animate-slide-up">
                  {[
                    ["ALL", `${t("全部")} ${counts.all}`],
                    ["STOCK", `${t("个股")} ${counts.stocks}`],
                    ["ETF", `ETF ${counts.etfs}`],
                    ["LEV", `${t("杠杆")} ${counts.lev}`],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setTypeFilter(key); setTypeOpen(false); }}
                      className={`w-full text-left px-2 py-1.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap tabular-nums ${
                        typeFilter === key ? "bg-indigo-500/20 text-indigo-300" : "text-[#a0aec0] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowFavOnly(v => !v)}
            title={t("只看关注")}
            className={`ml-auto flex items-center gap-0.5 px-1.5 py-1 rounded-md text-[9px] font-medium transition-all active:scale-95 border shrink-0 ${showFavOnly ? "bg-amber-400/15 border-amber-400/40 text-amber-300" : "bg-white/5 border-white/8 text-[#a0aec0] hover:text-white hover:bg-white/10"}`}
          >
            <Star size={11} className={showFavOnly ? "fill-amber-400 text-amber-400" : ""} />
            {favorites.size > 0 && <span className="font-mono tabular-nums">{favorites.size}</span>}
          </button>
          <button
            onClick={() => setViewMode(v => v === "list" ? "sector" : "list")}
            title={viewMode === "list" ? t("切换到板块视图") : t("切换到列表视图")}
            className={`p-1 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all shrink-0 border ${viewMode === "sector" ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300" : "bg-white/5 border-white/8"}`}
          >
            <Layers size={12} />
          </button>
          <button
            onClick={() => setDensity(d => d === "standard" ? "compact" : "standard")}
            title={density === "standard" ? t("切换到紧凑") : t("切换到标准")}
            className={`p-1 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all shrink-0 border ${density === "compact" ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300" : "bg-white/5 border-white/8"}`}
          >
            {density === "standard" ? <Minus size={12} /> : <Filter size={12} />}
          </button>
          <button onClick={() => setShowW(!showW)} className="p-1 rounded-md bg-white/5 border border-white/8 text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all shrink-0">
            <Settings size={12} />
          </button>
        </div>
        {/* 对比条 — 有项时显示 */}
        {compareSet.size > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 animate-slide-up">
            <Layers size={12} className="text-cyan-300 shrink-0" />
            <span className="text-[10px] text-cyan-200 font-medium shrink-0">{t('对比')}</span>
            <div className="flex items-center gap-1 flex-1 overflow-x-auto">
              {[...compareSet].map(tk => (
                <span key={tk} className="text-[10px] font-mono text-white bg-white/10 rounded px-1.5 py-0.5 flex items-center gap-1 shrink-0">
                  {tk}
                  <span role="button" onClick={() => toggleCompare(tk)} className="text-cyan-300/70 hover:text-white cursor-pointer"><X size={10} /></span>
                </span>
              ))}
            </div>
            <button onClick={() => setShowCompare(true)} disabled={compareSet.size < 2} className="text-[10px] px-2 py-1 rounded bg-cyan-500 text-white font-medium hover:bg-cyan-400 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
              {t('查看')} ({compareSet.size})
            </button>
          </div>
        )}
        {/* 排序 + 结果统计 */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[#778] font-mono">{filtered.length} <span className="font-sans">{t('个标的')}</span></span>
          <div className="flex items-center gap-1">
            {[["score", t("评分")], ["change", t("涨跌")], ["name", t("代码")]].map(([key, label]) => (
              <button key={key} onClick={() => setSortBy(key)} className={`px-2 py-1 rounded text-[10px] transition-all active:scale-95 ${sortBy === key ? "text-indigo-400 bg-indigo-500/10" : "text-[#778] hover:text-[#a0aec0]"}`}>
                {label}{sortBy === key && (key === "name" ? " ↑" : " ↓")}
              </button>
            ))}
          </div>
        </div>
        </div>
        {showW && (
          <div className="glass-card p-3 space-y-3 animate-slide-up">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>{t('因子权重配置')}</div>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md ${
                (weights.fundamental + weights.technical + weights.growth) === 100
                  ? "bg-up/10 text-up border border-up/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              }`}>
                {t('合计')} {weights.fundamental + weights.technical + weights.growth}%
              </span>
            </div>
            {/* 策略预设 */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[9px] text-[#778] mr-1">{t('预设')}</span>
              {[
                [t('均衡'), { fundamental: 40, technical: 30, growth: 30 }],
                [t('价值'), { fundamental: 60, technical: 25, growth: 15 }],
                [t('成长'), { fundamental: 25, technical: 35, growth: 40 }],
                [t('动量'), { fundamental: 15, technical: 55, growth: 30 }],
              ].map(([label, preset]) => {
                const isActive = weights.fundamental === preset.fundamental && weights.technical === preset.technical && weights.growth === preset.growth;
                return (
                  <button key={label} onClick={() => setWeights(preset)} className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all active:scale-95 ${isActive ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'bg-white/5 text-[#a0aec0] border border-white/10 hover:bg-white/10'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            {[
              ["fundamental", t("基本面"), "#6366f1", t("PE⁻¹ + ROE + EPS质量")],
              ["technical", t("技术面"), "#06b6d4", t("RSI均值回归 + 动量 + β风险")],
              ["growth", t("成长性"), "#00E5A0", t("营收增速 + 利润率扩张")],
            ].map(([k, label, color, desc]) => {
              const v = weights[k];
              return (
                <div key={k} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-heading)" }}>{label}</span>
                      <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{desc}</span>
                    </div>
                    <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color }}>{v}%</span>
                  </div>
                  <div className="relative h-6 flex items-center group">
                    {/* Track background */}
                    <div className="absolute inset-x-0 h-1.5 rounded-full" style={{ background: "var(--bg-muted)" }} />
                    {/* Active fill */}
                    <div className="absolute left-0 h-1.5 rounded-full transition-all duration-150" style={{ width: `${v}%`, background: `linear-gradient(90deg, ${color}66, ${color})` }} />
                    {/* Tick marks */}
                    <div className="absolute inset-x-0 h-1.5 flex items-center pointer-events-none">
                      {[0, 25, 50, 75, 100].map(tick => (
                        <div key={tick} className="absolute w-px h-2.5" style={{ left: `${tick}%`, background: "var(--border-strong)", opacity: 0.3 }} />
                      ))}
                    </div>
                    {/* Range input */}
                    <input
                      type="range" min="0" max="100" value={v}
                      onChange={e => setWeights(p => ({ ...p, [k]: +e.target.value }))}
                      className="weight-slider absolute inset-0 w-full appearance-none bg-transparent cursor-pointer z-10"
                      style={{ "--slider-color": color }}
                    />
                  </div>
                </div>
              );
            })}
            {/* 确认应用按钮 */}
            <button
              onClick={() => {
                const tw = weights.fundamental + weights.technical + weights.growth;
                if (tw === 0) return;
                const wf = weights.fundamental / tw;
                const wt = weights.technical / tw;
                const wg = weights.growth / tw;
                if (ctxSetStocks) {
                  ctxSetStocks(prev => prev.map(s => {
                    if (!s.subScores) return s;
                    let newScore;
                    if (s.isETF) {
                      const vals = [s.subScores.cost, s.subScores.liquidity, s.subScores.momentum, s.subScores.risk].filter(v => v != null);
                      newScore = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : s.score;
                    } else {
                      const f = s.subScores.fundamental ?? 0;
                      const t = s.subScores.technical ?? 0;
                      const g = s.subScores.growth ?? 0;
                      newScore = Math.round((f * wf + t * wt + g * wg) * 10) / 10;
                    }
                    return newScore !== s.score ? { ...s, score: newScore } : s;
                  }));
                }
                setShowW(false);
              }}
              className="w-full py-2 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-indigo-500 to-violet-500 text-white flex items-center justify-center gap-1.5 shadow-glow-indigo btn-tactile mt-1"
            >
              <Zap size={12} /> {t('应用权重并重新评分')}
            </button>
          </div>
        )}
        <div className="space-y-0.5 pr-1 md:flex-1 md:overflow-auto">
          {/* List header — visible only in list view with results */}
          {viewMode === "list" && filtered.length > 0 && (
            density === "compact" ? (
              <div className="hidden md:flex items-center gap-2 px-2.5 py-1 text-[9px] uppercase tracking-wider text-[#667] sticky top-0 bg-[#0b0b14]/85 backdrop-blur-sm border-b border-white/5 z-[1]">
                <span className="w-4 text-center font-mono">#</span>
                <span className="font-mono shrink-0">{t('代码')}</span>
                <span className="flex-1 ml-1">{t('名称')}</span>
                <span className="shrink-0 w-14 text-center">5D</span>
                <span className="shrink-0">{t('评分')}</span>
                <span className="shrink-0 w-14 text-right">{t('涨跌')}</span>
                <span className="w-3" />
              </div>
            ) : (
              <div className="hidden md:flex items-center justify-between px-2.5 pt-1 pb-1 text-[9px] uppercase tracking-wider text-[#667] sticky top-0 bg-[#0b0b14]/85 backdrop-blur-sm border-b border-white/5 z-[1]">
                <span>{t('标的 · 名称')}</span>
                <span>5D · {t('评分 · 涨跌')}</span>
              </div>
            )
          )}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#778]">
              <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/8 flex items-center justify-center mb-3">
                <Search size={20} className="opacity-30" />
              </div>
              <span className="text-xs mb-1">{showFavOnly && favorites.size === 0 ? t('关注列表为空 — 点击列表中的 ⭐ 添加') : t('未找到匹配的标的')}</span>
              <button onClick={() => { setSearchTerm(""); setMkt("ALL"); setTypeFilter("ALL"); setShowFavOnly(false); }} className="text-[10px] text-indigo-400 mt-1 hover:underline px-3 py-1 rounded-md bg-indigo-500/5 border border-indigo-500/10 transition-all hover:bg-indigo-500/10">{t('清除筛选')}</button>
            </div>
          ) : viewMode === "sector" ? (
            <div className="space-y-1.5">
              {sectorGroups.map((g, i) => (
                <div key={g.name} className="glass-card p-2.5 animate-stagger" style={{ animationDelay: `${i * 0.03}s` }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Layers size={11} className="text-indigo-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-white truncate">{g.name}</span>
                      <span className="text-[9px] text-[#778] font-mono shrink-0">{g.count}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[9px] text-[#778]">{t('均分')}</span>
                      <span className="text-[11px] font-mono font-bold tabular-nums text-indigo-300">{g.avgScore.toFixed(1)}</span>
                      <span className={`text-[10px] font-mono tabular-nums ${g.avgChange >= 0 ? "text-up" : "text-down"}`}>
                        {g.avgChange >= 0 ? "+" : ""}{g.avgChange.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {g.top.map((stk, j) => (
                      <button key={stk.ticker} onClick={() => { setSel(stk); setMobileShowDetail(true); }}
                        className={`w-full flex items-center justify-between px-2 py-1 rounded-md transition-colors text-left ${sel?.ticker === stk.ticker ? "bg-indigo-500/20" : "hover:bg-white/5"}`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[9px] w-3 text-center text-[#667] font-mono">{j + 1}</span>
                          <span className="text-[11px] font-mono font-semibold text-white shrink-0">{stk.ticker}</span>
                          <span className="text-[9px] text-[#a0aec0] truncate">{lang === 'zh' ? (stk.nameCN || STOCK_CN_NAMES[stk.ticker] || stk.name) : stk.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <MiniSparkline data={get5DSparkData(stk)} w={40} h={12} />
                          <span className="text-[10px] font-mono tabular-nums text-indigo-300">{stk.score?.toFixed(1)}</span>
                          <span className={`text-[10px] font-mono tabular-nums ${safeChange(stk.change) >= 0 ? "text-up" : "text-down"}`}>
                            {safeChange(stk.change) >= 0 ? "+" : ""}{fmtChange(stk.change)}%
                          </span>
                        </div>
                      </button>
                    ))}
                    {g.count > 3 && (
                      <div className="text-[9px] text-[#667] text-center pt-0.5">+{g.count - 3} {t('更多')}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.map((stk, i) => (
            <button key={stk.ticker} onClick={() => { setSel(stk); setMobileShowDetail(true); }} onContextMenu={(e) => handleContextMenu(e, stk)} className={`w-full text-left px-2.5 ${density === "compact" ? "py-1" : "py-2.5 md:py-2"} rounded-lg transition-all duration-200 border animate-stagger active:scale-[0.98] group relative ${sel?.ticker === stk.ticker ? "bg-gradient-to-r from-indigo-500/35 via-indigo-500/15 to-transparent border-indigo-500/30 shadow-lg shadow-indigo-500/5" : "bg-white/[0.02] border-transparent hover:bg-white/[0.04] hover:border-white/10"}`} style={{ animationDelay: `${i * 0.03}s` }}>
              {density === "compact" ? (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] w-4 text-center text-[#667] font-mono shrink-0">{i + 1}</span>
                  <span className="font-semibold text-[11px] text-white shrink-0 font-mono"><Highlight text={stk.ticker} query={searchTerm} /></span>
                  <span className="text-[9px] text-[#a0aec0] truncate flex-1"><Highlight text={lang === 'zh' ? (stk.nameCN || STOCK_CN_NAMES[stk.ticker] || stk.name) : stk.name} query={searchTerm} /></span>
                  <MiniSparkline data={get5DSparkData(stk)} w={56} h={16} />
                  <span className="text-[10px] font-mono tabular-nums text-indigo-300 shrink-0">{stk.score?.toFixed(1)}</span>
                  <span className={`text-[10px] font-mono tabular-nums shrink-0 w-14 text-right ${safeChange(stk.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(stk.change) >= 0 ? "+" : ""}{fmtChange(stk.change)}%
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); toggleFav(stk.ticker); }}
                    className={`p-0.5 rounded shrink-0 transition-all ${favorites.has(stk.ticker) ? "text-amber-400" : "text-[#556] opacity-0 group-hover:opacity-100 hover:text-amber-300"}`}
                    title={favorites.has(stk.ticker) ? t("移出关注") : t("加入关注")}
                  >
                    <Star size={11} className={favorites.has(stk.ticker) ? "fill-amber-400" : ""} />
                  </span>
                </div>
              ) : (
              <>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`rank-badge ${i < 3 ? "rank-top" : "rank-mid"}`}>{i + 1}</span>
                  <span className="font-semibold text-xs text-white shrink-0"><Highlight text={stk.ticker} query={searchTerm} /></span>
                  <Badge variant={stk.market === "US" ? "info" : "warning"} size="sm">{stk.market}</Badge>
                  {stk.isETF && !stk.leverage && <Badge variant="accent" size="sm">ETF</Badge>}
                  {stk.isETF && stk.leverage && <Badge variant="danger" size="sm">{stk.leverage}</Badge>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-xs font-semibold font-mono tabular-nums ${safeChange(stk.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(stk.change) >= 0 ? "+" : ""}{fmtChange(stk.change)}%
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); toggleFav(stk.ticker); }}
                    className={`p-1 -m-1 rounded transition-all ${favorites.has(stk.ticker) ? "text-amber-400" : "text-[#556] opacity-0 group-hover:opacity-100 hover:text-amber-300"}`}
                    title={favorites.has(stk.ticker) ? t("移出关注") : t("加入关注")}
                  >
                    <Star size={12} className={favorites.has(stk.ticker) ? "fill-amber-400" : ""} />
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#b0b8c4] truncate flex-1 min-w-0"><Highlight text={lang === 'zh' ? (stk.nameCN || STOCK_CN_NAMES[stk.ticker] || stk.name) : stk.name} query={searchTerm} /></span>
                <MiniSparkline data={get5DSparkData(stk)} w={48} h={14} />
                <div className="w-20 shrink-0"><ScoreBar score={stk.score} /></div>
              </div>
              </>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={`md:col-span-7 md:min-h-0 md:overflow-auto pr-0 md:pr-1 ${mobileShowDetail ? "flex flex-col" : "hidden md:block"}`}>
        {/* Mobile back button */}
        <button onClick={() => setMobileShowDetail(false)} className="md:hidden flex items-center gap-1.5 text-xs text-indigo-400 mb-2 py-2 px-3 rounded-lg bg-indigo-500/[0.06] border border-indigo-500/15 w-fit active:scale-95 transition-all">
          <ChevronRight size={14} className="rotate-180" /> {t('返回列表')}
        </button>
        {sel && loading ? (
          <div className="flex flex-col gap-3 animate-slide-up">
            <div className="glass-card p-4">
              <div className="flex items-start justify-between mb-3">
                <div><SkeletonBlock className="h-5 w-32 mb-1.5" /><SkeletonBlock className="h-3 w-48" /></div>
                <div className="text-right"><SkeletonBlock className="h-7 w-24 mb-1" /><SkeletonBlock className="h-4 w-16 ml-auto" /></div>
              </div>
              <SkeletonBlock className="h-3 w-full mb-1" /><SkeletonBlock className="h-3 w-3/4 mb-3" />
              <SkeletonBlock className="h-36 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-card p-3"><SkeletonBlock className="h-3 w-24 mb-2" /><SkeletonBlock className="h-40 w-full" /></div>
              <div className="glass-card p-3"><SkeletonBlock className="h-3 w-24 mb-2" /><SkeletonBlock className="h-40 w-full" /></div>
            </div>
          </div>
        ) : sel && (
          <div className="flex flex-col gap-3">
            <div className="glass-card p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-2 gap-1">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">{sel.ticker}</h3>
                    <Badge variant="accent" size="sm">{sel.sector}</Badge>
                    {sel.isETF && <Badge variant={sel.leverage ? "danger" : "warning"} size="sm">{sel.etfType}</Badge>}
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md ${sel.score >= 80 ? "bg-up/10 text-up border border-up/20" : sel.score >= 60 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-down/10 text-down border border-down/20"}`}>
                      <CountUp value={sel.score} decimals={1} duration={500} />/100
                    </span>
                  </div>
                  <div className="text-xs text-[#a0aec0]">{lang === 'zh' ? (sel.nameCN || STOCK_CN_NAMES[sel.ticker] || sel.name) : sel.name}</div>
                </div>
                <div className="sm:text-right flex sm:block items-center gap-2">
                  <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white">
                    <CountUp value={parseFloat(sel.price) || 0} decimals={2} duration={600} prefix={sel.currency === "HKD" ? "HK$" : "$"} />
                  </div>
                  <div className={`text-sm font-bold tabular-nums ${safeChange(sel.change) >= 0 ? "text-up" : "text-down"}`}>
                    <span>{safeChange(sel.change) >= 0 ? "▲" : "▼"} </span>
                    <CountUp value={Math.abs(safeChange(sel.change))} decimals={2} duration={500} suffix="%" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#a0aec0] leading-relaxed mb-2 border-l-2 border-indigo-500/30 pl-2">{lang === 'zh' ? (STOCK_CN_DESCS[sel.ticker] || sel.descriptionCN || sel.description) : sel.description}</p>
              {/* 图表标题 */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <Activity size={11} className="text-indigo-400" />
                <span className="text-[11px] font-medium text-white/90">{t('价格走势')}</span>
                <span className="text-[10px] font-mono text-[#778]">— {sel.ticker}</span>
                {showBenchmark && <span className="text-[10px] font-mono text-[#94a3b8]">· {benchmarkLabel} {t('基准')}</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => setShowBenchmark(v => !v)} title={showBenchmark ? t('隐藏基准') : t('对比基准')} className={`px-1.5 py-0.5 rounded text-[9px] font-medium border transition-all active:scale-95 ${showBenchmark ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'bg-white/5 text-[#a0aec0] border-white/10 hover:bg-white/10'}`}>
                    {benchmarkLabel}
                  </button>
                  <button onClick={() => setChartFullscreen(true)} title={t('全屏')} className="p-1 rounded text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all active:scale-95">
                    <Maximize2 size={11} />
                  </button>
                </div>
              </div>
              {/* 时间维度选择器 */}
              <div className="flex items-center gap-0.5 mb-2 bg-white/5 rounded-lg p-0.5 border border-white/8 w-full md:w-fit overflow-x-auto">
                {["1D","5D","1M","6M","YTD","1Y","5Y","ALL"].map(r => {
                  const label = r === "1D" ? t("分时") : r === "5D" ? t("五日") : r === "1M" ? t("月") : r === "6M" ? t("6月") : r === "YTD" ? t("今年") : r === "1Y" ? t("1年") : r === "5Y" ? t("5年") : t("全部");
                  const hasData = sel.priceRanges && sel.priceRanges[r];
                  return (
                    <button key={r} onClick={() => setChartRange(r)}
                      className={`px-1.5 md:px-1.5 py-1 md:py-0.5 rounded text-[10px] font-medium transition-all flex-1 md:flex-none active:scale-95 ${chartRange === r ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                    >{label}{!hasData && r !== "6M" && chartRange !== r ? "" : ""}</button>
                  );
                })}
              </div>
              {/* 区间收益率标签 */}
              {periodReturn !== null && (
                <div className="flex items-center justify-end gap-1.5 mb-1">
                  <span className="text-[10px] text-[#778]">{t('区间收益')}</span>
                  <span className={`text-xs font-bold font-mono tabular-nums px-1.5 py-0.5 rounded ${safeChange(periodReturn) >= 0 ? "text-up bg-up/10" : "text-down bg-down/10"}`}>
                    {safeChange(periodReturn) >= 0 ? "+" : ""}{fmtChange(periodReturn)}%
                  </span>
                </div>
              )}
              <div ref={chartContainerRef} className="h-36 chart-glow relative">
                {chartData.length < 2 && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-lg bg-white/[0.02] border border-dashed border-white/10">
                    <Activity size={20} className="text-[#778] opacity-50" />
                    <span className="text-[10px] text-[#778]">{t('该周期暂无价格数据')}</span>
                    <span className="text-[9px] text-[#556]">{sel.priceHistory && sel.priceHistory.length > 0 ? t('请尝试其他时间维度') : t('数据加载中或不可用')}</span>
                  </div>
                )}
                {chartSize.w > 0 && chartSize.h > 0 && (
                <ComposedChart width={chartSize.w} height={chartSize.h} data={chartDataWithBench} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#8A2BE2" />
                        <stop offset="100%" stopColor="#4169E1" />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="m" tick={{ fontSize: 9, fill: "#667" }} axisLine={false} tickLine={false} minTickGap={28} />
                    <YAxis yAxisId="price" tick={{ fontSize: 10, fill: "#667" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={45} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 9, fill: "#778" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={52} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                    <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 3" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => {
                      if (name === "p") return [`${sel.currency === "HKD" ? "HK$" : "$"}${v}`, t("价格")];
                      if (name === "pct") return [`${v >= 0 ? "+" : ""}${v}%`, t("收益率")];
                      if (name === "bpct") return [`${v >= 0 ? "+" : ""}${v}%`, `${benchmarkLabel} ${t('基准')}`];
                      return [v, name];
                    }} />
                    <Area yAxisId="price" type="monotone" dataKey="p" stroke={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "url(#strokeGrad)" : "#FF6B6B"} strokeWidth={2} fill="url(#pg)" dot={false} activeDot={{ r: 4, fill: "#fff", stroke: "#8A2BE2", strokeWidth: 2, filter: "drop-shadow(0 0 4px rgba(138,43,226,0.6))" }} />
                    <Line yAxisId="pct" type="monotone" dataKey="pct" stroke="transparent" dot={false} activeDot={false} />
                    {showBenchmark && <Line yAxisId="pct" type="monotone" dataKey="bpct" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: "#cbd5e1", stroke: "#94a3b8", strokeWidth: 1.5 }} />}
                  </ComposedChart>
                )}
              </div>
            </div>

            {/* ── KPI 速览条（综合评分 + 关键因子） ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="glass-card p-2.5">
                <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">{t('综合评分')}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono tabular-nums text-white">{sel.score?.toFixed(1)}</span>
                  <span className="text-[10px] text-[#778] font-mono">/100</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${sel.score}%`, background: sel.score >= 80 ? "var(--accent-up)" : sel.score >= 60 ? "#f59e0b" : "var(--accent-down)" }} />
                </div>
              </div>
              {sel.isETF ? (
                <>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">{t('总费率')}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold font-mono tabular-nums text-white">{sel.expenseRatio ?? '—'}</span>
                      {sel.expenseRatio != null && <span className="text-[10px] text-[#778] font-mono">%</span>}
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.expenseRatio == null ? t('暂无') : sel.expenseRatio <= 0.5 ? t('低成本') : sel.expenseRatio <= 1 ? t('中等') : t('偏高')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">AUM</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold font-mono tabular-nums text-white truncate">{sel.aum || '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{t('资产规模')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">{t('动量')}</div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-lg font-bold font-mono tabular-nums ${sel.momentum >= 70 ? 'text-up' : sel.momentum >= 40 ? 'text-white' : 'text-down'}`}>{sel.momentum ?? '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.momentum == null ? t('暂无') : sel.momentum >= 70 ? t('强势') : sel.momentum >= 40 ? t('中性') : t('弱势')}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">P/E</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold font-mono tabular-nums text-white">{sel.pe != null && sel.pe > 0 ? sel.pe.toFixed(1) : '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.pe == null || sel.pe <= 0 ? t('暂无') : sel.pe < 15 ? t('低估') : sel.pe < 30 ? t('合理') : t('高估')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">ROE</div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-lg font-bold font-mono tabular-nums ${sel.roe != null && sel.roe >= 15 ? 'text-up' : 'text-white'}`}>{sel.roe != null ? sel.roe.toFixed(1) : '—'}</span>
                      {sel.roe != null && <span className="text-[10px] text-[#778] font-mono">%</span>}
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.roe == null ? t('暂无') : sel.roe >= 20 ? t('优秀') : sel.roe >= 10 ? t('良好') : t('一般')}</div>
                  </div>
                  <div className="glass-card p-2.5">
                    <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5">RSI(14)</div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-lg font-bold font-mono tabular-nums ${sel.rsi > 70 ? 'text-down' : sel.rsi < 30 ? 'text-up' : 'text-white'}`}>{sel.rsi ?? '—'}</span>
                    </div>
                    <div className="text-[9px] text-[#a0aec0] mt-1">{sel.rsi == null ? t('暂无') : sel.rsi > 70 ? t('超买') : sel.rsi < 30 ? t('超卖') : t('中性')}</div>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:flex-1 md:min-h-0">
              <div className="flex flex-col gap-3 md:overflow-auto md:min-h-0 pr-0 md:pr-1">
                {/* ── 多因子雷达图 ── */}
                <div
                  className={`glass-card p-3 relative group/drag cursor-move transition-all ${draggingCard === 'radar' ? 'opacity-40 scale-95' : ''}`}
                  style={{ order: cardOrder.indexOf('radar') }}
                  draggable
                  onDragStart={() => setDraggingCard('radar')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleCardDrop('radar')}
                  onDragEnd={() => setDraggingCard(null)}
                >
                  <div className="absolute top-2 right-2 opacity-0 group-hover/drag:opacity-60 transition-opacity pointer-events-none">
                    <GripVertical size={11} className="text-[#778]" />
                  </div>
                  <div className="section-header">
                    <Star size={11} className="text-indigo-400" />
                    <span className="section-title">{sel.isETF ? t("ETF 评估雷达") : t("多因子雷达")}</span>
                  </div>
                  <ResponsiveContainer key={`radar-${sel.ticker}`} width="100%" height={160}>
                    <RadarChart data={radar}>
                      <defs>
                        <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={sel.isETF ? "#f59e0b" : "#8A2BE2"} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={sel.isETF ? "#f59e0b" : "#4169E1"} stopOpacity={0.08} />
                        </radialGradient>
                      </defs>
                      <PolarGrid stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
                      <PolarAngleAxis dataKey="factor" tick={{ fontSize: 10, fill: "#9ca3af", fontWeight: 500 }} />
                      <Radar dataKey="value" stroke={sel.isETF ? "#f59e0b" : "#8A2BE2"} fill="url(#radarFill)" strokeWidth={2.5}
                        dot={{ r: 4, fill: "var(--radar-dot-fill)", stroke: sel.isETF ? "#f59e0b" : "#8A2BE2", strokeWidth: 2.5, filter: `drop-shadow(0 0 4px ${sel.isETF ? "rgba(245,158,11,0.6)" : "rgba(138,43,226,0.6)"})` }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* ── 52周价格区间 + 技术信号 ── */}
                <div
                  className={`glass-card p-3 relative group/drag cursor-move transition-all ${draggingCard === 'range52w' ? 'opacity-40 scale-95' : ''}`}
                  style={{ order: cardOrder.indexOf('range52w') }}
                  draggable
                  onDragStart={() => setDraggingCard('range52w')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleCardDrop('range52w')}
                  onDragEnd={() => setDraggingCard(null)}
                >
                  <div className="absolute top-2 right-2 opacity-0 group-hover/drag:opacity-60 transition-opacity pointer-events-none">
                    <GripVertical size={11} className="text-[#778]" />
                  </div>
                  <div className="section-header">
                    <TrendingUp size={11} className="text-indigo-400" />
                    <span className="section-title">{t('52周价格区间')}</span>
                  </div>
                  {sel.week52Low != null && sel.week52High != null && (() => {
                    const lo = sel.week52Low, hi = sel.week52High;
                    const range = hi - lo || 1;
                    const pct = Math.max(0, Math.min(100, ((sel.price - lo) / range) * 100));
                    const currSymbol = sel.currency === "HKD" ? "HK$" : "$";
                    return (
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-1.5">
                          <span className="text-down font-mono">{currSymbol}{lo}</span>
                          <span className="text-up font-mono">{currSymbol}{hi}</span>
                        </div>
                        <div className="relative w-full h-3 rounded-full overflow-visible">
                          {/* Background track with gradient */}
                          <div className="absolute inset-0 h-1.5 top-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-down/30 via-amber-500/30 to-up/30" />
                          {/* Tick marks at 0/25/50/75/100% */}
                          {[0, 25, 50, 75, 100].map(tick => (
                            <div key={tick} className="absolute top-0 h-full w-px bg-white/10" style={{ left: `${tick}%` }}>
                              <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] text-[#778]">{tick}</span>
                            </div>
                          ))}
                          {/* Floating pill slider for current price */}
                          <div className="absolute top-1/2 -translate-y-1/2 transition-all duration-300" style={{ left: `calc(${pct}% - 18px)` }}>
                            <div className="px-1.5 py-0.5 rounded-full bg-indigo-500 text-[9px] font-mono text-white font-medium shadow-md shadow-indigo-500/30 whitespace-nowrap">
                              {pct.toFixed(0)}%
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[10px] mt-4">
                          <span className="text-[#a0aec0]">{t('52周低')}</span>
                          <span className="font-mono text-white font-medium">{currSymbol}{sel.price}</span>
                          <span className="text-[#a0aec0]">{t('52周高')}</span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* 技术信号小标签 */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {sel.rsi != null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        sel.rsi > 70 ? "text-down bg-down/10 border-down/20" :
                        sel.rsi < 30 ? "text-up bg-up/10 border-up/20" :
                        "text-[#a0aec0] bg-white/5 border-white/10"
                      }`}>
                        <Activity size={9} />
                        RSI {sel.rsi} {sel.rsi > 70 ? t("超买") : sel.rsi < 30 ? t("超卖") : t("中性")}
                      </span>
                    )}
                    {sel.momentum != null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        sel.momentum >= 70 ? "text-up bg-up/10 border-up/20" :
                        sel.momentum <= 30 ? "text-down bg-down/10 border-down/20" :
                        "text-amber-400 bg-amber-500/10 border-amber-500/20"
                      }`}>
                        <TrendingUp size={9} />
                        {t('动量')} {sel.momentum}
                      </span>
                    )}
                    {sel.beta != null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        sel.beta > 1.5 ? "text-down bg-down/10 border-down/20" :
                        sel.beta < 0.8 ? "text-up bg-up/10 border-up/20" :
                        "text-[#a0aec0] bg-white/5 border-white/10"
                      }`}>
                        <Zap size={9} />
                        Beta {sel.beta}
                      </span>
                    )}
                    {sel.change != null && Math.abs(safeChange(sel.change)) > 3 && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        safeChange(sel.change) > 0 ? "text-up bg-up/10 border-up/20" : "text-down bg-down/10 border-down/20"
                      }`}>
                        {safeChange(sel.change) > 0 ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                        {t('日内')} {safeChange(sel.change) > 0 ? "+" : ""}{fmtChange(sel.change)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* ── 评分拆解 ── */}
                {sel.subScores && (
                  <div
                    className={`glass-card p-3 relative group/drag cursor-move transition-all ${draggingCard === 'scoreBreakdown' ? 'opacity-40 scale-95' : ''}`}
                    style={{ order: cardOrder.indexOf('scoreBreakdown') }}
                    draggable
                    onDragStart={() => setDraggingCard('scoreBreakdown')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleCardDrop('scoreBreakdown')}
                    onDragEnd={() => setDraggingCard(null)}
                  >
                    <div className="absolute top-2 right-2 opacity-0 group-hover/drag:opacity-60 transition-opacity pointer-events-none">
                      <GripVertical size={11} className="text-[#778]" />
                    </div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-medium text-[#a0aec0]">{t('评分归因')}</span>
                      <span className="text-xs font-mono font-bold text-white">{sel.score}<span className="text-[10px] text-[#a0aec0] font-normal">/100</span></span>
                    </div>
                    <div className="space-y-2.5">
                      {(sel.isETF ? [
                        [t("成本效率"), sel.subScores.cost, "indigo", sectorMedians?.cost,
                          [
                            sel.expenseRatio != null && [t('费率'), `${sel.expenseRatio}%`],
                          ].filter(Boolean)],
                        [t("流动性"), sel.subScores.liquidity, "violet", sectorMedians?.liquidity,
                          [
                            sel.aum && ['AUM', sel.aum],
                            sel.adv && [t('日均'), sel.adv],
                          ].filter(Boolean)],
                        [t("动量趋势"), sel.subScores.momentum, "cyan", sectorMedians?.momentum,
                          [
                            sel.momentum != null && [t('动量'), sel.momentum],
                          ].filter(Boolean)],
                        [t("风险分散"), sel.subScores.risk, "amber", sectorMedians?.risk,
                          [
                            sel.concentrationTop3 != null && ['Top3', `${sel.concentrationTop3}%`],
                          ].filter(Boolean)],
                      ] : [
                        [t("基本面"), sel.subScores.fundamental, "indigo", sectorMedians?.fundamental,
                          [
                            sel.pe != null && sel.pe > 0 && ['PE', sel.pe.toFixed(1)],
                            sel.roe != null && ['ROE', `${sel.roe.toFixed(1)}%`],
                          ].filter(Boolean)],
                        [t("技术面"), sel.subScores.technical, "cyan", sectorMedians?.technical,
                          [
                            sel.rsi != null && ['RSI', sel.rsi],
                            sel.beta != null && ['β', sel.beta],
                          ].filter(Boolean)],
                        [t("成长性"), sel.subScores.growth, "up", sectorMedians?.growth,
                          [
                            sel.revenueGrowth != null && [t('营收'), `${sel.revenueGrowth.toFixed(1)}%`],
                            sel.profitMargin != null && [t('利润率'), `${sel.profitMargin.toFixed(1)}%`],
                          ].filter(Boolean)],
                      ]).map(([label, value, colorKey, peerMed, subInds]) => {
                        const delta = peerMed != null && Number.isFinite(value) ? +(value - peerMed).toFixed(1) : null;
                        return (
                          <div key={label}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-[#a0aec0]">{label}</span>
                              <div className="flex items-center gap-1.5">
                                {delta != null && (
                                  <span className={`text-[9px] font-mono ${delta >= 0 ? 'text-up' : 'text-down'}`} title={t('vs 行业中位')}>
                                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-white">{value}</span>
                              </div>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden relative">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: `linear-gradient(90deg, var(--accent-${colorKey}-soft), var(--accent-${colorKey}))` }} />
                              {peerMed != null && (
                                <div className="absolute top-0 h-full w-px bg-white/40" style={{ left: `${peerMed}%` }} title={`${t('行业中位')} ${peerMed.toFixed(1)}`} />
                              )}
                            </div>
                            {subInds && subInds.length > 0 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {subInds.map(([k, v]) => (
                                  <span key={k} className="inline-flex items-center gap-0.5 text-[9px] text-[#778] bg-white/[0.03] border border-white/8 rounded px-1 py-0.5">
                                    <span className="text-[#556]">{k}</span>
                                    <span className="font-mono text-[#a0aec0]">{v}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {sectorMedians && (
                      <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[9px] text-[#778]">
                        <span>{t('vs 行业中位')}</span>
                        <span className="font-mono">{sel.sector} · {sectorMedians.peerCount} {t('对比')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="glass-card p-3 overflow-auto">
                {sel.isETF ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="section-header mb-0" style={{ marginBottom: 0, flex: 1 }}>
                        <Database size={11} className="text-indigo-400" />
                        <span className="section-title">{t('ETF 核心指标')}</span>
                      </div>
                      <Badge variant={sel.leverage ? "danger" : "accent"} size="sm">{sel.etfType}</Badge>
                    </div>
                    <div className="space-y-2">
                      {/* 成本与费用 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-1 mb-0.5">{t('成本与费用')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('总费率 (ER)')}</span>
                        <Badge variant={sel.expenseRatio <= 0.5 ? "success" : sel.expenseRatio <= 1 ? "warning" : "danger"}>{sel.expenseRatio}%</Badge>
                      </div>
                      {sel.leverage ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">{t('年化波动磨损')}</span>
                          <Badge variant={
                            sel.decayRate == null ? "info"
                              : sel.decayRate < 5 ? "success"
                              : sel.decayRate < 15 ? "warning"
                              : "danger"
                          }>
                            {sel.decayRate != null ? `≈ ${sel.decayRate}% / ${t("年")}` : t("数据不足")}
                          </Badge>
                        </div>
                      ) : sel.premiumDiscount != null ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">{t('折溢价率')}</span>
                          <Badge variant={Math.abs(sel.premiumDiscount) < 1 ? "success" : Math.abs(sel.premiumDiscount) < 5 ? "warning" : "danger"}>
                            {sel.premiumDiscount > 0 ? "+" : ""}{sel.premiumDiscount}% {sel.premiumDiscount > 0 ? t("溢价") : sel.premiumDiscount < 0 ? t("折价") : t("平价")}
                          </Badge>
                        </div>
                      ) : null}
                      {sel.nav && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">NAV ({sel.navDate})</span>
                          <Badge variant="info">HK${sel.nav}</Badge>
                        </div>
                      )}
                      {/* 跟踪效果 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">{t('跟踪效果')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('标的指数')}</span>
                        <span className="text-[10px] text-white max-w-[140px] text-right truncate">{sel.benchmark}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('跟踪误差')}</span>
                        <Badge variant={sel.trackingError === null ? "success" : "warning"}>{sel.trackingError || t("N/A (主动管理)")}</Badge>
                      </div>
                      {/* 流动性与规模 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">{t('流动性与规模')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">AUM</span>
                        <Badge variant="info">{sel.aum}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('日均成交')}</span>
                        <Badge variant="default">{sel.adv}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('买卖价差')}</span>
                        <Badge variant="default">{sel.bidAskSpread}</Badge>
                      </div>
                      {/* 定性信息 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">{t('定性信息')}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('基金管理人')}</span>
                        <span className="text-[10px] text-white">{sel.issuer}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('分红政策')}</span>
                        <Badge variant="default">{sel.dividendPolicy}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('成立日期')}</span>
                        <Badge variant="default">{sel.inceptionDate}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">{t('52周区间')}</span>
                        <Badge variant="info">{sel.currency === "HKD" ? "HK$" : "$"}{sel.week52Low} - {sel.week52High}</Badge>
                      </div>
                      {/* 持仓明细 */}
                      {sel.topHoldings && (
                        <>
                          <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">
                            {t('持仓分布')} ({sel.totalHoldings}{t('只')} · Top3{t('集中度')} {sel.concentrationTop3}%)
                          </div>
                          {sel.topHoldings.map((h, i) => (
                            <div key={i} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-white">{h.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-14 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                  <div className="h-full rounded-full bg-indigo-500/60" style={{ width: `${h.weight}%` }} />
                                </div>
                                <span className="text-[10px] font-mono text-[#a0aec0] w-10 text-right">{h.weight}%</span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="section-header">
                      <Database size={11} className="text-indigo-400" />
                      <span className="section-title">{t('核心指标 · 真实数据')}</span>
                    </div>
                    <div className="space-y-0">
                      {[
                        ["PE (TTM)", sel.pe ? Number(sel.pe).toFixed(1) : "N/A", sel.pe && sel.pe > 0 && sel.pe < 25 ? "success" : sel.pe && sel.pe > 0 && sel.pe < 50 ? "warning" : "danger"],
                        [t("52周区间"), `${sel.currency === "HKD" ? "HK$" : "$"}${sel.week52Low} – ${sel.week52High}`, "info"],
                        [t("营收增长"), sel.revenueGrowth ? `${sel.revenueGrowth}%` : "N/A", sel.revenueGrowth && sel.revenueGrowth > 20 ? "success" : sel.revenueGrowth && sel.revenueGrowth > 5 ? "warning" : "default"],
                        [t("利润率"), sel.profitMargin ? `${sel.profitMargin}%` : "N/A", sel.profitMargin && sel.profitMargin > 20 ? "success" : sel.profitMargin && sel.profitMargin > 0 ? "warning" : "danger"],
                        [t("年营收"), sel.revenue || "N/A", "info"],
                        [t("市值"), sel.marketCap, "info"],
                        ["EBITDA", sel.ebitda || "N/A", "info"],
                        ["EPS", sel.eps != null ? String(sel.eps) : "N/A", sel.eps != null && !String(sel.eps).startsWith("-") ? "success" : "danger"],
                        ["Beta", sel.beta || "N/A", "default"],
                        [t("下次财报"), sel.nextEarnings || "N/A", "accent"],
                      ].map(([l, v, vt]) => (
                        <div key={l} className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
                          <span className="text-[11px] text-[#a0aec0]">{l}</span>
                          <Badge variant={vt} size="sm">{v}</Badge>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    {/* 底部工具行：近期财报（可折叠） + 快速添加标的 */}
    {(() => {
      const upcoming = (liveStocks || [])
        .filter(s => s.nextEarnings && !isNaN(new Date(s.nextEarnings).getTime()) && new Date(s.nextEarnings) >= new Date())
        .sort((a, b) => new Date(a.nextEarnings) - new Date(b.nextEarnings))
        .slice(0, 5);
      const showEarnings = upcoming.length > 0;
      const showQuickAdd = apiOnline || standalone;
      if (!showEarnings && !showQuickAdd) return null;
      const today = new Date();
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 shrink-0 mt-1 items-start">
          {/* 近期财报（折叠式） */}
          {showEarnings && (
            <div className="relative">
              <button
                onClick={() => setEarningsExpanded(v => !v)}
                className={`w-full flex items-center justify-between gap-1.5 py-2 px-3 rounded-lg border text-[11px] transition-all group ${earningsExpanded ? "border-indigo-500/30 bg-indigo-500/[0.06] text-indigo-300" : "border-dashed border-white/10 text-[#a0aec0] hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5"}`}
              >
                <span className="flex items-center gap-1.5">
                  <Calendar size={12} className={earningsExpanded ? "text-indigo-400" : "text-[#778] group-hover:text-indigo-400 transition-colors"} />
                  <span>{t('近期财报')}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[#a0aec0]">{upcoming.length}</span>
                </span>
                <ChevronRight size={12} className={`transition-transform ${earningsExpanded ? "-rotate-90" : ""}`} />
              </button>
              {earningsExpanded && (
                <div className="absolute left-0 right-0 bottom-full mb-1 glass-card p-2.5 animate-slide-up z-10">
                  <div className="space-y-1">
                    {upcoming.map(s => {
                      const d = new Date(s.nextEarnings);
                      const days = Math.ceil((d - today) / 86400000);
                      const urgent = days <= 7;
                      const label = displayTicker(s.ticker, s, lang);
                      const isHK = s.ticker?.endsWith(".HK");
                      return (
                        <div key={s.ticker} className="flex items-center justify-between py-0.5 gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-[10px] font-semibold text-white truncate ${isHK ? "" : "font-mono"}`} title={s.ticker}>{label}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[9px] font-mono text-[#a0aec0]">{s.nextEarnings}</span>
                            <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${urgent ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "text-[#778]"}`}>
                              {days === 0 ? t("今天") : days === 1 ? t("明天") : `${days}${t("天")}`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* 快速添加标的 */}
          {showQuickAdd && (
            <div className={`relative ${!showEarnings ? "md:col-span-2" : ""}`}>
              {!quickAddOpen ? (
                <button
                  onClick={() => setQuickAddOpen(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-[#778] hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all group"
                >
                  <Plus size={13} className="group-hover:scale-110 transition-transform" />
                  <span>{t('快速添加标的')}</span>
                </button>
              ) : (
                <div data-quickadd-panel className="glass-card p-2 animate-slide-up space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#778]" />
                      <input
                        type="text"
                        autoFocus
                        value={quickAddQuery}
                        onChange={e => setQuickAddQuery(e.target.value)}
                        placeholder={t("输入代码或名称搜索...")}
                        autoCorrect="off" autoCapitalize="none" spellCheck={false}
                        className="w-full bg-white/5 border border-white/10 rounded-md pl-7 pr-2 py-2 md:py-1.5 text-[11px] text-white placeholder-[#667] outline-none focus:border-indigo-500/50 transition-all"
                      />
                    </div>
                    <button onClick={() => { setQuickAddOpen(false); setQuickAddQuery(""); setQuickAddResults([]); }} className="p-1 rounded-md text-[#778] hover:text-white hover:bg-white/10 transition-all">
                      <X size={13} />
                    </button>
                  </div>
                  {quickAddSearching && (
                    <div className="flex items-center justify-center py-2 text-[10px] text-[#778]">
                      <Loader size={12} className="animate-spin mr-1.5" /> {t('搜索中...')}
                    </div>
                  )}
                  {!quickAddSearching && quickAddResults.length > 0 && (
                    <div className="space-y-0.5 max-h-[160px] overflow-auto">
                      {quickAddResults.map(r => (
                        <div key={r.symbol} className={`flex items-center justify-between px-2 py-1.5 rounded-md transition-all group ${r.alreadyAdded ? "bg-white/[0.02] opacity-70" : "bg-white/[0.03] hover:bg-white/[0.06]"}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[11px] font-semibold ${r.alreadyAdded ? "text-[#a0aec0]" : "text-white"}`}>{r.symbol}</span>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-300">{r.market || "US"}</span>
                              {r.alreadyAdded && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-up/10 text-up border border-up/20 flex items-center gap-0.5"><Check size={8} /> {t('已添加')}</span>}
                              {r.price && <span className="text-[10px] font-mono tabular-nums text-[#a0aec0]">${r.price}</span>}
                            </div>
                            <div className="text-[10px] text-[#778] truncate">{lang === 'zh' ? (STOCK_CN_NAMES[r.symbol] || r.name) : r.name}</div>
                          </div>
                          {r.alreadyAdded ? (
                            <button
                              onClick={() => { setSel(liveStocks.find(s => s.ticker === r.symbol)); setQuickAddOpen(false); setQuickAddQuery(""); setQuickAddResults([]); }}
                              className="ml-2 shrink-0 flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium bg-white/5 text-[#a0aec0] hover:bg-white/10 hover:text-white transition-all"
                            >
                              <Eye size={10} /> {t('查看')}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleQuickAdd(r)}
                              disabled={quickAdding === r.symbol}
                              className="ml-2 shrink-0 flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/30 hover:text-indigo-200 disabled:opacity-50 transition-all"
                            >
                              {quickAdding === r.symbol
                                ? <Loader size={10} className="animate-spin" />
                                : <><Plus size={10} /> {t('添加')}</>}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!quickAddSearching && quickAddQuery.trim() && quickAddResults.length === 0 && (
                    <div className="text-center py-2 text-[10px] text-[#778]">{t('未找到匹配标的')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    })()}
    <CompareModal
      open={showCompare}
      onClose={() => setShowCompare(false)}
      stocks={[...compareSet].map(tk => liveStocks.find(s => s.ticker === tk)).filter(Boolean)}
    />
    {/* ── 图表全屏 Modal ── */}
    {chartFullscreen && sel && (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up" onClick={() => setChartFullscreen(false)}>
        <div className="glass-card w-full max-w-6xl h-[85vh] p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3 shrink-0">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-indigo-400" />
              <span className="text-sm font-semibold text-white">{t('价格走势')}</span>
              <span className="text-xs font-mono text-[#a0aec0]">— {sel.ticker}</span>
              {showBenchmark && <span className="text-xs font-mono text-[#94a3b8]">· {benchmarkLabel} {t('基准')}</span>}
              <span className="text-[10px] text-[#778] ml-2">{chartRange}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowBenchmark(v => !v)} className={`px-2 py-1 rounded text-[10px] font-medium border transition-all ${showBenchmark ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' : 'bg-white/5 text-[#a0aec0] border-white/10 hover:bg-white/10'}`}>
                {benchmarkLabel} {t('基准')}
              </button>
              <button onClick={() => setChartFullscreen(false)} className="p-1.5 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer key={`chart-full-${sel.ticker}-${chartRange}-${chartData.length}`} width="100%" height="100%">
              <ComposedChart data={chartDataWithBench} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pgFull" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "#8A2BE2" : "#FF6B6B"} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="strokeGradFull" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#8A2BE2" />
                    <stop offset="100%" stopColor="#4169E1" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: "#a0aec0" }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis yAxisId="price" tick={{ fontSize: 11, fill: "#a0aec0" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={60} />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10, fill: "#a0aec0" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={60} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 3" />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => {
                  if (name === "p") return [`${sel.currency === "HKD" ? "HK$" : "$"}${v}`, t("价格")];
                  if (name === "pct") return [`${v >= 0 ? "+" : ""}${v}%`, t("收益率")];
                  if (name === "bpct") return [`${v >= 0 ? "+" : ""}${v}%`, `${benchmarkLabel} ${t('基准')}`];
                  return [v, name];
                }} />
                <Area yAxisId="price" type="monotone" dataKey="p" stroke={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "url(#strokeGradFull)" : "#FF6B6B"} strokeWidth={2.5} fill="url(#pgFull)" dot={false} activeDot={{ r: 5, fill: "#fff", stroke: "#8A2BE2", strokeWidth: 2 }} />
                <Line yAxisId="pct" type="monotone" dataKey="pct" stroke="transparent" dot={false} activeDot={false} />
                {showBenchmark && <Line yAxisId="pct" type="monotone" dataKey="bpct" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, fill: "#cbd5e1", stroke: "#94a3b8", strokeWidth: 2 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between mt-2 text-[10px] text-[#778] shrink-0">
            <span>{t('ESC 或点击外部关闭')}</span>
            {periodReturn !== null && (
              <span>{t('区间收益')} <span className={`font-mono font-bold ${periodReturn >= 0 ? 'text-up' : 'text-down'}`}>{periodReturn >= 0 ? '+' : ''}{periodReturn.toFixed(2)}%</span></span>
            )}
          </div>
        </div>
      </div>
    )}
  </div>
  );
};

// ─── Backtesting ──────────────────────────────────────────
const PIE_COLORS = ["#6366f1","#8b5cf6","#06b6d4","#00E5A0","#f59e0b","#FF6B6B","#ec4899","#14b8a6","#f97316","#a855f7","#3b82f6","#84cc16"];

// ─── Rotary Knob Component ──────────────────────────────
const RotaryKnob = ({ value, onChange, size = 76, color = "#6366f1" }) => {
  const [active, setActive] = useState(false);
  const lastY = useRef(null);
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 12; // main radius
  const startAngle = -225; // 0% position (bottom-left)
  const endAngle = 45;     // 100% position (bottom-right)
  const totalArc = endAngle - startAngle; // 270 degrees
  const currentAngle = startAngle + (value / 100) * totalArc;
  const sensitivity = 0.15; // low sensitivity: 0.15% per pixel

  const tickMarks = [];
  for (let i = 0; i <= 10; i++) {
    const pct = i * 10;
    const angle = startAngle + (pct / 100) * totalArc;
    const rad = (angle * Math.PI) / 180;
    const outerR = r + 6;
    const innerR = r + 2;
    const isMain = pct === 0 || pct === 50 || pct === 100;
    tickMarks.push({
      pct, angle, rad,
      x1: cx + innerR * Math.cos(rad),
      y1: cy + innerR * Math.sin(rad),
      x2: cx + outerR * Math.cos(rad),
      y2: cy + outerR * Math.sin(rad),
      labelX: cx + (outerR + 9) * Math.cos(rad),
      labelY: cy + (outerR + 9) * Math.sin(rad),
      isMain,
    });
  }

  // Arc path for track
  const describeArc = (startA, endA, radius) => {
    const s = (startA * Math.PI) / 180;
    const e = (endA * Math.PI) / 180;
    const sx = cx + radius * Math.cos(s);
    const sy = cy + radius * Math.sin(s);
    const ex = cx + radius * Math.cos(e);
    const ey = cy + radius * Math.sin(e);
    const large = (endA - startA) > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`;
  };

  const handleTickClick = (pct) => {
    onChange(pct);
  };

  // Vertical drag: mouse up = increase, mouse down = decrease
  const handlePointerDown = (e) => {
    setActive(true);
    lastY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Request pointer lock to hide cursor
    e.currentTarget.requestPointerLock?.();
  };
  const handlePointerMove = (e) => {
    if (!active) return;
    // Use movementY for pointer lock, fallback to clientY delta
    let dy;
    if (document.pointerLockElement) {
      dy = e.movementY;
    } else {
      if (lastY.current === null) { lastY.current = e.clientY; return; }
      dy = e.clientY - lastY.current;
      lastY.current = e.clientY;
    }
    // Mouse up (negative dy) = increase value
    const delta = -dy * sensitivity;
    const newVal = Math.round(Math.max(0, Math.min(100, value + delta)) * 10) / 10;
    if (newVal !== value) onChange(newVal);
  };
  const handlePointerUp = () => {
    setActive(false);
    lastY.current = null;
    document.exitPointerLock?.();
  };

  // Indicator dot position
  const indicatorRad = (currentAngle * Math.PI) / 180;
  const dotR = r - 4;
  const dotX = cx + dotR * Math.cos(indicatorRad);
  const dotY = cy + dotR * Math.sin(indicatorRad);

  // Corner bracket positions
  const m = 2; // margin from edge
  const bLen = 8; // bracket arm length
  const bw = 1.5; // bracket stroke width

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Corner brackets when active */}
      {active && (
        <svg className="absolute inset-0 pointer-events-none" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Top-left */}
          <path d={`M ${m + bLen} ${m} L ${m} ${m} L ${m} ${m + bLen}`} fill="none" stroke={color} strokeWidth={bw} strokeLinecap="round" />
          {/* Top-right */}
          <path d={`M ${size - m - bLen} ${m} L ${size - m} ${m} L ${size - m} ${m + bLen}`} fill="none" stroke={color} strokeWidth={bw} strokeLinecap="round" />
          {/* Bottom-left */}
          <path d={`M ${m} ${size - m - bLen} L ${m} ${size - m} L ${m + bLen} ${size - m}`} fill="none" stroke={color} strokeWidth={bw} strokeLinecap="round" />
          {/* Bottom-right */}
          <path d={`M ${size - m} ${size - m - bLen} L ${size - m} ${size - m} L ${size - m - bLen} ${size - m}`} fill="none" stroke={color} strokeWidth={bw} strokeLinecap="round" />
        </svg>
      )}
      <svg
        width={size} height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={`select-none ${active ? "cursor-none" : "cursor-ns-resize"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: "none" }}
      >
        {/* Track background */}
        <path d={describeArc(startAngle, endAngle, r)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" strokeLinecap="round" />
        {/* Active arc */}
        {value > 0.05 && (
          <path d={describeArc(startAngle, currentAngle, r)} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" opacity="0.9"
            style={{ filter: active ? `drop-shadow(0 0 4px ${color}80)` : "none" }}
          />
        )}
        {/* Tick marks */}
        {tickMarks.map(t => (
          <g key={t.pct} onClick={(e) => { e.stopPropagation(); handleTickClick(t.pct); }} className="cursor-pointer">
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={value >= t.pct ? color : "var(--text-muted)"}
              strokeWidth={t.isMain ? 2 : 1}
              opacity={t.isMain ? 0.9 : 0.4}
            />
            {t.isMain && (
              <text x={t.labelX} y={t.labelY} textAnchor="middle" dominantBaseline="central"
                fill="var(--text-muted)" fontSize="8" fontFamily="monospace"
              >{t.pct === 0 ? "0" : `${t.pct}%`}</text>
            )}
          </g>
        ))}
        {/* Center knob body */}
        <circle cx={cx} cy={cy} r={r - 9} fill="var(--bg-card)" stroke={active ? color : "var(--border-default)"} strokeWidth={active ? 1.5 : 1}
          style={{ transition: "stroke 0.2s" }}
        />
        {/* Value text */}
        <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize="12" fontWeight="700" fontFamily="monospace"
        >{value.toFixed(1)}</text>
        {/* no % symbol — clean look */}
        {/* Indicator dot */}
        <circle cx={dotX} cy={dotY} r={2.5} fill={color} opacity="0.95" />
        {active && <circle cx={dotX} cy={dotY} r={5} fill={color} opacity="0.15" />}
      </svg>
    </div>
  );
};

const BacktestEngine = () => {
  const { t, lang } = useLang();
  const { stocks: ctxStocks2, setStocks: ctxSetStocks2, standalone, addTicker: addTickerToPlatform } = useContext(DataContext);
  const liveStocks = ctxStocks2 || STOCKS;
  const [dataLoading, setDataLoading] = useState(false);
  const [dataLoadMsg, setDataLoadMsg] = useState("");
  const [running, setRunning] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [portfolio, setPortfolio] = useState(() => {
    // 默认组合: NVDA, SNDK, RKLB, LITE 各25%
    const defaults = ["NVDA", "SNDK", "RKLB", "LITE"];
    const init = {};
    defaults.forEach(t => {
      if (STOCKS.find(s => s.ticker === t)) init[t] = 25;
    });
    // 如果默认标的不在 STOCKS 中，降级到前4个
    if (Object.keys(init).length === 0) {
      STOCKS.slice(0, 4).forEach(s => { init[s.ticker] = 25; });
    }
    return init;
  });
  const [initialCap, setInitialCap] = useState(100000);
  const [costBps, setCostBps] = useState(15); // 0.15% = 15 bps
  const [benchTicker, setBenchTicker] = useState("SPY");
  const [searchAdd, setSearchAdd] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchingAdd, setSearchingAdd] = useState(false);
  const [btResult, setBtResult] = useState(null);
  const [builderOpen, setBuilderOpen] = useState(true); // 组合构建器折叠状态
  const [resultsOpen, setResultsOpen] = useState(true); // 回测结果折叠状态
  const [highlightRange, setHighlightRange] = useState(null); // {startDate, endDate, ret} 高亮回测曲线区间
  const [zoomRange, setZoomRange] = useState(null); // {startDate, endDate, label} 点击缩放区间
  const [btRange, setBtRange] = useState("1Y"); // 回测时间维度: 1M|6M|YTD|1Y|5Y|ALL|CUSTOM
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [rebalance, setRebalance] = useState("none"); // none|quarterly|yearly
  const benchCacheRef = useRef({}); // 缓存已获取的基准数据 { ticker: stockData }
  const autoRan = useRef(false);
  // 策略模板 — 保存 / 加载
  const [templates, setTemplates] = useState(() => {
    try { return JSON.parse(localStorage.getItem("quantedge_bt_templates") || "[]"); } catch { return []; }
  });
  const [showTemplates, setShowTemplates] = useState(false);
  const [logScale, setLogScale] = useState(false); // 对数坐标（长周期更合理）
  const [shareToast, setShareToast] = useState(null); // {msg, t}
  const [savedRuns, setSavedRuns] = useState([]); // 多次回测对比 — [{id, label, navCurve, metrics, color}]
  const RUN_COLORS = ['#10b981', '#f59e0b', '#ec4899']; // 对比线颜色池
  const [mcResult, setMcResult] = useState(null); // Monte Carlo 未来路径预测
  const [mcRunning, setMcRunning] = useState(false);
  const [mcHorizon, setMcHorizon] = useState(252); // 默认预测 1 年 (252 交易日)

  // ── 配置分享链接（URL hash 编码/解码）────────────────────
  const encodeConfig = useCallback(() => {
    try {
      const cfg = { p: portfolio, ic: initialCap, cb: costBps, bt: benchTicker, r: btRange, rb: rebalance };
      const json = JSON.stringify(cfg);
      // 兼容中文、Unicode：先 encodeURIComponent → escape 成 ASCII → btoa
      const b64 = btoa(unescape(encodeURIComponent(json)));
      return `${location.origin}${location.pathname}#s=${b64}`;
    } catch { return location.href; }
  }, [portfolio, initialCap, costBps, benchTicker, btRange, rebalance]);

  const shareConfig = useCallback(async () => {
    const url = encodeConfig();
    try {
      await navigator.clipboard.writeText(url);
      setShareToast({ msg: t('分享链接已复制到剪贴板'), t: Date.now() });
    } catch {
      setShareToast({ msg: t('复制失败，请手动复制'), t: Date.now() });
    }
    setTimeout(() => setShareToast(null), 2500);
  }, [encodeConfig, t]);

  // 首次挂载：解析 URL hash 恢复配置
  const hashRestored = useRef(false);
  useEffect(() => {
    if (hashRestored.current) return;
    hashRestored.current = true;
    const hash = location.hash;
    const m = hash.match(/#s=([^&]+)/);
    if (!m) return;
    try {
      const json = decodeURIComponent(escape(atob(m[1])));
      const cfg = JSON.parse(json);
      if (cfg.p && typeof cfg.p === 'object') {
        // 仅保留 liveStocks 里存在的标的
        const validTickers = new Set(liveStocks.map(s => s.ticker));
        const filtered = Object.fromEntries(Object.entries(cfg.p).filter(([k]) => validTickers.has(k)));
        if (Object.keys(filtered).length > 0) setPortfolio(filtered);
      }
      if (typeof cfg.ic === 'number') setInitialCap(cfg.ic);
      if (typeof cfg.cb === 'number') setCostBps(cfg.cb);
      if (typeof cfg.bt === 'string') setBenchTicker(cfg.bt);
      if (typeof cfg.r === 'string') setBtRange(cfg.r);
      if (typeof cfg.rb === 'string') setRebalance(cfg.rb);
      setShareToast({ msg: t('已从分享链接恢复组合配置'), t: Date.now() });
      setTimeout(() => setShareToast(null), 2500);
      // 清除 hash（避免刷新再次触发）
      history.replaceState(null, '', location.pathname);
    } catch (e) {
      console.warn('[QuantEdge] Failed to decode shared config:', e);
    }
  }, [liveStocks, t]);

  const saveTemplate = useCallback((name) => {
    const tpl = { name, portfolio: { ...portfolio }, initialCap, costBps, benchTicker, btRange, rebalance, savedAt: Date.now() };
    setTemplates(prev => {
      const next = [...prev.filter(x => x.name !== name), tpl];
      try { localStorage.setItem("quantedge_bt_templates", JSON.stringify(next)); } catch {}
      return next;
    });
  }, [portfolio, initialCap, costBps, benchTicker, btRange, rebalance]);
  const deleteTemplate = useCallback((name) => {
    setTemplates(prev => {
      const next = prev.filter(x => x.name !== name);
      try { localStorage.setItem("quantedge_bt_templates", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const loadTemplate = useCallback(async (tpl) => {
    const tplPortfolio = tpl.portfolio || {};
    setPortfolio(tplPortfolio);
    if (tpl.initialCap != null) setInitialCap(tpl.initialCap);
    if (tpl.costBps != null) setCostBps(tpl.costBps);
    if (tpl.benchTicker) setBenchTicker(tpl.benchTicker);
    if (tpl.btRange) setBtRange(tpl.btRange);
    if (tpl.rebalance) setRebalance(tpl.rebalance);
    // 清除旧结果，让新组合自动重新回测
    setHasResult(false);
    setBtResult(null);
    autoRan.current = false;
    // 模板中缺失的标的 — 从 Yahoo Finance 自动添加到平台
    const wantTickers = Object.keys(tplPortfolio);
    const missingTickers = wantTickers.filter(tk => !liveStocks.find(s => s.ticker === tk));
    if (missingTickers.length === 0) return;
    setDataLoading(true);
    setDataLoadMsg(t('正在添加 {n} 个标的: {list}', {n: missingTickers.length, list: missingTickers.join(', ')}));
    autoRan.current = false; // 数据到位后允许重新自动回测
    for (const tk of missingTickers) {
      try {
        const isHK = tk.endsWith(".HK");
        const yfSym = isHK ? tk.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK" : tk;
        await addTickerToPlatform({
          ticker: tk, name: tk, yf_symbol: yfSym,
          market: isHK ? "HK" : "US", sector: "未知",
          currency: isHK ? "HKD" : "USD", type: "stock",
        });
      } catch { /* 跳过失败 */ }
    }
    setDataLoading(false);
    setDataLoadMsg("");
  }, [liveStocks, addTickerToPlatform, t]);
  // 内置策略预设
  const BUILTIN_PRESETS = useMemo(() => [
    { name: "🚀 " + t("动量成长"), portfolio: { NVDA: 30, AMD: 20, AVGO: 20, META: 15, GOOGL: 15 }, initialCap: 100000, costBps: 15, benchTicker: "SPY", btRange: "1Y", rebalance: "quarterly" },
    { name: "💎 " + t("红利防御"), portfolio: { PEP: 25, KO: 25, PG: 25, JNJ: 25 }, initialCap: 100000, costBps: 15, benchTicker: "SPY", btRange: "5Y", rebalance: "yearly" },
    { name: "🏭 " + t("半导体重仓"), portfolio: { SMH: 40, NVDA: 20, TSM: 15, AMD: 15, AVGO: 10 }, initialCap: 100000, costBps: 15, benchTicker: "QQQ", btRange: "1Y", rebalance: "quarterly" },
    { name: "🛰️ " + t("航天新兴"), portfolio: { RKLB: 40, UFO: 30, MARS: 20, LUNR: 10 }, initialCap: 100000, costBps: 15, benchTicker: "SPY", btRange: "1Y", rebalance: "none" },
    { name: "⚖️ " + t("60/40 经典"), portfolio: { SPY: 60, TLT: 40 }, initialCap: 100000, costBps: 10, benchTicker: "SPY", btRange: "5Y", rebalance: "yearly" },
  ], [t]);

  const totalWeight = useMemo(() => {
    const t = Object.values(portfolio).reduce((a, b) => a + b, 0);
    return Math.round(t * 10) / 10;
  }, [portfolio]);
  const portfolioStocks = useMemo(() =>
    Object.entries(portfolio).map(([ticker, weight]) => ({
      ticker, weight,
      stk: liveStocks.find(s => s.ticker === ticker),
    })).filter(p => p.stk),
  [portfolio, liveStocks]);

  // 搜索标的 — 支持 Yahoo Finance / API / 本地
  const searchStocks = useCallback(async (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearchingAdd(true);
    try {
      const existing = new Set(liveStocks.map(s => s.ticker));
      const inPortfolio = new Set(Object.keys(portfolio));
      if (standalone) {
        const results = await standaloneSearch(q.trim());
        setSearchResults(results.map(r => ({
          ...r,
          alreadyInPlatform: existing.has(r.symbol),
          alreadyInPortfolio: inPortfolio.has(r.symbol),
        })).slice(0, 8));
      } else {
        const res = await apiFetch(`/search?q=${encodeURIComponent(q.trim())}`);
        if (res?.results) {
          setSearchResults(res.results.map(r => ({
            ...r,
            alreadyInPlatform: existing.has(r.symbol),
            alreadyInPortfolio: inPortfolio.has(r.symbol),
          })).slice(0, 8));
        }
      }
      // Also search local STOCKS
      const localMatches = liveStocks.filter(s =>
        !inPortfolio.has(s.ticker) &&
        (s.ticker.toLowerCase().includes(q.toLowerCase()) || s.name.toLowerCase().includes(q.toLowerCase()))
      ).slice(0, 4).map(s => ({
        symbol: s.ticker,
        name: s.name,
        market: s.market,
        alreadyInPlatform: true,
        alreadyInPortfolio: false,
      }));
      setSearchResults(prev => {
        const seen = new Set(prev.map(r => r.symbol));
        return [...prev, ...localMatches.filter(m => !seen.has(m.symbol))].slice(0, 8);
      });
    } catch { setSearchResults([]); }
    setSearchingAdd(false);
  }, [standalone, portfolio, liveStocks]);

  // Debounced search
  useEffect(() => {
    if (!searchAdd.trim()) { setSearchResults([]); return; }
    const t = setTimeout(() => searchStocks(searchAdd), 400);
    return () => clearTimeout(t);
  }, [searchAdd, searchStocks]);

  const setWeight = (ticker, w) => setPortfolio(p => ({ ...p, [ticker]: Math.max(0, Math.min(100, Math.round(w * 10) / 10)) }));
  const removeTicker = (ticker) => setPortfolio(p => { const n = { ...p }; delete n[ticker]; return n; });
  const addTickerToPortfolio = async (result) => {
    const sym = result.symbol || result;
    // If already in liveStocks, just add to portfolio
    if (liveStocks.find(s => s.ticker === sym)) {
      setPortfolio(p => ({ ...p, [sym]: 10 }));
      setSearchAdd(""); setSearchResults([]);
      return;
    }
    // Otherwise, add to platform first (fetch data from Yahoo Finance)
    try {
      const isHK = sym.endsWith(".HK");
      const yfSym = isHK ? sym.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK" : sym;
      const tickerData = {
        ticker: sym,
        name: result.name || sym,
        yf_symbol: yfSym,
        market: result.market || (isHK ? "HK" : "US"),
        sector: result.sector || "未知",
        currency: result.currency || (isHK ? "HKD" : "USD"),
        type: result.type || "stock",
      };
      const res = await addTickerToPlatform(tickerData);
      if (res?.success) {
        setPortfolio(p => ({ ...p, [sym]: 10 }));
      }
    } catch { /* fallback: just add by ticker */
      setPortfolio(p => ({ ...p, [sym]: 10 }));
    }
    setSearchAdd(""); setSearchResults([]);
  };
  const equalizeWeights = () => {
    const tickers = Object.keys(portfolio);
    if (!tickers.length) return;
    const base = Math.floor(100 / tickers.length);
    const remainder = 100 - base * tickers.length;
    const n = {};
    tickers.forEach((t, i) => { n[t] = base + (i < remainder ? 1 : 0); });
    setPortfolio(n);
  };

  // 获取指定标的在选定时间维度的价格数据
  const getPriceData = useCallback((stk) => {
    if (!stk) return [];
    if (btRange === "CUSTOM") {
      // 自定义日期：用5Y数据（YYYY/MM格式），按日期过滤
      const data5Y = stk.priceRanges?.["5Y"] || stk.priceRanges?.["ALL"] || stk.priceHistory || [];
      if (!customStart || !customEnd || data5Y.length === 0) return data5Y;
      const startYM = customStart.substring(0, 4) + "/" + customStart.substring(5, 7); // "2021/01"
      const endYM = customEnd.substring(0, 4) + "/" + customEnd.substring(5, 7);
      // 检测数据格式
      const firstM = data5Y[0]?.m || "";
      if (firstM.match(/^\d{4}\//)) {
        // YYYY/MM 格式 — 直接过滤
        const filtered = data5Y.filter(p => p.m >= startYM && p.m <= endYM);
        return filtered.length >= 2 ? filtered : data5Y;
      }
      if (firstM.match(/^\d{2}\//)) {
        // MM/DD 格式 (1Y range) — 无法精确过滤年份，按比例裁剪
        const startD = new Date(customStart).getTime();
        const endD = new Date(customEnd).getTime();
        const now = Date.now();
        const oneYearAgo = now - 365 * 86400000;
        // 如果自定义范围在最近1年内，用1Y数据裁剪
        if (startD >= oneYearAgo) {
          const totalSpan = now - oneYearAgo;
          const startRatio = Math.max(0, (startD - oneYearAgo) / totalSpan);
          const endRatio = Math.min(1, (endD - oneYearAgo) / totalSpan);
          const si = Math.floor(startRatio * data5Y.length);
          const ei = Math.ceil(endRatio * data5Y.length);
          const sliced = data5Y.slice(si, ei);
          return sliced.length >= 2 ? sliced : data5Y;
        }
      }
      return data5Y;
    }
    // 优先 priceRanges
    if (stk.priceRanges && stk.priceRanges[btRange]) return stk.priceRanges[btRange];
    // 降级到 priceHistory
    return stk.priceHistory || [];
  }, [btRange, customStart, customEnd]);

  // 各时间维度的估算天数/期 (用于年化计算)
  const rangeDaysMap = { "1M": 30, "6M": 180, "YTD": 100, "1Y": 365, "5Y": 1825, "ALL": 3650 };

  // ── 真实回测计算 ──
  const runBacktest = useCallback(async () => {
    setRunning(true);
    setHasResult(false);
    setZoomRange(null);
    setHighlightRange(null);

    // 预获取基准价格数据
    const benchCacheKey = `${benchTicker}_${btRange}`;
    let benchPriceData = benchCacheRef.current[benchCacheKey];
    const benchStockInList = liveStocks.find(s => s.ticker === benchTicker);
    // 即使 benchStockInList 存在，如果其 priceRanges 为空（如 QQQ 等 ETF 静态数据缺失），仍需动态 fetch
    const benchInListHasPrices = benchStockInList && getPriceData(benchStockInList).length >= 2;
    if (!benchPriceData && !benchInListHasPrices) {
      try {
        const effectiveRange = btRange === "CUSTOM" ? "5Y" : btRange;
        const prices = await fetchBenchmarkPrices(benchTicker, effectiveRange);
        if (prices && prices.length >= 2) {
          benchCacheRef.current[benchCacheKey] = prices;
          benchPriceData = prices;
        }
      } catch (e) {
        console.warn("[Backtest] 获取基准数据失败:", benchTicker, e);
      }
    }

    setTimeout(() => {
      // 取各标的在选定时间维度的价格数据
      const entries = portfolioStocks.map(p => ({
        ...p,
        ph: getPriceData(p.stk),
      })).filter(p => p.ph.length >= 2);
      if (entries.length === 0) { setRunning(false); return; }

      // 用最长数据的日期轴
      const maxLen = Math.max(...entries.map(e => e.ph.length));
      const rawDateAxis = entries.find(e => e.ph.length === maxLen).ph.map(p => p.m);
      const isLongFmt = rawDateAxis[0]?.length >= 6 && rawDateAxis[0]?.indexOf("/") >= 4; // YYYY/MM

      // 对稀疏数据进行插值：如果YYYY/MM格式且数据点太少，生成逐月日期轴
      let dateAxis = rawDateAxis;
      let numPts = rawDateAxis.length;
      // 计算期望的月份数
      if (isLongFmt && rawDateAxis.length >= 2) {
        const startY = parseInt(rawDateAxis[0].substring(0, 4));
        const startM = parseInt(rawDateAxis[0].substring(5));
        const endY = parseInt(rawDateAxis[rawDateAxis.length - 1].substring(0, 4));
        const endM = parseInt(rawDateAxis[rawDateAxis.length - 1].substring(5));
        const expectedMonths = (endY - startY) * 12 + (endM - startM) + 1;
        if (expectedMonths > rawDateAxis.length * 1.5) {
          // 数据稀疏，生成逐月日期轴
          const monthlyDates = [];
          let y = startY, m = startM;
          while (y < endY || (y === endY && m <= endM)) {
            monthlyDates.push(`${y}/${String(m).padStart(2, "0")}`);
            m++;
            if (m > 12) { m = 1; y++; }
          }
          dateAxis = monthlyDates;
          numPts = monthlyDates.length;
        }
      }

      // 归一化权重到 100%
      const tw = entries.reduce((s, e) => s + e.weight, 0) || 1;
      const initWeights = entries.map(e => e.weight / tw);

      // 各标的的价格序列（归一化到起始=100）
      // 使用线性插值而非最近邻，确保稀疏数据平滑过渡
      const interpolatePrice = (ph, targetDates) => {
        const startP = ph[0]?.p || 1;
        const series = [];
        if (!isLongFmt || ph.length === targetDates.length) {
          // 短格式或长度匹配，用原始映射
          for (let i = 0; i < targetDates.length; i++) {
            const srcIdx = Math.min(Math.round(i * (ph.length - 1) / (targetDates.length - 1)), ph.length - 1);
            series.push(ph[srcIdx].p / startP * 100);
          }
          return series;
        }
        // YYYY/MM格式：按日期进行线性插值
        for (let i = 0; i < targetDates.length; i++) {
          const targetDate = targetDates[i];
          // 在原始数据中找到前后两个点
          let lo = 0, hi = ph.length - 1;
          for (let j = 0; j < ph.length; j++) {
            if (ph[j].m <= targetDate) lo = j;
            if (ph[j].m >= targetDate) { hi = j; break; }
          }
          if (lo === hi || ph[lo].m === targetDate) {
            series.push(ph[lo].p / startP * 100);
          } else {
            // 线性插值
            const loY = parseInt(ph[lo].m.substring(0, 4)), loM = parseInt(ph[lo].m.substring(5));
            const hiY = parseInt(ph[hi].m.substring(0, 4)), hiM = parseInt(ph[hi].m.substring(5));
            const tY = parseInt(targetDate.substring(0, 4)), tM = parseInt(targetDate.substring(5));
            const totalSpan = (hiY - loY) * 12 + (hiM - loM);
            const curSpan = (tY - loY) * 12 + (tM - loM);
            const ratio = totalSpan > 0 ? curSpan / totalSpan : 0;
            const price = ph[lo].p + (ph[hi].p - ph[lo].p) * ratio;
            series.push(price / startP * 100);
          }
        }
        return series;
      };

      const normSeries = entries.map((e, idx) => {
        const series = interpolatePrice(e.ph, dateAxis);
        return { ticker: e.stk.ticker, weight: initWeights[idx], series };
      });

      // 判断是否为再平衡日（季度/年度）
      // 日期格式: "MM/DD"（1Y内）或 "YYYY/MM"（5Y/全部/自定义）
      const isRebalanceDay = (dateStr, prevDateStr) => {
        if (rebalance === "none") return false;
        let curMonth, prevMonth, curYear, prevYear;
        const isLong = dateStr.length >= 6 && dateStr.indexOf("/") >= 4; // YYYY/MM
        if (isLong) {
          curYear = parseInt(dateStr.substring(0, 4));
          curMonth = parseInt(dateStr.substring(5));
          prevYear = parseInt(prevDateStr.substring(0, 4));
          prevMonth = parseInt(prevDateStr.substring(5));
        } else {
          // MM/DD format
          curMonth = parseInt(dateStr.substring(0, 2));
          prevMonth = parseInt(prevDateStr.substring(0, 2));
          curYear = curMonth < prevMonth ? 1 : 0; // 简单推断跨年
          prevYear = 0;
        }
        // 判断是否跨入了新的月份
        const monthChanged = (curYear !== prevYear || curMonth !== prevMonth);
        if (!monthChanged) return false;
        if (rebalance === "quarterly") {
          return [1, 4, 7, 10].includes(curMonth);
        }
        if (rebalance === "yearly") {
          return curMonth === 1;
        }
        return false;
      };

      // 基准指数真实数据 — 优先 in-list 静态数据，缺失时回退到动态 fetch 的 benchPriceData
      let benchSeries = null;
      const benchPh = benchStockInList ? getPriceData(benchStockInList) : [];
      const benchRaw = benchPh.length >= 2
        ? benchPh
        : (benchPriceData && benchPriceData.length >= 2 ? benchPriceData : null);
      if (benchRaw) benchSeries = interpolatePrice(benchRaw, dateAxis);

      // 组合净值曲线（支持再平衡）
      const navCurve = [];
      let maxNav = 0, maxDD = 0;
      const returns = [];
      // 持有份额（模拟实际持仓）
      let shares = normSeries.map(ns => ns.weight * 100 / ns.series[0]); // 初始份额
      let rebalanceCount = 0;

      for (let i = 0; i < numPts; i++) {
        // 计算当前净值
        let nav = 0;
        normSeries.forEach((ns, j) => { nav += shares[j] * ns.series[i]; });

        // 检查再平衡
        if (i > 0 && isRebalanceDay(dateAxis[i], dateAxis[i - 1])) {
          // 按初始权重重新分配
          normSeries.forEach((ns, j) => {
            shares[j] = (initWeights[j] * nav) / ns.series[i];
          });
          rebalanceCount++;
        }

        navCurve.push({ date: dateAxis[i], strategy: Math.round(nav * 100) / 100, benchmark: benchSeries ? Math.round(benchSeries[i] * 100) / 100 : 100 + i * (35 / numPts) });
        if (nav > maxNav) maxNav = nav;
        const dd = (nav - maxNav) / maxNav * 100;
        if (dd < maxDD) maxDD = dd;
        if (i > 0) returns.push((nav - navCurve[i - 1].strategy) / navCurve[i - 1].strategy);
      }

      // 指标计算
      const finalNav = navCurve[navCurve.length - 1].strategy;
      const totalReturn = ((finalNav - 100) / 100 * 100);
      const nPeriods = returns.length;
      // 总天数：优先用 dateAxis 起止日期真实计算（5Y / ALL 的 YYYY/MM 格式可精确推算），
      // 避免 ALL 按 3650 硬编码，但实际数据可能跨数十年（如 NVDA 1999 至今）
      let totalDays;
      if (btRange === "CUSTOM" && customStart && customEnd) {
        totalDays = Math.max(30, Math.round((new Date(customEnd) - new Date(customStart)) / 86400000));
      } else {
        const firstDate = dateAxis[0] || "";
        const lastDate = dateAxis[dateAxis.length - 1] || "";
        const isYM = firstDate.length >= 7 && firstDate.indexOf("/") === 4; // YYYY/MM
        if (isYM) {
          const y1 = parseInt(firstDate.substring(0, 4));
          const m1 = parseInt(firstDate.substring(5));
          const y2 = parseInt(lastDate.substring(0, 4));
          const m2 = parseInt(lastDate.substring(5));
          const months = Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1);
          totalDays = Math.round(months * 30.4375);
        } else {
          // MM/DD 格式 = 实际数据是 1Y 及以下。若 btRange 选了 5Y/ALL 但数据
          // 降级到 priceHistory（=1Y），cap 到 365 避免按 3650 稀释年化
          totalDays = Math.min(rangeDaysMap[btRange] || 180, 365);
        }
      }
      const estDaysPerPeriod = totalDays / Math.max(nPeriods, 1);
      const annFactor = 365 / Math.max(totalDays, 30);
      const annReturn = (Math.pow(finalNav / 100, annFactor) - 1) * 100;
      const avgRet = returns.reduce((a, b) => a + b, 0) / returns.length;
      const stdRet = Math.sqrt(returns.reduce((a, b) => a + (b - avgRet) ** 2, 0) / returns.length);
      const downRet = returns.filter(r => r < 0);
      const downStd = downRet.length > 0 ? Math.sqrt(downRet.reduce((a, b) => a + b ** 2, 0) / downRet.length) : 0.001;
      const periodsPerYear = 365 / Math.max(estDaysPerPeriod, 1);
      const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(periodsPerYear) : 0;
      const sortino = downStd > 0 ? (avgRet / downStd) * Math.sqrt(periodsPerYear) : 0;
      const calmar = maxDD !== 0 ? Math.abs(annReturn / maxDD) : 0;
      const winRate = returns.filter(r => r > 0).length / returns.length * 100;
      const vol = stdRet * Math.sqrt(periodsPerYear) * 100;

      // 各标的独立收益
      const holdingResults = normSeries.map(ns => {
        const ret = (ns.series[ns.series.length - 1] - 100);
        return { ticker: ns.ticker, weight: Math.round(ns.weight * 100), ret };
      }).sort((a, b) => b.ret - a.ret);

      // 回撤曲线 (underwater curve) — 组合 + 基准
      const drawdownCurve = [];
      let peak = 0;
      let benchPeak = 0;
      let ddStart = -1, maxDDDuration = 0, curDDDuration = 0;
      let benchMaxDD = 0;
      navCurve.forEach((pt, idx) => {
        if (pt.strategy > peak) {
          peak = pt.strategy;
          if (curDDDuration > maxDDDuration) maxDDDuration = curDDDuration;
          curDDDuration = 0;
        } else {
          curDDDuration++;
        }
        if (pt.benchmark > benchPeak) benchPeak = pt.benchmark;
        const benchDD = benchPeak > 0 ? Math.round((pt.benchmark - benchPeak) / benchPeak * 10000) / 100 : 0;
        if (benchDD < benchMaxDD) benchMaxDD = benchDD;
        drawdownCurve.push({
          date: pt.date,
          drawdown: Math.round((pt.strategy - peak) / peak * 10000) / 100,
          benchDD,
        });
      });
      if (curDDDuration > maxDDDuration) maxDDDuration = curDDDuration;
      // 估算回撤持续天数
      const ddDays = Math.round(maxDDDuration * (totalDays / Math.max(numPts, 1)));

      // 超额收益 Alpha（策略收益 - 基准收益）
      const benchFinal = navCurve[navCurve.length - 1].benchmark;
      const benchReturn = ((benchFinal - 100) / 100 * 100);
      const alpha = totalReturn - benchReturn;

      // VaR (Value at Risk) — 95% and 99% confidence
      const sortedReturns = [...returns].sort((a, b) => a - b);
      const var95Idx = Math.floor(sortedReturns.length * 0.05);
      const var99Idx = Math.floor(sortedReturns.length * 0.01);
      const var95 = sortedReturns[var95Idx] ? sortedReturns[var95Idx] * 100 : 0;
      const var99 = sortedReturns[var99Idx] ? sortedReturns[var99Idx] * 100 : 0;

      // 收益分布（>3年用年度，否则用月度）
      const isLongFormat = dateAxis[0] && dateAxis[0].includes("/") && dateAxis[0].length >= 6 && dateAxis[0].indexOf("/") >= 4; // YYYY/MM
      const isAnnual = totalDays > 3 * 365;
      const monthlyReturns = [];
      const currentYear = new Date().getFullYear().toString();

      if (isAnnual) {
        // 按年分组：找到每年最后一个数据点的索引
        const yearEndMap = new Map(); // year -> last index in navCurve
        navCurve.forEach((pt, idx) => {
          const year = isLongFormat ? pt.date.substring(0, 4) : pt.date;
          yearEndMap.set(year, idx);
        });
        const years = [...yearEndMap.keys()];
        for (let y = 0; y < years.length; y++) {
          const endIdx = yearEndMap.get(years[y]);
          const startIdx = y === 0 ? 0 : yearEndMap.get(years[y - 1]);
          const mRet = ((navCurve[endIdx].strategy - navCurve[startIdx].strategy) / navCurve[startIdx].strategy) * 100;
          const label = years[y] === currentYear ? `${years[y]}(YTD)` : years[y];
          monthlyReturns.push({ month: label, ret: Math.round(mRet * 100) / 100, startDate: navCurve[startIdx].date, endDate: navCurve[endIdx].date });
        }
      } else {
        // 按月分组
        let periodStart = 0;
        for (let i = 1; i < navCurve.length; i++) {
          const prevDate = navCurve[i - 1].date;
          const curDate = navCurve[i].date;
          let boundary = false;
          if (isLongFormat) {
            boundary = prevDate !== curDate;
          } else {
            boundary = curDate.substring(0, 2) !== prevDate.substring(0, 2);
          }
          if (boundary || i === navCurve.length - 1) {
            const endIdx = i === navCurve.length - 1 ? i : i - 1;
            const mRet = ((navCurve[endIdx].strategy - navCurve[periodStart].strategy) / navCurve[periodStart].strategy) * 100;
            monthlyReturns.push({ month: navCurve[periodStart].date, ret: Math.round(mRet * 100) / 100, startDate: navCurve[periodStart].date, endDate: navCurve[endIdx].date });
            periodStart = i;
          }
        }
      }

      // 区间收益分析（分成4段）
      const segLen = Math.floor(numPts / 4);
      const segments = [];
      for (let s = 0; s < 4; s++) {
        const si = s * segLen;
        const ei = s === 3 ? numPts - 1 : (s + 1) * segLen;
        const segRet = (navCurve[ei].strategy - navCurve[si].strategy) / navCurve[si].strategy * 100;
        segments.push({ period: `${dateAxis[si]} - ${dateAxis[ei]}`, ret: Math.round(segRet * 100) / 100, startDate: dateAxis[si], endDate: dateAxis[ei] });
      }

      // 相关性矩阵计算
      const tickers = normSeries.map(ns => ns.ticker);
      const returnsSeries = normSeries.map(ns => {
        const r = [];
        for (let i = 1; i < ns.series.length; i++) {
          r.push((ns.series[i] - ns.series[i - 1]) / ns.series[i - 1]);
        }
        return r;
      });
      const corrMatrix = [];
      for (let a = 0; a < tickers.length; a++) {
        const row = [];
        for (let b = 0; b < tickers.length; b++) {
          if (a === b) { row.push(1); continue; }
          const ra = returnsSeries[a], rb = returnsSeries[b];
          const n = Math.min(ra.length, rb.length);
          const meanA = ra.slice(0, n).reduce((s, v) => s + v, 0) / n;
          const meanB = rb.slice(0, n).reduce((s, v) => s + v, 0) / n;
          let cov = 0, varA = 0, varB = 0;
          for (let k = 0; k < n; k++) {
            const da = ra[k] - meanA, db = rb[k] - meanB;
            cov += da * db; varA += da * da; varB += db * db;
          }
          row.push(varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0);
        }
        corrMatrix.push(row);
      }

      // ─── 压力测试: 模拟极端场景 ───
      const stressScenarios = [
        { name: "COVID-19 崩盘", period: "2020.02-2020.03", spyDrop: -33.9, description: "全球疫情引发流动性危机" },
        { name: "2022 加息风暴", period: "2022.01-2022.10", spyDrop: -25.4, description: "美联储激进加息，成长股暴跌" },
        { name: "2018 Q4 暴跌", period: "2018.10-2018.12", spyDrop: -19.8, description: "贸易战+加息预期恶化" },
        { name: "2008 金融危机", period: "2008.09-2009.03", spyDrop: -56.8, description: "雷曼倒闭引发全球金融海啸" },
      ];
      const stressResults = stressScenarios.map(sc => {
        // 根据组合Beta和波动率估算组合在该场景下的表现
        const avgBeta = portfolioStocks.reduce((s, ps) => s + (ps.stk.beta || 1.0) * ps.weight / 100, 0);
        const portfolioVol = vol / 100; // 年化波动率(小数)
        const spyVol = 0.16; // SPY长期年化波动率约16%
        const volRatio = spyVol > 0 ? Math.min(portfolioVol / spyVol, 3) : 1;
        // 在对数收益率空间做放大：beta×volRatio 线性叠加在 log-return 上，
        // 复合回普通收益率后结果天然 > -100%，符合"不加杠杆亏不破 0"的物理现实。
        const betaAmp = avgBeta * (0.6 + 0.4 * volRatio);
        const spyLogRet = Math.log(1 + sc.spyDrop / 100);
        const estDropRaw = (Math.exp(spyLogRet * betaAmp) - 1) * 100;
        const estDrop = Math.max(estDropRaw, -99); // 展示下限：最多显示 -99%，避免负账户余额
        const estValue = Math.max(0, Math.round(initialCap * (1 + estDrop / 100)));
        return { ...sc, estDrop: Math.round(estDrop * 10) / 10, estValue, avgBeta: Math.round(avgBeta * 100) / 100 };
      });

      // ─── 仓位管理建议 ───
      // Kelly公式: f* = (p*b - q) / b，其中p=胜率, b=盈亏比, q=1-p
      const winCount = returns.filter(r => r > 0).length;
      const lossCount = returns.filter(r => r < 0).length;
      const avgWin = winCount > 0 ? returns.filter(r => r > 0).reduce((a, b) => a + b, 0) / winCount : 0;
      const avgLoss = lossCount > 0 ? Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0) / lossCount) : 0.001;
      const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 1;
      const pWin = winCount / Math.max(returns.length, 1);
      const kellyFull = payoffRatio > 0 ? (pWin * payoffRatio - (1 - pWin)) / payoffRatio : 0;
      const kellyHalf = Math.max(0, Math.min(1, kellyFull / 2)); // Half-Kelly更保守

      // 风险平价权重
      const tickerVols = returnsSeries.map(rs => {
        const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
        return Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
      });
      const invVols = tickerVols.map(v => v > 0 ? 1 / v : 1);
      const invVolSum = invVols.reduce((a, b) => a + b, 0);
      const riskParityWeights = invVols.map(iv => Math.round(iv / invVolSum * 1000) / 10);

      setBtResult({
        navCurve, drawdownCurve, holdingResults, segments, monthlyReturns, isAnnual,
        corrMatrix, corrTickers: tickers, rebalanceCount,
        stressResults, riskParityWeights,
        kelly: { full: Math.round(kellyFull * 1000) / 10, half: Math.round(kellyHalf * 1000) / 10, payoffRatio: Math.round(payoffRatio * 100) / 100, winRate: Math.round(pWin * 1000) / 10 },
        metrics: {
          totalReturn: Math.round(totalReturn * 100) / 100,
          annReturn: Math.round(annReturn * 100) / 100,
          alpha: Math.round(alpha * 100) / 100,
          benchReturn: Math.round(benchReturn * 100) / 100,
          sharpe: Math.round(sharpe * 100) / 100,
          maxDD: Math.round(maxDD * 100) / 100,
          maxDDDays: ddDays,
          calmar: Math.round(calmar * 100) / 100,
          sortino: Math.round(sortino * 100) / 100,
          winRate: Math.round(winRate * 10) / 10,
          vol: Math.round(vol * 10) / 10,
          var95: Math.round(var95 * 100) / 100,
          var99: Math.round(var99 * 100) / 100,
          benchMaxDD: Math.round(benchMaxDD * 100) / 100,
        },
        finalValue: Math.round(initialCap * finalNav / 100),
      });
      setHasResult(true);
      setBuilderOpen(false);
      setRunning(false);
    }, 600);
  }, [portfolioStocks, initialCap, btRange, getPriceData, rebalance, customStart, customEnd, benchTicker]);

  // 按需加载组合中标的的价格数据（部署版静态数据无 priceRanges）
  useEffect(() => {
    if (portfolioStocks.length === 0) return;
    // 找出缺少当前 btRange 数据的标的
    // 注意：仅当 priceHistory 能覆盖 targetRange（=1Y 及以下）时才允许降级使用
    const targetRange = (btRange === "CUSTOM") ? "5Y" : btRange;
    const canFallbackToHist = ["1M", "6M", "YTD", "1Y"].includes(targetRange);
    const missing = portfolioStocks.filter(p => {
      const stk = p.stk;
      if (!stk) return false;
      const hasRange = stk.priceRanges && stk.priceRanges[targetRange] && stk.priceRanges[targetRange].length >= 2;
      if (hasRange) return false;
      // 5Y / ALL 不可用 priceHistory (=1Y) 降级 —— 会导致标注"全部历史"实际只是 1 年
      if (!canFallbackToHist) return true;
      const hasHist = stk.priceHistory && stk.priceHistory.length >= 2;
      return !hasHist;
    });
    if (missing.length === 0) return;
    let cancelled = false;
    setDataLoading(true);
    setDataLoadMsg(t('正在加载 {n} 个标的的价格数据...', {n: missing.length}));
    (async () => {
      const updates = {};
      await Promise.all(missing.map(async (p) => {
        try {
          let yfSym = p.ticker;
          if (p.ticker.endsWith(".HK")) {
            yfSym = p.ticker.replace(".HK", "").replace(/^0+/, "").padStart(4, "0") + ".HK";
          }
          const data = await fetchRangePrices(yfSym, targetRange);
          if (data && data.length >= 2) updates[p.ticker] = { [targetRange]: data };
        } catch { /* 跳过失败的标的 */ }
      }));
      if (cancelled) return;
      const tickersUpdated = Object.keys(updates);
      if (tickersUpdated.length > 0 && ctxSetStocks2) {
        ctxSetStocks2(prev => prev.map(s => {
          if (!updates[s.ticker]) return s;
          return { ...s, priceRanges: { ...(s.priceRanges || {}), ...updates[s.ticker] } };
        }));
      }
      setDataLoading(false);
      setDataLoadMsg("");
      // 数据到位后允许 autoRan 重新触发一次回测
      autoRan.current = false;
    })();
    return () => { cancelled = true; };
  }, [portfolioStocks, btRange, ctxSetStocks2, t]);

  // 首次打开自动运行回测
  useEffect(() => {
    if (dataLoading) return; // 等待数据加载完成
    if (!autoRan.current && portfolioStocks.length > 0 && !hasResult) {
      // 确认所有标的都有数据再运行
      const targetRange = (btRange === "CUSTOM") ? "5Y" : btRange;
      const ready = portfolioStocks.every(p => {
        const stk = p.stk;
        if (!stk) return false;
        const hasRange = stk.priceRanges && stk.priceRanges[targetRange] && stk.priceRanges[targetRange].length >= 2;
        const hasHist = stk.priceHistory && stk.priceHistory.length >= 2;
        return hasRange || hasHist;
      });
      if (!ready) return;
      autoRan.current = true;
      setTimeout(() => runBacktest(), 300);
    }
  }, [portfolioStocks, dataLoading, btRange, hasResult]);

  const m = btResult?.metrics;

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-5 md:gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      {/* ── 左栏：组合构建器 ── */}
      <div className={`md:col-span-4 flex flex-col gap-2 md:min-h-0 ${builderOpen ? "md:overflow-auto" : ""} pr-0 md:pr-1`}>
        {/* 策略模板 & 分享按钮 */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowTemplates(true)}
            className="flex-1 glass-card p-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 transition-all"
          >
            <BookOpen size={12} /> {t('策略模板库')}
            <span className="text-[9px] text-[#778] font-mono">({BUILTIN_PRESETS.length + templates.length})</span>
          </button>
          <button
            onClick={shareConfig}
            aria-label={t('分享当前组合配置链接')}
            title={t('将组合配置编码到 URL 并复制到剪贴板 — 分享给他人可一键恢复')}
            className="glass-card px-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-violet-300 hover:text-violet-200 hover:bg-violet-500/10 transition-all"
          >
            <Share2 size={12} /> {t('分享')}
          </button>
        </div>
        {shareToast && (
          <div className="glass-card p-2 text-[10px] text-center text-violet-300 animate-slide-up" role="status" aria-live="polite">
            ✓ {shareToast.msg}
          </div>
        )}
        <div className="glass-card p-3">
          {/* 组合构建器 header — 可点击折叠 */}
          <div
            className={`flex items-center justify-between ${builderOpen ? "mb-3" : ""} cursor-pointer select-none`}
            onClick={() => setBuilderOpen(v => !v)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Layers size={14} className="text-indigo-400" />
              <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>{t('组合构建器')}</span>
              {!builderOpen && (
                <span className="text-[10px] text-[#a0aec0] truncate hidden md:inline">
                  {portfolioStocks.map(p => p.ticker).join(" · ")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${totalWeight === 100 ? "bg-up/10 text-up border border-up/20" : totalWeight > 100 ? "bg-down/10 text-down border border-down/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                {totalWeight}% / 100%
              </span>
              <ChevronDown size={14} className={`text-[#a0aec0] shrink-0 transition-transform duration-200 ${builderOpen ? "rotate-180" : ""}`} />
            </div>
          </div>
          {builderOpen && (<>
          {/* 标的权重卡片网格 */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {portfolioStocks.map(({ ticker, weight, stk }, i) => (
              <div key={ticker} className="relative rounded-xl p-2 flex flex-col items-center gap-1 transition-all hover:scale-[1.02]"
                style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-default)" }}>
                {/* Remove button */}
                <button onClick={() => removeTicker(ticker)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 md:w-4 md:h-4 flex items-center justify-center rounded-full bg-white/10 md:bg-transparent text-[#778] hover:text-down hover:bg-down/10 transition-all active:scale-90"
                  title={t("删除")}
                ><X size={9} /></button>
                {/* Ticker / Name & Market */}
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[11px] font-bold truncate max-w-[80px]" style={{ color: "var(--text-heading)" }}>{stk.market === "HK" ? stk.name : ticker}</span>
                  <Badge variant={stk.market === "US" ? "info" : "warning"}>{stk.market}</Badge>
                </div>
                {/* Rotary Knob */}
                <RotaryKnob
                  value={weight}
                  onChange={(v) => setWeight(ticker, v)}
                  size={76}
                  color={PIE_COLORS[i % PIE_COLORS.length]}
                />
              </div>
            ))}
          </div>
          <button onClick={equalizeWeights} className="w-full py-1.5 rounded-lg text-[10px] text-[#a0aec0] bg-white/5 hover:bg-white/10 border border-white/8 mb-2 transition-all flex items-center justify-center gap-1">
            <Target size={10} /> {t('等权分配')}
          </button>
          {/* 搜索添加标的 */}
          <div className="relative">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input
                value={searchAdd}
                onChange={e => setSearchAdd(e.target.value)}
                placeholder={t("搜索代码或名称添加标的...")}
                autoCorrect="off" autoCapitalize="none" spellCheck={false}
                className="w-full rounded-lg pl-7 pr-2 py-2 md:py-1.5 text-[11px] outline-none transition-all"
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            {/* 搜索中... — 向上展示 */}
            {searchingAdd && (
              <div className="absolute bottom-full left-0 right-0 mb-1 glass-card p-2 z-20 flex items-center justify-center text-[10px]" style={{ color: "var(--text-muted)" }}>
                <Loader size={12} className="animate-spin mr-1.5" /> {t('搜索中...')}
              </div>
            )}
            {/* 搜索结果 — 向上展示 */}
            {!searchingAdd && searchAdd.trim() && searchResults.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 glass-card z-20 max-h-[240px] overflow-auto" style={{ boxShadow: "var(--bg-card-shadow)" }}>
                {searchResults.map(r => (
                  <button
                    key={r.symbol}
                    onClick={() => {
                      if (!r.alreadyInPortfolio) {
                        addTickerToPortfolio(r);
                      }
                    }}
                    disabled={r.alreadyInPortfolio}
                    className="w-full text-left px-3 py-2 text-[11px] flex items-center justify-between transition-all group hover:bg-white/5 border-b border-white/5"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-semibold" style={{ color: r.alreadyInPortfolio ? "var(--text-muted)" : "var(--text-heading)" }}>{r.symbol}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent-indigo)" }}>{r.market || "US"}</span>
                      <span className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>{lang === 'zh' ? (STOCK_CN_NAMES[r.symbol] || r.name) : r.name}</span>
                    </div>
                    {r.alreadyInPortfolio ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-up/10 text-up border border-up/20 flex items-center gap-0.5 shrink-0 ml-1">
                        <Check size={8} /> {t('已添加')}
                      </span>
                    ) : (
                      <span className="shrink-0 ml-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5" style={{ color: "var(--accent-indigo)" }}>
                        <Plus size={10} /> {t('添加')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!searchingAdd && searchAdd.trim() && searchResults.length === 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 glass-card p-2 z-20 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
                {t('未找到匹配标的')}
              </div>
            )}
          </div>
          </>)}
        </div>
        {builderOpen && (<>
        {/* 回测参数 */}
        <div className="glass-card p-3 space-y-2">
          <div className="text-xs font-medium text-[#a0aec0] mb-1">{t('回测参数')}</div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">{t('初始资金')}</label>
            <select value={initialCap} onChange={e => setInitialCap(+e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none">
              <option value={50000}>$50,000</option><option value={100000}>$100,000</option><option value={500000}>$500,000</option><option value={1000000}>$1,000,000</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">{t('交易成本 (bps)')}</label>
            <select value={costBps} onChange={e => setCostBps(+e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none">
              <option value={0}>{t('无成本')}</option><option value={10}>10 bps (0.10%)</option><option value={15}>15 bps (0.15%)</option><option value={30}>30 bps (0.30%)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">{t('基准对比')}</label>
            <select value={benchTicker} onChange={e => setBenchTicker(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none">
              <option value="SPY">S&P 500 (SPY)</option><option value="QQQ">{t('纳斯达克 (QQQ)')}</option><option value="EWY">{t('韩国 (EWY)')}</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">{t('回测周期')}</label>
            <div className="flex flex-wrap gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["1M",t("1月")],["6M",t("6月")],["YTD",t("今年")],["1Y",t("1年")],["5Y",t("5年")],["ALL",t("全部")],["CUSTOM",t("自定义")]].map(([k, label]) => (
                <button key={k} onClick={() => setBtRange(k)}
                  className={`flex-1 min-w-0 px-1 py-0.5 rounded text-[10px] font-medium transition-all text-center ${btRange === k ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                >{label}</button>
              ))}
            </div>
            {btRange === "CUSTOM" && (
              <div className="mt-1.5 space-y-1">
                <div className="flex gap-1.5 items-center">
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[10px] outline-none"
                    style={{ color: "var(--text-primary)", colorScheme: "dark" }}
                    max={customEnd || new Date().toISOString().slice(0, 10)}
                  />
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t('至')}</span>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[10px] outline-none"
                    style={{ color: "var(--text-primary)", colorScheme: "dark" }}
                    min={customStart} max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
                <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                  {t('起始日期不早于所有标的数据起点，结束日期不晚于今天')}
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">{t('再平衡策略')}</label>
            <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["none",t("不再平衡")],["quarterly",t("季度再平衡")],["yearly",t("年度再平衡")]].map(([k, label]) => (
                <button key={k} onClick={() => setRebalance(k)}
                  className={`flex-1 px-1 py-0.5 rounded text-[10px] font-medium transition-all text-center ${rebalance === k ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                >{label}</button>
              ))}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {rebalance === "quarterly" ? t("每季度初自动调回初始比例 (1月/4月/7月/10月)") : rebalance === "yearly" ? t("每年1月初自动调回初始比例") : t("持有不动，权重随市场漂移")}
            </div>
          </div>
          <button onClick={runBacktest} disabled={running || portfolioStocks.length < 1 || totalWeight === 0} className={`w-full py-2.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 text-white disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-glow-indigo mt-1 btn-ripple btn-tactile ${!running && totalWeight === 100 ? "animate-pulse-ring" : ""}`}>
            {running ? <><RefreshCw size={12} className="animate-spin" /> {t('计算中...')}</> : <><Zap size={12} /> {t('运行回测')}</>}
          </button>
        </div>
        {/* 配置饼图 */}
        {portfolioStocks.length > 0 && (
          <div className="glass-card p-3">
            <div className="text-xs font-medium text-[#a0aec0] mb-1">{t('配置可视化')}</div>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={portfolioStocks.map(p => ({ name: p.ticker, value: p.weight }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} innerRadius={30} paddingAngle={2} strokeWidth={0}>
                  {portfolioStocks.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, t("权重")]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
              {portfolioStocks.map((p, i) => (
                <div key={p.ticker} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="text-[9px] text-[#a0aec0] truncate">{p.ticker} {p.weight}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </>)}
      </div>

      {/* ── 右栏：回测结果 ── */}
      <div className="md:col-span-8 md:min-h-0 md:overflow-auto pr-0 md:pr-1 mt-2 md:mt-0">
        {!hasResult ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-center" style={{ color: "var(--text-muted)" }}>
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/15 flex items-center justify-center">
                <Activity size={28} className="text-indigo-400/40" />
              </div>
              <span className="text-sm mb-1.5 block font-medium" style={{ color: "var(--text-secondary)" }}>
                {dataLoading ? dataLoadMsg : (running ? t('正在计算回测...') : t('构建组合后自动运行回测'))}
              </span>
              <span className="text-[10px] block">{t('基于 {n} 个标的的真实价格历史 · 支持多时间维度', {n: portfolioStocks.length})}</span>
            </div>
            {/* 相关性矩阵占位框 */}
            {portfolioStocks.length >= 2 && (
              <div className="glass-card p-3 w-full max-w-md">
                <div className="flex items-center gap-2 mb-2">
                  <Database size={12} style={{ color: "var(--text-muted)" }} />
                  <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{t('资产相关性矩阵')}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: "var(--bg-muted)", color: "var(--text-dim)" }}>{t('运行回测后显示')}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-center">
                    <thead>
                      <tr>
                        <th className="text-[8px] md:text-[9px] font-mono p-0.5 md:p-1" style={{ color: "var(--text-muted)" }}></th>
                        {portfolioStocks.map(p => (
                          <th key={p.ticker} className="text-[8px] md:text-[9px] font-mono p-0.5 md:p-1" style={{ color: "var(--text-muted)" }}>{p.ticker}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioStocks.map((p, i) => (
                        <tr key={p.ticker}>
                          <td className="text-[8px] md:text-[9px] font-mono p-0.5 md:p-1 text-left whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{p.ticker}</td>
                          {portfolioStocks.map((_, j) => (
                            <td key={j} className="p-px md:p-0.5">
                              <div className="rounded md:rounded-md py-0.5 md:py-1 px-0.5 text-[8px] md:text-[9px] font-mono" style={{ background: "var(--bg-muted)", color: "var(--text-dim)" }}>
                                {i === j ? "1.00" : "—"}
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : btResult && (
          <div className="flex flex-col gap-2">
            {/* 回测结果 header — 可折叠 */}
            <div className="rounded-xl px-3 py-2.5 border border-indigo-500/15 bg-indigo-500/[0.04]">
              <div
                className="flex items-center justify-between cursor-pointer select-none"
                onClick={() => setResultsOpen(v => !v)}
              >
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-indigo-400" />
                  <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>{t('回测结果')}</span>
                  <span className="text-[10px] text-[#a0aec0] font-mono">
                    {({
                      "1M":t("近1月"),"6M":t("近6月"),"YTD":t("年初至今"),"1Y":t("近1年"),"5Y":t("近5年"),"ALL":t("全部历史"),
                      "CUSTOM": customStart && customEnd ? `${customStart} ~ ${customEnd}` : t("自定义")
                    })[btRange] || btRange}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${m.totalReturn >= 0 ? "bg-up/10 text-up border border-up/20" : "bg-down/10 text-down border border-down/20"}`}>
                    {m.totalReturn >= 0 ? "+" : ""}{m.totalReturn}%
                  </span>
                  <ChevronDown size={14} className={`text-[#a0aec0] shrink-0 transition-transform duration-200 ${resultsOpen ? "rotate-180" : ""}`} />
                </div>
              </div>
            </div>
            {resultsOpen && (<>
            {/* KPI 卡片 — 核心指标 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5">
              {[
                [t("总收益"), `${m.totalReturn >= 0 ? "+" : ""}${m.totalReturn}%`, m.totalReturn >= 0 ? "text-up" : "text-down", m.totalReturn >= 0 ? "positive" : "negative"],
                [t("年化收益"), `${m.annReturn >= 0 ? "+" : ""}${m.annReturn}%`, m.annReturn >= 0 ? "text-up" : "text-down", m.annReturn >= 0 ? "positive" : "negative"],
                [t("超额 α"), `${m.alpha >= 0 ? "+" : ""}${m.alpha}%`, m.alpha >= 0 ? "text-up" : "text-down", m.alpha >= 0 ? "positive" : "negative"],
                [t("终值"), `$${btResult.finalValue.toLocaleString()}`, "text-white", null],
                [t("夏普"), m.sharpe.toFixed(2), m.sharpe > 1 ? "text-up" : m.sharpe > 0.5 ? "text-amber-400" : "text-down", m.sharpe > 1 ? "positive" : "negative"],
                [t("最大回撤"), `${m.maxDD.toFixed(1)}%`, m.maxDD > -10 ? "text-amber-400" : "text-down", "negative"],
              ].map(([l, v, c, delta], idx) => (
                <div key={l} className="kpi-card animate-stagger" style={{ animationDelay: `${idx * 0.05}s` }}>
                  <div className="kpi-label">{l}</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm md:text-base font-bold font-mono tabular-nums leading-tight ${c}`}>{v}</span>
                    {delta && <span className={`delta-chip ${delta}`}>{delta === "positive" ? "▲" : "▼"}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* 净值曲线 */}
            {(() => {
              const baseNav = zoomRange
                ? btResult.navCurve.filter(pt => pt.date >= zoomRange.startDate && pt.date <= zoomRange.endDate)
                : btResult.navCurve;
              // 合并对比运行 — 按 date 索引 lookup（savedRuns 的 navCurve 长度可能不同）
              const navData = savedRuns.length === 0 ? baseNav : baseNav.map(row => {
                const extra = {};
                savedRuns.forEach(run => {
                  const match = run.navCurve.find(p => p.date === row.date);
                  if (match) extra[`run_${run.id}`] = match.strategy;
                });
                return { ...row, ...extra };
              });
              const xInterval = Math.max(1, Math.floor(navData.length / 8));
              return (
              <div className="glass-card p-3" style={{ minHeight: 240 }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#a0aec0]">{t('组合净值曲线')} ({({
                      "1M":t("近1月"),"6M":t("近6月"),"YTD":t("年初至今"),"1Y":t("近1年"),"5Y":t("近5年"),"ALL":t("全部历史"),
                      "CUSTOM": customStart && customEnd ? `${customStart} ~ ${customEnd}` : t("自定义")
                    })[btRange] || btRange})</span>
                    {zoomRange && (
                      <button onClick={() => setZoomRange(null)}
                        className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/25 transition-colors">
                        {zoomRange.label} <span className="text-indigo-400/60 ml-0.5">×</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {savedRuns.length < 3 && (
                      <button
                        onClick={() => {
                          if (!btResult) return;
                          const tickers = portfolioStocks.map(p => `${p.ticker}${p.weight}`).join('/');
                          const label = tickers.length > 24 ? `${t('组合')} ${savedRuns.length + 1}` : tickers;
                          setSavedRuns(prev => [...prev, {
                            id: Date.now(),
                            label,
                            navCurve: btResult.navCurve,
                            metrics: btResult.metrics,
                            color: RUN_COLORS[prev.length % RUN_COLORS.length],
                          }]);
                        }}
                        aria-label={t('保存此次回测用于对比')}
                        title={t('最多保存 3 次回测，叠加在曲线上做对比')}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-md border transition-all bg-violet-500/10 text-violet-300 border-violet-500/30 hover:bg-violet-500/20">
                        + {t('对比')}
                      </button>
                    )}
                    <button
                      onClick={() => setLogScale(v => !v)}
                      aria-pressed={logScale}
                      title={t('对数坐标 — 长周期曲线更直观地呈现复合增长率')}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-md border transition-all ${logScale ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" : "bg-white/[0.04] text-[#a0aec0] border-white/10 hover:bg-white/[0.08]"}`}>
                      log
                    </button>
                    <span className="flex items-center gap-1 text-[10px] text-indigo-400"><span className="w-3 h-0.5 bg-indigo-400 rounded-full inline-block" /> {t('组合')}</span>
                    <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-3 h-0.5 bg-gray-500 rounded-full inline-block" /> {benchTicker}</span>
                    {savedRuns.map((run) => (
                      <span key={run.id} className="flex items-center gap-1 text-[10px] px-1 rounded bg-white/[0.04]" style={{ color: run.color }}>
                        <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: run.color }} />
                        {run.label}
                        <button onClick={() => setSavedRuns(prev => prev.filter(r => r.id !== run.id))}
                          aria-label={`${t('移除对比')} ${run.label}`}
                          className="opacity-60 hover:opacity-100 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <ComposedChart data={navData} className="chart-glow">
                    <defs>
                      <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8A2BE2" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#4169E1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="navStroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#8A2BE2" />
                        <stop offset="100%" stopColor="#4169E1" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#667" }} axisLine={false} tickLine={false} interval={xInterval} />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#667" }}
                      axisLine={false} tickLine={false} width={40}
                      scale={logScale ? "log" : "auto"}
                      domain={logScale ? ["auto", "auto"] : undefined}
                      allowDataOverflow={logScale}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <ReferenceLine y={100} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                    {highlightRange && !zoomRange && <ReferenceArea x1={highlightRange.startDate} x2={highlightRange.endDate}
                      fill={highlightRange.ret >= 0 ? "rgba(0,229,160,0.10)" : "rgba(255,107,107,0.10)"}
                      stroke={highlightRange.ret >= 0 ? "rgba(0,229,160,0.30)" : "rgba(255,107,107,0.30)"}
                      strokeDasharray="2 2" />}
                    <Area type="linear" dataKey="strategy" stroke="url(#navStroke)" strokeWidth={2} fill="url(#navGrad)" dot={false} name={t("组合")} />
                    <Line type="linear" dataKey="benchmark" stroke="#667" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name={benchTicker} />
                    {savedRuns.map(run => (
                      <Line key={run.id} type="linear" dataKey={`run_${run.id}`} stroke={run.color} strokeWidth={1.5} dot={false} strokeDasharray="2 2" name={run.label} connectNulls />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              );
            })()}

            {/* Monte Carlo 未来路径预测 */}
            {(() => {
              const runMC = () => {
                if (!btResult) return;
                setMcRunning(true);
                setTimeout(() => {
                  // 从 navCurve 反推每日收益（使用 math/stats 模块）
                  const navs = btResult.navCurve.map(p => p.strategy);
                  const dailyRets = mcNavToReturns(navs);
                  if (dailyRets.length < 10) { setMcRunning(false); return; }
                  const result = mcSimulate(dailyRets, mcHorizon, 1000, 100);
                  setMcResult(result);
                  setMcRunning(false);
                }, 100);
              };
              return (
                <div className="glass-card p-3" style={{ minHeight: 180 }}>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="section-header mb-0" style={{ marginBottom: 0 }}>
                      <Zap size={11} className="text-indigo-400" />
                      <span className="section-title">{t('蒙特卡洛路径预测')}</span>
                      <span className="text-[9px] text-[#778] font-mono ml-1">1000 {t('次模拟')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={mcHorizon}
                        onChange={(e) => { setMcHorizon(Number(e.target.value)); setMcResult(null); }}
                        aria-label={t('预测期')}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-white/[0.08]">
                        <option value={63}>3 {t('月')}</option>
                        <option value={126}>6 {t('月')}</option>
                        <option value={252}>1 {t('年')}</option>
                        <option value={504}>2 {t('年')}</option>
                      </select>
                      <button
                        onClick={runMC}
                        disabled={mcRunning}
                        className="text-[10px] font-mono px-2.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 disabled:opacity-50 transition-all">
                        {mcRunning ? t('模拟中...') : (mcResult ? t('重新模拟') : t('运行模拟'))}
                      </button>
                    </div>
                  </div>
                  {!mcResult && !mcRunning && (
                    <div className="text-center py-6 text-[11px] text-[#778]">
                      {t('基于历史收益分布，模拟 1000 条未来净值路径 — 显示 5% / 25% / 50% / 75% / 95% 分位带')}
                    </div>
                  )}
                  {mcResult && (
                    <>
                      <div className="grid grid-cols-4 gap-1.5 mb-2">
                        {[
                          [t('悲观 (P5)'), `${mcResult.summary.p5}%`, mcResult.summary.p5 < 100 ? 'text-down' : 'text-up'],
                          [t('中位 (P50)'), `${mcResult.summary.p50}%`, mcResult.summary.p50 < 100 ? 'text-down' : 'text-up'],
                          [t('乐观 (P95)'), `${mcResult.summary.p95}%`, 'text-up'],
                          [t('亏损概率'), `${mcResult.summary.probLoss}%`, mcResult.summary.probLoss > 50 ? 'text-down' : mcResult.summary.probLoss > 25 ? 'text-amber-400' : 'text-up'],
                        ].map(([l, v, c]) => (
                          <div key={l} className="glass-card p-1.5 text-center">
                            <div className="text-[9px] text-[#778]">{l}</div>
                            <div className={`text-[11px] font-mono font-semibold ${c}`}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <ResponsiveContainer width="100%" height={160}>
                        <ComposedChart data={mcResult.bands}>
                          <defs>
                            <linearGradient id="mcBand95" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.15} />
                              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="mcBand75" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                          <XAxis dataKey="step" tick={{ fontSize: 9, fill: "#667" }} axisLine={false} tickLine={false}
                            interval={Math.max(1, Math.floor(mcResult.bands.length / 6))}
                            tickFormatter={(v) => `${Math.round(v / 21)}M`} />
                          <YAxis tick={{ fontSize: 10, fill: "#667" }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} />
                          <Tooltip contentStyle={TOOLTIP_STYLE}
                            formatter={(v, name) => {
                              const map = { p50: t('中位'), band25_75: `25~75%`, band5_95: `5~95%` };
                              return [Array.isArray(v) ? `${v[0]} ~ ${v[1]}` : v, map[name] || name];
                            }}
                            labelFormatter={(v) => `T+${v}d`} />
                          <ReferenceLine y={100} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                          <Area type="monotone" dataKey="band5_95" stroke="none" fill="url(#mcBand95)" name="band5_95" />
                          <Area type="monotone" dataKey="band25_75" stroke="none" fill="url(#mcBand75)" name="band25_75" />
                          <Line type="monotone" dataKey="p50" stroke="#818cf8" strokeWidth={2} dot={false} name="p50" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </>
                  )}
                </div>
              );
            })()}

            {/* 因子暴露分析 — 板块 / 市场 / Beta */}
            {(() => {
              // 聚合板块权重
              const sectorAgg = {};
              portfolioStocks.forEach(({ stk, weight }) => {
                const s = stk?.sector || t('未知');
                sectorAgg[s] = (sectorAgg[s] || 0) + weight;
              });
              const sectorList = Object.entries(sectorAgg)
                .map(([name, w]) => ({ name: t(name), weight: Math.round(w * 10) / 10 }))
                .sort((a, b) => b.weight - a.weight);

              // 聚合市场权重
              const marketAgg = {};
              portfolioStocks.forEach(({ stk, weight }) => {
                const m = stk?.market || 'US';
                marketAgg[m] = (marketAgg[m] || 0) + weight;
              });
              const marketList = Object.entries(marketAgg)
                .map(([name, w]) => ({ name, weight: Math.round(w * 10) / 10 }))
                .sort((a, b) => b.weight - a.weight);

              // 加权 Beta（stressResults 已算过，这里重算保证始终可用）
              const avgBeta = portfolioStocks.reduce((s, ps) => s + (ps.stk?.beta || 1.0) * ps.weight / 100, 0);
              const betaPct = Math.max(0, Math.min(100, (avgBeta / 2.5) * 100)); // 0~2.5 映射到 0~100%

              // 集中度 (HHI) — 使用 math/stats 模块
              const weightArr = portfolioStocks.map(p => p.weight);
              const hhi = hhiCalc(weightArr);
              const effectiveN = effN(weightArr);

              return (
                <div className="glass-card p-3">
                  <div className="section-header mb-3">
                    <Layers size={11} className="text-indigo-400" />
                    <span className="section-title">{t('因子暴露分析')}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 板块分布 */}
                    <div>
                      <div className="text-[10px] text-[#a0aec0] mb-2 flex items-center justify-between">
                        <span>{t('板块分布')}</span>
                        <span className="text-[9px] text-[#778] font-mono">{sectorList.length} {t('类')}</span>
                      </div>
                      <div className="space-y-1.5">
                        {sectorList.slice(0, 5).map((s, i) => (
                          <div key={s.name}>
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span className="truncate" style={{ color: "var(--text-heading)" }}>{s.name}</span>
                              <span className="font-mono text-[#a0aec0]">{s.weight}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s.weight}%`, background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* 市场分布 */}
                    <div>
                      <div className="text-[10px] text-[#a0aec0] mb-2">{t('市场分布')}</div>
                      <div className="space-y-1.5">
                        {marketList.map((m, i) => (
                          <div key={m.name}>
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span style={{ color: "var(--text-heading)" }}>{m.name}</span>
                              <span className="font-mono text-[#a0aec0]">{m.weight}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${m.weight}%`, background: i === 0 ? '#6366f1' : '#ec4899' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-2 border-t border-white/[0.05]">
                        <div className="text-[10px] text-[#a0aec0] mb-1">{t('集中度 (HHI)')}</div>
                        <div className="flex items-baseline gap-2">
                          <span className={`text-sm font-mono font-semibold ${hhi > 0.4 ? 'text-down' : hhi > 0.25 ? 'text-amber-400' : 'text-up'}`}>{hhi.toFixed(3)}</span>
                          <span className="text-[9px] text-[#778]">{t('有效标的')} {effectiveN.toFixed(1)}</span>
                        </div>
                      </div>
                    </div>
                    {/* 加权 Beta */}
                    <div>
                      <div className="text-[10px] text-[#a0aec0] mb-2 flex items-center justify-between">
                        <span>{t('组合 Beta')}</span>
                        <span className={`text-base font-mono font-bold ${avgBeta > 1.3 ? 'text-down' : avgBeta < 0.8 ? 'text-up' : 'text-amber-400'}`}>{avgBeta.toFixed(2)}</span>
                      </div>
                      <div className="relative w-full h-2 rounded-full bg-gradient-to-r from-up/30 via-amber-500/30 to-down/30 mb-1">
                        {/* 1.0 中线标记 */}
                        <div className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: '40%' }} />
                        {/* Beta 指示器 */}
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white shadow-lg shadow-indigo-500/40 transition-all duration-500"
                          style={{ left: `${betaPct}%` }} />
                      </div>
                      <div className="flex justify-between text-[8px] text-[#778] font-mono mb-2">
                        <span>0</span><span>1.0</span><span>2.5+</span>
                      </div>
                      <div className="text-[10px] text-[#a0aec0] leading-relaxed">
                        {avgBeta > 1.3 ? t('高 Beta — 超额放大市场波动，下跌时损失更大') :
                         avgBeta < 0.8 ? t('低 Beta — 防御性偏强，跑不赢牛市但回撤受控') :
                         t('均衡 Beta — 贴近大盘表现')}
                      </div>
                      <div className="mt-3 space-y-1">
                        <div className="text-[10px] text-[#a0aec0]">{t('个股 Beta')}</div>
                        {portfolioStocks.map((p) => (
                          <div key={p.ticker} className="flex items-center justify-between text-[10px]">
                            <span className="font-mono" style={{ color: "var(--text-heading)" }}>{p.ticker}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[#778] font-mono">{p.weight}%</span>
                              <span className={`font-mono font-semibold ${(p.stk?.beta || 1) > 1.3 ? 'text-down' : (p.stk?.beta || 1) < 0.8 ? 'text-up' : 'text-amber-400'}`}>
                                β {(p.stk?.beta || 1).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 第二行: 个股贡献 + 年度收益 + 区间收益 */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              {/* 持仓收益 */}
              <div className="md:col-span-4 glass-card p-3">
                <div className="section-header">
                  <Briefcase size={11} className="text-indigo-400" />
                  <span className="section-title">{t('个股贡献')}</span>
                </div>
                <div className="space-y-1">
                  {btResult.holdingResults.map((h, i) => (
                    <div key={h.ticker} className="flex items-center justify-between py-1 border-b border-white/[0.03] last:border-0">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-[11px] font-mono font-semibold truncate" style={{ color: "var(--text-heading)" }}>{h.ticker}</span>
                        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden max-w-[60px]">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${h.weight}%`, background: PIE_COLORS[i % PIE_COLORS.length] + "80" }} />
                        </div>
                        <span className="text-[9px] text-[#a0aec0] font-mono">{h.weight}%</span>
                      </div>
                      <span className={`text-[11px] font-mono tabular-nums font-bold shrink-0 ml-2 ${h.ret >= 0 ? "text-up" : "text-down"}`}>
                        {h.ret >= 0 ? "+" : ""}{h.ret.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 年度/月度收益分布 */}
              <div className="md:col-span-5 glass-card p-3">
                <div className="section-header">
                  <BarChart3 size={11} className="text-indigo-400" />
                  <span className="section-title">{btResult.isAnnual ? t("年度收益分布") : t("月度收益分布")}</span>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={btResult.monthlyReturns}
                    onMouseMove={(state) => {
                      if (state?.activePayload?.[0]?.payload) {
                        const d = state.activePayload[0].payload;
                        setHighlightRange({ startDate: d.startDate, endDate: d.endDate, ret: d.ret });
                      }
                    }}
                    onMouseLeave={() => setHighlightRange(null)}
                    onClick={(state) => {
                      if (state?.activePayload?.[0]?.payload) {
                        const d = state.activePayload[0].payload;
                        setZoomRange(prev => prev ? null : { startDate: d.startDate, endDate: d.endDate, label: d.month });
                        setHighlightRange(null);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#667" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "#667" }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, btResult.isAnnual ? t("年收益") : t("月收益")]} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
                    <Bar dataKey="ret" radius={[2, 2, 0, 0]}>
                      {btResult.monthlyReturns.map((entry, i) => (
                        <Cell key={i} fill={entry.ret >= 0 ? "var(--accent-up)" : "var(--accent-down)"} fillOpacity={0.7} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 区间收益 */}
              <div className="md:col-span-3 glass-card p-3" onMouseLeave={() => setHighlightRange(null)}>
                <div className="text-xs font-medium text-[#a0aec0] mb-2">{t('区间收益')}</div>
                <div className="space-y-1.5">
                  {btResult.segments.map((seg, i) => (
                    <div key={i} className="flex flex-col gap-0.5 cursor-pointer rounded px-1 -mx-1 transition-colors hover:bg-white/[0.04]"
                      onMouseEnter={() => setHighlightRange({ startDate: seg.startDate, endDate: seg.endDate, ret: seg.ret })}
                      onClick={() => { setZoomRange(prev => prev ? null : { startDate: seg.startDate, endDate: seg.endDate, label: seg.period }); setHighlightRange(null); }}
                    >
                      <span className="text-[9px] text-[#778] truncate">{seg.period}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${Math.min(100, Math.abs(seg.ret) * 3)}%`,
                            background: seg.ret >= 0 ? "var(--accent-up)" : "var(--accent-down)",
                            opacity: 0.6,
                          }} />
                        </div>
                        <span className={`text-[10px] font-mono font-medium w-14 text-right ${seg.ret >= 0 ? "text-up" : "text-down"}`}>
                          {seg.ret >= 0 ? "+" : ""}{seg.ret}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 第三行: Underwater 曲线（含基准对比）+ 风险指标 */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              {/* Underwater 曲线 */}
              <div className="md:col-span-8 glass-card p-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="section-header mb-0" style={{ marginBottom: 0 }}>
                      <TrendingDown size={11} className="text-down" />
                      <span className="section-title">{t('Underwater 曲线')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[9px] text-down"><span className="w-3 h-0.5 bg-down rounded-full inline-block" /> {t('组合 {pct}%', {pct: m?.maxDD})}</span>
                      <span className="flex items-center gap-1 text-[9px] text-amber-400"><span className="w-3 h-0.5 bg-amber-400 rounded-full inline-block" style={{ opacity: 0.6 }} /> {benchTicker} {m?.benchMaxDD || 0}%</span>
                    </div>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-down/10 text-down border border-down/20 w-fit">
                    {t('最长回撤 {n} 天', {n: m.maxDDDays})}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={btResult.drawdownCurve}>
                    <defs>
                      <linearGradient id="underwaterGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF6B6B" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#FF6B6B" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="benchDDGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#667" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(btResult.drawdownCurve.length / 8))} />
                    <YAxis tick={{ fontSize: 9, fill: "#667" }} axisLine={false} tickLine={false} width={35} domain={['dataMin', 0]} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [`${v}%`, name === "drawdown" ? t("组合回撤") : `${benchTicker} ${t("回撤")}`]} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
                    <Area type="linear" dataKey="benchDD" stroke="#f59e0b" fill="url(#benchDDGrad)" strokeWidth={1} dot={false} strokeOpacity={0.6} name="benchDD" />
                    <Area type="linear" dataKey="drawdown" stroke="#FF6B6B" fill="url(#underwaterGrad)" strokeWidth={1.5} dot={false} name="drawdown" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* 风险指标矩阵 */}
              <div className="md:col-span-4 glass-card p-3">
                <div className="section-header mb-2">
                  <Target size={11} className="text-indigo-400" />
                  <span className="section-title">{t('风险指标')}</span>
                </div>
                <div className="space-y-0">
                  {[
                    [t("卡玛比率"), m.calmar.toFixed(2), m.calmar > 2 ? "text-up" : "", t("风险调整后收益")],
                    [t("索提诺比率"), m.sortino.toFixed(2), m.sortino > 1.5 ? "text-up" : "", t("下行风险调整")],
                    [t("胜率"), `${m.winRate}%`, m.winRate > 55 ? "text-up" : "", ""],
                    [t("年化波动率"), `${m.vol}%`, m.vol < 20 ? "text-up" : m.vol < 40 ? "text-amber-400" : "text-down", ""],
                    ["VaR 99%", `${m.var99.toFixed(2)}%`, "text-down", ""],
                    [t("最大回撤天数"), `${m.maxDDDays} ${t("天")}`, m.maxDDDays < 30 ? "text-up" : m.maxDDDays < 60 ? "text-amber-400" : "text-down", ""],
                    [t("基准收益"), `${m.benchReturn >= 0 ? "+" : ""}${m.benchReturn}%`, m.benchReturn >= 0 ? "text-up" : "text-down", ""],
                    [t("基准最大回撤"), `${m.benchMaxDD}%`, "text-down", ""],
                  ].map(([l, v, c, tip]) => (
                    <div key={l} className="flex justify-between items-center py-1.5 border-b border-white/[0.03] last:border-0" title={tip}>
                      <span className="text-[10px] text-[#a0aec0]">{l}</span>
                      <span className={`text-[10px] font-mono font-semibold tabular-nums ${c || ""}`} style={!c ? { color: "var(--text-heading)" } : undefined}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 相关性矩阵 */}
            <div className="glass-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="section-header mb-0" style={{ marginBottom: 0 }}>
                  <Layers size={12} className="text-indigo-400" />
                  <span className="section-title">{t('资产相关性矩阵')}</span>
                </div>
                {btResult.rebalanceCount > 0 && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    {t('再平衡 {n} 次', {n: btResult.rebalanceCount})}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-center" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th className="text-[8px] md:text-[9px] font-mono p-0.5 md:p-1" style={{ color: "var(--text-muted)" }}></th>
                      {btResult.corrTickers.map(t => (
                        <th key={t} className="text-[8px] md:text-[9px] font-mono font-medium p-0.5 md:p-1" style={{ color: "var(--text-heading)" }}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {btResult.corrTickers.map((t, i) => (
                      <tr key={t}>
                        <td className="text-[8px] md:text-[9px] font-mono font-medium p-0.5 md:p-1 text-left whitespace-nowrap" style={{ color: "var(--text-heading)" }}>{t}</td>
                        {btResult.corrMatrix[i].map((val, j) => {
                          const absV = Math.abs(val);
                          const hue = val >= 0 ? 142 : 0;
                          const sat = i === j ? 0 : Math.round(absV * 70);
                          const lum = i === j ? 25 : 15 + Math.round(absV * 15);
                          const alpha = i === j ? 0.3 : 0.15 + absV * 0.5;
                          return (
                            <td key={j} className="p-px md:p-0.5">
                              <div className="rounded md:rounded-md py-0.5 md:py-1 px-0.5 text-[8px] md:text-[9px] font-mono font-medium tabular-nums transition-all"
                                style={{
                                  background: i === j ? "var(--bg-muted)" : `hsla(${hue}, ${sat}%, ${lum}%, ${alpha})`,
                                  color: i === j ? "var(--text-muted)" : val > 0.5 ? "var(--accent-up)" : val < -0.3 ? "var(--accent-down)" : "var(--text-secondary)",
                                }}
                              >
                                {i === j ? "1.00" : val.toFixed(2)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-center gap-4 mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-2 rounded-sm" style={{ background: "hsla(0, 50%, 20%, 0.5)" }} />
                  <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>{t('负相关')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-2 rounded-sm" style={{ background: "var(--bg-muted)" }} />
                  <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>{t('无相关')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-2 rounded-sm" style={{ background: "hsla(142, 50%, 20%, 0.5)" }} />
                  <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>{t('正相关')}</span>
                </div>
              </div>
            </div>

            {/* ─── 压力测试 ─── */}
            <div className="glass-card p-3">
              <div className="section-header">
                <AlertTriangle size={12} className="text-amber-400" />
                <span className="section-title">{t('压力测试 · 极端场景模拟')}</span>
              </div>
              <div className="space-y-2">
                {btResult.stressResults.map((sc, idx) => {
                  const severe = sc.estDrop < -30;
                  const lossWidth = Math.min(Math.abs(sc.estDrop), 100);
                  return (
                    <div key={idx} className={`relative p-2.5 rounded-lg border overflow-hidden transition-all hover:scale-[1.005] ${severe ? "border-red-500/20 bg-red-500/[0.03]" : "border-amber-500/15 bg-amber-500/[0.02]"}`}>
                      {/* Severity indicator bar on the left */}
                      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${severe ? "bg-down" : "bg-amber-400"}`} />
                      <div className="flex items-center justify-between mb-1 pl-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-white">{t(sc.name)}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[#778]">{sc.period}</span>
                        </div>
                        <span className={`text-xs font-bold font-mono tabular-nums ${severe ? "text-down" : "text-amber-400"}`}>
                          {sc.estDrop > 0 ? "+" : ""}{sc.estDrop}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between pl-2">
                        <span className="text-[10px] text-[#a0aec0]">{t(sc.description)}</span>
                        <span className="text-[10px] font-mono text-[#a0aec0]">
                          ${initialCap.toLocaleString()} → <span className={`font-semibold ${severe ? "text-down" : "text-amber-400"}`}>${sc.estValue.toLocaleString()}</span>
                        </span>
                      </div>
                      {/* 损失可视化条 */}
                      <div className="mt-1.5 ml-2 h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${severe ? "bg-down/60" : "bg-amber-500/50"}`} style={{ width: `${lossWidth}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[9px] text-[#778] flex items-center gap-1">
                <span>*</span>
                <span>{t('基于组合 Beta ({beta}) × 波动率比率 × 历史基准跌幅估算，实际表现可能偏离', {beta: btResult.stressResults[0]?.avgBeta})}</span>
              </div>
            </div>

            {/* ─── 仓位管理建议 ─── */}
            <div className="glass-card p-3">
              <div className="section-header">
                <Target size={12} className="text-indigo-400" />
                <span className="section-title">{t('仓位管理建议')}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Kelly公式 */}
                <div className="p-2.5 rounded-lg border border-indigo-500/15 bg-indigo-500/[0.03]">
                  <div className="text-[11px] font-medium text-white mb-2">{t('Kelly 公式')}</div>
                  <div className="space-y-1.5 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-[#a0aec0]">{t('胜率 (p)')}</span>
                      <span className="font-mono text-white">{btResult.kelly.winRate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#a0aec0]">{t('盈亏比 (b)')}</span>
                      <span className="font-mono text-white">{btResult.kelly.payoffRatio}x</span>
                    </div>
                    <div className="flex justify-between border-t border-white/5 pt-1">
                      <span className="text-[#a0aec0]">{t('Full Kelly 仓位')}</span>
                      <span className={`font-mono font-semibold ${btResult.kelly.full > 0 ? "text-up" : "text-down"}`}>{btResult.kelly.full}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#a0aec0]">{t('Half Kelly (建议)')}</span>
                      <span className="font-mono font-semibold text-indigo-400">{btResult.kelly.half}%</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] text-[#778]">{t('f* = (p×b − q) / b，Half Kelly 降低破产风险')}</div>
                </div>
                {/* 风险平价 */}
                <div className="p-2.5 rounded-lg border border-white/10 bg-white/[0.02]">
                  <div className="text-[11px] font-medium text-white mb-2">{t('风险平价权重 vs 当前')}</div>
                  <div className="space-y-1.5">
                    {btResult.corrTickers.map((t, i) => {
                      const rp = btResult.riskParityWeights[i] || 0;
                      const cur = btResult.holdingResults.find(h => h.ticker === t)?.weight || 0;
                      const diff = rp - cur;
                      return (
                        <div key={t} className="flex items-center gap-2 text-[10px]">
                          <span className="font-mono text-white w-16 shrink-0">{t}</span>
                          <div className="flex-1 flex items-center gap-1">
                            <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden relative">
                              <div className="absolute inset-y-0 left-0 rounded-full bg-indigo-500/40" style={{ width: `${rp}%` }} />
                              <div className="absolute inset-y-0 left-0 rounded-full border-r-2 border-white/50" style={{ width: `${cur}%` }} />
                            </div>
                          </div>
                          <span className="font-mono text-[#a0aec0] w-10 text-right">{rp}%</span>
                          <span className={`font-mono w-10 text-right ${diff > 2 ? "text-up" : diff < -2 ? "text-down" : "text-[#778]"}`}>
                            {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[9px] text-[#778]">{t('按波动率倒数分配，使每个标的对组合风险贡献相等')}</div>
                </div>
              </div>
            </div>

            {/* ─── 回测偏差声明 ─── */}
            <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.02] p-3">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle size={13} className="text-amber-400" />
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-amber-400 mb-1.5 tracking-wide uppercase" style={{ letterSpacing: "0.05em" }}>{t('回测偏差声明')}</div>
                  <div className="space-y-1 text-[10px] text-[#a0aec0]">
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">{t('前视偏差')}</b> — {t('当前标的池基于今日可知信息选取，回测期间部分标的可能尚未上市或不在关注范围内')}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">{t('生存者偏差')}</b> — {t('标的池不包含已退市或被收购的股票，可能高估策略表现')}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">{t('交易成本')}</b> — {t('仅模拟固定手续费 ({bps} bps)，未含滑点和市场冲击成本', {bps: costBps})}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">{t('复权处理')}</b> — {t('使用 Yahoo Finance 后复权价格，分红再投资假设可能与实际不符')}</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] text-[#667] italic">{t('过往表现不代表未来收益。回测结果仅供研究参考，不构成投资建议。')}</div>
                </div>
              </div>
            </div>
            </>)}
          </div>
        )}
      </div>

      {/* ── 策略模板库模态框 ── */}
      {showTemplates && (
        <TemplateLibraryModal
          onClose={() => setShowTemplates(false)}
          builtins={BUILTIN_PRESETS}
          userTemplates={templates}
          currentConfig={{ portfolio, initialCap, costBps, benchTicker, btRange, rebalance }}
          onLoad={(tpl) => { loadTemplate(tpl); setShowTemplates(false); }}
          onSave={saveTemplate}
          onDelete={deleteTemplate}
        />
      )}
    </div>
  );
};

// ─── 策略模板库模态框 ─────────────────────────────────
const TemplateLibraryModal = ({ onClose, builtins, userTemplates, currentConfig, onLoad, onSave, onDelete }) => {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const curTickers = Object.keys(currentConfig.portfolio || {});
  const summary = (tpl) => {
    const entries = Object.entries(tpl.portfolio || {}).sort((a, b) => b[1] - a[1]);
    return entries.map(([k, v]) => `${k} ${v}%`).join(" · ");
  };
  const cfgLine = (tpl) => {
    const cap = tpl.initialCap ? `$${(tpl.initialCap / 1000).toFixed(0)}k` : "—";
    const rbl = tpl.rebalance === "none" ? t("不调仓") : tpl.rebalance === "quarterly" ? t("每季度") : t("每年");
    return `${cap} · ${tpl.btRange || "1Y"} · ${rbl} · ${tpl.costBps ?? 15}bps · vs ${tpl.benchTicker || "SPY"}`;
  };
  const handleSave = () => {
    const n = name.trim();
    if (!n) return;
    if (curTickers.length === 0) return;
    onSave(n);
    setName("");
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-indigo-300" />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-heading)" }}>{t('策略模板库')}</h2>
            <span className="text-[10px] text-[#a0aec0]">{builtins.length + userTemplates.length}</span>
          </div>
          <button onClick={onClose} className="text-[#a0aec0] hover:text-white transition-colors p-1 rounded hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* 内置预设 */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#778] font-medium mb-2">{t('内置预设')}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {builtins.map(tpl => (
                <div key={tpl.name} className="glass-card p-3 flex flex-col gap-1.5 hover:border-indigo-400/40 transition-all">
                  <div className="flex items-center justify-between">
                    <div className="text-[12px] font-semibold truncate" style={{ color: "var(--text-heading)" }}>{tpl.name}</div>
                    <button onClick={() => onLoad(tpl)}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 border border-indigo-400/25 shrink-0 ml-2">
                      {t('加载')}
                    </button>
                  </div>
                  <div className="text-[10px] text-[#a0aec0] font-mono truncate">{summary(tpl)}</div>
                  <div className="text-[9px] text-[#667] font-mono">{cfgLine(tpl)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 用户保存 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-[#778] font-medium">{t('我的模板')}</div>
              <span className="text-[9px] text-[#556] font-mono">{userTemplates.length}/20</span>
            </div>
            {userTemplates.length === 0 ? (
              <div className="glass-card p-3 text-center text-[11px] text-[#778]">{t('暂无保存的模板')}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {userTemplates.map(tpl => (
                  <div key={tpl.name} className="glass-card p-3 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-semibold truncate" style={{ color: "var(--text-heading)" }}>{tpl.name}</div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => onLoad(tpl)}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 border border-indigo-400/25">
                          {t('加载')}
                        </button>
                        {confirmDel === tpl.name ? (
                          <>
                            <button onClick={() => { onDelete(tpl.name); setConfirmDel(null); }}
                              className="text-[10px] px-2 py-0.5 rounded-md bg-down/20 text-down border border-down/30 hover:bg-down/30">
                              {t('确认')}
                            </button>
                            <button onClick={() => setConfirmDel(null)}
                              className="text-[10px] px-1.5 py-0.5 rounded-md text-[#778] hover:text-white">
                              ×
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDel(tpl.name)}
                            className="p-1 rounded-md text-[#778] hover:text-down hover:bg-down/10" title={t('删除')}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-[#a0aec0] font-mono truncate">{summary(tpl)}</div>
                    <div className="text-[9px] text-[#667] font-mono">{cfgLine(tpl)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 保存当前配置 */}
          <div className="glass-card p-3 border border-indigo-500/15">
            <div className="text-[10px] uppercase tracking-wider text-[#778] font-medium mb-2">{t('保存当前配置')}</div>
            {curTickers.length === 0 ? (
              <div className="text-[11px] text-[#778]">{t('当前组合为空，无法保存')}</div>
            ) : (
              <>
                <div className="text-[10px] text-[#a0aec0] font-mono truncate mb-2">
                  {curTickers.map(k => `${k} ${currentConfig.portfolio[k]}%`).join(" · ")}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                    placeholder={t('模板名称（例如：我的动量策略）')}
                    className="flex-1 px-3 py-1.5 rounded-md text-[11px] bg-white/5 border border-white/10 focus:border-indigo-400/60 focus:outline-none focus:ring-1 focus:ring-indigo-400/30 text-white placeholder-[#667]"
                    maxLength={40}
                  />
                  <button onClick={handleSave}
                    disabled={!name.trim() || userTemplates.length >= 20}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/35 border border-indigo-400/30 disabled:opacity-40 disabled:cursor-not-allowed">
                    {t('保存')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── MobileAccordion (Monitor 手机端折叠) ─────────────────
const MobileAccordion = ({ title, defaultOpen = false, icon, badge, extra, flex = false, className = "", children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`glass-card ${className}`}>
      <div
        className="flex items-center justify-between p-3 md:p-4 md:pb-2 cursor-pointer md:cursor-default select-none"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-xs font-medium text-[#a0aec0]">{title}</span>
          {badge}
        </div>
        <div className="flex items-center gap-2">
          {extra && <div className="hidden md:flex items-center gap-1.5">{extra}</div>}
          <ChevronDown size={14} className={`text-[#a0aec0] shrink-0 transition-transform duration-200 md:hidden ${open ? "rotate-180" : ""}`} />
        </div>
      </div>
      <div className={`${open ? "" : "hidden"} ${flex ? "md:!flex md:!flex-col md:flex-1 md:min-h-0" : "md:!block"} px-3 pb-3 md:px-4 md:pb-4`}>
        {children}
      </div>
    </div>
  );
};

// ─── Monitor ──────────────────────────────────────────────
// 全局预警规则配置 — 基于当前股票数据动态建议
const ALERT_RULES_KEY = "quantedge_alert_rules";
const AlertRulesPanel = ({ liveStocks, t, lang }) => {
  // 基于数据质量动态生成候选规则
  const candidates = useMemo(() => {
    const rules = [];
    // 高 RSI 的股票
    liveStocks.forEach(s => {
      if (typeof s.rsi === "number" && s.rsi > 65) {
        rules.push({ id: `rsi_${s.ticker}`, tk: s.ticker, ruleKey: "RSI超买", value: `RSI > 70 (${t('当前')} ${s.rsi.toFixed(1)})` });
      }
    });
    // 高评分的股票（监控评分突变）
    liveStocks.filter(s => typeof s.score === "number" && s.score >= 80).slice(0, 2).forEach(s => {
      rules.push({ id: `score_${s.ticker}`, tk: s.ticker, ruleKey: "评分突变", value: `${t('排名变化')} > 3` });
    });
    // 大涨大跌的股票
    liveStocks.filter(s => Math.abs(safeChange(s.change)) >= 5).slice(0, 1).forEach(s => {
      rules.push({ id: `price_${s.ticker}`, tk: s.ticker, ruleKey: "价格突破", value: `${t('单日')} ±5%` });
    });
    return rules.slice(0, 6);
  }, [liveStocks, t]);

  const [activeRules, setActiveRules] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(ALERT_RULES_KEY) || "[]")); }
    catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(ALERT_RULES_KEY, JSON.stringify([...activeRules])); } catch {}
  }, [activeRules]);

  const toggle = (id) => setActiveRules(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (candidates.length === 0) {
    return <div className="text-[11px] text-center py-6" style={{ color: "var(--text-muted)" }}>{t('暂无预警规则候选')}</div>;
  }

  return (
    <div className="space-y-3">
      {candidates.map(r => {
        const stk = liveStocks.find(s => s.ticker === r.tk);
        const nameLabel = displayTicker(r.tk, stk, lang);
        const isActive = activeRules.has(r.id);
        return (
          <button key={r.id} onClick={() => toggle(r.id)} className="w-full flex items-center justify-between gap-2 text-left hover:bg-white/[0.02] -mx-1 px-1 py-0.5 rounded transition-colors">
            <div className="min-w-0">
              <div className="text-xs text-white truncate" title={r.tk}>{nameLabel} {t(r.ruleKey)}</div>
              <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{r.value}</div>
            </div>
            <div className={`w-10 h-5 md:w-8 md:h-4 rounded-full p-0.5 transition-colors shrink-0 ${isActive ? "bg-indigo-500" : "bg-white/10"}`}>
              <div className={`w-4 h-4 md:w-3 md:h-3 rounded-full bg-white transition-transform ${isActive ? "translate-x-5 md:translate-x-4" : ""}`} />
            </div>
          </button>
        );
      })}
      <div className="text-[9px] pt-1" style={{ color: "var(--text-dim)" }}>{t('规则开关已持久化到本地')}</div>
    </div>
  );
};

const Monitor = () => {
  const { t, lang } = useLang();
  const { stocks: ctxStocks3, alerts: ctxAlerts3 } = useContext(DataContext) || {};
  const liveStocks = ctxStocks3 || STOCKS;
  const allAlerts = ctxAlerts3 || ALERTS;
  const [selSector, setSelSector] = useState(null);

  // 预警 ACK / 24h 静音（localStorage 持久化）
  const [ackedIds, setAckedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('quantedge_acked_alerts') || '[]')); }
    catch { return new Set(); }
  });
  const [mutedTickers, setMutedTickers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('quantedge_muted_tickers') || '{}'); }
    catch { return {}; }
  });
  const [showAcked, setShowAcked] = useState(false);

  useEffect(() => { try { localStorage.setItem('quantedge_acked_alerts', JSON.stringify([...ackedIds])); } catch {} }, [ackedIds]);
  useEffect(() => { try { localStorage.setItem('quantedge_muted_tickers', JSON.stringify(mutedTickers)); } catch {} }, [mutedTickers]);

  const now = Date.now();
  const isMuted = (ticker) => mutedTickers[ticker] && mutedTickers[ticker] > now;
  const ackAlert = (id) => setAckedIds(prev => new Set([...prev, id]));
  const unackAlert = (id) => setAckedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  const muteTicker = (ticker) => setMutedTickers(prev => ({ ...prev, [ticker]: now + 24 * 3600 * 1000 }));
  const unmuteTicker = (ticker) => setMutedTickers(prev => { const n = { ...prev }; delete n[ticker]; return n; });

  // 基于实际股票数据动态生成预警（覆盖空的 ALERTS）
  const dynamicAlerts = useMemo(() => {
    const alerts = [];
    liveStocks.forEach(s => {
      const chg = safeChange(s.change);
      if (!isFinite(chg)) return;
      // 单日涨跌 > 5% → 价格预警
      if (Math.abs(chg) >= 5) {
        alerts.push({
          id: `dyn_price_${s.ticker}`,
          ticker: s.ticker,
          type: "price",
          severity: Math.abs(chg) >= 10 ? "high" : "warning",
          message: `${t('今日')}${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% · ${t('显著')}${chg >= 0 ? t("上涨") : t("下跌")}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      }
      // RSI > 70 超买 / < 30 超卖
      if (typeof s.rsi === "number" && s.rsi > 70) {
        alerts.push({
          id: `dyn_rsi_h_${s.ticker}`,
          ticker: s.ticker,
          type: "technical",
          severity: "warning",
          message: `RSI ${s.rsi.toFixed(1)} · ${t('超买区间，注意回调风险')}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      } else if (typeof s.rsi === "number" && s.rsi < 30) {
        alerts.push({
          id: `dyn_rsi_l_${s.ticker}`,
          ticker: s.ticker,
          type: "technical",
          severity: "info",
          message: `RSI ${s.rsi.toFixed(1)} · ${t('超卖区间，可能反弹')}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      }
      // 评分 >= 85 高评
      if (typeof s.score === "number" && s.score >= 85) {
        alerts.push({
          id: `dyn_score_${s.ticker}`,
          ticker: s.ticker,
          type: "score",
          severity: "info",
          message: `${t('评分')} ${s.score.toFixed(1)}/100 · ${t('顶级评级')}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      }
    });
    // 高严重性在前
    alerts.sort((a, b) => {
      const rank = { high: 0, warning: 1, info: 2 };
      return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    });
    return alerts.slice(0, 20);
  }, [liveStocks, t]);

  const mergedAlerts = allAlerts.length > 0 ? allAlerts : dynamicAlerts;
  const liveAlerts = mergedAlerts.filter(a => {
    if (isMuted(a.ticker)) return false;
    if (!showAcked && ackedIds.has(a.id)) return false;
    return true;
  });
  const hiddenCount = mergedAlerts.length - liveAlerts.length;

  // 基于实际股票数据计算板块表现
  const sectors = useMemo(() => {
    const groups = {};
    liveStocks.forEach(s => {
      const chg = safeChange(s.change);
      if (!isFinite(chg) || !s.sector) return;
      // 归类到主要板块
      const key = s.sector.split("/")[0];
      if (!groups[key]) groups[key] = { sum: 0, count: 0 };
      groups[key].sum += chg;
      groups[key].count += 1;
    });
    const result = Object.entries(groups)
      .map(([name, { sum, count }]) => ({ name, value: +(sum / count).toFixed(2), count }))
      .filter(s => s.count >= 2) // 至少 2 个标的才参与统计
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 6);
    return result.map(s => ({ ...s, displayName: t(s.name) }));
  }, [liveStocks, t]);

  // 基于实际涨跌计算市场情绪（Fear & Greed 替代）
  const fearGreed = useMemo(() => {
    if (!liveStocks || liveStocks.length === 0) return 50;
    const valid = liveStocks.map(s => safeChange(s.change)).filter(c => isFinite(c));
    if (valid.length === 0) return 50;
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    const up = valid.filter(c => c > 0).length;
    const breadth = up / valid.length; // 0..1
    // 组合：平均涨跌幅（-5% ~ +5% 映射到 0-100）和宽度
    const avgScore = Math.min(100, Math.max(0, 50 + avg * 8));
    const breadthScore = breadth * 100;
    return Math.round((avgScore * 0.6 + breadthScore * 0.4));
  }, [liveStocks]);

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      <div className="md:col-span-4 flex flex-col gap-4 md:gap-3 md:min-h-0 md:overflow-auto pr-0 md:pr-1">
        <div className="glass-card p-3 md:p-4">
          <div className="section-header mb-3">
            <Activity size={12} className="text-indigo-400" />
            <span className="section-title">{t('市场情绪指数')}</span>
          </div>
          <div className="flex items-center justify-center gap-5">
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                {/* Background segments */}
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--bg-muted)" strokeWidth="7" />
                {/* Active arc */}
                <circle cx="50" cy="50" r="42" fill="none" stroke={`var(--accent-${fearGreed > 60 ? "up" : fearGreed > 40 ? "amber" : "down"})`} strokeWidth="7" strokeDasharray={`${fearGreed * 2.64} 264`} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 8px var(--accent-${fearGreed > 60 ? "up-soft" : fearGreed > 40 ? "amber-soft" : "down-soft"}))` }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold font-mono tabular-nums text-white leading-none">{fearGreed}</span>
                <span className={`text-[10px] font-medium mt-0.5 ${fearGreed > 60 ? "text-up" : fearGreed > 40 ? "text-amber-400" : "text-down"}`}>
                  {fearGreed > 75 ? t("极度贪婪") : fearGreed > 60 ? t("贪婪") : fearGreed > 40 ? t("中性偏贪") : fearGreed > 25 ? t("恐惧") : t("极度恐惧")}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              {[
                [75, 100, t("极度贪婪"), "text-up", "bg-up"],
                [50, 75, t("贪婪"), "text-up", "bg-up"],
                [25, 50, t("恐惧"), "text-amber-400", "bg-amber-400"],
                [0, 25, t("极度恐惧"), "text-down", "bg-down"],
              ].map(([lo, hi, label, color, bg]) => {
                const active = fearGreed >= lo && fearGreed < hi;
                return (
                  <div key={label} className={`flex items-center gap-2 px-2 py-0.5 rounded ${active ? "bg-white/5" : ""}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${bg} ${active ? "opacity-100" : "opacity-30"}`} />
                    <span className={`text-[10px] ${active ? color + " font-semibold" : "text-[#778]"}`}>{lo}–{hi} {label}</span>
                    {active && <span className="text-[9px] text-[#778]">←</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-[9px] mt-3 pt-2 border-t border-white/5 text-center" style={{ color: "var(--text-dim)" }}>
            {t('基于 {n} 个标的的平均涨跌幅和市场宽度计算', {n: liveStocks.length})}
          </div>
        </div>

        <MobileAccordion title={t("关注板块表现 (今日)")}>
          {sectors.length === 0 ? (
            <div className="text-[11px] py-4 text-center" style={{ color: "var(--text-dim)" }}>{t('暂无足够数据计算板块')}</div>
          ) : (
            <div className="space-y-2">
              {sectors.map(s => (
                <button key={s.name} onClick={() => setSelSector(s.name.split("/")[0])} className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selSector === s.name.split("/")[0] ? "bg-indigo-500/10 border border-indigo-500/20" : "hover:bg-white/5 border border-transparent"}`}>
                  <span className="text-xs text-white">{s.displayName}<span className="ml-1.5 text-[9px]" style={{ color: "var(--text-dim)" }}>({s.count})</span></span>
                  <span className={`text-xs font-mono ${s.value >= 0 ? "text-up" : "text-down"}`}>{s.value >= 0 ? "+" : ""}{s.value}%</span>
                </button>
              ))}
            </div>
          )}
        </MobileAccordion>

        <MobileAccordion title={t("板块-ETF 映射")} className="md:flex-1">
          {selSector ? (
            <>
              <div className="text-[10px] mb-3" style={{ color: "var(--text-secondary)" }}>{t('已选: {s}', {s: selSector})}</div>
              {SECTOR_ETF_MAP[selSector] ? (
                <div className="space-y-2">
                  <div className="text-sm font-bold text-white">{SECTOR_ETF_MAP[selSector].etf}</div>
                  <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{SECTOR_ETF_MAP[selSector].name}</div>
                </div>
              ) : (
                <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{t('暂无此板块的 ETF 映射')}</div>
              )}
            </>
          ) : (
            <div className="text-[11px] py-4 text-center" style={{ color: "var(--text-dim)" }}>{t('点击上方板块查看对应 ETF')}</div>
          )}
        </MobileAccordion>
      </div>

      <div className="md:col-span-5 flex flex-col gap-4 md:gap-3 md:min-h-0">
        <MobileAccordion
          title={t("智能预警")}
          icon={<Bell size={14} className="text-indigo-400" />}
          badge={<Badge variant="accent">{liveAlerts.length}</Badge>}
          extra={<><div className="live-dot" /><span className="text-[10px] text-[#a0aec0]">{t('实时数据流')}</span></>}
          flex
          className="md:flex-1 flex flex-col md:min-h-0"
        >
          {(hiddenCount > 0 || Object.keys(mutedTickers).some(k => mutedTickers[k] > now)) && (
            <div className="flex items-center justify-between mb-2 px-1 text-[10px]">
              <button
                onClick={() => setShowAcked(v => !v)}
                className="text-[#a0aec0] hover:text-indigo-300 transition-colors underline-offset-2 hover:underline">
                {showAcked ? t('隐藏已处理') : t('显示已处理')} ({hiddenCount})
              </button>
              {Object.entries(mutedTickers).filter(([, until]) => until > now).map(([tk, until]) => (
                <button key={tk} onClick={() => unmuteTicker(tk)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-white/[0.08] hover:text-white transition-all ml-1"
                  title={`${t('点击取消静音')} (${Math.ceil((until - now) / 3600000)}h)`}>
                  <span className="text-[9px] font-mono">{tk}</span>
                  <span className="text-[9px]">🔕</span>
                </button>
              ))}
            </div>
          )}
          <div className="md:flex-1 md:overflow-auto space-y-2">
            {liveAlerts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <div className="w-10 h-10 rounded-full bg-up/10 border border-up/20 flex items-center justify-center">
                  <Check size={16} className="text-up" />
                </div>
                <div className="text-[11px] text-[#a0aec0] font-medium">{t('暂无预警')}</div>
                <div className="text-[9px] text-[#778]">
                  {hiddenCount > 0 ? `${hiddenCount} ${t('条已处理或静音')}` : t('所有标的运行正常')}
                </div>
              </div>
            )}
            {liveAlerts.map((a, idx) => {
              const isAcked = ackedIds.has(a.id);
              const stkForAlert = liveStocks.find(s => s.ticker === a.ticker);
              const alertLabel = displayTicker(a.ticker, stkForAlert, lang);
              return (
              <div key={a.id} className={`p-3 rounded-lg border transition-all hover:bg-white/[0.02] animate-stagger relative group ${isAcked ? 'opacity-50' : ''} ${a.severity === "high" ? "border-red-500/20 bg-red-500/5" : a.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-sky-500/20 bg-sky-500/5"}`} style={{ animationDelay: `${idx * 0.06}s` }}>
                {a.severity === "high" && !isAcked && <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-down animate-breathe" />}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white" title={a.ticker}>{alertLabel}</span>
                    <Badge variant={a.type === "score" ? "accent" : a.type === "technical" ? "warning" : a.type === "price" ? "danger" : "info"}>
                      {a.type === "score" ? t("评级") : a.type === "technical" ? t("技术") : a.type === "price" ? t("价格") : t("新闻")}
                    </Badge>
                    {isAcked && <span className="text-[9px] text-[#778]">✓ {t('已处理')}</span>}
                  </div>
                  <span className="text-[10px] text-[#a0aec0] font-mono">{a.time}</span>
                </div>
                <p className="text-xs text-[#a0aec0] leading-relaxed">{a.message}</p>
                <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!isAcked ? (
                    <button onClick={() => ackAlert(a.id)} aria-label={t('标记为已处理')}
                      className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-up/10 hover:text-up hover:border-up/30 transition-all">
                      ✓ {t('已处理')}
                    </button>
                  ) : (
                    <button onClick={() => unackAlert(a.id)} aria-label={t('取消已处理')}
                      className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-white/[0.08] transition-all">
                      ↶ {t('撤销')}
                    </button>
                  )}
                  <button onClick={() => muteTicker(a.ticker)} aria-label={`${t('静音')} ${a.ticker} 24h`}
                    className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-amber-400/10 hover:text-amber-300 hover:border-amber-400/30 transition-all">
                    🔕 {t('静音')} 24h
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </MobileAccordion>
      </div>

      <div className="md:col-span-3 flex flex-col gap-4 md:gap-3 md:min-h-0 md:overflow-auto pr-0 md:pr-1">
        <MobileAccordion title={t("标的实时概览")} badge={<span className="text-[9px]" style={{ color: "var(--text-dim)" }}>{liveStocks.length}</span>}>
          <div className="space-y-2 max-h-[400px] md:max-h-none overflow-auto">
            {[...liveStocks].sort((a, b) => Math.abs(safeChange(b.change)) - Math.abs(safeChange(a.change))).slice(0, 30).map((s, idx) => {
              const isHK = s.ticker?.endsWith(".HK");
              const label = displayTicker(s.ticker, s, lang);
              return (
              <div key={s.ticker} className="flex items-center justify-between gap-2 p-1.5 rounded bg-white/[0.02] animate-stagger" style={{ animationDelay: `${Math.min(idx, 10) * 0.02}s` }}>
                <span className={`text-xs text-white truncate min-w-0 ${isHK ? "" : "font-mono"}`} title={s.ticker}>{label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <MiniSparkline data={get5DSparkData(s)} w={40} h={12} />
                  <span className="text-xs font-mono tabular-nums text-[#a0aec0]">{s.currency === "HKD" ? "HK$" : "$"}{s.price}</span>
                  <span className={`text-[10px] font-mono tabular-nums ${safeChange(s.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(s.change) >= 0 ? "+" : ""}{fmtChange(s.change)}%
                  </span>
                </div>
              </div>
              );
            })}
            {liveStocks.length > 30 && (
              <div className="text-[9px] pt-2 text-center" style={{ color: "var(--text-dim)" }}>
                {t('按涨跌幅排序 · 显示前 30 / 共 {n}', {n: liveStocks.length})}
              </div>
            )}
          </div>
        </MobileAccordion>

        <MobileAccordion title={t("预警规则")} className="md:flex-1">
          <AlertRulesPanel liveStocks={liveStocks} t={t} lang={lang} />
        </MobileAccordion>
      </div>
    </div>
  );
};

// ─── Journal ──────────────────────────────────────────────
const JOURNAL_STORAGE_KEY = "quantedge_journal";
const loadJournal = () => {
  try {
    const raw = localStorage.getItem(JOURNAL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};
const saveJournal = (entries) => {
  localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(entries));
};

// ─── 持仓编辑器（股数 + 持有成本） ─────────────────────────
const PositionEditor = ({ entry, currency, onUpdate }) => {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  // 成本单价：优先使用 costBasis，回退到 anchorPrice（兼容旧数据）
  const effectiveCostBasis = entry.costBasis != null ? Number(entry.costBasis) : Number(entry.anchorPrice) || 0;
  const [sharesVal, setSharesVal] = useState(entry.shares ?? "");
  const [costVal, setCostVal] = useState(entry.costBasis ?? entry.anchorPrice ?? "");
  useEffect(() => {
    setSharesVal(entry.shares ?? "");
    setCostVal(entry.costBasis ?? entry.anchorPrice ?? "");
    setEditing(false);
  }, [entry.id]);

  const shares = Number(entry.shares) || 0;
  const hasPos = shares > 0;
  const avgCost = effectiveCostBasis;
  const totalCost = shares * avgCost;
  const value = shares * (Number(entry.currentPrice) || 0);
  const gain = value - totalCost;
  const gainPct = totalCost > 0 ? (gain / totalCost * 100) : 0;

  const save = () => {
    const s = parseFloat(sharesVal);
    const c = parseFloat(costVal);
    const patch = {};
    if (Number.isFinite(s) && s >= 0) patch.shares = s;
    if (Number.isFinite(c) && c >= 0) patch.costBasis = c;
    if (Object.keys(patch).length > 0) onUpdate(patch);
    setEditing(false);
  };

  const cancel = () => {
    setSharesVal(entry.shares ?? "");
    setCostVal(entry.costBasis ?? entry.anchorPrice ?? "");
    setEditing(false);
  };

  return (
    <div className={`glass-card p-3 ${hasPos ? "border border-indigo-500/20" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Briefcase size={12} className="text-indigo-300" />
          <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>{t('我的持仓')}</span>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition-all">
            {hasPos ? t('编辑') : t('添加持仓')}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-[#778] mb-1 block">{t('股数')}</label>
              <div className="relative">
                <input
                  type="number"
                  value={sharesVal}
                  onChange={(e) => setSharesVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
                  autoFocus
                  placeholder="0"
                  min="0"
                  step="any"
                  aria-label={t('股数')}
                  className="w-full px-2.5 py-1.5 pr-7 rounded-md text-xs bg-white/5 border border-white/10 focus:border-indigo-400/60 focus:outline-none focus:ring-1 focus:ring-indigo-400/30 text-white font-mono"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-[#778] pointer-events-none">{t('股')}</span>
              </div>
            </div>
            <div>
              <label className="text-[9px] text-[#778] mb-1 block">{t('持有成本 / 股')}</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#778] pointer-events-none">{currency}</span>
                <input
                  type="number"
                  value={costVal}
                  onChange={(e) => setCostVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
                  placeholder={String(entry.anchorPrice ?? "0")}
                  min="0"
                  step="any"
                  aria-label={t('平均持有成本')}
                  className="w-full pl-6 pr-2 py-1.5 rounded-md text-xs bg-white/5 border border-white/10 focus:border-indigo-400/60 focus:outline-none focus:ring-1 focus:ring-indigo-400/30 text-white font-mono"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={cancel}
              className="text-[11px] px-3 py-1 rounded-md text-[#778] hover:text-white hover:bg-white/5">
              {t('取消')}
            </button>
            <button onClick={save}
              className="text-[11px] px-3 py-1 rounded-md bg-indigo-500/25 text-indigo-200 hover:bg-indigo-500/40 border border-indigo-400/30 font-medium">
              {t('保存')}
            </button>
          </div>
          <div className="text-[9px] text-[#778] leading-relaxed pt-1 border-t border-white/[0.04]">
            {t('提示：持有成本即你实际买入的平均价，与锚定价格（记录时的市价）分开记录。')}
          </div>
        </div>
      ) : hasPos ? (
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-[9px] text-[#778] mb-0.5">{t('持有')}</div>
            <div className="text-xs font-mono tabular-nums" style={{ color: "var(--text-heading)" }}>{shares}</div>
          </div>
          <div>
            <div className="text-[9px] text-[#778] mb-0.5">{t('均价')}</div>
            <div className="text-xs font-mono tabular-nums text-[#a0aec0]">{currency}{avgCost.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[9px] text-[#778] mb-0.5">{t('市值')}</div>
            <div className="text-xs font-mono tabular-nums" style={{ color: "var(--text-heading)" }}>{currency}{value.toFixed(0)}</div>
          </div>
          <div>
            <div className="text-[9px] text-[#778] mb-0.5">{t('盈亏')}</div>
            <div className={`text-xs font-mono tabular-nums font-semibold ${gain >= 0 ? "text-up" : "text-down"}`}>
              {gain >= 0 ? "+" : ""}{currency}{gain.toFixed(0)} <span className="text-[9px]">({gain >= 0 ? "+" : ""}{gainPct.toFixed(1)}%)</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-[#778] text-center py-1">
          {t('尚未记录持仓数量，点击"添加持仓"以跟踪实际盈亏')}
        </div>
      )}
    </div>
  );
};

// ─── 锚定价格内联编辑器 ─────────────────────────────────
const AnchorPriceEditor = ({ entry, currency, onUpdate }) => {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(entry.anchorPrice ?? "");
  useEffect(() => { setVal(entry.anchorPrice ?? ""); setEditing(false); }, [entry.id]);

  const save = () => {
    const n = parseFloat(val);
    if (Number.isFinite(n) && n > 0) onUpdate({ anchorPrice: n });
    setEditing(false);
  };
  const cancel = () => { setVal(entry.anchorPrice ?? ""); setEditing(false); };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[10px] text-[#a0aec0]">{t('锚定')}</span>
        <span className="text-[10px] text-[#a0aec0]">{currency}</span>
        <input
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          autoFocus
          min="0"
          step="any"
          aria-label={t('修改锚定价格')}
          className="w-20 px-1.5 py-0.5 rounded-md text-[10px] bg-white/5 border border-indigo-400/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/30 text-white font-mono"
        />
        <button onClick={save} aria-label={t('保存')}
          className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/25 text-indigo-200 hover:bg-indigo-500/40 border border-indigo-400/30">✓</button>
        <button onClick={cancel} aria-label={t('取消')}
          className="text-[10px] px-1.5 py-0.5 rounded text-[#778] hover:text-white hover:bg-white/5">×</button>
      </span>
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      aria-label={t('点击修改锚定价格')}
      title={t('点击修改锚定价格（记录时的基准价）')}
      className="inline-flex items-center gap-1 text-[10px] text-[#a0aec0] hover:text-indigo-300 px-1 py-0.5 rounded hover:bg-white/5 transition-all group">
      <span>{t('锚定 {currency}{price}', {currency, price: entry.anchorPrice})}</span>
      <svg className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    </button>
  );
};

const Journal = () => {
  const { t, lang } = useLang();
  const { stocks: ctxStocks4, standalone } = useContext(DataContext) || {};
  const liveStocks = ctxStocks4 || STOCKS;
  const [entries, setEntries] = useState(() => {
    const stored = loadJournal();
    // 首次访问：返回空数组而非硬编码示例
    return stored || [];
  });
  const [sel, setSel] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  // Add form state
  const [addTicker, setAddTicker] = useState("");
  const [addThesis, setAddThesis] = useState("");
  const [addTags, setAddTags] = useState("");
  const [addSearchResults, setAddSearchResults] = useState([]);
  const [addSearching, setAddSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  // Initialize sel
  useEffect(() => { if (!sel && entries.length > 0) setSel(entries[0]); }, [entries]);

  // Update currentPrice for all entries from liveStocks（仅在价格实际变化时更新，避免不必要的 localStorage 写入）
  useEffect(() => {
    setEntries(prev => {
      let changed = false;
      const next = prev.map(e => {
        const stk = liveStocks.find(s => s.ticker === e.ticker);
        if (stk && stk.price && stk.price !== e.currentPrice) {
          changed = true;
          return { ...e, currentPrice: stk.price };
        }
        return e;
      });
      return changed ? next : prev;
    });
  }, [liveStocks]);

  // Save to localStorage on change
  useEffect(() => { saveJournal(entries); }, [entries]);

  // Debounced search
  const searchStocks = useCallback(async (q) => {
    if (!q.trim()) { setAddSearchResults([]); return; }
    setAddSearching(true);
    try {
      if (standalone) {
        const results = await standaloneSearch(q.trim());
        setAddSearchResults(results.slice(0, 6));
      } else {
        const res = await apiFetch(`/search?q=${encodeURIComponent(q.trim())}`);
        if (res?.results) setAddSearchResults(res.results.slice(0, 6));
      }
      // Also add local matches
      const localMatches = liveStocks.filter(s =>
        s.ticker.toLowerCase().includes(q.toLowerCase()) ||
        s.name.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 4).map(s => ({
        symbol: s.ticker, name: s.name, market: s.market, price: s.price,
      }));
      setAddSearchResults(prev => {
        const seen = new Set(prev.map(r => r.symbol));
        return [...prev, ...localMatches.filter(m => !seen.has(m.symbol))].slice(0, 8);
      });
    } catch { setAddSearchResults([]); }
    setAddSearching(false);
  }, [standalone, liveStocks]);

  useEffect(() => {
    if (!addTicker.trim() || selectedStock) { setAddSearchResults([]); return; }
    const t = setTimeout(() => searchStocks(addTicker), 400);
    return () => clearTimeout(t);
  }, [addTicker, searchStocks, selectedStock]);

  const handleSelectStock = (r) => {
    setSelectedStock(r);
    setAddTicker(r.symbol);
    setAddSearchResults([]);
  };

  const handleAddEntry = async () => {
    if (!selectedStock) return;
    setAddingEntry(true);
    // Get current price
    let price = selectedStock.price;
    if (!price) {
      const stk = liveStocks.find(s => s.ticker === selectedStock.symbol);
      price = stk?.price || 0;
    }
    if (!price) {
      // Try fetching from Yahoo
      try {
        const data = await fetchStockData(selectedStock.symbol);
        price = data?.price || 0;
      } catch {}
    }
    const newEntry = {
      id: Date.now(),
      ticker: selectedStock.symbol,
      name: selectedStock.name || selectedStock.symbol,
      anchorPrice: price,
      anchorDate: new Date().toISOString().slice(0, 10),
      currentPrice: price,
      thesis: addThesis || "",
      tags: addTags ? addTags.split(/[,，\s]+/).filter(Boolean) : [],
      etf: "N/A",
      sector: "未知",
    };
    setEntries(prev => [newEntry, ...prev]);
    setSel(newEntry);
    setAddTicker(""); setAddThesis(""); setAddTags("");
    setSelectedStock(null); setShowAdd(false);
    setAddingEntry(false);
  };

  const deleteEntry = (id) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      if (sel?.id === id) setSel(next[0] || null);
      return next;
    });
  };

  const updateEntry = (id, patch) => {
    setEntries(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...patch } : e);
      if (sel?.id === id) setSel(s => ({ ...s, ...patch }));
      return next;
    });
  };

  const calcRet = (a, c) => {
    if (!a || a === 0 || c == null) return "0.00";
    const v = (c - a) / a * 100;
    return isFinite(v) ? v.toFixed(2) : "0.00";
  };

  // 持仓汇总（仅统计 shares > 0 的条目）— 优先使用 costBasis，回退到 anchorPrice
  const positionSummary = useMemo(() => {
    const held = entries.filter(e => (e.shares || 0) > 0);
    if (held.length === 0) return null;
    let cost = 0, value = 0;
    held.forEach(e => {
      const s = Number(e.shares) || 0;
      const unitCost = e.costBasis != null ? Number(e.costBasis) : Number(e.anchorPrice) || 0;
      cost += s * unitCost;
      value += s * (Number(e.currentPrice) || 0);
    });
    const gain = value - cost;
    const gainPct = cost > 0 ? (gain / cost * 100) : 0;
    return { count: held.length, cost, value, gain, gainPct };
  }, [entries]);

  const peerData = sel?.ticker === "RKLB" ? [
    { name: "RKLB", pe: -176, yours: true },
    { name: "FLY", pe: -45 },
    { name: "LUNR", pe: -30 },
    { name: "ASTS", pe: -85 },
  ] : sel?.ticker === "SNDK" ? [
    { name: "SNDK", pe: -105, yours: true },
    { name: "MU", pe: 12 },
    { name: "Samsung", pe: 15 },
    { name: "SK Hynix", pe: 8 },
  ] : sel?.ticker === "NVDA" ? [
    { name: "NVDA", pe: 37, yours: true },
    { name: "AMD", pe: 42 },
    { name: "AVGO", pe: 38 },
    { name: "INTC", pe: 25 },
  ] : [
    { name: "00005", pe: 9.2, yours: true },
    { name: "渣打", pe: 8.5 },
    { name: "恒生", pe: 12.1 },
    { name: "中银", pe: 5.2 },
  ];

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-3 md:gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      <div className={`md:col-span-4 flex flex-col gap-3 md:min-h-0 ${mobileShowDetail ? "hidden md:flex" : "flex"}`}>
        <button onClick={() => setShowAdd(!showAdd)} className="w-full py-2.5 rounded-xl text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 flex items-center justify-center gap-1.5 shrink-0">
          <Plus size={14} /> {t('新增看好标的')}
        </button>
        {showAdd && (
          <div className="glass-card p-3 space-y-2 animate-slide-up">
            {/* 搜索标的 */}
            <div className="relative">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input
                  value={addTicker}
                  onChange={e => { setAddTicker(e.target.value); setSelectedStock(null); }}
                  placeholder={t("搜索代码或名称 (如 AAPL, 腾讯)...")}
                  autoCorrect="off" autoCapitalize="none" spellCheck={false}
                  className="w-full rounded-lg pl-8 pr-2 py-2 text-xs outline-none transition-all"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
                />
                {selectedStock && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] px-1.5 py-0.5 rounded-full bg-up/10 text-up border border-up/20 flex items-center gap-0.5">
                    <Check size={8} /> {selectedStock.name}
                  </span>
                )}
              </div>
              {/* 搜索中 */}
              {addSearching && (
                <div className="absolute top-full left-0 right-0 mt-1 glass-card p-2 z-20 flex items-center justify-center text-[10px]" style={{ color: "var(--text-muted)" }}>
                  <Loader size={12} className="animate-spin mr-1.5" /> {t('搜索中...')}
                </div>
              )}
              {/* 搜索结果 */}
              {!addSearching && addSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 glass-card z-20 max-h-[200px] overflow-auto" style={{ boxShadow: "var(--bg-card-shadow)" }}>
                  {addSearchResults.map(r => (
                    <button
                      key={r.symbol}
                      onClick={() => handleSelectStock(r)}
                      className="w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-all hover:bg-white/5 border-b border-white/5"
                    >
                      <span className="font-semibold" style={{ color: "var(--text-heading)" }}>{r.symbol}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent-indigo)" }}>{r.market || "US"}</span>
                      <span className="truncate text-[10px] flex-1" style={{ color: "var(--text-secondary)" }}>{lang === 'zh' ? (STOCK_CN_NAMES[r.symbol] || r.name) : r.name}</span>
                      {r.price && <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>${r.price}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* 投资论点 */}
            <textarea
              value={addThesis}
              onChange={e => setAddThesis(e.target.value)}
              placeholder={t("投资论点 (为什么看好这个标的？)...")}
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
            />
            {/* 标签 */}
            <input
              value={addTags}
              onChange={e => setAddTags(e.target.value)}
              placeholder={t("标签 (用逗号分隔, 如: AI, 半导体, 催化剂)")}
              className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
            />
            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={handleAddEntry}
                disabled={!selectedStock || addingEntry}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 to-violet-500 text-white disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {addingEntry ? <><Loader size={11} className="animate-spin" /> {t('获取价格...')}</> : <><Zap size={11} /> {t('记录 (自动锚定当前价)')}</>}
              </button>
              <button onClick={() => { setShowAdd(false); setAddTicker(""); setAddThesis(""); setAddTags(""); setSelectedStock(null); setAddSearchResults([]); }}
                className="px-4 py-2 rounded-lg text-xs transition-all" style={{ background: "var(--bg-muted)", color: "var(--text-secondary)" }}>
                {t('取消')}
              </button>
            </div>
          </div>
        )}
        {/* 持仓汇总卡片 */}
        {positionSummary && (
          <div className="glass-card p-3 border border-indigo-500/20 animate-slide-up shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Briefcase size={12} className="text-indigo-300" />
                <span className="text-[11px] font-medium" style={{ color: "var(--text-heading)" }}>{t('持仓汇总')}</span>
                <span className="text-[9px] text-[#778] font-mono">· {positionSummary.count} {t('只')}</span>
              </div>
              <span className={`text-[11px] font-bold font-mono tabular-nums ${positionSummary.gain >= 0 ? "text-up" : "text-down"}`}>
                {positionSummary.gain >= 0 ? "+" : ""}{positionSummary.gainPct.toFixed(2)}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[9px] text-[#778] mb-0.5">{t('成本')}</div>
                <div className="text-[11px] font-mono tabular-nums text-[#a0aec0]">${positionSummary.cost.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#778] mb-0.5">{t('市值')}</div>
                <div className="text-[11px] font-mono tabular-nums" style={{ color: "var(--text-heading)" }}>${positionSummary.value.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#778] mb-0.5">{t('盈亏')}</div>
                <div className={`text-[11px] font-mono tabular-nums font-semibold ${positionSummary.gain >= 0 ? "text-up" : "text-down"}`}>
                  {positionSummary.gain >= 0 ? "+" : ""}${positionSummary.gain.toFixed(0)}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto space-y-2">
          {entries.length === 0 && !showAdd && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <BookOpen size={20} className="text-indigo-400" />
              </div>
              <div>
                <div className="text-xs font-medium mb-1" style={{ color: "var(--text-heading)" }}>{t('暂无投资记录')}</div>
                <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t('记录买入理由 · 锚定价格 · 追踪表现')}</div>
              </div>
              <button onClick={() => setShowAdd(true)}
                className="mt-2 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-400/25 hover:bg-indigo-500/25 transition-all btn-tactile flex items-center gap-1.5">
                <Plus size={12} /> {t('添加第一个论点')}
              </button>
            </div>
          )}
          {entries.map(e => {
            const ret = calcRet(e.anchorPrice, e.currentPrice);
            const stk = liveStocks.find(s => s.ticker === e.ticker);
            const currency = stk?.currency === "HKD" ? "HK$" : "$";
            const pnlAmount = e.anchorPrice > 0 ? ((e.currentPrice - e.anchorPrice) / e.anchorPrice * 10000).toFixed(0) : 0; // per $10k
            const hasPos = (e.shares || 0) > 0;
            const isHK = e.ticker?.endsWith(".HK");
            // 港股：主标签=名称，副标签=ticker；美股：主标签=ticker，副标签=英文名
            const mainLabel = isHK
              ? (lang === 'zh' ? (stk?.nameCN || STOCK_CN_NAMES[e.ticker] || stk?.name || e.name) : (stk?.name || e.name || STOCK_CN_NAMES[e.ticker])) || e.ticker
              : e.ticker;
            const subLabel = isHK ? e.ticker : e.name;
            return (
              <div key={e.id} className={`relative w-full text-left p-3 rounded-xl transition-all border cursor-pointer group ${sel?.id === e.id ? "bg-indigo-500/8 border-indigo-500/30" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"}`} onClick={() => { setSel(e); setMobileShowDetail(true); }}>
                {/* 收益率指示条 */}
                <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${ret >= 0 ? "bg-up" : "bg-down"}`} />
                {/* 删除按钮 — 右下角 */}
                <button
                  onClick={(ev) => { ev.stopPropagation(); if (window.confirm(t('确定删除 {ticker} 的投资记录？', {ticker: e.ticker}))) deleteEntry(e.id); }}
                  className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all opacity-0 group-hover:opacity-100 text-down bg-down/[0.08] border border-down/15 hover:bg-down/20 hover:border-down/40"
                  title={t("删除")}
                ><Trash2 size={10} /> {t('删除')}</button>
                <div className="flex items-center justify-between mb-1.5 pl-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm truncate" style={{ color: "var(--text-heading)" }} title={e.ticker}>{mainLabel}</span>
                    <span className="text-[10px] text-[#a0aec0] hidden sm:inline font-mono">{subLabel}</span>
                    {hasPos && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-400/25 font-mono flex items-center gap-0.5 shrink-0" title={t('持仓数量')}>
                        <Briefcase size={8} /> {e.shares}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold font-mono tabular-nums ${ret >= 0 ? "text-up" : "text-down"}`}>
                      {ret >= 0 ? "+" : ""}{ret}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between pl-2 mb-1.5">
                  <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums">
                    <span className="text-[#a0aec0]">{currency}{e.anchorPrice}</span>
                    <span className="text-[#778]">→</span>
                    <span style={{ color: "var(--text-heading)" }}>{currency}{e.currentPrice}</span>
                  </div>
                  <span className="text-[9px] text-[#778] font-mono">{e.anchorDate}</span>
                </div>
                <div className="flex gap-1 flex-wrap pl-2">
                  {(e.tags || []).map(t => {
                    const tc = TAG_COLORS[t] || { bg: "bg-white/5", text: "text-[#a0aec0]", border: "border-white/10" };
                    return <span key={t} className={`px-1.5 py-0.5 rounded text-[9px] border ${tc.bg} ${tc.text} ${tc.border}`}>{t}</span>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`md:col-span-8 md:min-h-0 md:overflow-auto pr-0 md:pr-1 ${mobileShowDetail ? "flex flex-col" : "hidden md:block"}`}>
        {!sel && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-center" style={{ color: "var(--text-muted)" }}>
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/15 flex items-center justify-center">
                <BookOpen size={28} className="text-indigo-400/40" />
              </div>
              <span className="text-sm mb-1.5 block font-medium" style={{ color: "var(--text-secondary)" }}>{t('开始记录你的投资论点')}</span>
              <span className="text-[10px] block">{t('记录买入理由、锚定价格、仓位 · 持续跟踪投资表现')}</span>
            </div>
          </div>
        )}
        {sel && (() => {
          const stk = liveStocks.find(s => s.ticker === sel.ticker);
          const ret = calcRet(sel.anchorPrice, sel.currentPrice);
          const currency = stk?.currency === "HKD" ? "HK$" : "$";
          return (
            <div className="flex flex-col gap-3">
              {/* 手机端返回按钮 */}
              <button onClick={() => setMobileShowDetail(false)} className="md:hidden flex items-center gap-1.5 text-xs text-indigo-400 py-2 px-3 rounded-lg bg-indigo-500/[0.06] border border-indigo-500/15 w-fit active:scale-95 transition-all">
                <ChevronRight size={14} className="rotate-180" /> {t('返回列表')}
              </button>

              <div className="glass-card p-3 md:p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Eye size={14} className="text-indigo-400" />
                    <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>
                      {t('投资论点')} — {sel.ticker?.endsWith(".HK")
                        ? displayTicker(sel.ticker, stk, lang)
                        : <>{sel.ticker} {lang === 'zh' ? (STOCK_CN_NAMES[sel.ticker] || sel.name) : sel.name}</>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                    <span className="text-[10px] text-[#a0aec0]">{t('记录于 {date}', {date: sel.anchorDate})}</span>
                    <AnchorPriceEditor entry={sel} currency={currency} onUpdate={(patch) => updateEntry(sel.id, patch)} />
                    <Badge variant={ret >= 0 ? "success" : "danger"}>
                      {ret >= 0 ? "+" : ""}{ret}% {t('自记录')}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs md:text-sm leading-relaxed border-l-2 border-indigo-500/30 pl-3" style={{ color: "var(--text-secondary)" }}>{sel.thesis}</p>
              </div>

              {/* 持仓编辑 */}
              <PositionEditor entry={sel} currency={currency} onUpdate={(patch) => updateEntry(sel.id, patch)} />

              <div className="grid grid-cols-3 gap-2">
                <div className="glass-card glass-card-hover p-2 md:p-3 text-center">
                  <div className="text-[9px] md:text-[10px] text-[#a0aec0] mb-1">{t('锚定价格')}</div>
                  <div className="text-sm md:text-lg font-bold font-mono tabular-nums" style={{ color: "var(--text-heading)" }}>{currency}{sel.anchorPrice}</div>
                </div>
                <div className="glass-card glass-card-hover p-2 md:p-3 text-center">
                  <div className="text-[9px] md:text-[10px] text-[#a0aec0] mb-1">{t('当前价格')}</div>
                  <div className="text-sm md:text-lg font-bold font-mono tabular-nums" style={{ color: "var(--text-heading)" }}>{currency}{sel.currentPrice}</div>
                </div>
                <div className="glass-card glass-card-hover p-2 md:p-3 text-center">
                  <div className="text-[9px] md:text-[10px] text-[#a0aec0] mb-1">{t('收益率')}</div>
                  <div className={`text-sm md:text-lg font-bold font-mono tabular-nums ${ret >= 0 ? "text-up" : "text-down"}`}>{ret >= 0 ? "+" : ""}{ret}%</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
                <div className="glass-card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={12} className="text-[#a0aec0]" />
                    <span className="text-xs font-medium text-[#a0aec0]">{t('行业PE对标')}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={peerData} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 10, fill: "#667" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#778" }} axisLine={false} tickLine={false} width={60} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="pe" radius={[0, 4, 4, 0]}>
                        {peerData.map((e, i) => <Cell key={i} fill={e.yours ? "#6366f1" : "rgba(255,255,255,0.15)"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="glass-card p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe size={12} className="text-[#a0aec0]" />
                    <span className="text-xs font-medium text-[#a0aec0]">{t('关联 ETF & 关键日期')}</span>
                  </div>
                  <div className="space-y-3">
                    {(() => {
                      const sectorETF = matchSectorETF(sel.sector);
                      return sectorETF ? (
                        <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-bold text-white">{sectorETF.etf}</span>
                          </div>
                          <div className="text-[10px] text-[#a0aec0]">{sectorETF.name}</div>
                        </div>
                      ) : (
                        <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                          <div className="text-xs text-[#a0aec0]">{t('该板块暂无精确对应ETF')}</div>
                        </div>
                      );
                    })()}
                    <div className="space-y-1.5">
                      <div className="text-[10px] text-[#a0aec0] font-medium">{t('关键日期追踪')}</div>
                      {stk?.nextEarnings && (
                        <div className="flex items-center justify-between p-1.5 rounded bg-white/[0.02]">
                          <span className="text-xs text-white">{t('下次财报')}</span>
                          <Badge variant="accent">{stk.nextEarnings}</Badge>
                        </div>
                      )}
                      <div className="flex items-center justify-between p-1.5 rounded bg-white/[0.02]">
                        <span className="text-xs text-white">{t('记录天数')}</span>
                        <span className="text-xs font-mono text-[#a0aec0]">{Math.floor((new Date() - new Date(sel.anchorDate)) / 86400000)}{t('天')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

// ─── Ticker Manager Modal ────────────────────────────────
const TickerManager = ({ open, onClose }) => {
  const { t, lang } = useLang();
  const { stocks, apiOnline, refreshing, refreshData, addTicker, removeTicker } = useData();
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState({});
  const [msg, setMsg] = useState("");
  const [view, setView] = useState("search"); // search | manage

  const doSearch = useCallback(async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    setSearchResults([]);
    const res = await apiFetch(`/search?q=${encodeURIComponent(searchQ.trim())}`);
    if (res?.results) setSearchResults(res.results);
    setSearching(false);
  }, [searchQ]);

  const doAdd = useCallback(async (item) => {
    setAdding(prev => ({ ...prev, [item.symbol]: true }));
    setMsg("");
    const res = await addTicker({
      ticker: item.symbol,
      name: item.name,
      type: item.type,
      market: item.market,
      sector: item.sector,
      currency: item.currency,
    });
    setAdding(prev => ({ ...prev, [item.symbol]: false }));
    if (res?.success) {
      setMsg(`✓ ${item.symbol} ${t('已添加')}`);
      setSearchResults(prev => prev.map(r => r.symbol === item.symbol ? { ...r, alreadyAdded: true } : r));
    } else {
      setMsg(`✗ ${res?.detail || t("添加失败")}`);
    }
  }, [addTicker]);

  const doRemove = useCallback(async (ticker) => {
    const res = await removeTicker(ticker);
    if (res?.success) setMsg(`✓ ${ticker} ${t('已删除')}`);
    else setMsg(`✗ ${res?.detail || t("删除失败")}`);
  }, [removeTicker]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[560px] mx-4 max-h-[80vh] glass-card p-0 flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-indigo-400" />
            <span className="text-sm font-semibold text-white">{t('标的管理')}</span>
            {apiOnline
              ? <span className="flex items-center gap-1 text-[10px] text-up"><div className="live-dot" style={{ width: 4, height: 4 }} /> {t('API 在线')}</span>
              : <span className="text-[10px] text-down">{t('API 离线 — 使用静态数据')}</span>
            }
          </div>
          <button onClick={onClose} aria-label="关闭命令面板" className="p-1 rounded-lg hover:bg-white/5 text-[#a0aec0] hover:text-white transition-colors"><X size={16} /></button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-2">
          <button onClick={() => setView("search")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === "search" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "text-[#a0aec0] hover:text-white"}`}>
            <Search size={12} className="inline mr-1" />{t('搜索添加')}
          </button>
          <button onClick={() => setView("manage")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === "manage" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "text-[#a0aec0] hover:text-white"}`}>
            <Settings size={12} className="inline mr-1" />{t('管理')} ({stocks.length})
          </button>
          <div className="flex-1" />
          <button onClick={refreshData} disabled={refreshing || !apiOnline} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all disabled:opacity-40">
            <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? t("刷新中...") : t("刷新全部")}
          </button>
        </div>

        {/* Message */}
        {msg && <div className="px-4 pb-1"><span className={`text-[10px] ${msg.startsWith("✓") ? "text-up" : "text-down"}`}>{msg}</span></div>}

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 pt-1 min-h-0">
          {!apiOnline ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#778]">
              <Database size={32} className="mb-3 opacity-30" />
              <span className="text-sm mb-1">{t('API 服务未启动')}</span>
              <span className="text-[10px] mb-3 text-center max-w-[320px]">{t('请在终端中运行以下命令启动后端：')}</span>
              <div className="bg-white/5 rounded-lg p-3 text-[11px] font-mono text-indigo-400 border border-white/8">
                cd backend && pip install fastapi uvicorn && python server.py
              </div>
              <span className="text-[10px] text-[#778] mt-3">{t('启动后即可搜索和添加任意股票/ETF')}</span>
            </div>
          ) : view === "search" ? (
            <>
              {/* Search input */}
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a0aec0]" />
                  <input
                    type="text" value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && doSearch()}
                    placeholder={t("输入代码或名称搜索... (如 AAPL, TSLA, 0700.HK)")}
                    autoCorrect="off" autoCapitalize="none" spellCheck={false}
                    className="w-full bg-white/5 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-[#667] outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                  />
                </div>
                <button onClick={doSearch} disabled={searching || !searchQ.trim()} className="px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-indigo-500 to-violet-500 text-white btn-tactile disabled:opacity-40">
                  {searching ? <Loader size={14} className="animate-spin" /> : t("搜索")}
                </button>
              </div>

              {/* Results */}
              {searching ? (
                <div className="flex items-center justify-center py-8">
                  <Loader size={20} className="animate-spin text-indigo-400 mr-2" />
                  <span className="text-xs text-[#a0aec0]">{t('搜索中...')}</span>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-1.5">
                  {searchResults.map((item, idx) => (
                    <div key={item.symbol} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all animate-stagger" style={{ animationDelay: `${idx * 0.04}s` }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-white">{item.symbol}</span>
                          <Badge variant={item.market === "US" ? "info" : "warning"}>{item.market}</Badge>
                          {item.type === "etf" && <Badge variant="accent">ETF</Badge>}
                          {item.price > 0 && <span className="text-[10px] font-mono tabular-nums text-[#a0aec0]">${item.price}</span>}
                          {item.change != null && safeChange(item.change) !== 0 && <span className={`text-[10px] font-mono tabular-nums ${safeChange(item.change) >= 0 ? "text-up" : "text-down"}`}>{safeChange(item.change) >= 0 ? "+" : ""}{fmtChange(item.change)}%</span>}
                        </div>
                        <div className="text-[10px] text-[#a0aec0] truncate">{item.name} {item.sector ? `· ${item.sector}` : ""} {item.exchange ? `· ${item.exchange}` : ""}</div>
                      </div>
                      <button
                        onClick={() => doAdd(item)}
                        disabled={item.alreadyAdded || adding[item.symbol]}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all shrink-0 ml-2 ${
                          item.alreadyAdded ? "bg-up/10 text-up border border-up/20 cursor-default" :
                          adding[item.symbol] ? "bg-white/5 text-[#a0aec0]" :
                          "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 btn-tactile"
                        }`}
                      >
                        {item.alreadyAdded ? <><Check size={10} className="inline mr-0.5" /> {t('已添加')}</> :
                         adding[item.symbol] ? <><Loader size={10} className="inline mr-0.5 animate-spin" /> {t('添加中')}</> :
                         <><Plus size={10} className="inline mr-0.5" /> {t('添加')}</>}
                      </button>
                    </div>
                  ))}
                </div>
              ) : searchQ && !searching ? (
                <div className="text-center py-8 text-[#778] text-xs">{t('未找到匹配结果，请尝试其他关键词')}</div>
              ) : (
                <div className="text-center py-8 text-[#778]">
                  <Search size={24} className="mx-auto mb-2 opacity-30" />
                  <div className="text-xs mb-2">{t('搜索全球股票和 ETF')}</div>
                  <div className="text-[10px] space-y-0.5">
                    <div>{t('支持美股 (AAPL, TSLA)、港股 (0700.HK, 9988.HK)')}</div>
                    <div>{t('支持 ETF (SPY, QQQ, ARKK) 和杠杆 ETF (TQQQ, SOXL)')}</div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Manage view */
            <div className="space-y-1">
              {stocks.map((s, idx) => (
                <div key={s.ticker} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5 animate-stagger" style={{ animationDelay: `${idx * 0.02}s` }}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[10px] font-mono tabular-nums text-[#778] w-4">{s.rank}</span>
                    <span className="text-xs font-semibold text-white">{s.ticker}</span>
                    <Badge variant={s.market === "US" ? "info" : "warning"}>{s.market}</Badge>
                    {s.isETF && <Badge variant="accent">ETF</Badge>}
                    <span className="text-[10px] text-[#a0aec0] truncate">{lang === 'zh' ? (s.nameCN || STOCK_CN_NAMES[s.ticker] || s.name) : s.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono tabular-nums text-white">{s.currency === "HKD" ? "HK$" : "$"}{s.price}</span>
                    <span className={`text-[10px] font-mono tabular-nums ${safeChange(s.change) >= 0 ? "text-up" : "text-down"}`}>{safeChange(s.change) >= 0 ? "+" : ""}{fmtChange(s.change)}%</span>
                    <span className="text-[10px] font-mono tabular-nums text-indigo-400">{s.score}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 text-[10px] text-[#a0aec0]">
          <span>{t('共')} {stocks.length} {t('个标的')}</span>
          <span>{t('数据来源')}: Yahoo Finance API</span>
        </div>
      </div>
    </div>
  );
};

// ─── 时钟组件（独立渲染，避免每秒重绘整个页面） ──────────
const LiveClock = React.memo(() => {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="font-mono tabular-nums text-xs text-[#a0aec0]">{time.toLocaleTimeString("en-GB", { hour12: false })}</span>;
});

// ─── Main ─────────────────────────────────────────────────
// ─── Command Palette (Cmd/Ctrl+K) ──────────────────────────────
const CommandPalette = ({ open, onClose, stocks, onPickStock, onSwitchTab, currentTab }) => {
  const { t, lang } = useLang();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) { setQuery(""); setActiveIdx(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tabItems = TAB_CFG.map(c => ({
      type: "tab", id: c.id, label: t(c.label), icon: c.icon, action: () => onSwitchTab(c.id),
    }));
    const stockItems = (stocks || []).map(s => ({
      type: "stock", id: s.ticker, label: s.ticker,
      sub: lang === 'zh' ? (s.nameCN || STOCK_CN_NAMES[s.ticker] || s.name) : s.name,
      score: s.score, change: safeChange(s.change), market: s.market, sector: s.sector,
      action: () => onPickStock(s),
    }));
    const all = [...tabItems, ...stockItems];
    if (!q) return all.slice(0, 20);
    const scored = all.map(it => {
      const hay = `${it.label} ${it.sub || ""} ${it.sector || ""}`.toLowerCase();
      if (!hay.includes(q)) return null;
      // 简单评分：完全匹配 ticker > 前缀匹配 > 包含匹配
      let s = 0;
      if (it.label.toLowerCase() === q) s = 100;
      else if (it.label.toLowerCase().startsWith(q)) s = 80;
      else if (hay.startsWith(q)) s = 60;
      else s = 30;
      return { ...it, _score: s };
    }).filter(Boolean).sort((a, b) => b._score - a._score);
    return scored.slice(0, 30);
  }, [query, stocks, t, lang, onSwitchTab, onPickStock]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  // Keep active item in view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  const handleKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[activeIdx];
      if (it) { it.action(); onClose(); }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8">
          <Search size={14} className="text-[#a0aec0]" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t("搜索标的 / 跳转页面…")}
            autoCorrect="off" autoCapitalize="none" spellCheck={false}
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder-[#667]"
          />
          <span className="text-[9px] font-mono text-[#667] border border-white/8 rounded px-1 py-0.5">Esc</span>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-[#667] text-xs">{t('未找到匹配项')}</div>
          ) : items.map((it, i) => {
            const Icon = it.icon;
            return (
              <div
                key={`${it.type}-${it.id}`}
                data-idx={i}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { it.action(); onClose(); }}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${activeIdx === i ? "bg-indigo-500/15" : "hover:bg-white/5"}`}
              >
                {it.type === "tab" ? (
                  <>
                    {Icon && <Icon size={14} className="text-indigo-400 shrink-0" />}
                    <span className="text-xs text-white">{it.label}</span>
                    {currentTab === it.id && <span className="ml-auto text-[9px] text-indigo-400 font-mono">{t('当前')}</span>}
                  </>
                ) : (
                  <>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-[#a0aec0] font-mono shrink-0">{it.market}</span>
                    <span className="text-xs font-mono font-semibold text-white shrink-0">{it.label}</span>
                    <span className="text-[10px] text-[#a0aec0] truncate flex-1">{it.sub}</span>
                    {it.score != null && <span className="text-[10px] font-mono tabular-nums text-indigo-300 shrink-0">{it.score.toFixed(1)}</span>}
                    <span className={`text-[10px] font-mono tabular-nums shrink-0 ${it.change >= 0 ? "text-up" : "text-down"}`}>
                      {it.change >= 0 ? "+" : ""}{it.change?.toFixed(2)}%
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/8 text-[9px] text-[#667]">
          <div className="flex items-center gap-2">
            <span><kbd className="font-mono">↑↓</kbd> {t('选择')}</span>
            <span><kbd className="font-mono">⏎</kbd> {t('打开')}</span>
          </div>
          <span className="font-mono">{items.length} {t('项')}</span>
        </div>
      </div>
    </div>
  );
};

// ─── 首次引导 ─────────────────────────────────────────────
const ONBOARD_KEY = "quantedge_onboarded_v1";
const OnboardingTour = ({ open, onClose }) => {
  const { t } = useLang();
  const [step, setStep] = useState(0);
  useEffect(() => { if (open) setStep(0); }, [open]);
  if (!open) return null;
  const steps = [
    {
      icon: <BarChart3 size={28} className="text-indigo-300" />,
      title: t('欢迎来到 QuantEdge'),
      body: t('这是一个端到端量化研究工作台，覆盖 171+ 标的的评分 · 回测 · 监控 · 投资日志。我们用 60 秒带你了解主要功能。'),
    },
    {
      icon: <BarChart3 size={28} className="text-indigo-300" />,
      title: t('① 量化评分'),
      body: t('多因子综合评分（价值 · 动量 · 质量 · 情绪），支持市场/行业筛选、模糊搜索、多标的对比（最多4个）、关注列表。右键标的可快速加入对比或关注。'),
    },
    {
      icon: <Activity size={28} className="text-violet-300" />,
      title: t('② 组合回测'),
      body: t('拖动旋钮分配权重，选择基准与时间维度，一键运行回测。内置 5 个策略预设（动量 / 红利 / 半导体 / 航天 / 60-40），也可保存自己的模板。'),
    },
    {
      icon: <Bell size={28} className="text-amber-300" />,
      title: t('③ 实时监控 & 投资日志'),
      body: t('价格/信号预警自动滚动，重要预警带呼吸发光。投资日志记录持仓锚定价，自动跟踪盈亏。'),
    },
    {
      icon: <KeyRound size={28} className="text-cyan-300" />,
      title: t('快捷键'),
      body: t('Ctrl/⌘ + K 打开全局命令面板，按 / 聚焦搜索，按 1-4 切换页签。右上角用户菜单可随时重开此引导。'),
    },
  ];
  const cur = steps[step];
  const isLast = step === steps.length - 1;
  const finish = () => {
    try { localStorage.setItem(ONBOARD_KEY, "1"); } catch {}
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={finish}>
      <div className="w-full max-w-md glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
        {/* 进度条 */}
        <div className="h-1 bg-white/5">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="p-6 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-white/10">
            {cur.icon}
          </div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-heading)" }}>{cur.title}</h2>
          <p className="text-[12px] leading-relaxed text-[#a0aec0] max-w-sm">{cur.body}</p>
          {/* 点点 */}
          <div className="flex items-center gap-1.5 mt-1">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-indigo-400" : "w-1.5 bg-white/20"}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/8 bg-white/[0.02]">
          <button onClick={finish} className="text-[11px] text-[#778] hover:text-white transition-colors">{t('跳过')}</button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)}
                className="text-[11px] px-3 py-1.5 rounded-md text-[#a0aec0] hover:text-white hover:bg-white/5 transition-all">
                {t('上一步')}
              </button>
            )}
            {isLast ? (
              <button onClick={finish}
                className="text-[11px] font-medium px-4 py-1.5 rounded-md bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:shadow-glow-indigo transition-all">
                {t('开始使用')}
              </button>
            ) : (
              <button onClick={() => setStep(s => s + 1)}
                className="text-[11px] font-medium px-4 py-1.5 rounded-md bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/35 border border-indigo-400/30 transition-all">
                {t('下一步')} →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function QuantPlatformInner() {
  const { stocks, alerts, apiOnline, refreshing, priceUpdatedAt, priceRefreshing, quickPriceRefresh } = useData();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [tab, setTab] = useState("scoring");
  const [showManager, setShowManager] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARD_KEY)) {
        const t = setTimeout(() => setOnboardOpen(true), 800);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);
  useEffect(() => {
    const handler = () => setOnboardOpen(true);
    window.addEventListener("quantedge:showOnboarding", handler);
    return () => window.removeEventListener("quantedge:showOnboarding", handler);
  }, []);
  const [theme, setTheme] = useState(() => localStorage.getItem("quantedge_theme") || "dark");
  useEffect(() => {
    localStorage.setItem("quantedge_theme", theme);
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);
  const toggleTheme = () => setTheme(v => v === "dark" ? "light" : "dark");

  // 全局键盘快捷键
  useEffect(() => {
    const handler = (e) => {
      // Cmd/Ctrl + K — 打开命令面板
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(v => !v);
        return;
      }
      // 1-4 切换 tab（仅当焦点不在输入框时）
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key >= "1" && e.key <= "4") {
        const idx = parseInt(e.key, 10) - 1;
        if (TAB_CFG[idx]) { e.preventDefault(); setTab(TAB_CFG[idx].id); }
      }
      // "/" 聚焦主搜索框
      if (e.key === "/") {
        const input = document.querySelector('input[placeholder*="搜索标的"]');
        if (input) { e.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleCmdPickStock = useCallback((stk) => {
    setTab("scoring");
    // 下一帧派发，确保 ScoringDashboard 已挂载
    setTimeout(() => window.dispatchEvent(new CustomEvent("quantedge:selectStock", { detail: stk })), 30);
  }, []);

  // 未登录显示认证页面
  if (!user) return <AuthPage />;

  return (
    <div className={`w-full h-screen flex flex-col overflow-hidden ${theme === "light" ? "light" : ""}`} style={{
      background: "var(--bg-gradient)",
      fontFamily: "'DM Sans', 'Noto Sans SC', sans-serif", color: "var(--text-primary)",
    }}>
      <a href="#main-content" className="skip-nav">{t('跳至主内容')}</a>
      <header className="flex flex-col md:flex-row items-center justify-between px-3 md:px-6 py-2 md:py-2.5 border-b border-white/5 bg-white/[0.02] backdrop-blur-md flex-shrink-0 gap-2 md:gap-0">
        <div className="flex items-center justify-between w-full md:w-auto">
          <div className="flex items-center gap-2.5 md:gap-3">
            <div className="relative w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Briefcase size={14} className="text-white drop-shadow-sm" />
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-up border border-deep-base" title="系统在线" />
            </div>
            <div className="flex items-center gap-2">
              <div>
                <h1 className="text-xs md:text-sm font-bold tracking-tight text-white leading-tight">QuantEdge</h1>
                <p className="text-[9px] md:text-[10px] text-[#a0aec0] hidden sm:block leading-tight">{t('综合量化投资平台 · 真实数据')}</p>
              </div>
              <span className="hidden lg:inline-flex px-1.5 py-0.5 rounded text-[8px] font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">PRO</span>
            </div>
          </div>
          {/* Mobile: show compact right-side controls */}
          <div className="flex md:hidden items-center gap-1.5">
            <button onClick={toggleTheme} className="p-2.5 rounded-lg bg-white/5 text-[#a0aec0] border border-white/5 transition-all active:scale-95" title={theme === "dark" ? t("切换浅色") : t("切换深色")}>
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={() => setShowManager(true)} className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[10px] font-medium bg-white/5 text-[#a0aec0] border border-white/5 active:scale-95" title={t("标的管理")}>
              <Database size={12} />
              <span>{stocks.length}</span>
            </button>
            <button onClick={() => setShowProfile(true)} className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold shadow-sm ring-1 ring-white/10 active:scale-95" title="账户信息">
              {(user.name || "U").charAt(0).toUpperCase()}
            </button>
          </div>
        </div>

        <nav role="tablist" aria-label={t('主导航')} className="flex items-center gap-0.5 md:gap-1 bg-white/[0.03] rounded-xl p-0.5 md:p-1 gradient-border w-full md:w-auto overflow-x-auto">
          {TAB_CFG.map(c => {
            const I = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => setTab(c.id)}
                role="tab"
                aria-selected={tab === c.id}
                aria-label={t(c.label)}
                className={`relative flex items-center gap-1 md:gap-1.5 px-2.5 md:px-4 py-2 md:py-2 rounded-lg text-[11px] md:text-xs font-medium btn-tactile whitespace-nowrap flex-1 md:flex-none justify-center active:scale-95 ${tab === c.id ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.4)] ring-1 ring-indigo-400/20" : "text-[#a0aec0] hover:text-white hover:bg-white/[0.06]"}`}>
                <I size={13} />{t(c.label)}
              </button>
            );
          })}
        </nav>

        <div className="hidden md:flex items-center gap-2.5">
          {/* Header ticker strip */}
          <div className="flex items-center gap-px rounded-lg bg-white/[0.03] border border-white/5 overflow-hidden">
            {stocks.slice(0, 3).map((s, i) => (
              <div key={s.ticker} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono tabular-nums ${i > 0 ? "border-l border-white/5" : ""}`}>
                <span className="text-[#c8cdd3] font-semibold">{s.ticker}</span>
                <span className={safeChange(s.change) >= 0 ? "text-up" : "text-down"}>{s.currency === "HKD" ? "HK$" : "$"}{s.price}</span>
              </div>
            ))}
          </div>
          <div className="w-px h-5 bg-white/8" />
          <button onClick={toggleTheme} className="p-1.5 rounded-lg bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 border border-white/5 transition-all btn-tactile" title={theme === "dark" ? t("切换浅色模式") : t("切换深色模式")}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={() => setShowManager(true)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 border border-white/5 transition-all btn-tactile" title={t("标的管理")}>
            <Database size={12} />
            <span>{stocks.length}</span>
            {apiOnline && <div className="live-dot" style={{ width: 4, height: 4 }} />}
          </button>
          <div className="flex items-center gap-2">
            <div className="live-dot" />
            <LiveClock />
          </div>
          {/* 用户头像按钮 */}
          <button onClick={() => setShowProfile(true)} className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold shadow-sm hover:shadow-indigo-500/30 hover:shadow-md transition-all btn-tactile ring-1 ring-white/10" title="账户信息">
            {(user.name || "U").charAt(0).toUpperCase()}
          </button>
        </div>
      </header>

      <main id="main-content" role="main" className="flex-1 p-2 md:p-4 min-h-0 overflow-hidden flex flex-col">
        {tab === "scoring" && <ScoringDashboard />}
        {tab === "backtest" && <BacktestEngine />}
        {tab === "monitor" && <Monitor />}
        {tab === "journal" && <Journal />}
      </main>

      <footer className="flex items-center justify-between px-3 md:px-6 py-1.5 md:py-2 border-t border-white/5 bg-white/[0.02] backdrop-blur-sm flex-shrink-0" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-[#a0aec0] flex-wrap">
          {(() => {
            // 数据源状态：有 stocks 就算在线（独立模式下数据来自静态 + Yahoo Vercel 代理）
            const online = stocks.length > 0;
            const source = apiOnline ? "API" : t("Vercel 代理");
            return (
              <>
                <span className="hidden sm:flex items-center gap-1" title={apiOnline ? t('通过后端 API 获取') : t('通过 Vercel serverless 代理直连 Yahoo Finance')}>
                  <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-up animate-pulse" : "bg-amber-400"}`} />
                  Yahoo Finance · {online ? t('在线') : t('离线')}
                </span>
                <span className="hidden md:inline text-[#667] font-mono">· {source}</span>
              </>
            );
          })()}
          <span className="hidden sm:inline text-white/10">|</span>
          <span className="flex items-center gap-1">
            <Clock size={9} className="opacity-60" />
            {priceUpdatedAt ? formatCacheAge(priceUpdatedAt) : "—"}
          </span>
          <span className="hidden md:inline text-white/10">|</span>
          <span className="hidden md:inline">{t('美股')} {stocks.filter(s=>s.market==="US").length} · {t('港股')} {stocks.filter(s=>s.market==="HK").length} · {t('共')} {stocks.length} {t('标的')}</span>
          <button
            onClick={quickPriceRefresh}
            disabled={priceRefreshing}
            className="flex items-center gap-1 px-2.5 py-1.5 md:px-2 md:py-0.5 rounded-lg md:rounded-md bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition-all disabled:opacity-50 active:scale-95 border border-white/5"
            title="快速刷新价格（Yahoo Finance 直接获取）"
          >
            <RefreshCw size={10} className={priceRefreshing ? "animate-spin" : ""} />
            {priceRefreshing ? t("刷新中...") : t("刷新")}
          </button>
        </div>
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <span className="hidden lg:inline-flex items-center gap-1.5 text-[9px] text-[#667]">
            <kbd className="px-1 py-[1px] rounded bg-white/5 border border-white/10 font-mono text-[8px]">⌘K</kbd>
            <span>{t('搜索')}</span>
            <kbd className="px-1 py-[1px] rounded bg-white/5 border border-white/10 font-mono text-[8px] ml-1">Tab</kbd>
            <span>{t('切换')}</span>
          </span>
          <span className="text-[9px] md:text-[10px] text-[#778] font-mono">v0.6.0 · <span className="text-indigo-400/80">Polished</span></span>
        </div>
      </footer>

      <TickerManager open={showManager} onClose={() => setShowManager(false)} />
      <UserProfilePanel open={showProfile} onClose={() => setShowProfile(false)} theme={theme} toggleTheme={toggleTheme} />
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        stocks={stocks}
        currentTab={tab}
        onPickStock={handleCmdPickStock}
        onSwitchTab={setTab}
      />
      <OnboardingTour open={onboardOpen} onClose={() => setOnboardOpen(false)} />
    </div>
  );
}

export default function QuantPlatform() {
  return (
    <LangProvider>
      <AuthProvider>
        <DataProvider>
          <QuantPlatformInner />
        </DataProvider>
      </AuthProvider>
    </LangProvider>
  );
}
