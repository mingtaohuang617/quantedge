// ─────────────────────────────────────────────────────────────
// ScoringDashboard — 评分仪表盘 / 股票列表 / 详情面板
// 从 quant-platform.jsx 抽出（C1 重构第四步），通过 React.lazy 懒加载
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback, useRef, useContext } from "react";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart, ReferenceLine } from "recharts";
import { Activity, ArrowDownRight, ArrowUpRight, Briefcase, Calendar, Check, ChevronDown, ChevronRight, Clock, Database, Eye, Filter, GripVertical, Info, Layers, Loader, Maximize2, Minus, Plus, RefreshCw, Search, Settings, Star, Trash2, TrendingUp, X, Zap } from "lucide-react";
import { searchTickers as standaloneSearch, fetchRangePrices, STOCK_CN_NAMES, STOCK_CN_DESCS } from "../standalone.js";
import { useLang } from "../i18n.jsx";
import { STOCKS } from "../data.js";
import AIStockSummaryCard from "../components/AIStockSummaryCard.jsx";
import ScoreExplainCard from "../components/ScoreExplainCard.jsx";
import {
  DataContext,
  useData,
  apiFetch,
  displayTicker,
  safeChange,
  fmtChange,
  TOOLTIP_STYLE,
  Badge,
  CountUp,
  Highlight,
  ScoreBar,
  SkeletonBlock,
  MobileAccordion,
  MiniSparkline,
  get5DSparkData,
  useContainerSize,
  currencySymbol,
  fmtPrice,
} from "../quant-platform.jsx";

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
                  [t("现价"), s => `${currencySymbol(s.currency)}${s.price}`, "text-white"],
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
  // A2: 评分权重 — 从 localStorage 读取（按 workspace 隔离），失败回退默认
  const [weights, setWeights] = useState(() => {
    try {
      const wsId = localStorage.getItem('quantedge_active_workspace') || 'default';
      const raw = localStorage.getItem(`quantedge_weights_${wsId}`);
      if (raw) {
        const w = JSON.parse(raw);
        // 校验必要字段 + 都是数字
        if (typeof w?.fundamental === 'number' && typeof w?.technical === 'number' && typeof w?.growth === 'number') {
          return w;
        }
      }
    } catch { /* 静默回退 */ }
    return { fundamental: 40, technical: 30, growth: 30 };
  });
  const [showW, setShowW] = useState(false);
  // A2: weights 改动时持久化到 localStorage（按当前 workspace）
  useEffect(() => {
    try {
      const wsId = localStorage.getItem('quantedge_active_workspace') || 'default';
      localStorage.setItem(`quantedge_weights_${wsId}`, JSON.stringify(weights));
    } catch { /* 私密模式可能 setItem 失败，忽略 */ }
  }, [weights]);
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
  // PDF1 P0：归因卡（scoreBreakdown）默认置顶，雷达图作为可切换备选
  const DEFAULT_CARD_ORDER = ['scoreBreakdown', 'range52w', 'radar'];
  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("quantedge_card_order") || 'null');
      if (Array.isArray(saved) && saved.length === DEFAULT_CARD_ORDER.length && DEFAULT_CARD_ORDER.every(k => saved.includes(k))) {
        // v0.7 一次性迁移：旧用户的 radar 若排在 scoreBreakdown 之前则交换（仅一次）
        const migrationFlag = localStorage.getItem("quantedge_card_order_v07_migrated");
        if (!migrationFlag) {
          try { localStorage.setItem("quantedge_card_order_v07_migrated", "1"); } catch {}
          const radarIdx = saved.indexOf('radar');
          const breakdownIdx = saved.indexOf('scoreBreakdown');
          if (radarIdx >= 0 && breakdownIdx >= 0 && radarIdx < breakdownIdx) {
            const next = [...saved];
            [next[radarIdx], next[breakdownIdx]] = [next[breakdownIdx], next[radarIdx]];
            return next;
          }
        }
        return saved;
      }
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
  const { stocks: ctxStocks, setStocks: ctxSetStocks, addTicker, removeTicker, apiOnline, standalone, quickPriceRefresh } = useData() || {};
  // F3 移动端 pull-to-refresh — 列表容器顶部下拉超过 60px 触发刷新
  const [pullDist, setPullDist] = useState(0);
  const pullRef = useRef({ startY: 0, active: false, container: null });
  const onListTouchStart = useCallback((e) => {
    const el = e.currentTarget;
    if (el.scrollTop > 4) return;  // 仅当滚到顶才允许下拉
    pullRef.current = { startY: e.touches[0].clientY, active: true, container: el };
  }, []);
  const onListTouchMove = useCallback((e) => {
    if (!pullRef.current.active) return;
    const dy = e.touches[0].clientY - pullRef.current.startY;
    if (dy > 0) setPullDist(Math.min(dy * 0.5, 70));
  }, []);
  const onListTouchEnd = useCallback(async () => {
    if (!pullRef.current.active) return;
    pullRef.current.active = false;
    if (pullDist > 50 && quickPriceRefresh) {
      try { await quickPriceRefresh(); } catch {}
    }
    setPullDist(0);
  }, [pullDist, quickPriceRefresh]);
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
    // Filter out null/0/negative prices (sanitized NaN + dividend-adjusted 异常)
    // 例: yfinance 韩股 SK 海力士 25Y ALL 调整后 close 可能出现负值，导致 basePrice
    // 算反 + 区间收益变成 -647% 之类的不可能值。
    const raw = rawAll.filter(d => d.p != null && d.p > 0);
    if (raw.length === 0) return [];
    const basePrice = raw[0].p;
    if (basePrice <= 0) return [];   // 防御性二次校验
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
        score: median(peers.map(s => s.score)),
        peerCount: peers.length,
      };
    }
    return {
      fundamental: median(peers.map(s => s.subScores?.fundamental)),
      technical: median(peers.map(s => s.subScores?.technical)),
      growth: median(peers.map(s => s.subScores?.growth)),
      score: median(peers.map(s => s.score)),    // PDF1 评分锚点：详情头部 vs 行业中位
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
      {/* C8: 恐惧贪婪指数 + 板块热力 — 复用 stocks 数据，无额外网络 */}
      {(() => {
        if (!liveStocks?.length) return null;
        const valid = liveStocks.map(s => safeChange(s.change)).filter(c => isFinite(c));
        if (valid.length === 0) return null;
        const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
        const breadth = valid.filter(c => c > 0).length / valid.length;
        const fearGreed = Math.round(Math.min(100, Math.max(0, 50 + avg * 8)) * 0.6 + breadth * 100 * 0.4);
        const fgLabel = fearGreed > 75 ? t('极度贪婪') : fearGreed > 60 ? t('贪婪') : fearGreed > 40 ? t('中性') : fearGreed > 25 ? t('恐惧') : t('极度恐惧');
        const fgColor = fearGreed > 60 ? 'text-up' : fearGreed > 40 ? 'text-amber-400' : 'text-down';
        const fgBg = fearGreed > 60 ? 'bg-up' : fearGreed > 40 ? 'bg-amber-400' : 'bg-down';
        // 板块聚合 — 取前 5 个 |avg| 最大
        const groups = {};
        liveStocks.forEach(s => {
          const c = safeChange(s.change);
          if (!isFinite(c) || !s.sector) return;
          const k = s.sector.split('/')[0];
          if (!groups[k]) groups[k] = { sum: 0, n: 0 };
          groups[k].sum += c; groups[k].n += 1;
        });
        const sectors = Object.entries(groups)
          .map(([name, { sum, n }]) => ({ name, val: +(sum / n).toFixed(2), n }))
          .filter(s => s.n >= 2)
          .sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
          .slice(0, 5);
        return (
          <>
            <span className="text-white/10 shrink-0">|</span>
            <div className="flex items-center gap-1.5 shrink-0" title={t('恐惧贪婪指数：基于今日涨跌均值 + 上涨宽度')}>
              <span className="text-[#a0aec0] font-medium uppercase text-[8px]">F&G</span>
              <span className={`w-1.5 h-1.5 rounded-full ${fgBg}`} />
              <span className={`font-mono tabular-nums font-bold ${fgColor}`}>{fearGreed}</span>
              <span className={`text-[9px] ${fgColor}`}>{fgLabel}</span>
            </div>
            {sectors.length > 0 && (
              <>
                <span className="text-white/10 shrink-0">|</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[#a0aec0] font-medium uppercase text-[8px]">{t('板块')}</span>
                  {sectors.map(s => (
                    <span key={s.name} className="flex items-center gap-1" title={`${s.name} · ${s.n} ${t('只')}`}>
                      <span className="text-[10px] text-[#a0aec0] truncate max-w-[60px]">{t(s.name)}</span>
                      <span className={`font-mono tabular-nums text-[10px] ${s.val >= 0 ? 'text-up' : 'text-down'}`}>
                        {s.val >= 0 ? '+' : ''}{s.val.toFixed(2)}%
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        );
      })()}
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
              className="w-full py-2 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-indigo-500 to-cyan-500 text-white flex items-center justify-center gap-1.5 shadow-glow-indigo btn-tactile btn-shine mt-1"
            >
              <Zap size={12} /> {t('应用权重并重新评分')}
            </button>
          </div>
        )}
        <div
          className="space-y-0.5 pr-1 md:flex-1 md:overflow-auto relative"
          onTouchStart={onListTouchStart}
          onTouchMove={onListTouchMove}
          onTouchEnd={onListTouchEnd}
          style={pullDist > 0 ? { transform: `translateY(${pullDist}px)`, transition: pullDist === 0 ? 'transform 0.25s ease-out' : 'none' } : undefined}
        >
          {/* F3: pull-to-refresh hint（仅移动端 + 下拉中可见） */}
          {pullDist > 0 && (
            <div
              className="md:hidden absolute left-0 right-0 -top-7 flex items-center justify-center gap-1.5 text-[10px] font-mono pointer-events-none"
              style={{ color: pullDist > 50 ? 'var(--sem-up)' : 'var(--text-muted)' }}
            >
              <RefreshCw size={11} className={pullDist > 50 ? 'animate-spin' : ''} />
              {pullDist > 50 ? t('松开刷新') : t('下拉刷新行情')}
            </div>
          )}
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
            <button key={stk.ticker} onClick={() => { setSel(stk); setMobileShowDetail(true); }} onContextMenu={(e) => handleContextMenu(e, stk)} className={`virt-row w-full text-left px-2.5 ${density === "compact" ? "py-1" : "py-2.5 md:py-2"} rounded-lg transition-all duration-200 border ${i < 30 ? 'animate-stagger' : ''} active:scale-[0.98] group relative ${sel?.ticker === stk.ticker ? "bg-gradient-to-r from-indigo-500/35 via-indigo-500/15 to-transparent border-indigo-500/30 shadow-lg shadow-indigo-500/5" : "bg-white/[0.02] border-transparent hover:bg-white/[0.04] hover:border-white/10"}`} style={{ animationDelay: i < 30 ? `${i * 0.03}s` : undefined }}>
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
                  {/* PDF1 P0 收敛：市场标签从彩色 Badge 改 neutral mono 文字。ETF/leverage 是功能性识别，保留 Badge */}
                  <span className="text-[9px] font-mono uppercase tracking-wide" style={{ color: 'var(--sem-neutral)' }}>{stk.market}</span>
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

      <div className={`detail-ambient md:col-span-7 md:min-h-0 md:overflow-auto pr-0 md:pr-1 pb-16 md:pb-0 ${mobileShowDetail ? "flex flex-col" : "hidden md:block"}`}>
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
                    {/* PDF1 收敛：sector 从 accent Badge 改 neutral 文字（信息性，无需视觉权重） */}
                    <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{sel.market} · {sel.sector}</span>
                    {sel.isETF && <Badge variant={sel.leverage ? "danger" : "warning"} size="sm">{sel.etfType}</Badge>}
                    {/* PDF2 抛光：28px 评分环 stroke 描边动画（1.1s）+ 双色品牌渐变 */}
                    {sel.score != null && (() => {
                      const C = 69.12;  // 2π × r=11
                      const s = Math.min(100, Math.max(0, sel.score));
                      const gradId = `score-ring-grad-${sel.ticker || 'sel'}`;
                      return (
                        <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0" aria-hidden="true">
                          <defs>
                            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="var(--accent-indigo)" />
                              <stop offset="100%" stopColor="var(--accent-cyan)" />
                            </linearGradient>
                          </defs>
                          <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
                          <circle cx="14" cy="14" r="11" fill="none"
                            stroke={`url(#${gradId})`} strokeWidth="2.5" strokeLinecap="round"
                            strokeDasharray={C}
                            strokeDashoffset={C * (1 - s / 100)}
                            transform="rotate(-90 14 14)"
                            style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.2,0.7,0.1,1)' }}
                          />
                        </svg>
                      );
                    })()}
                    {/* PDF1 P0：评分数字 + vs 行业中位 ▲▼ delta（chip 与环并排） */}
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-white">
                      <CountUp value={sel.score} decimals={1} duration={500} />
                      <span className="text-[#778] font-normal">/100</span>
                    </span>
                    {sectorMedians?.score != null && (
                      <span
                        className={`text-[9px] font-mono ${(sel.score - sectorMedians.score) >= 0 ? 'text-up' : 'text-down'}`}
                        title={t('vs 行业中位 {n}（{p} 同行）', { n: sectorMedians.score.toFixed(1), p: sectorMedians.peerCount })}
                      >
                        {(sel.score - sectorMedians.score) >= 0 ? '▲' : '▼'} {Math.abs(sel.score - sectorMedians.score).toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#a0aec0]">{lang === 'zh' ? (sel.nameCN || STOCK_CN_NAMES[sel.ticker] || sel.name) : sel.name}</div>
                </div>
                <div className="sm:text-right flex sm:block items-center gap-2">
                  <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white">
                    <CountUp value={parseFloat(sel.price) || 0} decimals={(sel.currency === "KRW" || sel.currency === "JPY") ? 0 : 2} duration={600} prefix={currencySymbol(sel.currency)} thousands />
                  </div>
                  <div className={`text-sm font-bold tabular-nums ${safeChange(sel.change) >= 0 ? "text-up" : "text-down"}`}>
                    <span>{safeChange(sel.change) >= 0 ? "▲" : "▼"} </span>
                    <CountUp value={Math.abs(safeChange(sel.change))} decimals={2} duration={500} suffix="%" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#a0aec0] leading-relaxed mb-2 border-l-2 border-indigo-500/30 pl-2">{lang === 'zh' ? (STOCK_CN_DESCS[sel.ticker] || sel.descriptionCN || sel.description) : sel.description}</p>
              {/* PDF2 抛光：AI 评分解读卡前置 — 紧贴评分块，回答「为什么是这个分」（默认折叠） */}
              {sel.subScores && (
                <div className="mb-2">
                  <ScoreExplainCard stock={sel} weights={weights} />
                </div>
              )}
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
                  loading ? (
                    /* C13: 加载中显示 skeleton shimmer */
                    <div className="absolute inset-0 z-10 flex flex-col gap-1 p-2 rounded-lg overflow-hidden">
                      <div className="skeleton h-3 w-1/3 rounded-md" />
                      <div className="flex-1 flex items-end gap-px mt-1">
                        {[...Array(20)].map((_, i) => (
                          <div key={i} className="skeleton flex-1 rounded-sm" style={{ height: `${30 + Math.sin(i * 0.6) * 30 + Math.random() * 20}%`, animationDelay: `${i * 0.05}s` }} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-lg bg-white/[0.02] border border-dashed border-white/10">
                      <Activity size={20} className="text-[#778] opacity-50" />
                      <span className="text-[10px] text-[#778]">{t('该周期暂无价格数据')}</span>
                      <span className="text-[9px] text-[#556]">{sel.priceHistory && sel.priceHistory.length > 0 ? t('请尝试其他时间维度') : t('数据加载中或不可用')}</span>
                    </div>
                  )
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
                      {/* C3: Bloomberg 风激光十字光标渐变 */}
                      <linearGradient id="crossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
                        <stop offset="50%" stopColor="#6366f1" stopOpacity="1" />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="m" tick={{ fontSize: 9, fill: "#667" }} axisLine={false} tickLine={false} minTickGap={28} />
                    <YAxis yAxisId="price" tick={{ fontSize: 10, fill: "#667" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={(sel.currency === "KRW" || sel.currency === "JPY") ? 64 : 45}
                      tickFormatter={(v) => {
                        // KRW/JPY 用千分位整数；其他保持原样
                        if (sel.currency === "KRW" || sel.currency === "JPY") return Math.round(v).toLocaleString();
                        return v;
                      }}
                    />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 9, fill: "#778" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={52} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                    <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 3" />
                    {/* C3: 自定义 Bloomberg 风 Tooltip + 激光十字光标 */}
                    <Tooltip
                      cursor={{ stroke: "url(#crossGrad)", strokeWidth: 1.5, strokeDasharray: "3 3" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        const cur = currencySymbol(sel.currency);
                        const sign = (n) => (n >= 0 ? '+' : '');
                        return (
                          <div className="glass-card border border-indigo-500/40 shadow-2xl px-2.5 py-2 tabular-nums" style={{ minWidth: 180 }}>
                            <div className="text-[8px] text-[#778] uppercase tracking-wider mb-1 font-mono">{label}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <div>
                                <div className="text-[8px] text-[#778] uppercase">{t('价格')}</div>
                                <div className="text-sm font-bold font-mono text-white leading-tight">{cur}{Number(d.p).toFixed(2)}</div>
                              </div>
                              <div>
                                <div className="text-[8px] text-[#778] uppercase">% Δ</div>
                                <div className={`text-sm font-bold font-mono leading-tight ${d.pct >= 0 ? 'text-up' : 'text-down'}`}>
                                  {sign(d.pct)}{Number(d.pct).toFixed(2)}%
                                </div>
                              </div>
                              {d.bpct != null && (
                                <>
                                  <div>
                                    <div className="text-[8px] text-[#778] uppercase">{benchmarkLabel}</div>
                                    <div className={`text-xs font-mono leading-tight ${d.bpct >= 0 ? 'text-up' : 'text-down'}`}>
                                      {sign(d.bpct)}{Number(d.bpct).toFixed(2)}%
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[8px] text-[#778] uppercase">α</div>
                                    <div className={`text-xs font-mono leading-tight ${(d.pct - d.bpct) >= 0 ? 'text-up' : 'text-down'}`}>
                                      {sign(d.pct - d.bpct)}{Number(d.pct - d.bpct).toFixed(2)}%
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area yAxisId="price" type="monotone" dataKey="p" stroke={chartData.length >= 2 && chartData[chartData.length-1].p >= chartData[0].p ? "url(#strokeGrad)" : "#FF6B6B"} strokeWidth={2} fill="url(#pg)" dot={false} activeDot={{ r: 4, fill: "#fff", stroke: "#8A2BE2", strokeWidth: 2, filter: "drop-shadow(0 0 4px rgba(138,43,226,0.6))" }} />
                    <Line yAxisId="pct" type="monotone" dataKey="pct" stroke="transparent" dot={false} activeDot={false} />
                    {showBenchmark && <Line yAxisId="pct" type="monotone" dataKey="bpct" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3, fill: "#cbd5e1", stroke: "#94a3b8", strokeWidth: 1.5 }} />}
                  </ComposedChart>
                )}
              </div>
            </div>

            {/* C7: 我的持仓快照（如果该 ticker 在 journal 里） */}
            {(() => {
              try {
                const wsId = localStorage.getItem('quantedge_active_workspace') || 'default';
                const raw = localStorage.getItem(`quantedge_journal_${wsId}`);
                if (!raw) return null;
                const entries = JSON.parse(raw);
                const myEntries = entries.filter(e => e.ticker === sel.ticker);
                if (myEntries.length === 0) return null;
                const totalShares = myEntries.reduce((s, e) => s + (Number(e.shares) || 0), 0);
                const totalCost = myEntries.reduce((s, e) => {
                  const sh = Number(e.shares) || 0;
                  const cb = e.costBasis != null ? Number(e.costBasis) : Number(e.anchorPrice) || 0;
                  return s + sh * cb;
                }, 0);
                const curPrice = Number(sel.price) || 0;
                const curValue = totalShares * curPrice;
                const gain = curValue - totalCost;
                const gainPct = totalCost > 0 ? (gain / totalCost * 100) : 0;
                const cur = currencySymbol(sel.currency);
                return (
                  <div id="detail-myposition" className="glass-card border border-cyan-500/25 bg-cyan-500/[0.03] px-3 py-2 flex items-center gap-3 flex-wrap scroll-mt-12">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Briefcase size={12} className="text-cyan-400" />
                      <span className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">{t('我的持仓')}</span>
                      <span className="text-[9px] text-[#778] font-mono">{myEntries.length} {t('条记录')}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] tabular-nums">
                      {totalShares > 0 && (
                        <>
                          <div><span className="text-[#778]">{t('股数')} </span><span className="text-white font-mono">{totalShares}</span></div>
                          <div><span className="text-[#778]">{t('均价')} </span><span className="text-white font-mono">{cur}{(totalCost/totalShares).toFixed(2)}</span></div>
                          <div><span className="text-[#778]">{t('市值')} </span><span className="text-white font-mono">{cur}{curValue.toFixed(0)}</span></div>
                          <div><span className="text-[#778]">{t('盈亏')} </span><span className={`font-mono font-bold ${gain >= 0 ? 'text-up' : 'text-down'}`}>{gain >= 0 ? '+' : ''}{cur}{gain.toFixed(0)} ({gain >= 0 ? '+' : ''}{gainPct.toFixed(1)}%)</span></div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "journal" }))}
                      className="ml-auto text-[9px] px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-400/20 transition shrink-0"
                    >{t('打开日志')} →</button>
                  </div>
                );
              } catch { return null; }
            })()}

            {/* C7: 详情 Tab 锚点导航条 */}
            <div className="flex items-center gap-1 sticky top-0 z-10 px-1 py-1.5 -mt-1 mb-1 backdrop-blur-md bg-[var(--bg-card)]/85 border-b border-white/5 rounded-t overflow-x-auto">
              {[
                { id: "overview", label: t("综合") },
                { id: "fundamental", label: t("基本面") },
                { id: "technical", label: t("技术面") },
                { id: "liquidity", label: t("资金面") },
                { id: "myposition", label: t("我的持仓") },
              ].map((tabItem) => (
                <button
                  key={tabItem.id}
                  onClick={() => {
                    const target = document.getElementById(`detail-${tabItem.id}`);
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="px-2.5 py-1 text-[10px] font-medium rounded-md text-[#a0aec0] hover:text-white hover:bg-white/[0.06] transition-all whitespace-nowrap shrink-0"
                >
                  {tabItem.label}
                </button>
              ))}
            </div>

            {/* ── KPI 速览条（综合评分 + 关键因子） ── */}
            <div id="detail-overview" className="grid grid-cols-2 sm:grid-cols-4 gap-2 scroll-mt-12">
              {/* S6: 综合评分 + 鼠标悬停展示子分数构成 */}
              <div className="glass-card p-2.5 group relative cursor-help">
                <div className="text-[9px] text-[#778] uppercase tracking-wider mb-0.5 flex items-center gap-1">
                  {t('综合评分')}
                  <Info size={9} className="opacity-40 group-hover:opacity-80 transition" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono tabular-nums text-white">{sel.score?.toFixed(1)}</span>
                  <span className="text-[10px] text-[#778] font-mono">/100</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${sel.score}%`, background: sel.score >= 80 ? "var(--accent-up)" : sel.score >= 60 ? "#f59e0b" : "var(--accent-down)" }} />
                </div>
                {/* 子分数 Tooltip */}
                {sel.subScores && Object.keys(sel.subScores).length > 0 && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 hidden group-hover:block pointer-events-none">
                    <div className="glass-card p-2 min-w-[180px] border border-indigo-500/30 shadow-xl">
                      <div className="text-[9px] text-indigo-300 uppercase tracking-wider mb-1.5 font-medium">{t('分数构成')}</div>
                      <div className="space-y-1">
                        {Object.entries(sel.subScores).map(([k, v]) => {
                          const labelMap = { fundamental: t('基本面'), technical: t('技术面'), growth: t('成长性'), cost: t('成本'), liquidity: t('流动性'), momentum: t('动量'), risk: t('风险') };
                          const label = labelMap[k] || k;
                          const pct = Math.max(0, Math.min(100, Number(v) || 0));
                          const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
                          return (
                            <div key={k} className="flex items-center gap-2">
                              <span className="text-[9px] text-[#a0aec0] w-10 shrink-0">{label}</span>
                              <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                              </div>
                              <span className="text-[9px] font-mono tabular-nums w-8 text-right" style={{ color }}>{pct.toFixed(0)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[8px] text-[#666]">{t('加权综合 = 各因子加权平均')}</div>
                    </div>
                  </div>
                )}
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
                  <div id="detail-fundamental" className="glass-card p-2.5 scroll-mt-12">
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

            {/* AI 解读卡（B1 - DeepSeek 集成）— ScoreExplainCard 已前置到详情头部紧贴评分块 */}
            {!sel.isETF && (
              <div>
                <AIStockSummaryCard stock={sel} />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:flex-1 md:min-h-0">
              <div className="flex flex-col gap-3 md:overflow-auto md:min-h-0 pr-0 md:pr-1">
                {/* ── 多因子雷达图 ── */}
                <div
                  id="detail-radar"
                  className={`glass-card p-3 relative group/drag cursor-move transition-all scroll-mt-12 ${draggingCard === 'radar' ? 'opacity-40 scale-95' : ''}`}
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
                  id="detail-technical"
                  className={`glass-card p-3 relative group/drag cursor-move transition-all scroll-mt-12 ${draggingCard === 'range52w' ? 'opacity-40 scale-95' : ''}`}
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
                    const currSymbol = currencySymbol(sel.currency);
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
                        // PDF1 评分归因：每维度贡献 = 分值 × 权重（仅非 ETF；ETF 用等权平均）
                        const weightKey = sel.isETF ? null
                          : (colorKey === 'indigo' ? 'fundamental'
                          : colorKey === 'cyan' ? 'technical'
                          : colorKey === 'up' ? 'growth' : null);
                        const wPct = weightKey ? (weights[weightKey] || 0) : 0;
                        const totalW = (weights.fundamental || 0) + (weights.technical || 0) + (weights.growth || 0);
                        const contribution = !sel.isETF && weightKey && Number.isFinite(value) && totalW > 0
                          ? (value * wPct / totalW)
                          : null;
                        return (
                          <div key={label}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-[#a0aec0]">
                                {label}
                                {weightKey && <span className="ml-1 text-[9px] text-[#556] font-mono">{wPct}%</span>}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {delta != null && (
                                  <span className={`text-[9px] font-mono ${delta >= 0 ? 'text-up' : 'text-down'}`} title={t('vs 行业中位')}>
                                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-white">{value}</span>
                                {contribution != null && (
                                  <span className="text-[9px] font-mono text-indigo-300/90" title={t('贡献 = 分值 × 权重')}>
                                    +{contribution.toFixed(1)}
                                  </span>
                                )}
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
                        <span>{t('vs 行业中位')} · <span className="font-mono">{sel.sector} · {sectorMedians.peerCount} {t('对比')}</span></span>
                        {/* PDF1 推荐：归因卡为主，雷达保留为可切换备选视图 */}
                        <button
                          onClick={() => document.getElementById('detail-radar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                          className="text-indigo-300/80 hover:text-indigo-200 transition-colors"
                          title={t('滚动到雷达图卡')}
                        >
                          {t('切换到雷达视图')} →
                        </button>
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
                        <Badge variant="info">{currencySymbol(sel.currency)}{sel.week52Low} - {sel.week52High}</Badge>
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
                    <div id="detail-liquidity" className="section-header scroll-mt-12">
                      <Database size={11} className="text-indigo-400" />
                      <span className="section-title">{t('核心指标 · 真实数据')}</span>
                    </div>
                    <div className="space-y-0">
                      {[
                        ["PE (TTM)", sel.pe ? Number(sel.pe).toFixed(1) : "N/A", sel.pe && sel.pe > 0 && sel.pe < 25 ? "success" : sel.pe && sel.pe > 0 && sel.pe < 50 ? "warning" : "danger"],
                        [t("52周区间"), `${currencySymbol(sel.currency)}${sel.week52Low} – ${sel.week52High}`, "info"],
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
                <YAxis yAxisId="price" tick={{ fontSize: 11, fill: "#a0aec0" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={(sel.currency === "KRW" || sel.currency === "JPY") ? 80 : 60}
                  tickFormatter={(v) => {
                    if (sel.currency === "KRW" || sel.currency === "JPY") return Math.round(v).toLocaleString();
                    return v;
                  }}
                />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10, fill: "#a0aec0" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={60} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} />
                <ReferenceLine yAxisId="pct" y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 3" />
                <Tooltip contentStyle={TOOLTIP_STYLE}
                  cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, strokeDasharray: '3 3' }}
                  formatter={(v, name) => {
                    if (name === "p") return [`${currencySymbol(sel.currency)}${v}`, t("价格")];
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
    {/* F2: 移动端详情页底部固定操作栏（仅 mobileShowDetail + sel 时） */}
    {mobileShowDetail && sel && (
      <div
        className="md:hidden fixed left-0 right-0 z-40 flex items-stretch border-t border-white/10 backdrop-blur-md"
        style={{
          bottom: 0,
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'rgba(11, 11, 21, 0.92)',
        }}
        role="toolbar"
        aria-label={t('详情快捷操作')}
      >
        <button
          onClick={() => toggleFav(sel.ticker)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium transition-colors active:scale-[0.97] ${favorites.has(sel.ticker) ? 'text-amber-400' : 'text-[#a0aec0]'}`}
        >
          <Star size={14} className={favorites.has(sel.ticker) ? 'fill-amber-400' : ''} />
          {favorites.has(sel.ticker) ? t('已关注') : t('关注')}
        </button>
        <div className="w-px bg-white/10 my-1.5" />
        <button
          onClick={() => {
            setCompareSet(prev => {
              const next = new Set(prev);
              if (next.has(sel.ticker)) next.delete(sel.ticker);
              else if (next.size < 4) next.add(sel.ticker);
              return next;
            });
          }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium transition-colors active:scale-[0.97] ${compareSet.has(sel.ticker) ? 'text-indigo-300' : 'text-[#a0aec0]'}`}
        >
          <Layers size={14} />
          {compareSet.has(sel.ticker) ? t('已加入对比') : t('加入对比')}
        </button>
        <div className="w-px bg-white/10 my-1.5" />
        <button
          onClick={() => setMobileShowDetail(false)}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium text-[#a0aec0] transition-colors active:scale-[0.97]"
        >
          <ChevronRight size={14} className="rotate-180" />
          {t('返回')}
        </button>
      </div>
    )}
  </div>
  );
};


// ─── MobileAccordion (Monitor 手机端折叠) ─────────────────

export default ScoringDashboard;
