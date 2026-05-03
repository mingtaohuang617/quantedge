import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext, lazy, Suspense } from "react";
// C1/C2: Recharts 已下沉到各 lazy page chunk（CompareModal 已迁至 ScoringDashboard），主文件不再直接依赖
import { TrendingUp, TrendingDown, Search, Bell, BookOpen, BarChart3, Activity, Settings, ChevronRight, ChevronDown, ChevronLeft, Star, AlertTriangle, Clock, Target, Zap, Filter, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Plus, X, Check, Eye, EyeOff, Layers, Globe, Briefcase, Info, Database, Trash2, Loader, ExternalLink, Sun, Moon, Calendar, User, LogOut, Mail, Lock, Shield, KeyRound, UserCircle, Share2, GripVertical, Maximize2, AlertCircle } from "lucide-react";
import { searchTickers as standaloneSearch, fetchStockData, fetchBenchmarkPrices, fetchRangePrices, validateStockData, validateAllStocks, loadStandaloneStocks, saveStandaloneStocks, checkStandaloneMode, resolveSector, STOCK_CN_NAMES, STOCK_CN_DESCS } from "./standalone.js";
import { LangProvider, useLang } from "./i18n.jsx";
import { monteCarlo as mcSimulate, navToReturns as mcNavToReturns, hhi as hhiCalc, effectiveN as effN } from "./math/stats.ts";
import { idbGet, idbSet } from "./lib/idb.js";

// C1/C2: 拆分主文件 + 代码分割 — 各 Tab 按需加载（首屏不打包这些 chunk）
const Journal = lazy(() => import("./pages/Journal.jsx"));
const Monitor = lazy(() => import("./pages/Monitor.jsx"));
const BacktestEngine = lazy(() => import("./pages/BacktestEngine.jsx"));
const ScoringDashboard = lazy(() => import("./pages/ScoringDashboard.jsx"));
const MacroDashboard = lazy(() => import("./pages/MacroDashboard.jsx"));

let STATIC_STOCKS = [];
let STATIC_ALERTS = [];
try {
  const mod = await import("./data.js");
  STATIC_STOCKS = mod.STOCKS || [];
  STATIC_ALERTS = mod.ALERTS || [];
} catch { /* data.js not available in standalone build */ }

// Mutable references — updated by DataProvider on API load
let STOCKS = [...STATIC_STOCKS];
let ALERTS = [...STATIC_ALERTS];

