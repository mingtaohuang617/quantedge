import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from "react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, PieChart, Pie, Cell, Legend, ComposedChart, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Search, Bell, BookOpen, BarChart3, Activity, Settings, ChevronRight, ChevronDown, Star, AlertTriangle, Clock, Target, Zap, Filter, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Plus, X, Check, Eye, Layers, Globe, Briefcase, Info, Database, Trash2, Loader, ExternalLink, Sun, Moon, Calendar } from "lucide-react";
import { searchTickers as standaloneSearch, fetchStockData, fetchBenchmarkPrices, validateStockData, validateAllStocks, loadStandaloneStocks, saveStandaloneStocks, checkStandaloneMode } from "./src/standalone.js";

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
async function fetchYahooPrices(tickers) {
  const results = {};
  const PROXY = "https://api.allorigins.win/get?url=";

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
        // 优先 vite proxy，降级 allorigins
        let parsed;
        try {
          const localRes = await fetch(`/yahoo-api${chartPath}`, { signal: AbortSignal.timeout(8000) });
          parsed = await localRes.json();
        } catch {
          const res = await fetch(PROXY + encodeURIComponent(`https://query1.finance.yahoo.com${chartPath}`), { signal: AbortSignal.timeout(10000) });
          const json = await res.json();
          parsed = JSON.parse(json.contents);
        }
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
  const initialStocks = cached?.stocks?.length > 0 ? cached.stocks
    : standaloneStocks.length > 0 ? standaloneStocks : STATIC_STOCKS;
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
        // ── 有后端：从 API 加载 ──
        const data = await apiFetch("/data");
        if (data && data.stocks && data.stocks.length > 0) {
          setStocks(data.stocks);
          setAlerts(data.alerts || []);
          setLastRefresh(data.lastRefresh || "");
          setApiOnline(true);
          saveCache(data.stocks, data.alerts, data.lastRefresh);
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

  // Keep module-level refs in sync
  useEffect(() => { STOCKS = stocks; ALERTS = alerts; }, [stocks, alerts]);

  return (
    <DataContext.Provider value={{
      stocks, setStocks, alerts, apiOnline: apiOnline || standalone, refreshing, lastRefresh,
      refreshData, addTicker, removeTicker,
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
  "半导体": { etf: "SMH", name: "VanEck Semiconductor ETF", change: 5.2 },
  "存储": { etf: "DRAM", name: "Roundhill Memory ETF", change: 10.29 },
  "航天": { etf: "N/A", name: "无对应ETF（可关注ARKX）", change: null },
  "银行": { etf: "XLF", name: "Financial Select SPDR", change: 0.8 },
  "AI": { etf: "BOTZ", name: "Global X Robotics & AI ETF", change: 3.1 },
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

const ScoringDashboard = () => {
  const [sel, setSel] = useState(null);
  const [mkt, setMkt] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL"); // ALL | STOCK | ETF | LEV
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("score"); // score | change | name
  const [weights, setWeights] = useState({ fundamental: 40, technical: 30, growth: 30 });
  const [showW, setShowW] = useState(false);
  const [chartRange, setChartRange] = useState("YTD"); // 1D|5D|1M|6M|YTD|1Y|5Y|ALL
  const [loading, setLoading] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false); // mobile: toggle list vs detail
  // Quick-add state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddQuery, setQuickAddQuery] = useState("");
  const [quickAddResults, setQuickAddResults] = useState([]);
  const [quickAddSearching, setQuickAddSearching] = useState(false);
  const [quickAdding, setQuickAdding] = useState(null); // ticker key being added
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
    // 优先使用 priceRanges 中对应维度的数据，否则降级到 priceHistory
    const rawAll = (sel.priceRanges && sel.priceRanges[chartRange])
      ? sel.priceRanges[chartRange]
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

  const filtered = useMemo(() => {
    let list = liveStocks;
    // 市场筛选
    if (mkt !== "ALL") list = list.filter(s => s.market === mkt);
    // 类型筛选
    if (typeFilter === "STOCK") list = list.filter(s => !s.isETF);
    else if (typeFilter === "ETF") list = list.filter(s => s.isETF && !s.leverage);
    else if (typeFilter === "LEV") list = list.filter(s => s.isETF && s.leverage);
    // 搜索
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(s =>
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.sector && s.sector.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q))
      );
    }
    // 排序
    if (sortBy === "score") return [...list].sort((a, b) => b.score - a.score);
    if (sortBy === "change") return [...list].sort((a, b) => b.change - a.change);
    if (sortBy === "name") return [...list].sort((a, b) => a.ticker.localeCompare(b.ticker));
    return [...list].sort((a, b) => b.score - a.score);
  }, [liveStocks, mkt, typeFilter, searchTerm, sortBy]);

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

  const radar = sel ? (sel.isETF ? [
    { factor: "费率优势", value: sel.expenseRatio <= 0.5 ? 90 : sel.expenseRatio <= 1 ? 70 : sel.expenseRatio <= 2 ? 40 : 20, fullMark: 100 },
    sel.leverage
      ? { factor: "波动磨损", value: sel.decayRate == null ? 50 : sel.decayRate < 5 ? 90 : sel.decayRate < 15 ? 60 : sel.decayRate < 30 ? 35 : 15, fullMark: 100 }
      : { factor: "折溢价", value: Math.abs(sel.premiumDiscount || 0) < 1 ? 95 : Math.abs(sel.premiumDiscount || 0) < 5 ? 70 : Math.abs(sel.premiumDiscount || 0) < 10 ? 40 : 20, fullMark: 100 },
    { factor: "规模(AUM)", value: parseFloat(sel.aum) > 1000 ? 90 : parseFloat(sel.aum) > 100 ? 60 : 30, fullMark: 100 },
    { factor: "动量", value: sel.momentum, fullMark: 100 },
    { factor: "流动性", value: sel.adv && sel.adv !== "N/A" ? 70 : 40, fullMark: 100 },
    { factor: "集中度风险", value: sel.concentrationTop3 > 70 ? 25 : sel.concentrationTop3 > 50 ? 50 : 80, fullMark: 100 },
  ] : [
    { factor: "PE估值", value: sel.pe && sel.pe > 0 ? Math.max(0, 100 - sel.pe * 0.8) : 20, fullMark: 100 },
    { factor: "ROE", value: sel.roe ? Math.min(100, Math.max(0, sel.roe * 0.8)) : 10, fullMark: 100 },
    { factor: "动量", value: sel.momentum, fullMark: 100 },
    { factor: "RSI", value: sel.rsi, fullMark: 100 },
    { factor: "营收增长", value: sel.revenueGrowth ? Math.min(100, sel.revenueGrowth * 0.6) : 0, fullMark: 100 },
    { factor: "利润率", value: sel.profitMargin ? Math.min(100, Math.max(0, sel.profitMargin * 1.5)) : 0, fullMark: 100 },
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

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      {/* Right-click context menu */}
      {ctxMenu && (
        <div id="ctx-menu" className="fixed z-50 glass-card border border-white/15 shadow-2xl shadow-black/50 py-1 min-w-[160px] animate-slide-up" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="px-3 py-1.5 text-[10px] text-[#778] border-b border-white/8 truncate max-w-[200px]">{ctxMenu.ticker} · {ctxMenu.name}</div>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { setSel(liveStocks.find(s => s.ticker === ctxMenu.ticker) || sel); setCtxMenu(null); }}
            className="w-full text-left px-3 py-2 text-[11px] text-[#c8cdd3] hover:bg-white/10 hover:text-white flex items-center gap-2 transition-colors"
          >
            <Eye size={12} /> 查看详情
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleDeleteTicker}
            className="w-full text-left px-3 py-2 text-[11px] text-down hover:bg-down/10 flex items-center gap-2 transition-colors"
          >
            <Trash2 size={12} /> 删除标的
          </button>
        </div>
      )}
      <div className={`md:col-span-5 flex flex-col gap-2 md:min-h-0 ${mobileShowDetail ? "hidden md:flex" : "flex"}`}>
        {/* 搜索栏 */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a0aec0]" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="搜索标的 / 代码 / 板块..."
            autoCorrect="off" autoCapitalize="none" spellCheck={false}
            className="w-full bg-white/5 border border-white/8 rounded-lg pl-8 pr-8 py-2 md:py-1.5 text-xs text-white placeholder-[#667] outline-none focus:border-indigo-500/50 focus:bg-white/[0.07] focus:ring-1 focus:ring-indigo-500/30 focus:shadow-[0_0_20px_rgba(99,102,241,0.15)] transition-all"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#778] hover:text-white transition-colors">
              <X size={12} />
            </button>
          )}
        </div>
        {/* 市场 + 类型 筛选 */}
        <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/8">
            {["ALL", "US", "HK"].map(m => (
              <button key={m} onClick={() => setMkt(m)} className={`px-2.5 py-1.5 md:py-1 rounded-md text-[10px] font-medium transition-all active:scale-95 ${mkt === m ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}>
                {m === "ALL" ? "全部" : m === "US" ? "美股" : "港股"}
              </button>
            ))}
          </div>
          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/8">
            {[
              ["ALL", `全部 ${counts.all}`],
              ["STOCK", `个股 ${counts.stocks}`],
              ["ETF", `ETF ${counts.etfs}`],
              ["LEV", `杠杆 ${counts.lev}`],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setTypeFilter(key)} className={`px-2 md:px-2 py-1.5 md:py-1 rounded-md text-[10px] font-medium transition-all active:scale-95 ${typeFilter === key ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowW(!showW)} className="ml-auto p-1.5 rounded-lg bg-white/5 border border-white/8 text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all">
            <Settings size={14} />
          </button>
        </div>
        {/* 排序 + 结果统计 */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-[#778] font-mono">{filtered.length} <span className="font-sans">个标的</span></span>
          <div className="flex items-center gap-1">
            {[["score", "评分"], ["change", "涨跌"], ["name", "代码"]].map(([key, label]) => (
              <button key={key} onClick={() => setSortBy(key)} className={`px-2 py-1 rounded text-[10px] transition-all active:scale-95 ${sortBy === key ? "text-indigo-400 bg-indigo-500/10" : "text-[#778] hover:text-[#a0aec0]"}`}>
                {label}{sortBy === key && (key === "name" ? " ↑" : " ↓")}
              </button>
            ))}
          </div>
        </div>
        {showW && (
          <div className="glass-card p-3 space-y-3 animate-slide-up">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>因子权重配置</div>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md ${
                (weights.fundamental + weights.technical + weights.growth) === 100
                  ? "bg-up/10 text-up border border-up/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              }`}>
                合计 {weights.fundamental + weights.technical + weights.growth}%
              </span>
            </div>
            {[
              ["fundamental", "基本面", "#6366f1", "PE⁻¹ + ROE + EPS质量"],
              ["technical", "技术面", "#06b6d4", "RSI均值回归 + 动量 + β风险"],
              ["growth", "成长性", "#00E5A0", "营收增速 + 利润率扩张"],
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
              <Zap size={12} /> 应用权重并重新评分
            </button>
          </div>
        )}
        <div className="flex-1 overflow-auto space-y-0.5 pr-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#778]">
              <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/8 flex items-center justify-center mb-3">
                <Search size={20} className="opacity-30" />
              </div>
              <span className="text-xs mb-1">未找到匹配的标的</span>
              <button onClick={() => { setSearchTerm(""); setMkt("ALL"); setTypeFilter("ALL"); }} className="text-[10px] text-indigo-400 mt-1 hover:underline px-3 py-1 rounded-md bg-indigo-500/5 border border-indigo-500/10 transition-all hover:bg-indigo-500/10">清除筛选</button>
            </div>
          ) : filtered.map((stk, i) => (
            <button key={stk.ticker} onClick={() => { setSel(stk); setMobileShowDetail(true); }} onContextMenu={(e) => handleContextMenu(e, stk)} className={`w-full text-left px-2.5 py-2.5 md:py-2 rounded-lg transition-all duration-200 border animate-stagger active:scale-[0.98] group ${sel?.ticker === stk.ticker ? "bg-gradient-to-r from-indigo-500/35 via-indigo-500/15 to-transparent border-indigo-500/30 shadow-lg shadow-indigo-500/5" : "bg-white/[0.02] border-transparent hover:bg-white/[0.04] hover:border-white/10"}`} style={{ animationDelay: `${i * 0.03}s` }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`rank-badge ${i < 3 ? "rank-top" : "rank-mid"}`}>{i + 1}</span>
                  <span className="font-semibold text-xs text-white shrink-0">{stk.ticker}</span>
                  <Badge variant={stk.market === "US" ? "info" : "warning"} size="sm">{stk.market}</Badge>
                  {stk.isETF && !stk.leverage && <Badge variant="accent" size="sm">ETF</Badge>}
                  {stk.isETF && stk.leverage && <Badge variant="danger" size="sm">{stk.leverage}</Badge>}
                </div>
                <span className={`text-xs font-semibold font-mono tabular-nums shrink-0 ${safeChange(stk.change) >= 0 ? "text-up" : "text-down"}`}>
                  {safeChange(stk.change) >= 0 ? "+" : ""}{fmtChange(stk.change)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#b0b8c4] truncate max-w-[140px]">{stk.name}</span>
                <div className="w-24"><ScoreBar score={stk.score} /></div>
              </div>
            </button>
          ))}
        </div>
        {/* 财报日历 */}
        {(() => {
          try {
            const upcoming = liveStocks
              .filter(s => s.nextEarnings && !isNaN(new Date(s.nextEarnings).getTime()) && new Date(s.nextEarnings) >= new Date())
              .sort((a, b) => new Date(a.nextEarnings) - new Date(b.nextEarnings))
              .slice(0, 5);
            if (upcoming.length === 0) return null;
            const today = new Date();
            return (
              <div className="glass-card p-2.5 shrink-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <Calendar size={11} className="text-indigo-400" />
                  <span className="text-[10px] font-medium text-[#a0aec0]">近期财报</span>
                </div>
                <div className="space-y-1">
                  {upcoming.map(s => {
                    const d = new Date(s.nextEarnings);
                    const days = Math.ceil((d - today) / 86400000);
                    const urgent = days <= 7;
                    return (
                      <div key={s.ticker} className="flex items-center justify-between py-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono font-semibold text-white">{s.ticker}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-mono text-[#a0aec0]">{s.nextEarnings}</span>
                          <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${urgent ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "text-[#778]"}`}>
                            {days === 0 ? "今天" : days === 1 ? "明天" : `${days}天`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          } catch (e) {
            console.error("[EarningsCalendar]", e);
            return null;
          }
        })()}
        {/* Quick-add button & inline search — outside scroll container */}
        {(apiOnline || standalone) && (
          <div className="mt-1 relative shrink-0">
            {!quickAddOpen ? (
              <button
                onClick={() => setQuickAddOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-[#778] hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all group"
              >
                <Plus size={13} className="group-hover:scale-110 transition-transform" />
                <span>快速添加标的</span>
              </button>
            ) : (
              <div className="glass-card p-2 animate-slide-up space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#778]" />
                    <input
                      type="text"
                      autoFocus
                      value={quickAddQuery}
                      onChange={e => setQuickAddQuery(e.target.value)}
                      placeholder="输入代码或名称搜索..."
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
                    <Loader size={12} className="animate-spin mr-1.5" /> 搜索中...
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
                            {r.alreadyAdded && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-up/10 text-up border border-up/20 flex items-center gap-0.5"><Check size={8} /> 已添加</span>}
                            {r.price && <span className="text-[10px] font-mono tabular-nums text-[#a0aec0]">${r.price}</span>}
                          </div>
                          <div className="text-[10px] text-[#778] truncate">{r.name}</div>
                        </div>
                        {r.alreadyAdded ? (
                          <button
                            onClick={() => { setSel(liveStocks.find(s => s.ticker === r.symbol)); setQuickAddOpen(false); setQuickAddQuery(""); setQuickAddResults([]); }}
                            className="ml-2 shrink-0 flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium bg-white/5 text-[#a0aec0] hover:bg-white/10 hover:text-white transition-all"
                          >
                            <Eye size={10} /> 查看
                          </button>
                        ) : (
                          <button
                            onClick={() => handleQuickAdd(r)}
                            disabled={quickAdding === r.symbol}
                            className="ml-2 shrink-0 flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/30 hover:text-indigo-200 disabled:opacity-50 transition-all"
                          >
                            {quickAdding === r.symbol
                              ? <Loader size={10} className="animate-spin" />
                              : <><Plus size={10} /> 添加</>}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!quickAddSearching && quickAddQuery.trim() && quickAddResults.length === 0 && (
                  <div className="text-center py-2 text-[10px] text-[#778]">未找到匹配标的</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`md:col-span-7 md:min-h-0 md:overflow-auto pr-0 md:pr-1 ${mobileShowDetail ? "flex flex-col" : "hidden md:block"}`}>
        {/* Mobile back button */}
        <button onClick={() => setMobileShowDetail(false)} className="md:hidden flex items-center gap-1.5 text-xs text-indigo-400 mb-2 py-2 px-3 rounded-lg bg-indigo-500/[0.06] border border-indigo-500/15 w-fit active:scale-95 transition-all">
          <ChevronRight size={14} className="rotate-180" /> 返回列表
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
            <div className="glass-card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold text-white tracking-tight">{sel.ticker}</h3>
                    <Badge variant="accent" size="sm">{sel.sector}</Badge>
                    {sel.isETF && <Badge variant={sel.leverage ? "danger" : "warning"} size="sm">{sel.etfType}</Badge>}
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md ${sel.score >= 80 ? "bg-up/10 text-up border border-up/20" : sel.score >= 60 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-down/10 text-down border border-down/20"}`}>
                      {sel.score}/100
                    </span>
                  </div>
                  <div className="text-xs text-[#a0aec0]">{sel.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold font-mono tabular-nums text-white">{sel.currency === "HKD" ? "HK$" : "$"}{sel.price}</div>
                  <div className={`text-sm font-bold tabular-nums ${safeChange(sel.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(sel.change) >= 0 ? "▲" : "▼"} {fmtChange(Math.abs(safeChange(sel.change)))}%
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#a0aec0] leading-relaxed mb-2 border-l-2 border-indigo-500/30 pl-2">{sel.description}</p>
              {/* 时间维度选择器 */}
              <div className="flex items-center gap-0.5 mb-2 bg-white/5 rounded-lg p-0.5 border border-white/8 w-full md:w-fit overflow-x-auto">
                {["1D","5D","1M","6M","YTD","1Y","5Y","ALL"].map(r => {
                  const label = r === "1D" ? "分时" : r === "5D" ? "五日" : r === "1M" ? "月" : r === "6M" ? "6月" : r === "YTD" ? "今年" : r === "1Y" ? "1年" : r === "5Y" ? "5年" : "全部";
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
                  <span className="text-[10px] text-[#778]">区间收益</span>
                  <span className={`text-xs font-bold font-mono tabular-nums px-1.5 py-0.5 rounded ${safeChange(periodReturn) >= 0 ? "text-up bg-up/10" : "text-down bg-down/10"}`}>
                    {safeChange(periodReturn) >= 0 ? "+" : ""}{fmtChange(periodReturn)}%
                  </span>
                </div>
              )}
              <div className="h-36 chart-glow">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
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
                    <XAxis dataKey="m" tick={{ fontSize: 9, fill: "#555" }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 7))} />
                    <YAxis yAxisId="price" tick={{ fontSize: 10, fill: "#555" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={45} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 9, fill: "#8892a4" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={52} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                    <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 3" />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => {
                      if (name === "p") return [`${sel.currency === "HKD" ? "HK$" : "$"}${v}`, "价格"];
                      if (name === "pct") return [`${v >= 0 ? "+" : ""}${v}%`, "收益率"];
                      return [v, name];
                    }} />
                    <Area yAxisId="price" type="monotone" dataKey="p" stroke={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "url(#strokeGrad)" : "#FF6B6B"} strokeWidth={2} fill="url(#pg)" dot={false} activeDot={{ r: 4, fill: "#fff", stroke: "#8A2BE2", strokeWidth: 2, filter: "drop-shadow(0 0 4px rgba(138,43,226,0.6))" }} />
                    <Line yAxisId="pct" type="monotone" dataKey="pct" stroke="transparent" dot={false} activeDot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:flex-1 md:min-h-0">
              <div className="flex flex-col gap-3 md:overflow-auto md:min-h-0 pr-0 md:pr-1">
                {/* ── 多因子雷达图 ── */}
                <div className="glass-card p-3">
                  <div className="section-header">
                    <Star size={11} className="text-indigo-400" />
                    <span className="section-title">{sel.isETF ? "ETF 评估雷达" : "多因子雷达"}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <RadarChart data={radar}>
                      <defs>
                        <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={sel.isETF ? "#f59e0b" : "#8A2BE2"} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={sel.isETF ? "#f59e0b" : "#4169E1"} stopOpacity={0.08} />
                        </radialGradient>
                      </defs>
                      <PolarGrid stroke="var(--radar-grid)" strokeWidth={1} />
                      <PolarAngleAxis dataKey="factor" tick={{ fontSize: 10, fill: "var(--radar-label)", fontWeight: 500 }} />
                      <Radar dataKey="value" stroke={sel.isETF ? "#f59e0b" : "#8A2BE2"} fill="url(#radarFill)" strokeWidth={2.5}
                        dot={{ r: 4, fill: "var(--radar-dot-fill)", stroke: sel.isETF ? "#f59e0b" : "#8A2BE2", strokeWidth: 2.5, filter: `drop-shadow(0 0 4px ${sel.isETF ? "rgba(245,158,11,0.6)" : "rgba(138,43,226,0.6)"})` }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* ── 52周价格区间 + 技术信号 ── */}
                <div className="glass-card p-3">
                  <div className="section-header">
                    <TrendingUp size={11} className="text-indigo-400" />
                    <span className="section-title">52周价格区间</span>
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
                          <span className="text-[#a0aec0]">52周低</span>
                          <span className="font-mono text-white font-medium">{currSymbol}{sel.price}</span>
                          <span className="text-[#a0aec0]">52周高</span>
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
                        RSI {sel.rsi} {sel.rsi > 70 ? "超买" : sel.rsi < 30 ? "超卖" : "中性"}
                      </span>
                    )}
                    {sel.momentum != null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        sel.momentum >= 70 ? "text-up bg-up/10 border-up/20" :
                        sel.momentum <= 30 ? "text-down bg-down/10 border-down/20" :
                        "text-amber-400 bg-amber-500/10 border-amber-500/20"
                      }`}>
                        <TrendingUp size={9} />
                        动量 {sel.momentum}
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
                        日内 {safeChange(sel.change) > 0 ? "+" : ""}{fmtChange(sel.change)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* ── 评分拆解 ── */}
                {sel.subScores && (
                  <div className="glass-card p-3">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-medium text-[#a0aec0]">评分拆解</span>
                      <span className="text-xs font-mono font-bold text-white">{sel.score}<span className="text-[10px] text-[#a0aec0] font-normal">/100</span></span>
                    </div>
                    <div className="space-y-2">
                      {(sel.isETF ? [
                        ["成本效率", sel.subScores.cost, "indigo"],
                        ["流动性", sel.subScores.liquidity, "violet"],
                        ["动量趋势", sel.subScores.momentum, "cyan"],
                        ["风险分散", sel.subScores.risk, "amber"],
                      ] : [
                        ["基本面", sel.subScores.fundamental, "indigo"],
                        ["技术面", sel.subScores.technical, "cyan"],
                        ["成长性", sel.subScores.growth, "up"],
                      ]).map(([label, value, colorKey]) => (
                        <div key={label}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] text-[#a0aec0]">{label}</span>
                            <span className="text-[10px] font-mono text-white">{value}</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: `linear-gradient(90deg, var(--accent-${colorKey}-soft), var(--accent-${colorKey}))` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="glass-card p-3 overflow-auto">
                {sel.isETF ? (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="section-header mb-0" style={{ marginBottom: 0, flex: 1 }}>
                        <Database size={11} className="text-indigo-400" />
                        <span className="section-title">ETF 核心指标</span>
                      </div>
                      <Badge variant={sel.leverage ? "danger" : "accent"} size="sm">{sel.etfType}</Badge>
                    </div>
                    <div className="space-y-2">
                      {/* 成本与费用 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-1 mb-0.5">成本与费用</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">总费率 (ER)</span>
                        <Badge variant={sel.expenseRatio <= 0.5 ? "success" : sel.expenseRatio <= 1 ? "warning" : "danger"}>{sel.expenseRatio}%</Badge>
                      </div>
                      {sel.leverage ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">年化波动磨损</span>
                          <Badge variant={
                            sel.decayRate == null ? "info"
                              : sel.decayRate < 5 ? "success"
                              : sel.decayRate < 15 ? "warning"
                              : "danger"
                          }>
                            {sel.decayRate != null ? `≈ ${sel.decayRate}% / 年` : "数据不足"}
                          </Badge>
                        </div>
                      ) : sel.premiumDiscount != null ? (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#a0aec0]">折溢价率</span>
                          <Badge variant={Math.abs(sel.premiumDiscount) < 1 ? "success" : Math.abs(sel.premiumDiscount) < 5 ? "warning" : "danger"}>
                            {sel.premiumDiscount > 0 ? "+" : ""}{sel.premiumDiscount}% {sel.premiumDiscount > 0 ? "溢价" : sel.premiumDiscount < 0 ? "折价" : "平价"}
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
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">跟踪效果</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">标的指数</span>
                        <span className="text-[10px] text-white max-w-[140px] text-right truncate">{sel.benchmark}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">跟踪误差</span>
                        <Badge variant={sel.trackingError === null ? "success" : "warning"}>{sel.trackingError || "N/A (主动管理)"}</Badge>
                      </div>
                      {/* 流动性与规模 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">流动性与规模</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">AUM</span>
                        <Badge variant="info">{sel.aum}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">日均成交</span>
                        <Badge variant="default">{sel.adv}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">买卖价差</span>
                        <Badge variant="default">{sel.bidAskSpread}</Badge>
                      </div>
                      {/* 定性信息 */}
                      <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">定性信息</div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">基金管理人</span>
                        <span className="text-[10px] text-white">{sel.issuer}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">分红政策</span>
                        <Badge variant="default">{sel.dividendPolicy}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">成立日期</span>
                        <Badge variant="default">{sel.inceptionDate}</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#a0aec0]">52周区间</span>
                        <Badge variant="info">{sel.currency === "HKD" ? "HK$" : "$"}{sel.week52Low} - {sel.week52High}</Badge>
                      </div>
                      {/* 持仓明细 */}
                      {sel.topHoldings && (
                        <>
                          <div className="text-[10px] text-indigo-400 font-medium mt-2 mb-0.5">
                            持仓分布 ({sel.totalHoldings}只 · Top3集中度 {sel.concentrationTop3}%)
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
                      <span className="section-title">核心指标 · 真实数据</span>
                    </div>
                    <div className="space-y-0">
                      {[
                        ["PE (TTM)", sel.pe ? Number(sel.pe).toFixed(1) : "N/A", sel.pe && sel.pe > 0 && sel.pe < 25 ? "success" : sel.pe && sel.pe > 0 && sel.pe < 50 ? "warning" : "danger"],
                        ["52周区间", `${sel.currency === "HKD" ? "HK$" : "$"}${sel.week52Low} – ${sel.week52High}`, "info"],
                        ["营收增长", sel.revenueGrowth ? `${sel.revenueGrowth}%` : "N/A", sel.revenueGrowth && sel.revenueGrowth > 20 ? "success" : sel.revenueGrowth && sel.revenueGrowth > 5 ? "warning" : "default"],
                        ["利润率", sel.profitMargin ? `${sel.profitMargin}%` : "N/A", sel.profitMargin && sel.profitMargin > 20 ? "success" : sel.profitMargin && sel.profitMargin > 0 ? "warning" : "danger"],
                        ["年营收", sel.revenue || "N/A", "info"],
                        ["市值", sel.marketCap, "info"],
                        ["EBITDA", sel.ebitda || "N/A", "info"],
                        ["EPS", sel.eps != null ? String(sel.eps) : "N/A", sel.eps != null && !String(sel.eps).startsWith("-") ? "success" : "danger"],
                        ["Beta", sel.beta || "N/A", "default"],
                        ["下次财报", sel.nextEarnings || "N/A", "accent"],
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
        <path d={describeArc(startAngle, endAngle, r)} fill="none" stroke="var(--border-default)" strokeWidth="3" strokeLinecap="round" />
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
  const { stocks: ctxStocks2, standalone } = useContext(DataContext);
  const liveStocks = ctxStocks2 || STOCKS;
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
  const [btRange, setBtRange] = useState("1Y"); // 回测时间维度: 1M|6M|YTD|1Y|5Y|ALL|CUSTOM
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [rebalance, setRebalance] = useState("none"); // none|quarterly|yearly
  const benchCacheRef = useRef({}); // 缓存已获取的基准数据 { ticker: stockData }
  const autoRan = useRef(false);

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

  const { addTicker: addTickerToPlatform } = useContext(DataContext);
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

    // 预获取基准价格数据
    const benchCacheKey = `${benchTicker}_${btRange}`;
    let benchPriceData = benchCacheRef.current[benchCacheKey];
    const benchStockInList = liveStocks.find(s => s.ticker === benchTicker);
    if (!benchPriceData && !benchStockInList) {
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

      // 基准指数真实数据
      let benchSeries = null;
      if (benchStockInList) {
        // 基准在 STOCKS 列表中，使用 getPriceData
        const benchPh = getPriceData(benchStockInList);
        if (benchPh.length >= 2) {
          benchSeries = interpolatePrice(benchPh, dateAxis);
        }
      } else if (benchPriceData && benchPriceData.length >= 2) {
        // 使用动态获取的基准价格数据
        benchSeries = interpolatePrice(benchPriceData, dateAxis);
      }

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
      // 根据选定的时间维度估算总天数和每期天数
      let totalDays = rangeDaysMap[btRange] || 180;
      if (btRange === "CUSTOM" && customStart && customEnd) {
        totalDays = Math.max(30, Math.round((new Date(customEnd) - new Date(customStart)) / 86400000));
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
          monthlyReturns.push({ month: label, ret: Math.round(mRet * 100) / 100 });
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
            monthlyReturns.push({ month: navCurve[periodStart].date, ret: Math.round(mRet * 100) / 100 });
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
        segments.push({ period: `${dateAxis[si]} - ${dateAxis[ei]}`, ret: Math.round(segRet * 100) / 100 });
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
        // 组合预计跌幅 ≈ 基准跌幅 × Beta × 波动率比率(加权)
        const estDrop = sc.spyDrop * avgBeta * (0.6 + 0.4 * volRatio);
        const estValue = Math.round(initialCap * (1 + estDrop / 100));
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

  // 首次打开自动运行回测
  useEffect(() => {
    if (!autoRan.current && portfolioStocks.length > 0 && !hasResult) {
      autoRan.current = true;
      setTimeout(() => runBacktest(), 300);
    }
  }, [portfolioStocks]);

  const m = btResult?.metrics;

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-5 md:gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      {/* ── 左栏：组合构建器 ── */}
      <div className={`md:col-span-4 flex flex-col gap-2 md:min-h-0 ${builderOpen ? "md:overflow-auto" : ""} pr-0 md:pr-1`}>
        <div className="glass-card p-3">
          {/* 组合构建器 header — 可点击折叠 */}
          <div
            className={`flex items-center justify-between ${builderOpen ? "mb-3" : ""} cursor-pointer select-none`}
            onClick={() => setBuilderOpen(v => !v)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Layers size={14} className="text-indigo-400" />
              <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>组合构建器</span>
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
                  title="移除"
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
            <Target size={10} /> 等权分配
          </button>
          {/* 搜索添加标的 */}
          <div className="relative">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input
                value={searchAdd}
                onChange={e => setSearchAdd(e.target.value)}
                placeholder="搜索代码或名称添加标的..."
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
                <Loader size={12} className="animate-spin mr-1.5" /> 搜索中...
              </div>
            )}
            {/* 搜索结果 — 向上展示 */}
            {!searchingAdd && searchAdd.trim() && searchResults.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 glass-card z-20 max-h-[240px] overflow-auto" style={{ boxShadow: "0 -8px 32px rgba(0,0,0,0.5)" }}>
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
                      <span className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>{r.name}</span>
                    </div>
                    {r.alreadyInPortfolio ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-up/10 text-up border border-up/20 flex items-center gap-0.5 shrink-0 ml-1">
                        <Check size={8} /> 已添加
                      </span>
                    ) : (
                      <span className="shrink-0 ml-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5" style={{ color: "var(--accent-indigo)" }}>
                        <Plus size={10} /> 添加
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!searchingAdd && searchAdd.trim() && searchResults.length === 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 glass-card p-2 z-20 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
                未找到匹配标的
              </div>
            )}
          </div>
          </>)}
        </div>
        {builderOpen && (<>
        {/* 回测参数 */}
        <div className="glass-card p-3 space-y-2">
          <div className="text-xs font-medium text-[#a0aec0] mb-1">回测参数</div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">初始资金</label>
            <select value={initialCap} onChange={e => setInitialCap(+e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none">
              <option value={50000}>$50,000</option><option value={100000}>$100,000</option><option value={500000}>$500,000</option><option value={1000000}>$1,000,000</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">交易成本 (bps)</label>
            <select value={costBps} onChange={e => setCostBps(+e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none">
              <option value={0}>无成本</option><option value={10}>10 bps (0.10%)</option><option value={15}>15 bps (0.15%)</option><option value={30}>30 bps (0.30%)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">基准对比</label>
            <select value={benchTicker} onChange={e => setBenchTicker(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none">
              <option value="SPY">S&P 500 (SPY)</option><option value="QQQ">纳斯达克 (QQQ)</option><option value="EWY">韩国 (EWY)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">回测周期</label>
            <div className="flex flex-wrap gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["1M","1月"],["6M","6月"],["YTD","今年"],["1Y","1年"],["5Y","5年"],["ALL","全部"],["CUSTOM","自定义"]].map(([k, label]) => (
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
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>至</span>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-1.5 py-1 text-[10px] outline-none"
                    style={{ color: "var(--text-primary)", colorScheme: "dark" }}
                    min={customStart} max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
                <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                  起始日期不早于所有标的数据起点，结束日期不晚于今天
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="text-[10px] text-[#a0aec0] mb-0.5 block">再平衡策略</label>
            <div className="flex gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/8">
              {[["none","不再平衡"],["quarterly","季度再平衡"],["yearly","年度再平衡"]].map(([k, label]) => (
                <button key={k} onClick={() => setRebalance(k)}
                  className={`flex-1 px-1 py-0.5 rounded text-[10px] font-medium transition-all text-center ${rebalance === k ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "text-[#a0aec0] hover:text-white"}`}
                >{label}</button>
              ))}
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {rebalance === "quarterly" ? "每季度初自动调回初始比例 (1月/4月/7月/10月)" : rebalance === "yearly" ? "每年1月初自动调回初始比例" : "持有不动，权重随市场漂移"}
            </div>
          </div>
          <button onClick={runBacktest} disabled={running || portfolioStocks.length < 1 || totalWeight === 0} className={`w-full py-2.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500 text-white disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-glow-indigo mt-1 btn-ripple btn-tactile ${!running && totalWeight === 100 ? "animate-pulse-ring" : ""}`}>
            {running ? <><RefreshCw size={12} className="animate-spin" /> 计算中...</> : <><Zap size={12} /> 运行回测</>}
          </button>
        </div>
        {/* 配置饼图 */}
        {portfolioStocks.length > 0 && (
          <div className="glass-card p-3">
            <div className="text-xs font-medium text-[#a0aec0] mb-1">配置可视化</div>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={portfolioStocks.map(p => ({ name: p.ticker, value: p.weight }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} innerRadius={30} paddingAngle={2} strokeWidth={0}>
                  {portfolioStocks.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "权重"]} />
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
              <span className="text-sm mb-1.5 block font-medium" style={{ color: "var(--text-secondary)" }}>构建组合后自动运行回测</span>
              <span className="text-[10px] block">基于 {portfolioStocks.length} 个标的的真实价格历史 · 支持多时间维度</span>
            </div>
            {/* 相关性矩阵占位框 */}
            {portfolioStocks.length >= 2 && (
              <div className="glass-card p-3 w-full max-w-md">
                <div className="flex items-center gap-2 mb-2">
                  <Database size={12} style={{ color: "var(--text-muted)" }} />
                  <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>资产相关性矩阵</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: "var(--bg-muted)", color: "var(--text-dim)" }}>运行回测后显示</span>
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
                  <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>回测结果</span>
                  <span className="text-[10px] text-[#a0aec0] font-mono">
                    {({
                      "1M":"近1月","6M":"近6月","YTD":"年初至今","1Y":"近1年","5Y":"近5年","ALL":"全部历史",
                      "CUSTOM": customStart && customEnd ? `${customStart} ~ ${customEnd}` : "自定义"
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
            <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
              {[
                ["总收益", `${m.totalReturn >= 0 ? "+" : ""}${m.totalReturn}%`, m.totalReturn >= 0 ? "text-up" : "text-down", m.totalReturn >= 0 ? "positive" : "negative"],
                ["年化收益", `${m.annReturn >= 0 ? "+" : ""}${m.annReturn}%`, m.annReturn >= 0 ? "text-up" : "text-down", m.annReturn >= 0 ? "positive" : "negative"],
                ["超额 α", `${m.alpha >= 0 ? "+" : ""}${m.alpha}%`, m.alpha >= 0 ? "text-up" : "text-down", m.alpha >= 0 ? "positive" : "negative"],
                ["终值", `$${btResult.finalValue.toLocaleString()}`, "text-white", null],
                ["夏普", m.sharpe.toFixed(2), m.sharpe > 1 ? "text-up" : m.sharpe > 0.5 ? "text-amber-400" : "text-down", m.sharpe > 1 ? "positive" : "negative"],
                ["最大回撤", `${m.maxDD.toFixed(1)}%`, m.maxDD > -10 ? "text-amber-400" : "text-down", "negative"],
              ].map(([l, v, c, delta], idx) => (
                <div key={l} className="kpi-card animate-stagger" style={{ animationDelay: `${idx * 0.05}s` }}>
                  <div className="kpi-label">{l}</div>
                  <div className={`text-sm md:text-base font-bold font-mono tabular-nums leading-tight ${c}`}>{v}</div>
                  {delta && <div className={`delta-chip ${delta} mt-1`}>{delta === "positive" ? "▲" : "▼"}</div>}
                </div>
              ))}
            </div>

            {/* 净值曲线 */}
            <div className="glass-card p-3" style={{ minHeight: 240 }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#a0aec0]">组合净值曲线 ({({
                  "1M":"近1月","6M":"近6月","YTD":"年初至今","1Y":"近1年","5Y":"近5年","ALL":"全部历史",
                  "CUSTOM": customStart && customEnd ? `${customStart} ~ ${customEnd}` : "自定义"
                })[btRange] || btRange})</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[10px] text-indigo-400"><span className="w-3 h-0.5 bg-indigo-400 rounded-full inline-block" /> 组合</span>
                  <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-3 h-0.5 bg-gray-500 rounded-full inline-block" /> {benchTicker}</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <ComposedChart data={btResult.navCurve} className="chart-glow">
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
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#555" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(btResult.navCurve.length / 8))} />
                  <YAxis tick={{ fontSize: 10, fill: "#555" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <ReferenceLine y={100} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="strategy" stroke="url(#navStroke)" strokeWidth={2} fill="url(#navGrad)" dot={false} name="组合" />
                  <Line type="monotone" dataKey="benchmark" stroke="#666" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name={benchTicker} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* 第二行: 个股贡献 + 年度收益 + 区间收益 */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              {/* 持仓收益 */}
              <div className="md:col-span-4 glass-card p-3">
                <div className="section-header">
                  <Briefcase size={11} className="text-indigo-400" />
                  <span className="section-title">个股贡献</span>
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
                  <span className="section-title">{btResult.isAnnual ? "年度收益分布" : "月度收益分布"}</span>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={btResult.monthlyReturns}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                    <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#666" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "#666" }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, btResult.isAnnual ? "年收益" : "月收益"]} />
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
              <div className="md:col-span-3 glass-card p-3">
                <div className="text-xs font-medium text-[#a0aec0] mb-2">区间收益</div>
                <div className="space-y-1.5">
                  {btResult.segments.map((seg, i) => (
                    <div key={i} className="flex flex-col gap-0.5">
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
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="section-header mb-0" style={{ marginBottom: 0 }}>
                      <TrendingDown size={11} className="text-down" />
                      <span className="section-title">Underwater 曲线</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[9px] text-down"><span className="w-3 h-0.5 bg-down rounded-full inline-block" /> 组合 {m?.maxDD}%</span>
                      <span className="flex items-center gap-1 text-[9px] text-amber-400"><span className="w-3 h-0.5 bg-amber-400 rounded-full inline-block" style={{ opacity: 0.6 }} /> {benchTicker} {m?.benchMaxDD || 0}%</span>
                    </div>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-down/10 text-down border border-down/20">
                    最长回撤 {m.maxDDDays} 天
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
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#666" }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(btResult.drawdownCurve.length / 8))} />
                    <YAxis tick={{ fontSize: 9, fill: "#666" }} axisLine={false} tickLine={false} width={35} domain={['dataMin', 0]} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [`${v}%`, name === "drawdown" ? "组合回撤" : `${benchTicker}回撤`]} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
                    <Area type="monotone" dataKey="benchDD" stroke="#f59e0b" fill="url(#benchDDGrad)" strokeWidth={1} dot={false} strokeOpacity={0.6} name="benchDD" />
                    <Area type="monotone" dataKey="drawdown" stroke="#FF6B6B" fill="url(#underwaterGrad)" strokeWidth={1.5} dot={false} name="drawdown" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* 风险指标矩阵 */}
              <div className="md:col-span-4 glass-card p-3">
                <div className="section-header mb-2">
                  <Target size={11} className="text-indigo-400" />
                  <span className="section-title">风险指标</span>
                </div>
                <div className="space-y-0">
                  {[
                    ["卡玛比率", m.calmar.toFixed(2), m.calmar > 2 ? "text-up" : "", "风险调整后收益"],
                    ["索提诺比率", m.sortino.toFixed(2), m.sortino > 1.5 ? "text-up" : "", "下行风险调整"],
                    ["胜率", `${m.winRate}%`, m.winRate > 55 ? "text-up" : "", ""],
                    ["年化波动率", `${m.vol}%`, m.vol < 20 ? "text-up" : m.vol < 40 ? "text-amber-400" : "text-down", ""],
                    ["VaR 99%", `${m.var99.toFixed(2)}%`, "text-down", ""],
                    ["最大回撤天数", `${m.maxDDDays} 天`, m.maxDDDays < 30 ? "text-up" : m.maxDDDays < 60 ? "text-amber-400" : "text-down", ""],
                    ["基准收益", `${m.benchReturn >= 0 ? "+" : ""}${m.benchReturn}%`, m.benchReturn >= 0 ? "text-up" : "text-down", ""],
                    ["基准最大回撤", `${m.benchMaxDD}%`, "text-down", ""],
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
                  <span className="section-title">资产相关性矩阵</span>
                </div>
                {btResult.rebalanceCount > 0 && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    再平衡 {btResult.rebalanceCount} 次
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
                  <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>负相关</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-2 rounded-sm" style={{ background: "var(--bg-muted)" }} />
                  <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>无相关</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-2 rounded-sm" style={{ background: "hsla(142, 50%, 20%, 0.5)" }} />
                  <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>正相关</span>
                </div>
              </div>
            </div>

            {/* ─── 压力测试 ─── */}
            <div className="glass-card p-3">
              <div className="section-header">
                <AlertTriangle size={12} className="text-amber-400" />
                <span className="section-title">压力测试 · 极端场景模拟</span>
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
                          <span className="text-[11px] font-semibold text-white">{sc.name}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[#778]">{sc.period}</span>
                        </div>
                        <span className={`text-xs font-bold font-mono tabular-nums ${severe ? "text-down" : "text-amber-400"}`}>
                          {sc.estDrop > 0 ? "+" : ""}{sc.estDrop}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between pl-2">
                        <span className="text-[10px] text-[#a0aec0]">{sc.description}</span>
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
                <span>基于组合 Beta ({btResult.stressResults[0]?.avgBeta}) × 波动率比率 × 历史基准跌幅估算，实际表现可能偏离</span>
              </div>
            </div>

            {/* ─── 仓位管理建议 ─── */}
            <div className="glass-card p-3">
              <div className="section-header">
                <Target size={12} className="text-indigo-400" />
                <span className="section-title">仓位管理建议</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Kelly公式 */}
                <div className="p-2.5 rounded-lg border border-indigo-500/15 bg-indigo-500/[0.03]">
                  <div className="text-[11px] font-medium text-white mb-2">Kelly 公式</div>
                  <div className="space-y-1.5 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-[#a0aec0]">胜率 (p)</span>
                      <span className="font-mono text-white">{btResult.kelly.winRate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#a0aec0]">盈亏比 (b)</span>
                      <span className="font-mono text-white">{btResult.kelly.payoffRatio}x</span>
                    </div>
                    <div className="flex justify-between border-t border-white/5 pt-1">
                      <span className="text-[#a0aec0]">Full Kelly 仓位</span>
                      <span className={`font-mono font-semibold ${btResult.kelly.full > 0 ? "text-up" : "text-down"}`}>{btResult.kelly.full}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#a0aec0]">Half Kelly (建议)</span>
                      <span className="font-mono font-semibold text-indigo-400">{btResult.kelly.half}%</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] text-[#778]">f* = (p×b − q) / b，Half Kelly 降低破产风险</div>
                </div>
                {/* 风险平价 */}
                <div className="p-2.5 rounded-lg border border-white/10 bg-white/[0.02]">
                  <div className="text-[11px] font-medium text-white mb-2">风险平价权重 vs 当前</div>
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
                  <div className="mt-2 text-[9px] text-[#778]">按波动率倒数分配，使每个标的对组合风险贡献相等</div>
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
                  <div className="text-[11px] font-semibold text-amber-400 mb-1.5 tracking-wide uppercase" style={{ letterSpacing: "0.05em" }}>回测偏差声明</div>
                  <div className="space-y-1 text-[10px] text-[#a0aec0]">
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">前视偏差</b> — 当前标的池基于今日可知信息选取，回测期间部分标的可能尚未上市或不在关注范围内</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">生存者偏差</b> — 标的池不包含已退市或被收购的股票，可能高估策略表现</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">交易成本</b> — 仅模拟固定手续费 ({costBps} bps)，未含滑点和市场冲击成本</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-amber-400/60 shrink-0">⚠</span>
                      <span><b className="text-white/80">复权处理</b> — 使用 Yahoo Finance 后复权价格，分红再投资假设可能与实际不符</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px] text-[#667] italic">过往表现不代表未来收益。回测结果仅供研究参考，不构成投资建议。</div>
                </div>
              </div>
            </div>
            </>)}
          </div>
        )}
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
const Monitor = () => {
  const { stocks: ctxStocks3, alerts: ctxAlerts3 } = useContext(DataContext) || {};
  const liveStocks = ctxStocks3 || STOCKS;
  const liveAlerts = ctxAlerts3 || ALERTS;
  const [selSector, setSelSector] = useState("存储");
  const sectors = [
    { name: "存储/NAND", value: 8.5 },
    { name: "半导体/AI", value: 5.2 },
    { name: "航天/国防", value: 3.5 },
    { name: "银行/金融", value: 0.8 },
  ];

  const fearGreed = 58;

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      <div className="md:col-span-4 flex flex-col gap-4 md:gap-3 md:min-h-0 md:overflow-auto pr-0 md:pr-1">
        <div className="glass-card p-3 md:p-4">
          <div className="section-header mb-3">
            <Activity size={12} className="text-indigo-400" />
            <span className="section-title">市场情绪指数</span>
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
                  {fearGreed > 75 ? "极度贪婪" : fearGreed > 60 ? "贪婪" : fearGreed > 40 ? "中性偏贪" : fearGreed > 25 ? "恐惧" : "极度恐惧"}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              {[
                [75, 100, "极度贪婪", "text-up", "bg-up"],
                [50, 75, "贪婪", "text-up", "bg-up"],
                [25, 50, "恐惧", "text-amber-400", "bg-amber-400"],
                [0, 25, "极度恐惧", "text-down", "bg-down"],
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
        </div>

        <MobileAccordion title="关注板块表现 (今日)">
          <div className="space-y-2">
            {sectors.map(s => (
              <button key={s.name} onClick={() => setSelSector(s.name.split("/")[0])} className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selSector === s.name.split("/")[0] ? "bg-indigo-500/10 border border-indigo-500/20" : "hover:bg-white/5 border border-transparent"}`}>
                <span className="text-xs text-white">{s.name}</span>
                <span className={`text-xs font-mono ${s.value >= 0 ? "text-up" : "text-down"}`}>+{s.value}%</span>
              </button>
            ))}
          </div>
        </MobileAccordion>

        <MobileAccordion title="板块-ETF 映射" className="md:flex-1">
          <div className="text-[10px] text-[#a0aec0] mb-3">已选: {selSector}</div>
          {SECTOR_ETF_MAP[selSector] && (
            <div className="space-y-2">
              <div className="text-sm font-bold text-white">{SECTOR_ETF_MAP[selSector].etf}</div>
              <div className="text-[10px] text-[#a0aec0]">{SECTOR_ETF_MAP[selSector].name}</div>
              {SECTOR_ETF_MAP[selSector].change != null && (
                <Badge variant={safeChange(SECTOR_ETF_MAP[selSector].change) >= 0 ? "success" : "danger"}>
                  今日 {safeChange(SECTOR_ETF_MAP[selSector].change) >= 0 ? "+" : ""}{fmtChange(SECTOR_ETF_MAP[selSector].change)}%
                </Badge>
              )}
            </div>
          )}
        </MobileAccordion>
      </div>

      <div className="md:col-span-5 flex flex-col gap-4 md:gap-3 md:min-h-0">
        <MobileAccordion
          title="智能预警"
          icon={<Bell size={14} className="text-indigo-400" />}
          badge={<Badge variant="accent">{liveAlerts.length}</Badge>}
          extra={<><div className="live-dot" /><span className="text-[10px] text-[#a0aec0]">实时数据流</span></>}
          flex
          className="md:flex-1 flex flex-col md:min-h-0"
        >
          <div className="md:flex-1 md:overflow-auto space-y-2">
            {liveAlerts.map((a, idx) => (
              <div key={a.id} className={`p-3 rounded-lg border transition-all hover:bg-white/[0.02] animate-stagger relative ${a.severity === "high" ? "border-red-500/20 bg-red-500/5" : a.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-sky-500/20 bg-sky-500/5"}`} style={{ animationDelay: `${idx * 0.06}s` }}>
                {a.severity === "high" && <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-down animate-breathe" />}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{a.ticker}</span>
                    <Badge variant={a.type === "score" ? "accent" : a.type === "technical" ? "warning" : a.type === "price" ? "danger" : "info"}>
                      {a.type === "score" ? "评级" : a.type === "technical" ? "技术" : a.type === "price" ? "价格" : "新闻"}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-[#a0aec0] font-mono">{a.time}</span>
                </div>
                <p className="text-xs text-[#a0aec0] leading-relaxed">{a.message}</p>
              </div>
            ))}
          </div>
        </MobileAccordion>
      </div>

      <div className="md:col-span-3 flex flex-col gap-4 md:gap-3 md:min-h-0 md:overflow-auto pr-0 md:pr-1">
        <MobileAccordion title="标的实时概览">
          <div className="space-y-2">
            {liveStocks.map((s, idx) => (
              <div key={s.ticker} className="flex items-center justify-between p-1.5 rounded bg-white/[0.02] animate-stagger" style={{ animationDelay: `${idx * 0.02}s` }}>
                <span className="text-xs font-mono text-white">{s.ticker}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono tabular-nums text-[#a0aec0]">{s.currency === "HKD" ? "HK$" : "$"}{s.price}</span>
                  <span className={`text-[10px] font-mono tabular-nums ${safeChange(s.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(s.change) >= 0 ? "+" : ""}{fmtChange(s.change)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </MobileAccordion>

        <MobileAccordion title="预警规则" className="md:flex-1">
          <div className="space-y-3">
            {[
              { label: "SNDK RSI超买", value: "> 70 (当前 71)", active: true },
              { label: "RKLB 评分突变", value: "排名变化 > 3", active: true },
              { label: "07709.HK 波动磨损", value: "> 10% / 年", active: true },
              { label: "00005.HK 财报预警", value: "5月5日", active: false },
            ].map((r, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-white">{r.label}</div>
                  <div className="text-[10px] text-[#a0aec0]">{r.value}</div>
                </div>
                <div className={`w-10 h-5 md:w-8 md:h-4 rounded-full p-0.5 transition-colors cursor-pointer ${r.active ? "bg-indigo-500" : "bg-white/10"}`}>
                  <div className={`w-4 h-4 md:w-3 md:h-3 rounded-full bg-white transition-transform ${r.active ? "translate-x-5 md:translate-x-4" : ""}`} />
                </div>
              </div>
            ))}
          </div>
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

const Journal = () => {
  const { stocks: ctxStocks4, standalone } = useContext(DataContext) || {};
  const liveStocks = ctxStocks4 || STOCKS;
  const [entries, setEntries] = useState(() => loadJournal() || JOURNAL);
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

  const calcRet = (a, c) => {
    if (!a || a === 0 || c == null) return "0.00";
    const v = (c - a) / a * 100;
    return isFinite(v) ? v.toFixed(2) : "0.00";
  };

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
          <Plus size={14} /> 新增看好标的
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
                  placeholder="搜索代码或名称 (如 AAPL, 腾讯)..."
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
                  <Loader size={12} className="animate-spin mr-1.5" /> 搜索中...
                </div>
              )}
              {/* 搜索结果 */}
              {!addSearching && addSearchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 glass-card z-20 max-h-[200px] overflow-auto" style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                  {addSearchResults.map(r => (
                    <button
                      key={r.symbol}
                      onClick={() => handleSelectStock(r)}
                      className="w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-all hover:bg-white/5 border-b border-white/5"
                    >
                      <span className="font-semibold" style={{ color: "var(--text-heading)" }}>{r.symbol}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent-indigo)" }}>{r.market || "US"}</span>
                      <span className="truncate text-[10px] flex-1" style={{ color: "var(--text-secondary)" }}>{r.name}</span>
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
              placeholder="投资论点 (为什么看好这个标的？)..."
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
            />
            {/* 标签 */}
            <input
              value={addTags}
              onChange={e => setAddTags(e.target.value)}
              placeholder="标签 (用逗号分隔, 如: AI, 半导体, 催化剂)"
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
                {addingEntry ? <><Loader size={11} className="animate-spin" /> 获取价格...</> : <><Zap size={11} /> 记录 (自动锚定当前价)</>}
              </button>
              <button onClick={() => { setShowAdd(false); setAddTicker(""); setAddThesis(""); setAddTags(""); setSelectedStock(null); setAddSearchResults([]); }}
                className="px-4 py-2 rounded-lg text-xs transition-all" style={{ background: "var(--bg-muted)", color: "var(--text-secondary)" }}>
                取消
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto space-y-2">
          {entries.map(e => {
            const ret = calcRet(e.anchorPrice, e.currentPrice);
            const stk = liveStocks.find(s => s.ticker === e.ticker);
            const currency = stk?.currency === "HKD" ? "HK$" : "$";
            const pnlAmount = e.anchorPrice > 0 ? ((e.currentPrice - e.anchorPrice) / e.anchorPrice * 10000).toFixed(0) : 0; // per $10k
            return (
              <div key={e.id} className={`relative w-full text-left p-3 rounded-xl transition-all border cursor-pointer group ${sel?.id === e.id ? "bg-indigo-500/8 border-indigo-500/30" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"}`} onClick={() => { setSel(e); setMobileShowDetail(true); }}>
                {/* 收益率指示条 */}
                <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${ret >= 0 ? "bg-up" : "bg-down"}`} />
                {/* 删除按钮 — 右下角 */}
                <button
                  onClick={(ev) => { ev.stopPropagation(); if (window.confirm(`确定删除 ${e.ticker} 的投资��录？`)) deleteEntry(e.id); }}
                  className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all opacity-0 group-hover:opacity-100 text-down bg-down/[0.08] border border-down/15 hover:bg-down/20 hover:border-down/40"
                  title="删除此记录"
                ><Trash2 size={10} /> ���除</button>
                <div className="flex items-center justify-between mb-1.5 pl-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm" style={{ color: "var(--text-heading)" }}>{e.ticker}</span>
                    <span className="text-[10px] text-[#a0aec0] hidden sm:inline">{e.name}</span>
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
        {sel && (() => {
          const stk = liveStocks.find(s => s.ticker === sel.ticker);
          const ret = calcRet(sel.anchorPrice, sel.currentPrice);
          const currency = stk?.currency === "HKD" ? "HK$" : "$";
          return (
            <div className="flex flex-col gap-3">
              {/* 手机端返回按钮 */}
              <button onClick={() => setMobileShowDetail(false)} className="md:hidden flex items-center gap-1.5 text-xs text-indigo-400 py-2 px-3 rounded-lg bg-indigo-500/[0.06] border border-indigo-500/15 w-fit active:scale-95 transition-all">
                <ChevronRight size={14} className="rotate-180" /> 返回列表
              </button>

              <div className="glass-card p-3 md:p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Eye size={14} className="text-indigo-400" />
                    <span className="text-xs font-medium" style={{ color: "var(--text-heading)" }}>投资论点 — {sel.ticker} {sel.name}</span>
                  </div>
                  <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                    <span className="text-[10px] text-[#a0aec0]">记录于 {sel.anchorDate}</span>
                    <span className="text-[10px] text-[#a0aec0]">锚定 {currency}{sel.anchorPrice}</span>
                    <Badge variant={ret >= 0 ? "success" : "danger"}>
                      {ret >= 0 ? "+" : ""}{ret}% 自记录
                    </Badge>
                  </div>
                </div>
                <p className="text-xs md:text-sm leading-relaxed border-l-2 border-indigo-500/30 pl-3" style={{ color: "var(--text-secondary)" }}>{sel.thesis}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="glass-card glass-card-hover p-2 md:p-3 text-center">
                  <div className="text-[9px] md:text-[10px] text-[#a0aec0] mb-1">锚定价格</div>
                  <div className="text-sm md:text-lg font-bold font-mono tabular-nums" style={{ color: "var(--text-heading)" }}>{currency}{sel.anchorPrice}</div>
                </div>
                <div className="glass-card glass-card-hover p-2 md:p-3 text-center">
                  <div className="text-[9px] md:text-[10px] text-[#a0aec0] mb-1">当前价格</div>
                  <div className="text-sm md:text-lg font-bold font-mono tabular-nums" style={{ color: "var(--text-heading)" }}>{currency}{sel.currentPrice}</div>
                </div>
                <div className="glass-card glass-card-hover p-2 md:p-3 text-center">
                  <div className="text-[9px] md:text-[10px] text-[#a0aec0] mb-1">收益率</div>
                  <div className={`text-sm md:text-lg font-bold font-mono tabular-nums ${ret >= 0 ? "text-up" : "text-down"}`}>{ret >= 0 ? "+" : ""}{ret}%</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
                <div className="glass-card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Layers size={12} className="text-[#a0aec0]" />
                    <span className="text-xs font-medium text-[#a0aec0]">行业PE对标</span>
                  </div>
                  <ResponsiveContainer width="100%" height="80%">
                    <BarChart data={peerData} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 10, fill: "#666" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} width={60} />
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
                    <span className="text-xs font-medium text-[#a0aec0]">关联 ETF & 关键日期</span>
                  </div>
                  <div className="space-y-3">
                    {sel.etf && sel.etf !== "N/A" ? (
                      <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">{sel.etf}</span>
                          {SECTOR_ETF_MAP[sel.sector]?.change != null && (
                            <Badge variant={safeChange(SECTOR_ETF_MAP[sel.sector].change) >= 0 ? "success" : "danger"}>{safeChange(SECTOR_ETF_MAP[sel.sector].change) >= 0 ? "+" : ""}{fmtChange(SECTOR_ETF_MAP[sel.sector].change)}%</Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-[#a0aec0]">{SECTOR_ETF_MAP[sel.sector]?.name || sel.etf}</div>
                      </div>
                    ) : (
                      <div className="p-3 bg-white/[0.03] rounded-lg border border-white/5">
                        <div className="text-xs text-[#a0aec0]">该板块暂无精确对应ETF</div>
                        <div className="text-[10px] text-[#a0aec0] mt-1">可关注 ARKX (太空探索ETF)</div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <div className="text-[10px] text-[#a0aec0] font-medium">关键日期追踪</div>
                      {stk?.nextEarnings && (
                        <div className="flex items-center justify-between p-1.5 rounded bg-white/[0.02]">
                          <span className="text-xs text-white">下次财报</span>
                          <Badge variant="accent">{stk.nextEarnings}</Badge>
                        </div>
                      )}
                      <div className="flex items-center justify-between p-1.5 rounded bg-white/[0.02]">
                        <span className="text-xs text-white">记录天数</span>
                        <span className="text-xs font-mono text-[#a0aec0]">{Math.floor((new Date() - new Date(sel.anchorDate)) / 86400000)}天</span>
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
      setMsg(`✓ ${item.symbol} 已添加`);
      setSearchResults(prev => prev.map(r => r.symbol === item.symbol ? { ...r, alreadyAdded: true } : r));
    } else {
      setMsg(`✗ ${res?.detail || "添加失败"}`);
    }
  }, [addTicker]);

  const doRemove = useCallback(async (ticker) => {
    const res = await removeTicker(ticker);
    if (res?.success) setMsg(`✓ ${ticker} 已删除`);
    else setMsg(`✗ ${res?.detail || "删除失败"}`);
  }, [removeTicker]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[560px] mx-4 max-h-[80vh] glass-card p-0 flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-indigo-400" />
            <span className="text-sm font-semibold text-white">标的管理</span>
            {apiOnline
              ? <span className="flex items-center gap-1 text-[10px] text-up"><div className="live-dot" style={{ width: 4, height: 4 }} /> API 在线</span>
              : <span className="text-[10px] text-down">API 离线 — 使用静态数据</span>
            }
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-[#a0aec0] hover:text-white transition-colors"><X size={16} /></button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-2">
          <button onClick={() => setView("search")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === "search" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "text-[#a0aec0] hover:text-white"}`}>
            <Search size={12} className="inline mr-1" />搜索添加
          </button>
          <button onClick={() => setView("manage")} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === "manage" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "text-[#a0aec0] hover:text-white"}`}>
            <Settings size={12} className="inline mr-1" />管理 ({stocks.length})
          </button>
          <div className="flex-1" />
          <button onClick={refreshData} disabled={refreshing || !apiOnline} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 transition-all disabled:opacity-40">
            <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "刷新中..." : "刷新全部"}
          </button>
        </div>

        {/* Message */}
        {msg && <div className="px-4 pb-1"><span className={`text-[10px] ${msg.startsWith("✓") ? "text-up" : "text-down"}`}>{msg}</span></div>}

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 pt-1 min-h-0">
          {!apiOnline ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#778]">
              <Database size={32} className="mb-3 opacity-30" />
              <span className="text-sm mb-1">API 服务未启动</span>
              <span className="text-[10px] mb-3 text-center max-w-[320px]">请在终端中运行以下命令启动后端：</span>
              <div className="bg-white/5 rounded-lg p-3 text-[11px] font-mono text-indigo-400 border border-white/8">
                cd backend && pip install fastapi uvicorn && python server.py
              </div>
              <span className="text-[10px] text-[#778] mt-3">启动后即可搜索和添加任意股票/ETF</span>
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
                    placeholder="输入代码或名称搜索... (如 AAPL, TSLA, 0700.HK)"
                    autoCorrect="off" autoCapitalize="none" spellCheck={false}
                    className="w-full bg-white/5 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-[#667] outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                  />
                </div>
                <button onClick={doSearch} disabled={searching || !searchQ.trim()} className="px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-indigo-500 to-violet-500 text-white btn-tactile disabled:opacity-40">
                  {searching ? <Loader size={14} className="animate-spin" /> : "搜索"}
                </button>
              </div>

              {/* Results */}
              {searching ? (
                <div className="flex items-center justify-center py-8">
                  <Loader size={20} className="animate-spin text-indigo-400 mr-2" />
                  <span className="text-xs text-[#a0aec0]">搜索中...</span>
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
                        {item.alreadyAdded ? <><Check size={10} className="inline mr-0.5" /> 已添加</> :
                         adding[item.symbol] ? <><Loader size={10} className="inline mr-0.5 animate-spin" /> 添加中</> :
                         <><Plus size={10} className="inline mr-0.5" /> 添加</>}
                      </button>
                    </div>
                  ))}
                </div>
              ) : searchQ && !searching ? (
                <div className="text-center py-8 text-[#778] text-xs">未找到匹配结果，请尝试其他关键词</div>
              ) : (
                <div className="text-center py-8 text-[#778]">
                  <Search size={24} className="mx-auto mb-2 opacity-30" />
                  <div className="text-xs mb-2">搜索全球股票和 ETF</div>
                  <div className="text-[10px] space-y-0.5">
                    <div>支持美股 (AAPL, TSLA)、港股 (0700.HK, 9988.HK)</div>
                    <div>支持 ETF (SPY, QQQ, ARKK) 和杠杆 ETF (TQQQ, SOXL)</div>
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
                    <span className="text-[10px] text-[#a0aec0] truncate">{s.name}</span>
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
          <span>共 {stocks.length} 个标的</span>
          <span>数据来源: Yahoo Finance API</span>
        </div>
      </div>
    </div>
  );
};

// ─── 时钟组件（独立渲染，避免每秒重绘整个页面） ──────────
const LiveClock = React.memo(() => {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="font-mono tabular-nums text-xs text-[#a0aec0]">{time.toLocaleTimeString("zh-CN", { hour12: false })}</span>;
});

// ─── Main ─────────────────────────────────────────────────
function QuantPlatformInner() {
  const { stocks, alerts, apiOnline, refreshing, priceUpdatedAt, priceRefreshing, quickPriceRefresh } = useData();
  const [tab, setTab] = useState("scoring");
  const [showManager, setShowManager] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("quantedge_theme") || "dark");
  useEffect(() => {
    localStorage.setItem("quantedge_theme", theme);
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);
  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  return (
    <div className={`w-full h-screen flex flex-col overflow-hidden ${theme === "light" ? "light" : ""}`} style={{
      background: "var(--bg-gradient)",
      fontFamily: "'DM Sans', 'Noto Sans SC', sans-serif", color: "var(--text-primary)",
    }}>
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
                <p className="text-[9px] md:text-[10px] text-[#a0aec0] hidden sm:block leading-tight">综合量化投资平台 · 真实数据</p>
              </div>
              <span className="hidden lg:inline-flex px-1.5 py-0.5 rounded text-[8px] font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">PRO</span>
            </div>
          </div>
          {/* Mobile: show compact right-side controls */}
          <div className="flex md:hidden items-center gap-1.5">
            <button onClick={toggleTheme} className="p-2.5 rounded-lg bg-white/5 text-[#a0aec0] border border-white/5 transition-all active:scale-95" title={theme === "dark" ? "切换浅色" : "切换深色"}>
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button onClick={() => setShowManager(true)} className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-[10px] font-medium bg-white/5 text-[#a0aec0] border border-white/5 active:scale-95" title="标的管理">
              <Database size={12} />
              <span>{stocks.length}</span>
            </button>
            <div className="flex items-center gap-1.5 pl-1">
              <div className="live-dot" />
              <LiveClock />
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-0.5 md:gap-1 bg-white/[0.03] rounded-xl p-0.5 md:p-1 gradient-border w-full md:w-auto overflow-x-auto">
          {TAB_CFG.map(t => {
            const I = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={`relative flex items-center gap-1 md:gap-1.5 px-2.5 md:px-4 py-2 md:py-2 rounded-lg text-[11px] md:text-xs font-medium btn-tactile whitespace-nowrap flex-1 md:flex-none justify-center active:scale-95 ${tab === t.id ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.4)] ring-1 ring-indigo-400/20" : "text-[#a0aec0] hover:text-white hover:bg-white/[0.06]"}`}>
                <I size={13} />{t.label}
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
          <button onClick={toggleTheme} className="p-1.5 rounded-lg bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 border border-white/5 transition-all btn-tactile" title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={() => setShowManager(true)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-white/5 text-[#a0aec0] hover:text-white hover:bg-white/10 border border-white/5 transition-all btn-tactile" title="标的管理">
            <Database size={12} />
            <span>{stocks.length}</span>
            {apiOnline && <div className="live-dot" style={{ width: 4, height: 4 }} />}
          </button>
          <div className="flex items-center gap-2">
            <div className="live-dot" />
            <LiveClock />
          </div>
        </div>
      </header>

      <main className="flex-1 p-2 md:p-4 min-h-0 overflow-hidden flex flex-col">
        {tab === "scoring" && <ScoringDashboard />}
        {tab === "backtest" && <BacktestEngine />}
        {tab === "monitor" && <Monitor />}
        {tab === "journal" && <Journal />}
      </main>

      <footer className="flex items-center justify-between px-3 md:px-6 py-1.5 md:py-2 border-t border-white/5 bg-white/[0.02] backdrop-blur-sm flex-shrink-0" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-[#a0aec0] flex-wrap">
          <span className="hidden sm:flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? "bg-up" : "bg-amber-400"}`} />
            Yahoo Finance{apiOnline ? " · 在线" : " · 离线"}
          </span>
          <span className="hidden sm:inline text-white/10">|</span>
          <span className="flex items-center gap-1">
            <Clock size={9} className="opacity-60" />
            {priceUpdatedAt ? formatCacheAge(priceUpdatedAt) : "未知"}
            {isCacheStale({ timestamp: priceUpdatedAt }) && priceUpdatedAt > 0 && <span className="text-amber-400 ml-0.5 animate-breathe" title="数据超过24小时未更新">●</span>}
          </span>
          <span className="hidden md:inline text-white/10">|</span>
          <span className="hidden md:inline">美股 {stocks.filter(s=>s.market==="US").length} · 港股 {stocks.filter(s=>s.market==="HK").length} · 共 {stocks.length} 标的</span>
          <button
            onClick={quickPriceRefresh}
            disabled={priceRefreshing}
            className="flex items-center gap-1 px-2.5 py-1.5 md:px-2 md:py-0.5 rounded-lg md:rounded-md bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition-all disabled:opacity-50 active:scale-95 border border-white/5"
            title="快速刷新价格（Yahoo Finance 直接获取）"
          >
            <RefreshCw size={10} className={priceRefreshing ? "animate-spin" : ""} />
            {priceRefreshing ? "刷新中..." : "刷新"}
          </button>
        </div>
        <span className="text-[9px] md:text-[10px] text-[#778] font-mono shrink-0">v0.6.0</span>
      </footer>

      <TickerManager open={showManager} onClose={() => setShowManager(false)} />
    </div>
  );
}

export default function QuantPlatform() {
  return (
    <DataProvider>
      <QuantPlatformInner />
    </DataProvider>
  );
}
