// ─────────────────────────────────────────────────────────────
// BacktestEngine — 组合回测引擎 / 策略模板库
// 从 quant-platform.jsx 抽出（C1 重构第三步），通过 React.lazy 懒加载
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback, useRef, useContext } from "react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, ReferenceLine, ReferenceArea } from "recharts";
import { Activity, AlertCircle, AlertTriangle, BookOpen, Briefcase, Check, ChevronDown, Database, Layers, Loader, Plus, RefreshCw, Search, Target, TrendingDown, Zap } from "lucide-react";
import { searchTickers as standaloneSearch, fetchStockData, fetchBenchmarkPrices, fetchRangePrices, STOCK_CN_NAMES } from "../standalone.js";
import { useLang } from "../i18n.jsx";
import { monteCarlo as mcSimulate, navToReturns as mcNavToReturns, hhi as hhiCalc, effectiveN as effN } from "../math/stats.ts";
import { STOCKS } from "../data.js";
import {
  DataContext,
  apiFetch,
  Badge,
  TOOLTIP_STYLE,
} from "../quant-platform.jsx";

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
  // S8: 额外叠加的基准（默认 QQQ + 00700.HK 让用户一眼看到多基准 alpha）
  const [extraBenchTickers, setExtraBenchTickers] = useState(["QQQ", "00700.HK"]);
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
  // S7: 回测过程中无法取得价格数据的标的（用于"剔除并重跑"提示卡）
  const [missingDataTickers, setMissingDataTickers] = useState([]); // [{ticker, reason}]

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

  // 首次挂载：解析 URL hash 恢复配置 + 监听跨 Tab 持仓导入事件
  const hashRestored = useRef(false);
  const applyConfig = useCallback((cfg, msg) => {
    try {
      if (cfg.p && typeof cfg.p === 'object') {
        const validTickers = new Set(liveStocks.map(s => s.ticker));
        const filtered = Object.fromEntries(Object.entries(cfg.p).filter(([k]) => validTickers.has(k)));
        // 若所有 ticker 都不在 liveStocks（例如持仓里有未添加的标的），保留原样让 useEffect 拉数据
        const portfolioToSet = Object.keys(filtered).length > 0 ? filtered : cfg.p;
        setPortfolio(portfolioToSet);
      }
      if (typeof cfg.ic === 'number') setInitialCap(cfg.ic);
      if (typeof cfg.cb === 'number') setCostBps(cfg.cb);
      if (typeof cfg.bt === 'string') setBenchTicker(cfg.bt);
      if (typeof cfg.r === 'string') setBtRange(cfg.r);
      if (typeof cfg.rb === 'string') setRebalance(cfg.rb);
      autoRan.current = false;
      if (msg) {
        setShareToast({ msg, t: Date.now() });
        setTimeout(() => setShareToast(null), 2500);
      }
    } catch (e) {
      console.warn('[QuantEdge] applyConfig failed:', e);
    }
  }, [liveStocks, t]);
  // S5: 监听 Journal 一键导入持仓事件
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) applyConfig(e.detail, t('已从持仓导入组合'));
    };
    window.addEventListener("quantedge:loadPortfolio", handler);
    return () => window.removeEventListener("quantedge:loadPortfolio", handler);
  }, [applyConfig, t]);
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
    // S8: 额外基准（去重 + 排除主基准）
    const extraBenchList = extraBenchTickers.filter(tk => tk && tk !== benchTicker);
    const extraBenchData = {}; // { ticker: priceArray }
    for (const tk of extraBenchList) {
      const cKey = `${tk}_${btRange}`;
      let pd = benchCacheRef.current[cKey];
      const inList = liveStocks.find(s => s.ticker === tk);
      const inListHas = inList && getPriceData(inList).length >= 2;
      if (!pd && !inListHas) {
        try {
          const effectiveRange = btRange === "CUSTOM" ? "5Y" : btRange;
          const prices = await fetchBenchmarkPrices(tk, effectiveRange);
          if (prices && prices.length >= 2) {
            benchCacheRef.current[cKey] = prices;
            pd = prices;
          }
        } catch (e) {
          console.warn("[Backtest] 获取额外基准失败:", tk, e);
        }
      }
      if (inListHas) extraBenchData[tk] = getPriceData(inList);
      else if (pd) extraBenchData[tk] = pd;
    }

    setTimeout(() => {
      // 取各标的在选定时间维度的价格数据
      const allEntries = portfolioStocks.map(p => ({
        ...p,
        ph: getPriceData(p.stk),
      }));
      const entries = allEntries.filter(p => p.ph.length >= 2);
      // S7: 收集"缺数据"标的，供 UI 一键剔除
      const missing = allEntries
        .filter(p => p.ph.length < 2)
        .map(p => ({
          ticker: p.ticker,
          reason: p.ph.length === 0 ? t('无价格数据') : t('数据点不足({n})', { n: p.ph.length }),
        }));
      setMissingDataTickers(missing);
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
      // S8: 额外基准插值序列
      const extraBenchSeries = {}; // { ticker: number[] }
      Object.entries(extraBenchData).forEach(([tk, raw]) => {
        if (raw && raw.length >= 2) extraBenchSeries[tk] = interpolatePrice(raw, dateAxis);
      });

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

        const navPt = { date: dateAxis[i], strategy: Math.round(nav * 100) / 100, benchmark: benchSeries ? Math.round(benchSeries[i] * 100) / 100 : 100 + i * (35 / numPts) };
        // S8: 额外基准
        Object.entries(extraBenchSeries).forEach(([tk, ser]) => {
          navPt[`bench_${tk}`] = Math.round(ser[i] * 100) / 100;
        });
        navCurve.push(navPt);
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
        // S8: 实际渲染出数据的额外基准列表
        extraBenches: Object.keys(extraBenchSeries),
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
  }, [portfolioStocks, initialCap, btRange, getPriceData, rebalance, customStart, customEnd, benchTicker, extraBenchTickers, liveStocks, t]);

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
            {/* S8: 额外叠加基准 — 可点选 */}
            <div className="mt-1 flex flex-wrap gap-1">
              {[
                ["SPY", "SPY"],
                ["QQQ", "QQQ"],
                ["00700.HK", "腾讯/港股"],
                ["IWM", "Russell"],
                ["TLT", "20Y 国债"],
                ["GLD", "黄金"],
              ].filter(([tk]) => tk !== benchTicker).map(([tk, label]) => {
                const active = extraBenchTickers.includes(tk);
                return (
                  <button key={tk}
                    onClick={() => setExtraBenchTickers(prev => active ? prev.filter(x => x !== tk) : [...prev, tk])}
                    className={`px-1.5 py-0.5 text-[9px] rounded border transition tabular-nums ${active ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-white/[0.03] text-[#666] border-white/8 hover:text-[#a0aec0]'}`}
                    title={t('点击叠加 / 移除此基准')}
                  >
                    {active ? '✓ ' : '+ '}{tk}
                  </button>
                );
              })}
            </div>
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
            {/* S7: 缺数据标的诊断卡 */}
            {missingDataTickers.length > 0 && !running && !dataLoading && (
              <div className="glass-card p-3 w-full max-w-md border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={14} className="text-amber-400" />
                  <span className="text-xs font-medium text-amber-300">
                    {t('{n} 个标的缺少 {r} 区间价格数据', { n: missingDataTickers.length, r: btRange })}
                  </span>
                </div>
                <div className="space-y-1 mb-2 max-h-32 overflow-auto">
                  {missingDataTickers.map(m => (
                    <div key={m.ticker} className="flex items-center justify-between text-[10px] tabular-nums">
                      <span className="font-mono text-amber-200">{m.ticker}</span>
                      <span className="text-amber-300/60">{m.reason}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      const drop = new Set(missingDataTickers.map(m => m.ticker));
                      setPortfolio(p => {
                        const n = {};
                        Object.entries(p).forEach(([k, v]) => { if (!drop.has(k)) n[k] = v; });
                        return n;
                      });
                      setMissingDataTickers([]);
                      autoRan.current = false; // 让 useEffect 重新触发回测
                    }}
                    className="flex-1 px-2 py-1 text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-md transition"
                  >
                    {t('剔除并重跑')}
                  </button>
                  <button
                    onClick={() => setMissingDataTickers([])}
                    className="px-2 py-1 text-[10px] text-amber-300/70 hover:text-amber-200 transition"
                  >
                    {t('忽略')}
                  </button>
                </div>
              </div>
            )}
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
                    {/* S8: 额外基准图例 + 删除按钮 */}
                    {(btResult.extraBenches || []).map((tk, idx) => {
                      const colors = ['#06b6d4', '#f97316', '#a855f7'];
                      const c = colors[idx % colors.length];
                      return (
                        <span key={tk} className="flex items-center gap-1 text-[10px] px-1 rounded bg-white/[0.04]" style={{ color: c }}>
                          <span className="w-3 h-0.5 rounded-full inline-block" style={{ background: c }} />
                          {tk}
                          <button onClick={() => setExtraBenchTickers(prev => prev.filter(x => x !== tk))}
                            aria-label={`${t('移除基准')} ${tk}`}
                            title={t('移除此基准')}
                            className="opacity-60 hover:opacity-100 ml-0.5">×</button>
                        </span>
                      );
                    })}
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
                      {/* C3: Bloomberg 风激光十字光标 */}
                      <linearGradient id="navCrossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
                        <stop offset="50%" stopColor="#6366f1" stopOpacity="1" />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
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
                    {/* C3: Bloomberg 风 NAV Tooltip — 显示组合 / 基准 / Alpha 一栏比较 */}
                    <Tooltip
                      cursor={{ stroke: "url(#navCrossGrad)", strokeWidth: 1.5, strokeDasharray: "3 3" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        const sign = (n) => (n >= 0 ? '+' : '');
                        const navToRet = (nav) => nav != null ? Number(nav) - 100 : null;
                        const sRet = navToRet(d.strategy);
                        const bRet = navToRet(d.benchmark);
                        const alpha = (sRet != null && bRet != null) ? sRet - bRet : null;
                        return (
                          <div className="glass-card border border-indigo-500/40 shadow-2xl px-2.5 py-2 tabular-nums" style={{ minWidth: 200 }}>
                            <div className="text-[8px] text-[#778] uppercase tracking-wider mb-1 font-mono">{label}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <div>
                                <div className="text-[8px] text-[#778] uppercase">{t('组合')}</div>
                                <div className={`text-sm font-bold font-mono leading-tight ${sRet >= 0 ? 'text-up' : 'text-down'}`}>
                                  {sign(sRet)}{sRet.toFixed(2)}%
                                </div>
                              </div>
                              <div>
                                <div className="text-[8px] text-[#778] uppercase">{benchTicker}</div>
                                <div className={`text-sm font-mono leading-tight ${bRet >= 0 ? 'text-up' : 'text-down'}`}>
                                  {sign(bRet)}{bRet.toFixed(2)}%
                                </div>
                              </div>
                              {alpha != null && (
                                <div className="col-span-2 pt-1 mt-0.5 border-t border-white/5 flex items-center justify-between">
                                  <span className="text-[8px] text-[#778] uppercase">α (Alpha)</span>
                                  <span className={`text-sm font-bold font-mono ${alpha >= 0 ? 'text-up' : 'text-down'}`}>
                                    {sign(alpha)}{alpha.toFixed(2)}%
                                  </span>
                                </div>
                              )}
                              {/* 额外基准 */}
                              {(btResult.extraBenches || []).map((tk) => {
                                const bRet2 = navToRet(d[`bench_${tk}`]);
                                if (bRet2 == null) return null;
                                return (
                                  <div key={tk} className="col-span-2 flex items-center justify-between text-[10px]">
                                    <span className="text-[#778] font-mono">{tk}</span>
                                    <span className={`font-mono ${bRet2 >= 0 ? 'text-up' : 'text-down'}`}>
                                      {sign(bRet2)}{bRet2.toFixed(2)}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine y={100} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                    {highlightRange && !zoomRange && <ReferenceArea x1={highlightRange.startDate} x2={highlightRange.endDate}
                      fill={highlightRange.ret >= 0 ? "rgba(0,229,160,0.10)" : "rgba(255,107,107,0.10)"}
                      stroke={highlightRange.ret >= 0 ? "rgba(0,229,160,0.30)" : "rgba(255,107,107,0.30)"}
                      strokeDasharray="2 2" />}
                    <Area type="linear" dataKey="strategy" stroke="url(#navStroke)" strokeWidth={2} fill="url(#navGrad)" dot={false} name={t("组合")} />
                    <Line type="linear" dataKey="benchmark" stroke="#667" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name={benchTicker} />
                    {/* S8: 额外基准曲线 */}
                    {(btResult.extraBenches || []).map((tk, idx) => {
                      const colors = ['#06b6d4', '#f97316', '#a855f7'];
                      const c = colors[idx % colors.length];
                      return (
                        <Line key={tk} type="linear" dataKey={`bench_${tk}`} stroke={c} strokeWidth={1.2} dot={false} strokeDasharray="3 3" name={tk} connectNulls />
                      );
                    })}
                    {savedRuns.map(run => (
                      <Line key={run.id} type="linear" dataKey={`run_${run.id}`} stroke={run.color} strokeWidth={1.5} dot={false} strokeDasharray="2 2" name={run.label} connectNulls />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              );
            })()}

            {/* C5: 策略对比指标横评表（仅 savedRuns >= 1 时显示） */}
            {savedRuns.length > 0 && btResult.metrics && (() => {
              const current = { id: 'current', label: t('当前'), color: '#6366f1', metrics: btResult.metrics };
              const all = [current, ...savedRuns];
              const rows = [
                { key: 'totalReturn', label: t('总收益'), fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, good: v => v > 0 },
                { key: 'annReturn',   label: t('年化'),   fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, good: v => v > 0 },
                { key: 'alpha',       label: 'α',         fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, good: v => v > 0 },
                { key: 'sharpe',      label: 'Sharpe',    fmt: (v) => v.toFixed(2),                          good: v => v >= 1 },
                { key: 'sortino',     label: 'Sortino',   fmt: (v) => v.toFixed(2),                          good: v => v >= 1 },
                { key: 'calmar',      label: 'Calmar',    fmt: (v) => v.toFixed(2),                          good: v => v >= 1 },
                { key: 'maxDD',       label: t('最大回撤'), fmt: (v) => `${v.toFixed(2)}%`,                  good: v => v > -10 },
                { key: 'vol',         label: t('波动率'),  fmt: (v) => `${v.toFixed(1)}%`,                   good: v => v < 25 },
                { key: 'winRate',     label: t('胜率'),    fmt: (v) => `${v.toFixed(1)}%`,                   good: v => v > 50 },
                { key: 'var95',       label: 'VaR 95',    fmt: (v) => `${v.toFixed(2)}%`,                   good: v => v > -3 },
              ];
              // 找出每行的胜者（最大值或最小值，看指标方向）
              const winners = {};
              rows.forEach(r => {
                const vals = all.map(run => Number(run.metrics[r.key]) || 0);
                // 回撤、波动、VaR 越大越好（接近 0），其他越大越好
                const isLowerBetter = ['maxDD', 'vol', 'var95', 'var99'].includes(r.key);
                const target = isLowerBetter ? Math.max(...vals) : Math.max(...vals);
                // 对于回撤等，max 已经是最优（因为是负数，越接近 0 越大）
                winners[r.key] = vals.indexOf(target);
              });
              return (
                <div className="glass-card p-3 mt-2 overflow-x-auto">
                  <div className="section-header mb-2" style={{ marginBottom: 8 }}>
                    <Layers size={11} className="text-indigo-400" />
                    <span className="section-title">{t('策略横评 ({n} 组)', { n: all.length })}</span>
                    <span className="text-[9px] text-[#778] font-mono ml-1">{t('深色 = 该指标胜者')}</span>
                  </div>
                  <table className="w-full text-[10px] tabular-nums border-collapse">
                    <thead>
                      <tr className="border-b border-white/8">
                        <th className="text-left font-medium text-[#778] py-1.5 pr-3">{t('指标')}</th>
                        {all.map(run => (
                          <th key={run.id} className="text-right font-mono font-medium py-1.5 px-2 whitespace-nowrap" style={{ color: run.color }}>
                            <div className="flex items-center gap-1 justify-end">
                              <span className="w-2 h-2 rounded-full inline-block" style={{ background: run.color }} />
                              <span className="truncate max-w-[100px]" title={run.label}>{run.label}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.key} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                          <td className="text-[#a0aec0] py-1 pr-3">{r.label}</td>
                          {all.map((run, idx) => {
                            const v = Number(run.metrics[r.key]) || 0;
                            const isWinner = winners[r.key] === idx && all.length > 1;
                            const goodColor = r.good(v) ? 'text-up' : 'text-down';
                            return (
                              <td key={run.id} className={`text-right font-mono py-1 px-2 ${isWinner ? 'bg-indigo-500/10 font-bold' : ''} ${goodColor}`}>
                                {r.fmt(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

export default BacktestEngine;