// ─── API helpers ──────────────────────────────────────
const API_BASE = "/api";
export const apiFetch = async (path, opts = {}) => {
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
  // 同步路径：仅 localStorage（保证首屏可立即渲染）
  // 若 localStorage 空，DataProvider 会在挂载后异步从 IDB hydrate
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// C10: 异步从 IndexedDB 拉取大缓存（容量 ≫ localStorage）
export async function loadCacheAsync() {
  const lsRaw = (() => { try { return localStorage.getItem(CACHE_KEY); } catch { return null; } })();
  if (lsRaw) { try { return JSON.parse(lsRaw); } catch {} }
  return await idbGet(CACHE_KEY);
}

function saveCache(stocks, alerts, lastRefresh) {
  const payload = { stocks, alerts, lastRefresh, timestamp: Date.now() };
  const json = JSON.stringify(payload);
  let lsOk = false;
  try {
    localStorage.setItem(CACHE_KEY, json);
    lsOk = true;
  } catch (e) {
    // C10: localStorage 满了 → 退化到只写 IDB；UI 偏好的小数据不会受影响
    console.info('[QuantEdge] localStorage 容量超限，转用 IndexedDB 持久化大缓存');
  }
  // 总是异步镜像到 IDB（即便 localStorage 成功），作为容量保险
  // fire-and-forget，不阻塞调用方
  idbSet(CACHE_KEY, payload).catch(() => {});
  return lsOk;
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
export const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

// ─── C16: Workspace Context (多组合 / 多账户工作区) ───────────
// 每个工作区独立 namespace：journal / backtest templates / saved runs
// 共享：股票池（DataContext.stocks）、主题、密度、Yahoo 缓存
export const WorkspaceContext = createContext(null);
export const useWorkspace = () => useContext(WorkspaceContext);
const WORKSPACES_KEY = "quantedge_workspaces";
const ACTIVE_WORKSPACE_KEY = "quantedge_active_workspace";

function WorkspaceProvider({ children }) {
  // 加载工作区列表（首次 = 自动迁移旧数据到 "default"）
  const [workspaces, setWorkspaces] = useState(() => {
    try {
      const raw = localStorage.getItem(WORKSPACES_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    // 首次运行：检查是否有旧 journal 数据，迁移
    const legacyJournal = localStorage.getItem("quantedge_journal");
    const legacyTemplates = localStorage.getItem("quantedge_bt_templates");
    if (legacyJournal) {
      try { localStorage.setItem("quantedge_journal_default", legacyJournal); } catch {}
    }
    if (legacyTemplates) {
      try { localStorage.setItem("quantedge_bt_templates_default", legacyTemplates); } catch {}
    }
    return [{ id: "default", name: "默认工作区", color: "#6366f1", createdAt: Date.now() }];
  });
  const [activeId, setActiveId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_WORKSPACE_KEY) || "default"; }
    catch { return "default"; }
  });

  useEffect(() => {
    try { localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces)); } catch {}
  }, [workspaces]);
  useEffect(() => {
    try { localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeId); } catch {}
  }, [activeId]);

  const active = workspaces.find(w => w.id === activeId) || workspaces[0];

  const create = (name, color = "#06b6d4") => {
    const id = `ws_${Date.now()}`;
    const ws = { id, name: name || `工作区 ${workspaces.length + 1}`, color, createdAt: Date.now() };
    setWorkspaces(prev => [...prev, ws]);
    setActiveId(id);
    return ws;
  };
  const rename = (id, name) => {
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name } : w));
  };
  const recolor = (id, color) => {
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, color } : w));
  };
  const remove = (id) => {
    if (workspaces.length <= 1) return; // 至少保留一个
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    if (activeId === id) setActiveId(workspaces.find(w => w.id !== id)?.id || "default");
    // 清理该工作区的所有 localStorage
    Object.keys(localStorage).filter(k => k.endsWith(`_${id}`)).forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
  };

  return (
    <WorkspaceContext.Provider value={{ workspaces, active, activeId, setActiveId, create, rename, recolor, remove }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// 工作区命名空间助手 — 在各页面里读写时自动加 ws id 后缀
export const wsKey = (base, wsId) => `${base}_${wsId || 'default'}`;

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

  // C10: localStorage 为空 → 异步从 IndexedDB hydrate（页面切换浏览器/隐私模式后回来仍能找回数据）
  useEffect(() => {
    if (cached?.stocks?.length > 0) return; // localStorage 已有数据，跳过
    let cancelled = false;
    (async () => {
      try {
        const idbCached = await idbGet(CACHE_KEY);
        if (cancelled || !idbCached?.stocks?.length) return;
        // 只在比当前 stocks 更丰富时才覆盖
        if (idbCached.stocks.length > stocks.length) {
          setStocks(idbCached.stocks);
          if (idbCached.alerts) setAlerts(idbCached.alerts);
          // 顺便回填 localStorage（只要未爆容量）
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(idbCached)); } catch {}
          console.info('[QuantEdge] 从 IndexedDB 恢复 ' + idbCached.stocks.length + ' 个标的');
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

export const SECTOR_ETF_MAP = {
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
export const matchSectorETF = (sector) => {
  if (!sector) return null;
  if (SECTOR_ETF_MAP[sector]) return SECTOR_ETF_MAP[sector];
  const prefix = sector.split("/")[0];
  return SECTOR_ETF_MAP[prefix] || null;
};

// ─── Shared Constants ────────────────────────────────────
export const TOOLTIP_STYLE = {
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

export const TAG_COLORS = {
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
export const safeChange = (v) => {
  if (v == null || !isFinite(v)) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
};
export const fmtChange = (v) => {
  const n = safeChange(v);
  return n.toFixed(2);
};

// ─── 多币种显示助手 — 替代散落各处的 `currency === "HKD" ? "HK$" : "$"` ─────
// 用法：const sym = currencySymbol(stk?.currency); fmtPrice(price, currency)
const CURRENCY_SYMBOLS = {
  USD: "$", HKD: "HK$", CNY: "¥", JPY: "¥", KRW: "₩", EUR: "€", GBP: "£",
};
// 不需要小数位的货币（KRW、JPY 单位本身已是整数）
const CURRENCY_NO_DECIMALS = new Set(["KRW", "JPY"]);

export const currencySymbol = (currency) => CURRENCY_SYMBOLS[currency] || "$";

/** 价格格式化：统一加货币符号 + 千分位 + 自适应小数位
 *  - KRW / JPY 整数（韩元、日元单位本身大）
 *  - 其他默认 2 位小数
 *  - 大于 1000 加千分位逗号 */
export const fmtPrice = (price, currency = "USD", opts = {}) => {
  const n = Number(price);
  if (!isFinite(n)) return `${currencySymbol(currency)}—`;
  const noDec = CURRENCY_NO_DECIMALS.has(currency);
  const decimals = opts.decimals != null ? opts.decimals : (noDec ? 0 : 2);
  return `${currencySymbol(currency)}${n.toLocaleString(undefined, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })}`;
};

// ─── 港股显示名称（优先 中文名/英文名），非港股保持 ticker ─────────
// 用于"近期财报、实时监控、投资日志"三处：港股以名称示人，更易识别。
export const displayTicker = (ticker, stock, lang) => {
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
const INVITE_CODE = "MtQuant2026_X9k7P";

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
export const Badge = ({ children, variant = "default", size = "md", dot = false }) => {
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


// 文本匹配高亮 — 高亮搜索命中部分
export const Highlight = ({ text, query }) => {
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
export const CountUp = ({ value, duration = 600, decimals = 2, prefix = "", suffix = "", className = "", thousands = false }) => {
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
  // thousands=true 时用 toLocaleString 加千分位（韩元/日元等大数好读）
  const text = thousands
    ? Number(display).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : Number(display).toFixed(decimals);
  return <span className={className}>{prefix}{text}{suffix}</span>;
};

export const ScoreBar = ({ score, max = 100 }) => {
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
  { id: "macro", label: "宏观看板", icon: Globe },
];

// ─── Scoring ──────────────────────────────────────────────
export const SkeletonBlock = ({ className = "" }) => <div className={`skeleton ${className}`} />;

// 极简纯 SVG 迷你走势图（行内使用，性能优于 Recharts）
export const MiniSparkline = ({ data, w = 56, h = 16 }) => {
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
export const get5DSparkData = (stk) => {
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
export const useContainerSize = () => {
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

export const MobileAccordion = ({ title, defaultOpen = false, icon, badge, extra, flex = false, className = "", children }) => {
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
// ─── C16: WorkspaceSwitcher — 头部工作区切换器 + 管理弹窗 ───
const WS_PRESET_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#a855f7', '#f97316'];
const WorkspaceSwitcher = () => {
  const { t } = useLang();
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name, color }
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(WS_PRESET_COLORS[1]);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setEditing(null); setCreating(false); } };
    setTimeout(() => document.addEventListener('click', handler), 50);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  if (!ws) return null;
  const { workspaces, active, setActiveId, create, rename, recolor, remove } = ws;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 hover:bg-white/10 border border-white/5 transition-all btn-tactile"
        title={t("切换工作区 / 多组合管理")}
      >
        <span className="w-2 h-2 rounded-full" style={{ background: active.color }} />
        <span className="text-white max-w-[90px] truncate">{active.name}</span>
        <ChevronDown size={10} className="text-[#778]" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 glass-card border border-white/10 shadow-2xl shadow-black/50 min-w-[260px]">
          {/* 工作区列表 */}
          <div className="p-1">
            <div className="text-[8px] uppercase tracking-wider text-[#778] px-2 py-1.5 font-mono">{t('工作区')} · {workspaces.length}</div>
            {workspaces.map(w => {
              const isActive = w.id === active.id;
              const isEditing = editing?.id === w.id;
              return (
                <div key={w.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md group ${isActive ? 'bg-indigo-500/10' : 'hover:bg-white/[0.04]'}`}>
                  {isEditing ? (
                    <>
                      <input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { rename(w.id, editing.name); recolor(w.id, editing.color); setEditing(null); }
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        autoFocus
                        className="flex-1 px-1.5 py-0.5 rounded bg-white/5 border border-indigo-400/40 text-xs text-white outline-none font-mono"
                      />
                      <div className="flex gap-0.5">
                        {WS_PRESET_COLORS.map(c => (
                          <button key={c} onClick={() => setEditing({ ...editing, color: c })}
                            className={`w-3 h-3 rounded-full transition ${editing.color === c ? 'ring-2 ring-white/60' : 'opacity-50 hover:opacity-100'}`}
                            style={{ background: c }} />
                        ))}
                      </div>
                      <button onClick={() => { rename(w.id, editing.name); recolor(w.id, editing.color); setEditing(null); }}
                        className="text-[10px] text-up hover:text-up font-bold">✓</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setActiveId(w.id); setOpen(false); }} className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: w.color }} />
                        <span className={`text-xs truncate ${isActive ? 'text-white font-medium' : 'text-[#a0aec0]'}`}>{w.name}</span>
                        {isActive && <Check size={10} className="text-indigo-400 shrink-0" />}
                      </button>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); setEditing({ id: w.id, name: w.name, color: w.color }); }}
                          className="text-[9px] px-1 py-0.5 rounded text-[#778] hover:text-white hover:bg-white/5"
                          title={t('重命名')}>✎</button>
                        {workspaces.length > 1 && (
                          <button onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(t('删除工作区 "{n}"？此操作会清除该工作区的日志和回测模板。', { n: w.name }))) {
                              remove(w.id);
                            }
                          }}
                            className="text-[9px] px-1 py-0.5 rounded text-[#778] hover:text-down hover:bg-down/10"
                            title={t('删除')}>×</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* 新建按钮 */}
          <div className="border-t border-white/5 p-1">
            {creating ? (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) { create(newName.trim(), newColor); setNewName(""); setCreating(false); setOpen(false); }
                    if (e.key === 'Escape') { setCreating(false); setNewName(""); }
                  }}
                  autoFocus
                  placeholder={t("工作区名称")}
                  className="flex-1 px-2 py-1 rounded bg-white/5 border border-indigo-400/40 text-xs text-white outline-none"
                />
                <div className="flex gap-0.5">
                  {WS_PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => setNewColor(c)}
                      className={`w-3 h-3 rounded-full transition ${newColor === c ? 'ring-2 ring-white/60' : 'opacity-50 hover:opacity-100'}`}
                      style={{ background: c }} />
                  ))}
                </div>
                <button onClick={() => { if (newName.trim()) { create(newName.trim(), newColor); setNewName(""); setCreating(false); setOpen(false); } }}
                  className="text-[10px] text-up font-bold">✓</button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 rounded transition">
                <Plus size={11} /> {t('新建工作区')}
              </button>
            )}
          </div>
          <div className="px-3 py-1.5 border-t border-white/5 text-[8px] text-[#667] leading-relaxed">
            {t('每个工作区独立保存日志 / 回测模板。股票池、行情数据全局共享。')}
          </div>
        </div>
      )}
    </div>
  );
};

const LiveClock = React.memo(() => {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="font-mono tabular-nums text-xs text-[#a0aec0]">{time.toLocaleTimeString("en-GB", { hour12: false })}</span>;
});

// ─── Main ─────────────────────────────────────────────────
// ─── Command Palette (Cmd/Ctrl+K) ──────────────────────────────
const CommandPalette = ({ open, onClose, stocks, onPickStock, onSwitchTab, currentTab, onQuickAction, onLoadTemplate }) => {
  const { t, lang } = useLang();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) { setQuery(""); setActiveIdx(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  // C4: 内置策略模板（与 BacktestEngine 保持一致）
  const TEMPLATES = useMemo(() => [
    { name: "🚀 " + t("动量成长"), portfolio: { NVDA: 30, AMD: 20, AVGO: 20, META: 15, GOOGL: 15 }, initialCap: 100000, costBps: 15, benchTicker: "SPY", btRange: "1Y", rebalance: "quarterly" },
    { name: "💎 " + t("红利防御"), portfolio: { PEP: 25, KO: 25, PG: 25, JNJ: 25 }, initialCap: 100000, costBps: 15, benchTicker: "SPY", btRange: "5Y", rebalance: "yearly" },
    { name: "🏭 " + t("半导体重仓"), portfolio: { SMH: 40, NVDA: 20, TSM: 15, AMD: 15, AVGO: 10 }, initialCap: 100000, costBps: 15, benchTicker: "QQQ", btRange: "1Y", rebalance: "quarterly" },
    { name: "🛰️ " + t("航天新兴"), portfolio: { RKLB: 40, UFO: 30, MARS: 20, LUNR: 10 }, initialCap: 100000, costBps: 15, benchTicker: "SPY", btRange: "1Y", rebalance: "none" },
    { name: "⚖️ " + t("60/40 经典"), portfolio: { SPY: 60, TLT: 40 }, initialCap: 100000, costBps: 10, benchTicker: "SPY", btRange: "5Y", rebalance: "yearly" },
  ], [t]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tabItems = TAB_CFG.map(c => ({
      type: "tab", id: c.id, label: t(c.label), icon: c.icon, action: () => onSwitchTab(c.id),
    }));
    // C4: 快捷动作
    const actionItems = [
      { type: "action", id: "act_theme", label: t("切换深色 / 浅色"), sub: t("Theme toggle"), action: () => onQuickAction?.('theme') },
      { type: "action", id: "act_density", label: t("切换表格密度"), sub: t("Density: cozy / compact / dense"), action: () => onQuickAction?.('density') },
      { type: "action", id: "act_layout", label: t("切换 Bloomberg 侧栏 / 顶部导航"), sub: t("Layout: topbar / sidebar"), action: () => onQuickAction?.('layout') },
      { type: "action", id: "act_refresh", label: t("刷新行情"), sub: t("Yahoo Finance"), action: () => onQuickAction?.('refresh') },
      { type: "action", id: "act_onboarding", label: t("打开使用教程"), sub: t("Onboarding tour"), action: () => onQuickAction?.('onboarding') },
    ];
    // C4: 策略模板（点击 → 加载到回测引擎并跳转）
    const tplItems = TEMPLATES.map((tpl, i) => ({
      type: "template", id: `tpl_${i}`, label: tpl.name,
      sub: `${Object.keys(tpl.portfolio).join(' / ')} · ${tpl.btRange}`,
      action: () => onLoadTemplate?.(tpl),
    }));
    const stockItems = (stocks || []).map(s => ({
      type: "stock", id: s.ticker, label: s.ticker,
      sub: lang === 'zh' ? (s.nameCN || STOCK_CN_NAMES[s.ticker] || s.name) : s.name,
      score: s.score, change: safeChange(s.change), market: s.market, sector: s.sector,
      action: () => onPickStock(s),
    }));
    const all = [...tabItems, ...actionItems, ...tplItems, ...stockItems];
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
                    <span className="ml-auto text-[8px] text-[#778] font-mono uppercase">{t('页面')}</span>
                    {currentTab === it.id && <span className="ml-1 text-[9px] text-indigo-400 font-mono">{t('当前')}</span>}
                  </>
                ) : it.type === "action" ? (
                  <>
                    <Settings size={14} className="text-amber-400 shrink-0" />
                    <span className="text-xs text-white">{it.label}</span>
                    <span className="text-[10px] text-[#a0aec0] truncate flex-1">{it.sub}</span>
                    <span className="text-[8px] text-[#778] font-mono uppercase shrink-0">{t('动作')}</span>
                  </>
                ) : it.type === "template" ? (
                  <>
                    <Activity size={14} className="text-cyan-400 shrink-0" />
                    <span className="text-xs text-white shrink-0">{it.label}</span>
                    <span className="text-[10px] text-[#a0aec0] truncate flex-1 font-mono">{it.sub}</span>
                    <span className="text-[8px] text-cyan-400 font-mono uppercase shrink-0">{t('模板')}</span>
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

  // H5: PWA 状态 — 新版本可用 + 安装到桌面
  const [swUpdateReg, setSwUpdateReg] = useState(null);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  useEffect(() => {
    const onUpdate = (e) => setSwUpdateReg(e.detail?.reg || null);
    const onBeforeInstall = (e) => { e.preventDefault(); setInstallPromptEvent(e); };
    const onInstalled = () => setInstallPromptEvent(null);
    window.addEventListener("quantedge:swUpdate", onUpdate);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("quantedge:swUpdate", onUpdate);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const applySwUpdate = () => {
    if (swUpdateReg?.waiting) {
      swUpdateReg.waiting.postMessage("SKIP_WAITING"); // 触发 controllerchange → 自动 reload
    } else {
      window.location.reload();
    }
  };
  const promptInstall = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === "accepted") setInstallPromptEvent(null);
  };
  const [theme, setTheme] = useState(() => localStorage.getItem("quantedge_theme") || "dark");
  useEffect(() => {
    localStorage.setItem("quantedge_theme", theme);
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);
  const toggleTheme = () => setTheme(v => v === "dark" ? "light" : "dark");
  // S2: 表格密度切换（cozy / compact / dense）— 默认 compact，活跃量化玩家更喜欢密集
  const [density, setDensity] = useState(() => localStorage.getItem("quantedge_density") || "compact");
  useEffect(() => {
    localStorage.setItem("quantedge_density", density);
  }, [density]);
  const cycleDensity = () => setDensity(d => d === "cozy" ? "compact" : d === "compact" ? "dense" : "cozy");
  // C9: 布局模式 — "topbar"（默认顶部水平 tab）/ "sidebar"（Bloomberg 风左侧栏，仅桌面）
  const [layoutMode, setLayoutMode] = useState(() => localStorage.getItem("quantedge_layout") || "topbar");
  useEffect(() => {
    localStorage.setItem("quantedge_layout", layoutMode);
  }, [layoutMode]);
  const toggleLayout = () => setLayoutMode(m => m === "topbar" ? "sidebar" : "topbar");
  const useSidebar = layoutMode === "sidebar";

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

  // S5: 跨 Tab 跳转监听 — Journal 持仓 → 回测引擎
  useEffect(() => {
    const handler = (e) => {
      const target = e.detail;
      if (target && typeof target === 'string') setTab(target);
    };
    window.addEventListener("quantedge:nav", handler);
    return () => window.removeEventListener("quantedge:nav", handler);
  }, []);

  // 未登录显示认证页面
  if (!user) return <AuthPage />;

  // footer 共享：市场计数（IIFE 外也要用，所以提到组件顶层）
  const usCount = stocks.filter(s => s.market === "US").length;
  const hkCount = stocks.filter(s => s.market === "HK").length;
  const cnCount = stocks.filter(s => ["SH", "SZ", "CN"].includes(s.market)).length;
  const krCount = stocks.filter(s => s.market === "KR").length;
  const jpCount = stocks.filter(s => s.market === "JP").length;

  return (
    <div className={`w-full h-screen flex flex-col overflow-hidden density-${density} ${theme === "light" ? "light" : ""} ${useSidebar ? 'md:pl-12' : ''}`} style={{
      background: "var(--bg-gradient)",
      fontFamily: "'DM Sans', 'Noto Sans SC', sans-serif", color: "var(--text-primary)",
    }}>
      <a href="#main-content" className="skip-nav">{t('跳至主内容')}</a>
      {/* C9: Bloomberg 风左侧栏（仅桌面 + sidebar 模式） */}
      {useSidebar && (
        <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-12 flex-col items-stretch border-r border-white/8 bg-white/[0.02] backdrop-blur-md py-2 group/sidebar hover:w-44 transition-[width] duration-200">
          <div className="px-2 py-1 mb-2 flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-[10px] shrink-0">QE</div>
            <span className="text-[11px] font-semibold text-white opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 whitespace-nowrap">QuantEdge</span>
          </div>
          <nav role="tablist" aria-label={t('主导航')} className="flex flex-col gap-0.5 px-1.5">
            {TAB_CFG.map(c => {
              const I = c.icon;
              const active = tab === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setTab(c.id)}
                  role="tab"
                  aria-selected={active}
                  aria-label={t(c.label)}
                  className={`relative flex items-center gap-2 px-2 py-2 rounded-lg text-[11px] font-medium transition-all overflow-hidden whitespace-nowrap btn-tactile ${active ? "bg-gradient-to-r from-indigo-500/30 to-violet-500/15 text-white ring-1 ring-indigo-400/25" : "text-[#a0aec0] hover:text-white hover:bg-white/[0.06]"}`}
                >
                  <I size={14} className="shrink-0" />
                  <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200">{t(c.label)}</span>
                  {active && <span className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-indigo-400 rounded-l" />}
                </button>
              );
            })}
          </nav>
          {/* 底部：⌘K 提示 */}
          <div className="mt-auto px-2 py-2 text-[8px] text-[#667] flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
            <kbd className="px-1 py-[1px] rounded bg-white/5 border border-white/10 font-mono">⌘K</kbd>
            <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200">{t('搜索')}</span>
          </div>
        </aside>
      )}
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

        <nav role="tablist" aria-label={t('主导航')} className={`${useSidebar ? 'flex md:hidden' : 'flex'} items-center gap-0.5 md:gap-1 bg-white/[0.03] rounded-xl p-0.5 md:p-1 gradient-border w-full md:w-auto overflow-x-auto`}>
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
          {/* C16: 工作区切换器 */}
          <WorkspaceSwitcher />
          <div className="w-px h-5 bg-white/8" />
          <button onClick={toggleTheme} className="p-1.5 rounded-lg bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 border border-white/5 transition-all btn-tactile" title={theme === "dark" ? t("切换浅色模式") : t("切换深色模式")}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          {/* S2: 表格密度切换 */}
          <button onClick={cycleDensity}
            className="px-2 py-1.5 rounded-lg text-[10px] font-mono font-medium bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 border border-white/5 transition-all btn-tactile tabular-nums"
            title={t("表格密度: 点击切换 舒适 / 紧凑 / 密集")}
          >
            {density === "cozy" ? "≡" : density === "compact" ? "≣" : "▦"}
          </button>
          {/* C9: Bloomberg 布局切换 — 仅桌面有效 */}
          <button onClick={toggleLayout}
            className={`hidden md:flex items-center px-2 py-1.5 rounded-lg text-[10px] font-mono font-medium border transition-all btn-tactile ${useSidebar ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' : 'bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 border-white/5'}`}
            title={useSidebar ? t("已切换 Bloomberg 侧栏布局，点击恢复顶部导航") : t("切换为 Bloomberg 风左侧栏（仅桌面）")}
          >
            {useSidebar ? '◧' : '◨'}
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
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-[#778] text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
              {t('加载中…')}
            </div>
          </div>
        }>
          {tab === "scoring" && <ScoringDashboard />}
          {tab === "backtest" && <BacktestEngine />}
          {tab === "monitor" && <Monitor />}
          {tab === "journal" && <Journal />}
          {tab === "macro" && <MacroDashboard />}
        </Suspense>
      </main>

      <footer className="flex items-center justify-between px-3 md:px-6 py-1.5 md:py-2 border-t border-white/5 bg-white/[0.02] backdrop-blur-sm flex-shrink-0" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-[#a0aec0] flex-wrap">
          {(() => {
            // S15: 数据源面板 — 鼠标悬停展示完整诊断信息
            // usCount/hkCount/cnCount/krCount/jpCount 由组件顶层的常量提供
            const online = stocks.length > 0;
            const source = apiOnline ? "API" : t("Vercel 代理");
            const ageMs = priceUpdatedAt ? Date.now() - priceUpdatedAt : null;
            const fresh = ageMs != null && ageMs < 2 * 60 * 1000; // 2 分钟内算新鲜
            return (
              <div className="relative group">
                <button className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/5 transition cursor-help">
                  <span className={`w-1.5 h-1.5 rounded-full ${online ? (fresh ? "bg-up animate-pulse" : "bg-up") : "bg-amber-400"}`} />
                  <span className="font-mono">Yahoo · {source}</span>
                  <ChevronDown size={9} className="opacity-40 group-hover:opacity-80" />
                </button>
                {/* 悬停面板 */}
                <div className="absolute left-0 bottom-full mb-1.5 z-30 hidden group-hover:block pointer-events-none">
                  <div className="glass-card p-2.5 min-w-[260px] border border-indigo-500/30 shadow-2xl text-[10px]">
                    <div className="text-[9px] text-indigo-300 uppercase tracking-wider font-semibold mb-1.5 flex items-center gap-1">
                      <Database size={10} /> {t('数据源诊断')}
                    </div>
                    <div className="space-y-1 tabular-nums">
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('状态')}</span>
                        <span className={`flex items-center gap-1 font-mono ${online ? 'text-up' : 'text-amber-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-up" : "bg-amber-400"}`} />
                          {online ? t('在线') : t('离线')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('数据源')}</span>
                        <span className="font-mono text-[#a0aec0]">{source}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('代理路径')}</span>
                        <span className="font-mono text-[#a0aec0] text-[9px]">/api/yahoo</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('最后刷新')}</span>
                        <span className={`font-mono ${fresh ? 'text-up' : 'text-[#a0aec0]'}`}>
                          {priceUpdatedAt ? formatCacheAge(priceUpdatedAt) : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('缓存')}</span>
                        <span className="font-mono text-[#a0aec0]">{ageMs != null ? `${(ageMs/1000).toFixed(0)}s ago` : '—'}</span>
                      </div>
                      <div className="border-t border-white/5 my-1" />
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('美股 / 港股')}</span>
                        <span className="font-mono text-[#a0aec0]">{usCount} / {hkCount}</span>
                      </div>
                      {(cnCount + krCount + jpCount) > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-[#778]">{t('A股 / 韩股 / 日股')}</span>
                          <span className="font-mono text-[#a0aec0]">{cnCount} / {krCount} / {jpCount}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('总标的')}</span>
                        <span className="font-mono text-cyan-300">{stocks.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('持久化')}</span>
                        <span className="font-mono text-[#a0aec0]">localStorage + IndexedDB</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#778]">{t('模式')}</span>
                        <span className="font-mono text-[#a0aec0]">{apiOnline ? t('后端 API 直连') : t('独立 + 代理')}</span>
                      </div>
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[8px] text-[#667] leading-relaxed">
                      {t('点击右侧"刷新"按钮立即拉取最新行情')}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          <span className="hidden sm:inline text-white/10">|</span>
          <span className="flex items-center gap-1">
            <Clock size={9} className="opacity-60" />
            {priceUpdatedAt ? formatCacheAge(priceUpdatedAt) : "—"}
          </span>
          <span className="hidden md:inline text-white/10">|</span>
          <span className="hidden md:inline">
            {t('美股')} {usCount} · {t('港股')} {hkCount}
            {cnCount > 0 && <> · {t('A股')} {cnCount}</>}
            {krCount > 0 && <> · {t('韩股')} {krCount}</>}
            {jpCount > 0 && <> · {t('日股')} {jpCount}</>}
            {' '}· {t('共')} {stocks.length} {t('标的')}
          </span>
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
          {/* H5: PWA 安装到桌面 */}
          {installPromptEvent && (
            <button onClick={promptInstall}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition"
              title={t('将 QuantEdge 安装到桌面 — 离线可用 + 启动更快')}
            >
              📲 {t('安装')}
            </button>
          )}
          {/* H5: SW 新版本可用 */}
          {swUpdateReg && (
            <button onClick={applySwUpdate}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition animate-pulse"
              title={t('点击刷新使用新版本（已下载完成）')}
            >
              ✨ {t('新版本可用')}
            </button>
          )}
          <span className="hidden lg:inline-flex items-center gap-1.5 text-[9px] text-[#667]">
            <kbd className="px-1 py-[1px] rounded bg-white/5 border border-white/10 font-mono text-[8px]">⌘K</kbd>
            <span>{t('搜索')}</span>
            <kbd className="px-1 py-[1px] rounded bg-white/5 border border-white/10 font-mono text-[8px] ml-1">Tab</kbd>
            <span>{t('切换')}</span>
          </span>
          <span className="text-[9px] md:text-[10px] text-[#778] font-mono">v0.7.0 · <span className="text-indigo-400/80">PWA</span></span>
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
        onQuickAction={(act) => {
          // C4: 快捷动作分发
          if (act === 'theme') toggleTheme();
          else if (act === 'density') cycleDensity();
          else if (act === 'refresh') quickPriceRefresh?.();
          else if (act === 'onboarding') setOnboardOpen(true);
          else if (act === 'layout') toggleLayout();
        }}
        onLoadTemplate={(tpl) => {
          // C4: 加载策略模板 → 跳转回测引擎并触发加载
          setTab("backtest");
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("quantedge:loadPortfolio", {
              detail: {
                p: tpl.portfolio, ic: tpl.initialCap, cb: tpl.costBps,
                bt: tpl.benchTicker, r: tpl.btRange, rb: tpl.rebalance,
              },
            }));
          }, 80);
        }}
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
          <WorkspaceProvider>
            <QuantPlatformInner />
          </WorkspaceProvider>
        </DataProvider>
      </AuthProvider>
    </LangProvider>
  );
}
