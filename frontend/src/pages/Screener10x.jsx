// ─────────────────────────────────────────────────────────────
// Screener10x — 10x 猎手主页面（赛道筛选 → 候选个股 → 观察列表）
// ─────────────────────────────────────────────────────────────
//
// 三段式工作流：
//   1) 左栏：勾选超级赛道（AI 算力 / 半导体 / 光通信 / 算力中心）
//   2) 中栏：根据勾选 + 市值上限筛出候选股，按市值升序（小市值优先）
//   3) 右栏：用户加入观察的标的，可编辑 thesis / 卡位或护城河等级 / 目标价 / 止损
//
// 数据来源：
//   - GET    /api/universe/stats           候选池规模
//   - GET    /api/watchlist/10x            观察列表 + 可用赛道
//   - POST   /api/watchlist/10x/screen     候选筛选
//   - POST   /api/watchlist/10x            添加观察项
//   - PUT    /api/watchlist/10x/{ticker}   编辑
//   - DELETE /api/watchlist/10x/{ticker}   删除
//
// 编辑/添加都通过 TenxItemEditor 模态框。
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Target, Layers, Plus, RefreshCw, Loader, AlertCircle,
  Filter, Search, Database, Star, Globe, Sparkles, X,
  Archive,
  Download, Upload,
  Activity,
  ArrowUp, ArrowDown, ArrowUpDown, ArrowRight,
  ChevronRight, Maximize2,
} from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import TenxItemEditor from "../components/TenxItemEditor.jsx";
import AddSupertrendDialog from "../components/AddSupertrendDialog.jsx";
import WatchlistCard from "../components/WatchlistCard.jsx";
import ValueFilters from "../components/ValueFilters.jsx";
import { loadPrefs, savePrefs } from "../lib/screener10xPrefs.js";
import { sortCandidates, nextSortState } from "../lib/candidateSort.js";
import StockDetailPanel from "../components/StockDetailPanel.jsx";
import { serializeWatchlistCsv } from "../lib/csvExport.js";
import { fmtMcap, fmtNum, fmtPct } from "../lib/formatters.js";
import { fetchCurrentPrice } from "../lib/yahoo.js";
import EmptyState from "../components/EmptyState.jsx";
import useIsMobile from "../hooks/useIsMobile.js";
import { BottomSheet, MobileAppBar, FullscreenChart } from "../components/mobile";
import { useLang } from "../i18n.jsx";

// ── 移动端：漏斗条形色阶（全宇宙→初筛→AI精选→观察名单）
const FUNNEL_COLORS = ["#5A5E76", "#818CF8", "#8B5CF6", "#1ED395"];

const STRATEGY_LABEL = { growth: "成长型", value: "价值型" };

// production fallback：vercel 部署没有 FastAPI backend 时，至少能看到 10 个内置赛道。
// 数据须与 backend/sector_mapping.py SUPERTRENDS 保持一致；筛选/观察操作仍需 self-hosted backend。
const BUILTIN_SUPERTRENDS_FALLBACK = [
  { id: "ai_compute", name: "AI 算力", note: "AI 软硬件 / 加速器 / HBM / AI 应用", source: "builtin", strategy: "growth" },
  { id: "semi", name: "半导体", note: "设计、制造、设备、材料、存储", source: "builtin", strategy: "growth" },
  { id: "optical", name: "光通信", note: "光模块、硅光、CPO、激光器、光纤", source: "builtin", strategy: "growth" },
  { id: "datacenter", name: "算力中心", note: "数据中心 / 电力 / 公共事业", source: "builtin", strategy: "growth" },
  { id: "consumer_internet", name: "消费互联网", note: "电商 / 流媒体 / 社交 / 旅游 / 出行", source: "builtin", strategy: "growth" },
  { id: "ev_auto", name: "电动车与新能源汽车", note: "整车 / 动力电池 / 充电桩 / 自动驾驶", source: "builtin", strategy: "growth" },
  { id: "biotech", name: "生物科技与创新药", note: "创新药 / GLP-1 / 基因疗法 / 医疗器械", source: "builtin", strategy: "growth" },
  { id: "defense_aerospace", name: "国防航天", note: "国防 / 航天 / 武器 / 军工电子", source: "builtin", strategy: "growth" },
  { id: "value_div", name: "高股息蓝筹", note: "公用事业 / 银行龙头 / 能源 / 电信（股息率 > 4%）", source: "builtin", strategy: "value" },
  { id: "value_cyclical", name: "周期价值", note: "银行 / 保险 / 化工 / 钢铁（低 PB 入场）", source: "builtin", strategy: "value" },
  { id: "value_consumer", name: "消费稳健", note: "食品饮料 / 必需消费 / 大盘药企", source: "builtin", strategy: "value" },
];

// 价值型 5 维默认值（None = 不启用筛选）
const DEFAULT_VALUE_FILTERS = {
  max_pe: 25,
  max_pb: null,
  min_roe: null,
  min_dividend_yield: null,
  max_debt_to_equity: null,
};

// fmtMcap / fmtNum / fmtPct 已抽到 src/lib/formatters.js（PR #163），import 自顶部

// _tickerToYahoo + fetchCurrentPrice 已抽到 src/lib/yahoo.js（PR #161）
// 该 lib 也被 StockDetailPanel.jsx 复用

const FIELD_LABEL = { sector: "板块", industry: "行业", name: "名称" };

/** 把候选 item 的 match_reasons[trend_id] 渲染成 hover tooltip 文本。
 * 输入：[{ field, value, keywords }, ...]
 * 输出："板块='Semiconductors' 含 Semiconductor | 名称='长飞光纤' 含 光纤"
 */
function formatMatchReason(matchReasons, tid) {
  const reasons = matchReasons?.[tid];
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  return reasons
    .map((r) => {
      const fieldLabel = FIELD_LABEL[r.field] || r.field;
      const kws = (r.keywords || []).join("、");
      return `${fieldLabel}="${r.value}" 含 ${kws}`;
    })
    .join(" | ");
}

/** 可排序的 <th>。点击循环 asc → desc → 默认（清空 sortKey）。当列高亮时显示方向箭头。 */
function SortHeader({ label, sortKey, currentKey, currentDir, onToggle, align = "right", title }) {
  const isActive = sortKey === currentKey;
  const Icon = !isActive ? ArrowUpDown : currentDir === "asc" ? ArrowUp : ArrowDown;
  const alignClass = align === "right" ? "text-right justify-end" : "text-left justify-start";
  return (
    <th className={`px-2 py-1.5 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onToggle(sortKey)}
        title={title || `按 ${label} 排序`}
        className={`inline-flex items-center gap-0.5 hover:text-white transition focus:outline-none ${alignClass} ${
          isActive ? "text-cyan-300" : "text-[#7a8497]"
        }`}
      >
        <span>{label}</span>
        <Icon size={9} className={isActive ? "opacity-100" : "opacity-40"} />
      </button>
    </th>
  );
}

export default function Screener10x() {
  // ── v6 移动端 ────────────────────────────────────────────────
  const isMobile = useIsMobile();
  const { t } = useLang();
  // 移动端专用状态（必须无条件声明，在所有早返回之前）
  const [mFilterOpen, setMFilterOpen] = useState(false);   // 筛选 BottomSheet
  const [mFunnelFs, setMFunnelFs] = useState(false);       // 漏斗全屏（横屏）
  const [mDetailItem, setMDetailItem] = useState(null);    // 候选下钻卡

  // 数据状态
  const [supertrends, setSupertrends] = useState([]);
  const [items, setItems] = useState([]);                   // watchlist
  const [universeStats, setUniverseStats] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);      // production 后端不可用 → fallback
  // localStorage 持久化的 UI 偏好（首次渲染时一次性读取）
  // 用 lazy initial state 避免每次 render 都读 localStorage
  const _initialPrefs = useMemo(() => loadPrefs(), []);
  // 策略切换（成长型 / 价值型 tab）
  const [activeStrategy, setActiveStrategy] = useState(_initialPrefs.activeStrategy);
  // 筛选条件
  const [selectedTrends, setSelectedTrends] = useState([]); // string[]（不持久化：赛道 ID 可能变）
  // 默认 1000B —— 包含绝大多数大盘股（NVDA 4800B 等极少数 mega-cap 用户可手动调高）
  // 之前 50B 太严，把 MU/NVDA/AVGO/腾讯 等主流标的全过滤掉
  const [maxMcapInput, setMaxMcapInput] = useState(_initialPrefs.maxMcapInput);     // 单位 B（input 即时绑定）
  const [maxMcapB, setMaxMcapB] = useState(_initialPrefs.maxMcapInput);             // 300ms debounced，喂 runScreen
  const [includeETF, setIncludeETF] = useState(_initialPrefs.includeETF);
  const [precise, setPrecise] = useState(_initialPrefs.precise);    // 精严模式：仅核心赛道关键词
  const [markets, setMarkets] = useState(_initialPrefs.markets);
  const [search, setSearch] = useState("");
  // 价值型 5 维筛选（仅 activeStrategy="value" 时启用）
  // 双 state：valueFilters 即时绑定 input；valueFiltersDebounced 喂 runScreen（300ms 防抖）
  const [valueFilters, setValueFilters] = useState(_initialPrefs.valueFilters);
  const [valueFiltersDebounced, setValueFiltersDebounced] = useState(_initialPrefs.valueFilters);
  // 候选 + loading
  const [candidates, setCandidates] = useState([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [errorCands, setErrorCands] = useState(null);
  // AI 排序：{ ticker: { moat_score, reason } }
  const [aiRanking, setAiRanking] = useState({});
  const [aiRankingState, setAiRankingState] = useState({ loading: false, error: null });
  // AI 赛道校验：最近一次结果（单行点击）
  const [aiMatchResult, setAiMatchResult] = useState(null); // { ticker, matched, reason, confidence, error? }
  const [aiMatchLoading, setAiMatchLoading] = useState(null); // 当前 loading 的 ticker
  // AI 一键串联：批量 match 结果 + 全局进度
  const [aiMatchMap, setAiMatchMap] = useState({}); // { ticker: { matched, confidence, error? } }
  const [aiPipelineState, setAiPipelineState] = useState({ loading: false, matched: 0, total: 0, error: null });
  // 编辑器
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);             // null = 新增
  const [pendingCandidate, setPendingCandidate] = useState(null);
  // 候选股详情面板（点 ticker 弹出）
  const [detailItem, setDetailItem] = useState(null);
  // 添加赛道对话框
  const [addTrendOpen, setAddTrendOpen] = useState(false);
  // 归档显示开关
  const [showArchived, setShowArchived] = useState(_initialPrefs.showArchived);
  // 导入/导出 loading
  const [importLoading, setImportLoading] = useState(false);
  const importInputRef = useRef(null);
  // 候选表列排序：sortKey=null 用 backend 默认（市值升序 + AI 排序覆盖）
  // 可选 sortKey: marketCap | pe | pb | dividend_yield | roe；sortDir: asc | desc
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  // 当前价（用于 target/stop 预警 badge）；只对设了 target 或 stop 的 item 拉
  const [pricesByTicker, setPricesByTicker] = useState({});

  // v5.3：已存筛选预设（localStorage）— 让调好的赛道+筛选条件可复用/切换
  const [presets, setPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("quantedge_10x_presets") || "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("quantedge_10x_presets", JSON.stringify(presets)); } catch {}
  }, [presets]);
  const saveCurrentPreset = () => {
    const name = window.prompt("预设名称", `筛选 ${presets.length + 1}`);
    if (!name) return;
    setPresets(prev => [...prev, { id: Date.now(), name, trends: selectedTrends, maxMcapInput, includeETF, precise, markets, activeStrategy }]);
  };
  const applyPreset = (p) => {
    setSelectedTrends(p.trends || []);
    if (p.maxMcapInput != null) setMaxMcapInput(p.maxMcapInput);
    if (typeof p.includeETF === "boolean") setIncludeETF(p.includeETF);
    if (typeof p.precise === "boolean") setPrecise(p.precise);
    if (Array.isArray(p.markets)) setMarkets(p.markets);
    if (p.activeStrategy) setActiveStrategy(p.activeStrategy);
  };
  const deletePreset = (id) => setPresets(prev => prev.filter(p => p.id !== id));
  const activePresetId = useMemo(() => {
    const cur = JSON.stringify([...selectedTrends].sort());
    return presets.find(p => JSON.stringify([...(p.trends || [])].sort()) === cur)?.id ?? null;
  }, [presets, selectedTrends]);

  // v5.3：候选列表 J/K 键盘 cursor
  const [cursorIdx, setCursorIdx] = useState(-1);

  // ── localStorage 偏好持久化（依赖变化时序列化写回，静默忽略写失败）─
  useEffect(() => {
    savePrefs({
      markets,
      includeETF,
      precise,
      maxMcapInput,
      activeStrategy,
      valueFilters,
      showArchived,
    });
  }, [markets, includeETF, precise, maxMcapInput, activeStrategy, valueFilters, showArchived]);

  // ── 拉初始数据（watchlist + universe stats）─────────────
  const reloadWatchlist = useCallback(async (opts = {}) => {
    const archivedFlag = opts.showArchived ?? showArchived;
    const url = archivedFlag ? "/watchlist/10x?include_archived=true" : "/watchlist/10x";
    const json = await apiFetch(url);
    // 真实数据：后端在线且 watchlist 非空（用户已添加过观察项）
    if (json && Array.isArray(json.items) && json.items.length > 0) {
      setSupertrends(json.supertrends || []);
      setItems(json.items);
      setIsDemoMode(false);
    } else {
      // 走 demo 的两种情况（同 StockGene 模式）：
      // 1) 后端不可达（json 为 null）
      // 2) 后端在线但观察列表为空（Vercel demo 环境 / 全新部署 — "空"等价于"没人用过"）
      // 仍优先使用 backend 给的 supertrends（如可用），否则用内置兜底列表。
      setSupertrends(json?.supertrends?.length ? json.supertrends : BUILTIN_SUPERTRENDS_FALLBACK);
      setIsDemoMode(true);
      try {
        const mod = await import("../data/screener10xDemo.js");
        setItems(mod.demoWatchlistItems);
      } catch {
        setItems([]);
      }
    }
  }, [showArchived]);

  const reloadUniverseStats = useCallback(async () => {
    const json = await apiFetch("/universe/stats");
    setUniverseStats(json);
  }, []);

  useEffect(() => {
    reloadWatchlist();
    reloadUniverseStats();
  }, [reloadWatchlist, reloadUniverseStats]);

  // ── 价格预警：对设了 target_price / stop_loss 的 active item 拉当前价 ───
  // 不拉所有票（避免几十只票一起请求 Yahoo）；缓存到 pricesByTicker；items 变化
  // 时仅补差（已拉过的不重复）
  useEffect(() => {
    const need = items.filter(
      it => !it.archived && (it.target_price != null || it.stop_loss != null)
    );
    if (need.length === 0) return;
    const missing = need.filter(it => !(it.ticker in pricesByTicker));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // 分批 6 并发拉；fetchCurrentPrice 失败时返回 null，不阻塞
      const chunks = [];
      for (let i = 0; i < missing.length; i += 6) chunks.push(missing.slice(i, i + 6));
      for (const chunk of chunks) {
        if (cancelled) return;
        const entries = await Promise.all(
          chunk.map(async it => [it.ticker, await fetchCurrentPrice(it.ticker)])
        );
        if (cancelled) return;
        setPricesByTicker(prev => {
          const next = { ...prev };
          for (const [tk, px] of entries) next[tk] = px; // null 也存（避免重复请求）
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);   // pricesByTicker 故意不放依赖（避免循环）；missing 检查会自动跳过已拉的

  // ── mcap input debounce（300ms）─────────────────────────
  // 用户在 input 里改数字时实时更新 maxMcapInput；停手 300ms 后才更新 maxMcapB，
  // 避免每个数字都触发后端 screen
  useEffect(() => {
    const t = setTimeout(() => setMaxMcapB(maxMcapInput), 300);
    return () => clearTimeout(t);
  }, [maxMcapInput]);

  // ── value filters debounce（300ms）──────────────────────
  // 价值型 5 维 input 同样按 300ms 节流避免每按一键就 screen
  // preset chip 是整对象切换 → 立即生效（不浪费等待）
  useEffect(() => {
    const t = setTimeout(() => setValueFiltersDebounced(valueFilters), 300);
    return () => clearTimeout(t);
  }, [valueFilters]);

  // ── 候选筛选（赛道 / 市值 / 市场变化时 trigger）─────────
  const runScreen = useCallback(async () => {
    setLoadingCands(true);
    setErrorCands(null);
    try {
      const body = {
        supertrend_ids: selectedTrends,
        markets,
        include_etf: includeETF,
        exclude_in_watchlist: true,
        limit: 2000,   // 之前 200 太严 — mega-cap 被小盘卡位排序挤出
        precise,
      };
      if (activeStrategy === "growth") {
        // 成长型：保留 max_market_cap_b（小市值卡位）
        body.max_market_cap_b = maxMcapB > 0 ? maxMcapB : null;
      } else {
        // 价值型：5 维财务过滤（None 字段不传，避免误启用）
        for (const [k, v] of Object.entries(valueFiltersDebounced)) {
          if (v != null && v !== "" && !Number.isNaN(v)) body[k] = Number(v);
        }
      }
      const json = await apiFetch("/watchlist/10x/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!json) throw new Error("后端无响应");
      setCandidates(json.items || []);
    } catch (e) {
      setErrorCands(String(e.message || e));
      setCandidates([]);
    } finally {
      setLoadingCands(false);
    }
  }, [selectedTrends, markets, maxMcapB, includeETF, precise, activeStrategy, valueFiltersDebounced]);

  // 自动 re-screen（赛道 / 市场 / 市值上限 / ETF / 精严切换都会触发）
  // 注：items 变化（加入/删除观察）不在此触发，由 handleSaved / handleDelete 主动处理：
  //   - 加入：本地 splice 掉刚加入的 ticker，省一次 screen
  //   - 删除：显式调 runScreen 让 ticker 回到候选
  useEffect(() => {
    if (selectedTrends.length === 0) {
      setCandidates([]);
      setErrorCands(null);
      return;
    }
    if (isDemoMode) {
      // 后端不可用：灌 demo candidates 让漏斗"匹配赛道"段不再是 0。
      // dynamic import 拆独立 chunk，只在 fallback 时下载。
      setErrorCands(null);
      import("../data/screener10xDemo.js").then(mod => {
        setCandidates(mod.demoCandidates || []);
      }).catch(() => {
        setCandidates([]);
      });
      return;
    }
    runScreen();
  }, [runScreen, selectedTrends, isDemoMode]);

  // ── 候选搜索过滤（前端） ─────────────────────────────
  // sort + ranking 逻辑在 src/lib/candidateSort.js（pure，可测）
  const filteredCandidates = useMemo(() => {
    let cs = candidates;
    if (search) {
      const q = search.toLowerCase();
      cs = cs.filter((c) =>
        c.ticker.toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q)
      );
    }
    // 用户列排序优先（如果设了 sortKey）
    if (sortKey) {
      cs = sortCandidates(cs, sortKey, sortDir);
    } else if (Object.keys(aiRanking).length > 0) {
      // AI 排序：拿到 moat_score 的标的优先，按分数降序；其余保持原顺序在后
      const ranked = cs.filter((c) => aiRanking[c.ticker] != null);
      const unranked = cs.filter((c) => aiRanking[c.ticker] == null);
      ranked.sort((a, b) =>
        (aiRanking[b.ticker]?.moat_score || 0) - (aiRanking[a.ticker]?.moat_score || 0)
      );
      cs = [...ranked, ...unranked];
    }
    return cs;
  }, [candidates, search, aiRanking, sortKey, sortDir]);

  // v5.3：候选列表键盘流 — J/K 移动 cursor · ↵ 看详情 · + 加观察（未聚焦输入时）
  useEffect(() => {
    const onKey = (e) => {
      if (!filteredCandidates.length) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") { e.preventDefault(); setCursorIdx(i => Math.min((i < 0 ? -1 : i) + 1, filteredCandidates.length - 1)); }
      else if (k === "k") { e.preventDefault(); setCursorIdx(i => Math.max((i <= 0 ? 1 : i) - 1, 0)); }
      else if (e.key === "Enter" && cursorIdx >= 0 && filteredCandidates[cursorIdx]) { e.preventDefault(); setDetailItem(filteredCandidates[cursorIdx]); }
      else if ((k === "+" || k === "=") && cursorIdx >= 0 && filteredCandidates[cursorIdx]) { e.preventDefault(); openAdd(filteredCandidates[cursorIdx]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredCandidates, cursorIdx]);

  /** 点击列头切换排序：用 nextSortState 计算（pure，可测） */
  const toggleSort = useCallback((key) => {
    setSortKey((prevKey) => {
      setSortDir((prevDir) => nextSortState(prevKey, prevDir, key).sortDir);
      return key;   // nextSortState 的 sortKey 总等于 clickedKey
    });
  }, []);

  const clearSort = useCallback(() => {
    setSortKey(null);
    setSortDir("asc");
  }, []);

  // 候选按市场分组计数（顶部 chip 显示 US:N HK:M CN:K）
  const marketBreakdown = useMemo(() => {
    const counts = { US: 0, HK: 0, CN: 0, other: 0 };
    for (const c of filteredCandidates) {
      const m = c.market;
      if (m === "US" || m === "HK" || m === "CN") counts[m] += 1;
      else counts.other += 1;
    }
    return counts;
  }, [filteredCandidates]);

  // candidates 一旦刷新（赛道/市场/市值切换），清空 AI 排序
  useEffect(() => {
    setAiRanking({});
    setAiRankingState({ loading: false, error: null });
  }, [candidates]);

  // ── AI 赛道校验：让 LLM 判断这只票是否真属于已勾选赛道 ───
  const handleAiMatch = useCallback(async (candidate) => {
    if (selectedTrends.length === 0 || !candidate?.ticker) return;
    setAiMatchLoading(candidate.ticker);
    try {
      const json = await apiFetch("/llm/match-supertrend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: candidate.ticker,
          name: candidate.name,
          sector: candidate.sector,
          industry: candidate.industry,
          // 限定 LLM 只在用户已勾选的赛道里选；候选很广时 LLM 容易胡判
          candidate_ids: selectedTrends,
          // 价值型场景透传 5 维财务（backend 按 candidates 的 strategy 自动选 prompt 框架）
          pe: candidate.pe ?? null,
          pb: candidate.pb ?? null,
          dividend_yield: candidate.dividend_yield ?? null,
          roe: candidate.roe ?? null,
          debt_to_equity: candidate.debt_to_equity ?? null,
        }),
      });
      if (!json) throw new Error("后端无响应");
      if (!json.ok) throw new Error(json.error || "AI 校验失败");
      setAiMatchResult({
        ticker: candidate.ticker,
        name: candidate.name,
        matched: json.matched || [],
        reason: json.reason || "",
        confidence: json.confidence ?? 0,
        cached: !!json.cached,
      });
    } catch (e) {
      setAiMatchResult({
        ticker: candidate.ticker,
        name: candidate.name,
        error: String(e.message || e),
      });
    } finally {
      setAiMatchLoading(null);
    }
  }, [selectedTrends]);

  // ── AI 排序：取 top 10 候选送 LLM 打 moat_score ───────
  const handleAiRank = useCallback(async () => {
    if (selectedTrends.length === 0 || candidates.length === 0) return;
    setAiRankingState({ loading: true, error: null });
    try {
      const top = candidates.slice(0, 10).map((c) => ({
        ticker: c.ticker,
        name: c.name,
        sector: c.sector,
        industry: c.industry,
        marketCap: c.marketCap,
        // 价值型场景透传 5 维财务（backend rank-candidates 按 supertrend.strategy 决定是否用上）
        pe: c.pe ?? null,
        pb: c.pb ?? null,
        dividend_yield: c.dividend_yield ?? null,
        roe: c.roe ?? null,
        debt_to_equity: c.debt_to_equity ?? null,
      }));
      const json = await apiFetch("/llm/rank-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supertrend_id: selectedTrends[0],   // 用第一个勾选的赛道
          candidates: top,
        }),
      });
      if (!json) throw new Error("后端无响应（DEEPSEEK_API_KEY 未配置或网络问题）");
      if (!json.ok) throw new Error(json.error || "AI 排序失败");
      const map = {};
      for (const r of json.rankings || []) {
        if (r.ticker) map[r.ticker] = { moat_score: r.moat_score, reason: r.reason };
      }
      setAiRanking(map);
      setAiRankingState({ loading: false, error: null });
    } catch (e) {
      setAiRankingState({ loading: false, error: String(e.message || e) });
    }
  }, [selectedTrends, candidates]);

  // ── AI 一键串联：批量校验 top 5 + 排序 top 10（并发） ───
  // 一次点击代替"AI 校验逐行点 5 次 + AI 排序"两步操作；适合 screen 完
  // 想快速看 top 候选的场景。结果：aiMatchMap 填 5 个 ticker 的 match
  // 结果（每行行内显示），aiRanking 填 10 个 ticker 的卡位/护城河分。
  const AI_PIPELINE_MATCH_TOP = 5;
  const handleAiPipeline = useCallback(async () => {
    if (selectedTrends.length === 0 || candidates.length === 0) return;
    const matchTargets = candidates.slice(0, AI_PIPELINE_MATCH_TOP);
    setAiPipelineState({ loading: true, matched: 0, total: matchTargets.length, error: null });
    setAiMatchMap({});

    // rank 并发触发（独立 promise，不阻塞 match 进度）
    const rankPromise = handleAiRank();

    // match 并发：每只候选独立调，进度计数
    let matchedCount = 0;
    const matchPromises = matchTargets.map(async (c) => {
      try {
        const json = await apiFetch("/llm/match-supertrend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: c.ticker, name: c.name,
            sector: c.sector, industry: c.industry,
            candidate_ids: selectedTrends,
          }),
        });
        if (!json) throw new Error("后端无响应");
        if (!json.ok) throw new Error(json.error || "AI 校验失败");
        setAiMatchMap((prev) => ({
          ...prev,
          [c.ticker]: {
            matched: json.matched || [],
            confidence: json.confidence ?? 0,
            cached: !!json.cached,
          },
        }));
      } catch (e) {
        setAiMatchMap((prev) => ({ ...prev, [c.ticker]: { error: String(e.message || e) } }));
      } finally {
        matchedCount += 1;
        setAiPipelineState((s) => ({ ...s, matched: matchedCount }));
      }
    });

    await Promise.allSettled([rankPromise, ...matchPromises]);
    setAiPipelineState((s) => ({ ...s, loading: false }));
  }, [selectedTrends, candidates, handleAiRank]);

  // ── 交互 ────────────────────────────────────────────
  const toggleTrend = (id) => {
    setSelectedTrends((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  };

  const openAdd = (candidate) => {
    setEditing(null);
    setPendingCandidate(candidate);
    // 把首次默认 supertrend 设为该候选的第一个匹配
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setPendingCandidate(null);
    setEditorOpen(true);
  };

  const handleSaved = async () => {
    // 编辑模式拿 editing.ticker；新增模式拿 pendingCandidate.ticker
    const justAddedTicker = !editing ? pendingCandidate?.ticker : null;
    setEditorOpen(false);
    setEditing(null);
    setPendingCandidate(null);
    await reloadWatchlist();
    // 加入观察：本地剔除候选，省一次 screen 调用
    if (justAddedTicker) {
      setCandidates((cur) => cur.filter((c) => c.ticker !== justAddedTicker));
    }
  };

  // 一键加入 Stock Gene 观察列表（共享标的研究流程）
  // 自动带上当前赛道作为 tag，加入后并行跑 4 引擎评分
  // 返回 { added: bool, alreadyExists: bool, error?: str }
  const [geneAdding, setGeneAdding] = useState(null); // 当前正在加的 ticker
  const [geneToast, setGeneToast] = useState(null);   // { ticker, ok, msg }
  const handleAddToGene = useCallback(async (candidate) => {
    if (!candidate?.ticker) return;
    setGeneAdding(candidate.ticker);
    setGeneToast(null);
    try {
      // 把命中的赛道名作为初始标签（直接查 supertrends，避免闭包过期）
      const trendTags = (candidate.matched_supertrends || [])
        .map(id => supertrends.find(s => s.id === id)?.name || id)
        .filter(Boolean);
      const tags = [...new Set(["10x候选", ...trendTags])];
      const addRes = await apiFetch("/stock-gene", {
        method: "POST",
        body: JSON.stringify({
          ticker: candidate.ticker,
          name: candidate.name || "",
          market: candidate.market || "US",
          sector: candidate.sector || candidate.industry || "",
          tags,
          notes: `来自 10x 猎手：${trendTags.join(" / ") || "未命中赛道"}`,
        }),
      });
      if (!addRes?.ok) {
        setGeneToast({ ticker: candidate.ticker, ok: false, msg: addRes?.detail || "加入失败" });
        return;
      }
      // 并行跑 4 个引擎评分（注：trend / value / signal / risk 4 个路由）
      const SCORE_ROUTES = ["score", "value-score", "signal-score", "risk-score"];
      await Promise.allSettled(
        SCORE_ROUTES.map(p => apiFetch(
          `/stock-gene/${encodeURIComponent(candidate.ticker)}/${p}`,
          { method: "POST" },
        ))
      );
      setGeneToast({ ticker: candidate.ticker, ok: true, msg: "已加入 + 4 引擎评分" });
      // 5 秒后自动消失
      setTimeout(() => setGeneToast(cur => (cur?.ticker === candidate.ticker ? null : cur)), 5000);
    } catch (e) {
      setGeneToast({ ticker: candidate.ticker, ok: false, msg: String(e.message || e) });
    } finally {
      setGeneAdding(null);
    }
  }, [supertrends]);

  const handleDelete = async (ticker) => {
    if (!window.confirm(`从观察列表删除 ${ticker}？此操作不可撤销。归档（左下"显示归档"按钮）可保留 thesis。`)) return;
    await apiFetch(`/watchlist/10x/${encodeURIComponent(ticker)}`, { method: "DELETE" });
    await reloadWatchlist();
    // 删除后让 ticker 重新进入候选列表
    if (selectedTrends.length > 0) runScreen();
  };

  const handleToggleArchive = async (ticker, archived) => {
    await apiFetch(`/watchlist/10x/${encodeURIComponent(ticker)}`, {
      method: "PUT",
      body: JSON.stringify({ archived }),
    });
    await reloadWatchlist();
    // 归档/恢复都不影响候选 — 归档项也算"已观察过"
  };

  // 一键"已复盘" — 不必 regenerate AI 草稿就能消除 N 天未复盘 badge
  // 用户简单看一眼觉得 thesis 仍成立 → 标记复盘，badge 重新计时
  const handleMarkReviewed = async (ticker) => {
    await apiFetch(`/watchlist/10x/${encodeURIComponent(ticker)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_thesis_cached_at: new Date().toISOString() }),
    });
    await reloadWatchlist();
  };

  // 导出整份 watchlist 为 .json 备份文件
  const handleExport = async () => {
    const json = await apiFetch("/watchlist/10x/export");
    if (!json) {
      window.alert("导出失败：后端不可用（演示模式或网络问题）");
      return;
    }
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quantedge-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // 导出 watchlist 为 .csv（Excel-friendly，带 BOM 解决中文乱码）
  // 序列化逻辑在 src/lib/csvExport.js（pure，可测）
  const handleExportCsv = async () => {
    const json = await apiFetch("/watchlist/10x/export");
    if (!json) {
      window.alert("导出失败：后端不可用（演示模式或网络问题）");
      return;
    }
    const csv = serializeWatchlistCsv(json.items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quantedge-watchlist-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // 选文件 → 解析 JSON → 选 merge / replace → POST import
  const handleImportFile = async (file) => {
    if (!file) return;
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (e) {
      window.alert(`文件解析失败：${e.message}`);
      return;
    }
    if (!payload || typeof payload !== "object") {
      window.alert("文件格式不对：应为 { items: [], user_supertrends: [] }");
      return;
    }

    const summary = `观察项 ${payload.items?.length || 0} 条；自定义赛道 ${payload.user_supertrends?.length || 0} 个`;
    const choice = window.prompt(
      `${summary}\n\n输入 'merge' 合并到现有数据（推荐）；输入 'replace' 清空后导入（不可撤销）；其他取消。`,
      "merge",
    );
    if (choice !== "merge" && choice !== "replace") return;

    setImportLoading(true);
    const res = await apiFetch("/watchlist/10x/import", {
      method: "POST",
      body: JSON.stringify({
        mode: choice,
        items: payload.items || [],
        user_supertrends: payload.user_supertrends || [],
      }),
    });
    setImportLoading(false);
    if (res?.ok) {
      window.alert(
        `导入成功（${res.mode}）\n` +
        `观察项：+${res.items_added} / 更新 ${res.items_updated}\n` +
        `自定义赛道：+${res.supertrends_added} / 更新 ${res.supertrends_updated}`
      );
      await reloadWatchlist();
    } else {
      window.alert(`导入失败：${res?.detail || "未知错误"}`);
    }
  };

  const trendName = (id) => supertrends.find((s) => s.id === id)?.name || id;

  // ── 策略切换：清掉旧 tab 的赛道选择 ───────────────────
  const handleStrategySwitch = (next) => {
    if (next === activeStrategy) return;
    setActiveStrategy(next);
    setSelectedTrends([]);   // 切换 tab 清空选中（避免 growth 选了 semi 切到 value 后还在筛选）
    setCandidates([]);
    setAiRanking({});
    setAiMatchResult(null);
  };

  // 按 activeStrategy 过滤左栏赛道
  const displayedSupertrends = useMemo(() =>
    supertrends.filter(s => (s.strategy || "growth") === activeStrategy),
    [supertrends, activeStrategy]
  );

  // ── v6 移动端渲染 ─────────────────────────────────────────────
  if (isMobile) {
    // 漏斗数据：复用桌面端已有的 universeStats / candidates / aiPipelineState / items
    const totalUniverse = universeStats
      ? (universeStats.US?.count || 0) + (universeStats.HK?.count || 0) + (universeStats.CN?.count || 0)
      : 0;
    const funnelStages = [
      { label: t("全宇宙"),   value: totalUniverse > 0 ? totalUniverse : 2350, widthPct: 100, color: FUNNEL_COLORS[0], sub: "US+HK+CN" },
      { label: t("匹配赛道"), value: candidates.length,                         widthPct: 46,  color: FUNNEL_COLORS[1], sub: selectedTrends.length > 0 ? `${selectedTrends.length} 个赛道` : "未选赛道" },
      { label: t("AI 已审"),  value: aiPipelineState.matched || 0,              widthPct: 22,  color: FUNNEL_COLORS[2], sub: "AI Pipeline" },
      { label: t("观察名单"), value: items.length,                              widthPct: 9,   color: FUNNEL_COLORS[3], sub: `${items.length} 只跟踪中` },
    ];

    // 候选下钻卡内容（锚→当→目标轨迹）
    const CandidateDetailCard = ({ item, onClose }) => {
      const anchor = item.anchor_price ?? item.cost_basis ?? null;
      const target = item.target_price ?? null;
      const now = pricesByTicker[item.ticker] ?? null;
      const hasTrack = anchor != null && target != null && now != null && target > anchor;
      const pct = hasTrack ? Math.max(0, Math.min(100, ((now - anchor) / (target - anchor)) * 100)) : 0;
      const upside = now && target && now > 0 ? (target / now).toFixed(1) : null;
      const aiConf = aiMatchMap[item.ticker]?.confidence;
      return (
        <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "var(--bg-0)" }}>
          <MobileAppBar
            onBack={onClose}
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono text-[15px] font-bold" style={{ color: "var(--fg-0)" }}>{item.ticker}</span>
                <span className="text-[12px]" style={{ color: "var(--fg-3)" }}>{item.name || ""}</span>
              </span>
            }
            actions={
              aiConf != null && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(139,92,246,.18)", color: "#C4B5FD", border: "1px solid rgba(139,92,246,.3)" }}>
                  信心 {Math.round(aiConf * 100)}
                </span>
              )
            }
          />
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {/* thesis */}
            {item.thesis && (
              <p className="text-[13px] mb-4 leading-relaxed" style={{ color: "var(--fg-2)" }}>{item.thesis}</p>
            )}
            {/* 超级赛道 chips */}
            {(item.supertrend_ids || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {item.supertrend_ids.map(id => (
                  <span key={id} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,.15)", color: "var(--indigo-2)", border: "1px solid rgba(99,102,241,.25)" }}>
                    {trendName(id)}
                  </span>
                ))}
              </div>
            )}
            {/* 锚→当→目标轨迹 */}
            <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(255,255,255,.022)", border: "1px solid var(--line)" }}>
              <div className="text-[11px] mb-3 font-medium" style={{ color: "var(--fg-3)" }}>锚 → 当 → 目标 轨迹</div>
              {hasTrack ? (
                <>
                  <div className="relative h-[6px] rounded-full mb-2" style={{ background: "rgba(255,255,255,.06)" }}>
                    <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--indigo), var(--up))" }} />
                    <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full" style={{ left: `${pct}%`, marginLeft: -7, background: "#fff", boxShadow: "0 0 0 2.5px var(--up)" }} />
                  </div>
                  <div className="flex justify-between text-[11px] font-mono">
                    <span style={{ color: "var(--fg-3)" }}>锚 ${anchor.toFixed(2)}</span>
                    <span style={{ color: "var(--up)", fontWeight: 600 }}>当 ${now.toFixed(2)}</span>
                    <span style={{ color: "var(--indigo-2)" }}>目标 ${target.toFixed(2)}{upside ? ` · ${upside}x` : ""}</span>
                  </div>
                </>
              ) : (
                <div className="text-[12px]" style={{ color: "var(--fg-3)" }}>
                  {anchor != null ? `锚点 $${anchor}` : "无锚点"}
                  {target != null ? ` · 目标 $${target}` : " · 无目标价"}
                  {now == null && " · 价格加载中"}
                </div>
              )}
            </div>
            {/* stop loss */}
            {item.stop_loss != null && (
              <div className="flex items-center gap-2 text-[12px] mb-4">
                <span style={{ color: "var(--fg-3)" }}>止损</span>
                <span className="font-mono" style={{ color: "var(--down)" }}>${item.stop_loss}</span>
                {now != null && now <= item.stop_loss && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,.15)", color: "var(--down)", border: "1px solid rgba(239,68,68,.3)" }}>触发</span>
                )}
              </div>
            )}
            {/* 操作按钮 */}
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => { setMDetailItem(null); openEdit(item); }}
                className="flex-1 py-3 rounded-xl text-[13px] font-semibold active:scale-95 transition"
                style={{ background: "rgba(99,102,241,.15)", color: "var(--indigo-2)", border: "1px solid rgba(99,102,241,.3)" }}
              >
                {t("编辑")}
              </button>
              <button
                onClick={() => { setMDetailItem(null); handleDelete(item.ticker); }}
                className="py-3 px-5 rounded-xl text-[13px] active:scale-95 transition"
                style={{ background: "rgba(239,68,68,.08)", color: "var(--down)", border: "1px solid rgba(239,68,68,.2)" }}
              >
                {t("删除")}
              </button>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="h-full flex flex-col" style={{ background: "var(--bg-0)" }}>
        {/* ── 可滚主体 ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain">

          {/* 顶栏：标题 + AI 狩猎 + 筛选按钮 */}
          <div className="px-4 pt-3 pb-2 flex items-center gap-2">
            <h1 className="text-[22px] font-bold flex-1" style={{ color: "var(--fg-0)" }}>
              {t("10x 猎手")}
            </h1>
            {isDemoMode && (
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(245,181,60,.12)", color: "var(--warn)", border: "1px solid rgba(245,181,60,.25)" }}>演示</span>
            )}
            <button
              onClick={handleAiPipeline}
              disabled={aiPipelineState.loading || isDemoMode || selectedTrends.length === 0 || candidates.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold active:scale-95 transition disabled:opacity-40"
              style={{ background: "rgba(139,92,246,.14)", color: "#C4B5FD", border: "1px solid rgba(139,92,246,.3)" }}
            >
              {aiPipelineState.loading
                ? <><Loader size={12} className="animate-spin" />{aiPipelineState.matched}/{aiPipelineState.total}</>
                : <><Sparkles size={12} />{t("AI 狩猎")}</>}
            </button>
            <button
              onClick={() => setMFilterOpen(true)}
              className="relative w-9 h-9 rounded-[10px] border flex items-center justify-center active:scale-95 transition"
              style={{
                borderColor: selectedTrends.length > 0 ? "rgba(99,102,241,.35)" : "var(--line)",
                background: selectedTrends.length > 0 ? "rgba(99,102,241,.12)" : "rgba(255,255,255,.03)",
              }}
            >
              <Filter size={17} style={{ color: selectedTrends.length > 0 ? "var(--indigo-2)" : "var(--fg-1)" }} />
              {selectedTrends.length > 0 && (
                <span className="absolute -top-1 -right-1 w-[15px] h-[15px] rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: "var(--indigo)" }}>
                  {selectedTrends.length}
                </span>
              )}
            </button>
          </div>

          {/* 成长型 / 价值型 大开关 */}
          <div className="px-4 mb-3">
            <div className="flex gap-1.5 p-1 rounded-xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>
              {[["growth", t("成长猎手")], ["value", t("价值猎手")]].map(([key, label]) => {
                const on = activeStrategy === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleStrategySwitch(key)}
                    className="flex-1 py-2.5 rounded-[9px] text-[13px] font-semibold transition active:scale-[0.98]"
                    style={on
                      ? { background: "linear-gradient(180deg, var(--indigo-2), var(--indigo))", color: "#fff" }
                      : { color: "var(--fg-2)" }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 漏斗可视化 ── */}
          <div className="px-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-3)" }}>{t("狩猎漏斗")}</span>
              <button
                onClick={() => setMFunnelFs(true)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg active:scale-95 transition"
                style={{ color: "var(--fg-3)", background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}
              >
                <Maximize2 size={11} />{t("全景")}
              </button>
            </div>
            <div className="space-y-2">
              {funnelStages.map((stage, i) => (
                <div key={stage.label} className="flex items-center gap-3">
                  <span className="text-[10px] w-14 text-right shrink-0" style={{ color: "var(--fg-3)" }}>{stage.label}</span>
                  <div className="flex-1 h-7 rounded-lg relative overflow-hidden" style={{ background: "rgba(255,255,255,.03)" }}>
                    <div
                      className="absolute left-0 top-0 bottom-0 rounded-lg flex items-center justify-end pr-2.5"
                      style={{ width: `${stage.widthPct}%`, background: `linear-gradient(90deg, ${stage.color}33, ${stage.color}cc)` }}
                    >
                      <span className="font-mono text-[12px] font-bold text-white">
                        {typeof stage.value === "number" && stage.value > 0 ? stage.value.toLocaleString() : (i === 0 ? "—" : stage.value)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 观察名单·轨迹卡 ── */}
          <div className="px-4 mb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-3)" }}>
                {t("观察名单")} · {t("锚→当→目标")}
              </span>
              <span className="text-[11px]" style={{ color: "var(--fg-3)" }}>{items.length} {t("只")}</span>
            </div>

            {items.length === 0 && (
              <div className="text-center py-10 text-[12px]" style={{ color: "var(--fg-3)" }}>
                {t("还没有观察项")}
              </div>
            )}

            {items.map((it) => {
              const anchor = it.anchor_price ?? it.cost_basis ?? null;
              const target = it.target_price ?? null;
              const now = pricesByTicker[it.ticker] ?? null;
              const hasTrack = anchor != null && target != null && now != null && target > anchor;
              const pct = hasTrack ? Math.max(0, Math.min(100, ((now - anchor) / (target - anchor)) * 100)) : 0;
              const upside = now && target && now > 0 ? (target / now).toFixed(1) : null;
              const aiConf = aiMatchMap[it.ticker]?.confidence;
              return (
                <button
                  key={it.ticker}
                  onClick={() => setMDetailItem(it)}
                  className="w-full text-left rounded-2xl p-4 mb-3 active:scale-[0.99] transition"
                  style={{ background: "rgba(255,255,255,.022)", border: "1px solid var(--line)" }}
                >
                  {/* header */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[15px] font-bold" style={{ color: "var(--fg-0)" }}>{it.ticker}</span>
                    <span className="text-[12px] truncate flex-1" style={{ color: "var(--fg-3)" }}>{it.name || ""}</span>
                    {aiConf != null && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0" style={{ background: "rgba(139,92,246,.18)", color: "#C4B5FD", border: "1px solid rgba(139,92,246,.25)" }}>
                        {t("信心")} {Math.round(aiConf * 100)}
                      </span>
                    )}
                    {aiConf == null && aiPipelineState.matched > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0" style={{ background: "rgba(255,255,255,.05)", color: "var(--fg-3)", border: "1px solid var(--line)" }}>
                        {t("信心")} —
                      </span>
                    )}
                  </div>
                  {/* catalyst */}
                  {it.thesis && (
                    <p className="text-[12px] mb-3 line-clamp-2" style={{ color: "var(--fg-2)" }}>{it.thesis}</p>
                  )}
                  {/* track */}
                  {hasTrack ? (
                    <>
                      <div className="relative h-[5px] rounded-full mb-2" style={{ background: "rgba(255,255,255,.06)" }}>
                        <div className="absolute left-0 top-0 bottom-0 rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--indigo), var(--up))" }} />
                        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full" style={{ left: `${pct}%`, marginLeft: -6, background: "#fff", boxShadow: "0 0 0 2px var(--up)" }} />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono">
                        <span style={{ color: "var(--fg-3)" }}>锚 ${anchor.toFixed(2)}</span>
                        <span style={{ color: "var(--up)", fontWeight: 600 }}>当 ${now.toFixed(2)}</span>
                        <span style={{ color: "var(--indigo-2)" }}>目标 ${target.toFixed(2)}{upside ? ` · ${upside}x` : ""}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px]" style={{ color: "var(--fg-3)" }}>
                      {anchor != null ? `锚 $${anchor}` : "无锚点"}
                      {target != null ? ` → 目标 $${target}` : ""}
                    </div>
                  )}
                </button>
              );
            })}

            {/* 候选快速加观察入口（漏斗"匹配赛道"层有结果时展示 top 5） */}
            {filteredCandidates.length > 0 && (
              <div className="mt-2 mb-4">
                <div className="text-[11px] mb-2 font-semibold uppercase tracking-wider" style={{ color: "var(--fg-3)" }}>
                  {t("候选快速加入")} · {t("匹配赛道")} {filteredCandidates.length}
                </div>
                {filteredCandidates.slice(0, 5).map((c) => (
                  <div key={c.ticker} className="flex items-center gap-2 py-2.5 border-b" style={{ borderColor: "var(--line)" }}>
                    <span className="font-mono text-[13px] font-semibold flex-1" style={{ color: "var(--fg-0)" }}>{c.ticker}</span>
                    <span className="text-[11px] truncate max-w-[120px]" style={{ color: "var(--fg-3)" }}>{c.name || ""}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,.04)", color: "var(--fg-3)" }}>{fmtMcap(c.marketCap)}</span>
                    <button
                      onClick={() => openAdd(c)}
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 active:scale-90 transition"
                      style={{ background: "rgba(99,102,241,.15)", color: "var(--indigo-2)", border: "1px solid rgba(99,102,241,.3)" }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
                {filteredCandidates.length > 5 && (
                  <div className="text-center text-[11px] pt-2" style={{ color: "var(--fg-3)" }}>
                    +{filteredCandidates.length - 5} {t("更多候选")}…
                  </div>
                )}
              </div>
            )}

            {/* 无赛道选中提示 */}
            {selectedTrends.length === 0 && candidates.length === 0 && (
              <div className="text-center py-6 text-[12px]" style={{ color: "var(--fg-3)" }}>
                {t("点击右上角筛选选择赛道")}
              </div>
            )}
            {loadingCands && (
              <div className="flex items-center justify-center gap-2 py-6 text-[12px]" style={{ color: "var(--fg-3)" }}>
                <Loader size={13} className="animate-spin" />{t("筛选中")}…
              </div>
            )}
          </div>
        </div>{/* end scroll */}

        {/* ── 筛选 BottomSheet ── */}
        <BottomSheet
          open={mFilterOpen}
          onClose={() => setMFilterOpen(false)}
          title={t("筛选赛道")}
          footer={
            <button
              onClick={() => setMFilterOpen(false)}
              className="w-full py-3.5 rounded-xl text-[14px] font-semibold active:scale-[0.98] transition"
              style={{ background: "linear-gradient(180deg, var(--indigo-2), var(--indigo))", color: "#fff" }}
            >
              {t("显示")} {filteredCandidates.length} {t("只候选")}
            </button>
          }
        >
          {/* 策略切换 */}
          <div className="flex gap-1.5 p-1 rounded-xl mb-4" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>
            {[["growth", t("成长猎手")], ["value", t("价值猎手")]].map(([key, label]) => {
              const on = activeStrategy === key;
              return (
                <button key={key} onClick={() => handleStrategySwitch(key)}
                  className="flex-1 py-2 rounded-[9px] text-[13px] font-semibold transition"
                  style={on ? { background: "rgba(99,102,241,.2)", color: "var(--indigo-2)", border: "1px solid rgba(99,102,241,.35)" } : { color: "var(--fg-2)" }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* 超级赛道列表 */}
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--fg-3)" }}>{t("超级赛道")}</div>
          <div className="space-y-2 mb-4">
            {displayedSupertrends.map((s) => {
              const active = selectedTrends.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleTrend(s.id)}
                  className="w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition active:scale-[0.99]"
                  style={{
                    background: active ? "rgba(99,102,241,.1)" : "rgba(255,255,255,.02)",
                    border: `1px solid ${active ? "rgba(99,102,241,.35)" : "var(--line)"}`,
                  }}
                >
                  <span className="mt-0.5 shrink-0 w-4 h-4 rounded-md flex items-center justify-center"
                    style={{ background: active ? "var(--indigo)" : "transparent", border: `1.5px solid ${active ? "var(--indigo)" : "var(--fg-3)"}` }}>
                    {active && <span style={{ width: 6, height: 6, borderRadius: 2, background: "#fff", display: "block" }} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium block" style={{ color: active ? "var(--fg-0)" : "var(--fg-1)" }}>{s.name}</span>
                    <span className="text-[11px] block truncate" style={{ color: "var(--fg-3)" }}>{s.note || ""}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* 市值上限（成长型） */}
          {activeStrategy === "growth" && (
            <div className="mb-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--fg-3)" }}>{t("市值上限")} (B)</div>
              <input
                type="number"
                value={maxMcapInput}
                onChange={(e) => setMaxMcapInput(Number(e.target.value) || 0)}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none border"
                style={{ background: "rgba(255,255,255,.04)", borderColor: "var(--line)", color: "var(--fg-0)" }}
              />
            </div>
          )}

          {/* 市场切换 */}
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--fg-3)" }}>{t("市场")}</div>
            <div className="flex gap-2">
              {["US", "HK", "CN"].map((m) => {
                const on = markets.includes(m);
                return (
                  <button key={m}
                    onClick={() => {
                      const isOnlyOne = on && markets.length === 1;
                      if (isOnlyOne) setMarkets(["US", "HK", "CN"]);
                      else setMarkets(cur => on ? cur.filter(x => x !== m) : [...cur, m]);
                    }}
                    className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition active:scale-95"
                    style={on
                      ? { background: "rgba(99,102,241,.2)", color: "var(--indigo-2)", border: "1px solid rgba(99,102,241,.4)" }
                      : { background: "rgba(255,255,255,.03)", color: "var(--fg-3)", border: "1px solid var(--line)" }}>
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ETF + 精严 toggles */}
          <div className="flex gap-3 mb-6">
            {[
              [includeETF, () => setIncludeETF(v => !v), "ETF"],
              [precise, () => setPrecise(v => !v), t("精严模式")],
            ].map(([on, toggle, label]) => (
              <button key={label} onClick={toggle}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition active:scale-95"
                style={on
                  ? { background: "rgba(99,102,241,.12)", color: "var(--indigo-2)", border: "1px solid rgba(99,102,241,.3)" }
                  : { background: "rgba(255,255,255,.03)", color: "var(--fg-3)", border: "1px solid var(--line)" }}>
                {label}
              </button>
            ))}
          </div>
        </BottomSheet>

        {/* ── 漏斗横屏全景（FullscreenChart） ── */}
        <FullscreenChart
          open={mFunnelFs}
          onClose={() => setMFunnelFs(false)}
          title={t("成长猎手 · 狩猎漏斗")}
          meta={<span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,.18)", color: "#C4B5FD", border: "1px solid rgba(139,92,246,.3)" }}>AI Pipeline</span>}
          footerNote={items.length > 0 ? `观察名单：${items.map(it => it.ticker).join(" · ")}` : undefined}
        >
          {/* 横屏内容：4 级漏斗块 + 候选 Nx 行 */}
          <div className="w-full h-full flex flex-col justify-center gap-3 px-2">
            {/* 漏斗块行 */}
            <div className="flex items-end gap-1 flex-1">
              {funnelStages.map((stage, i) => (
                <React.Fragment key={stage.label}>
                  <div className="flex-1 flex flex-col items-center justify-end">
                    <div
                      className="w-full rounded-xl flex flex-col items-center justify-center"
                      style={{
                        height: `${stage.widthPct * 1.5}%`,
                        minHeight: 40,
                        maxHeight: "90%",
                        background: `linear-gradient(180deg, ${stage.color}cc, ${stage.color}44)`,
                        boxShadow: `0 8px 24px -8px ${stage.color}`,
                      }}
                    >
                      <span className="font-mono text-[16px] font-bold text-white">
                        {typeof stage.value === "number" && stage.value > 0 ? stage.value.toLocaleString() : "—"}
                      </span>
                      <span className="text-[9px] text-white/80 mt-0.5">{stage.label}</span>
                    </div>
                    <span className="text-[9px] mt-1.5 text-center" style={{ color: "var(--fg-3)" }}>{stage.sub}</span>
                  </div>
                  {i < funnelStages.length - 1 && (
                    <ArrowRight size={14} style={{ color: "var(--fg-4)", marginBottom: "20%" }} />
                  )}
                </React.Fragment>
              ))}
            </div>
            {/* 候选 Nx 倍数行 */}
            {items.length > 0 && (
              <div className="flex gap-2 mt-1 shrink-0">
                {items.map((it) => {
                  const now = pricesByTicker[it.ticker];
                  const target = it.target_price;
                  const nx = now && target && now > 0 ? (target / now).toFixed(1) : null;
                  return (
                    <div key={it.ticker} className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(30,211,149,.05)", border: "1px solid rgba(30,211,149,.2)" }}>
                      <span className="font-mono text-[12px] font-bold" style={{ color: "var(--fg-0)" }}>{it.ticker}</span>
                      <span className="flex-1" />
                      {nx && <span className="font-mono text-[11px]" style={{ color: "var(--indigo-2)" }}>{nx}x</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </FullscreenChart>

        {/* ── 候选下钻卡 ── */}
        {mDetailItem && (
          <CandidateDetailCard item={mDetailItem} onClose={() => setMDetailItem(null)} />
        )}

        {/* ── 编辑 TenxItemEditor（移动端复用桌面版模态框） ── */}
        <TenxItemEditor
          open={editorOpen}
          item={editing}
          candidate={pendingCandidate}
          supertrends={supertrends}
          currentPrice={pricesByTicker[editing?.ticker || pendingCandidate?.ticker]}
          onClose={() => { setEditorOpen(false); setEditing(null); setPendingCandidate(null); }}
          onSaved={handleSaved}
        />
      </div>
    );
  }

  // ── 渲染 ────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 glass-card border border-white/10">
        <div className="flex items-center gap-3">
          <Target size={16} className="text-amber-400" />
          <span className="text-sm font-semibold text-white">10x 猎手</span>
          {/* Growth / Value tab 切换 */}
          <div className="flex items-center gap-0.5 ml-2 bg-white/5 rounded border border-white/10 p-0.5">
            <button
              onClick={() => handleStrategySwitch("growth")}
              className={`px-2 py-0.5 text-[10px] rounded transition ${
                activeStrategy === "growth"
                  ? "bg-cyan-500/20 text-cyan-100 font-medium"
                  : "text-[#a0aec0] hover:text-white"
              }`}
              title="成长型：超级趋势 + 双层瓶颈 + 卡位公司"
            >
              成长型
            </button>
            <button
              onClick={() => handleStrategySwitch("value")}
              className={`px-2 py-0.5 text-[10px] rounded transition ${
                activeStrategy === "value"
                  ? "bg-amber-500/20 text-amber-100 font-medium"
                  : "text-[#a0aec0] hover:text-white"
              }`}
              title="价值型：Graham 安全边际 + 估值点位 + 护城河"
            >
              价值型
            </button>
          </div>
          {isDemoMode && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30"
              title="后端不可用：仅展示内置赛道；筛选 / 添加观察 / AI 草稿需 self-hosted backend"
            >
              演示模式
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-[#a0aec0]">
          <button
            onClick={() => { reloadWatchlist(); reloadUniverseStats(); runScreen(); }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
            title="刷新"
          >
            <RefreshCw size={10} /> 刷新
          </button>
        </div>
      </div>

      {/* v5 漏斗叙事：4 段 hero header — 全宇宙 → 匹配赛道 → AI 已审 → 你的观察
          serif 数字 + 箭头连接，把"狩猎"过程做成可视化叙事 */}
      {(() => {
        const totalUniverse = universeStats
          ? (universeStats.US?.count || 0) + (universeStats.HK?.count || 0) + (universeStats.CN?.count || 0)
          : 0;
        const steps = [
          {
            label: "全宇宙",
            n: totalUniverse > 0 ? totalUniverse.toLocaleString() : "—",
            desc: universeStats
              ? `US ${universeStats.US?.count || 0} · HK ${universeStats.HK?.count || 0} · CN ${universeStats.CN?.count || 0}`
              : "US + HK + CN",
            color: "text-[#7a8497]",
            border: "border-white/10",
          },
          {
            label: "匹配赛道",
            n: candidates.length || 0,
            desc: selectedTrends.length > 0
              ? `${selectedTrends.length} 个赛道命中`
              : "未选赛道",
            color: "text-indigo-200",
            border: "border-indigo-400/25",
          },
          {
            label: "AI 已审过",
            n: aiPipelineState.matched || 0,
            desc: aiPipelineState.matched > 0
              ? `moat ≥ ${aiPipelineState.threshold || 54}`
              : "AI Pipeline 未运行",
            color: "text-violet-200",
            border: "border-violet-400/25",
          },
          {
            label: "你的观察",
            n: items.length || 0,
            desc: items.length > 0 ? `${items.length} 个跟踪中` : "未加观察",
            color: "text-amber-200",
            border: "border-amber-400/25",
          },
        ];
        return (
          <div className="flex items-stretch gap-1.5">
            {steps.map((s, i) => (
              <React.Fragment key={s.label}>
                <div className={`flex-1 px-3 py-2 rounded-lg border bg-white/[0.022] ${s.border}`}>
                  <div className="text-[9px] uppercase tracking-wider text-[#778] mb-0.5">{s.label}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`font-serif text-2xl font-semibold tabular-nums leading-none ${s.color}`} style={{ letterSpacing: "-0.02em" }}>
                      {typeof s.n === "number" ? s.n.toLocaleString() : s.n}
                    </span>
                    <span className="text-[10px] text-[#7a8497] truncate">{s.desc}</span>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="flex items-center justify-center text-[#556]" style={{ width: 14 }}>
                    <ArrowRight size={14} />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        );
      })()}

      {/* v5.2 总转化总览 + v5.3 已存筛选预设 */}
      {(() => {
        const totalUniverse = universeStats ? (universeStats.US?.count || 0) + (universeStats.HK?.count || 0) + (universeStats.CN?.count || 0) : 0;
        const finalN = items.length;
        return (
          <div className="flex flex-wrap items-center gap-2 -mt-1">
            {totalUniverse > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/[0.05] border border-cyan-400/15 text-[10px]">
                <span className="text-cyan-300 font-mono font-semibold">{(finalN / totalUniverse * 100).toFixed(2)}% 总转化</span>
                <span className="text-[#556]">·</span>
                <span className="text-[#a0aec0] font-mono">{totalUniverse.toLocaleString()} → {finalN}</span>
                {finalN > 0 && <><span className="text-[#556]">·</span><span className="text-cyan-200 font-mono">≈ {Math.round(totalUniverse / finalN)}× 放大</span></>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {presets.map(p => (
                <span key={p.id} className={`group/preset inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] transition ${p.id === activePresetId ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-100" : "bg-white/[0.03] border-white/10 text-[#a0aec0] hover:bg-white/[0.06]"}`}>
                  <button onClick={() => applyPreset(p)} className="font-medium" title="应用此预设">{p.name}</button>
                  <button onClick={() => deletePreset(p.id)} className="opacity-0 group-hover/preset:opacity-60 hover:opacity-100 transition" title="删除预设">×</button>
                </span>
              ))}
              <button onClick={saveCurrentPreset} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-white/15 text-[10px] text-[#7a8497] hover:text-white hover:border-white/30 transition" title="把当前赛道 + 筛选条件存为预设">
                <Plus size={10} /> 存为预设
              </button>
            </div>
          </div>
        );
      })()}

      {/* 三栏 grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[220px_1fr_320px] gap-3 overflow-hidden min-h-0">

        {/* ─── 左栏：超级赛道 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <Layers size={12} className="text-cyan-300" />
            <span className="text-[11px] font-semibold text-white">超级赛道</span>
            <span className="text-[9px] text-[#a0aec0] ml-auto">{selectedTrends.length} 选中</span>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1.5">
            {displayedSupertrends.map((s) => {
              const active = selectedTrends.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleTrend(s.id)}
                  className={`w-full flex items-start gap-2 px-2 py-1.5 rounded text-left transition border ${
                    active
                      ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-100"
                      : "bg-white/[0.02] border-white/8 text-[#d0d7e2] hover:bg-white/5"
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    <span className={`inline-block w-3 h-3 rounded-sm border ${active ? "bg-cyan-400 border-cyan-300" : "border-white/30"}`} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[11px] font-medium block">{s.name}</span>
                    <span className="text-[9px] text-[#7a8497] block truncate">{s.note || ""}</span>
                  </span>
                  {s.source === "user" && (
                    <span className="text-[9px] text-violet-300/80">user</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="px-3 py-2 border-t border-white/8 flex items-center gap-2">
            <button
              onClick={() => setAddTrendOpen(true)}
              disabled={isDemoMode}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={isDemoMode ? "需后端 + KV 才能添加" : "添加自定义赛道（含 AI 关键词生成）"}
            >
              <Plus size={10} /> 自定义赛道
            </button>
            <span className="text-[9px] text-[#7a8497] flex-1 truncate">
              内置 4 个 · 关键词在 sector_mapping
            </span>
          </div>
        </div>

        {/* ─── 中栏：候选个股 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2 flex-wrap">
            <Filter size={12} className="text-indigo-300" />
            <span className="text-[11px] font-semibold text-white">候选个股</span>
            <span
              className="text-[9px] text-[#a0aec0]"
              title={`US: ${marketBreakdown.US} / HK: ${marketBreakdown.HK} / CN: ${marketBreakdown.CN}${marketBreakdown.other > 0 ? ` / 其他: ${marketBreakdown.other}` : ""}`}
            >
              {filteredCandidates.length} / {candidates.length}
              {filteredCandidates.length > 0 && (
                <span className="ml-1 text-[#5a6477]">
                  {[
                    marketBreakdown.US > 0 && `US ${marketBreakdown.US}`,
                    marketBreakdown.HK > 0 && `HK ${marketBreakdown.HK}`,
                    marketBreakdown.CN > 0 && `CN ${marketBreakdown.CN}`,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            {sortKey && (
              <button
                onClick={clearSort}
                className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/25 transition flex items-center gap-0.5"
                title="清除排序 — 回到默认（市值升序 + AI 排序覆盖）"
              >
                <X size={9} /> 排序：{sortKey}{sortDir === "desc" ? "↓" : "↑"}
              </button>
            )}

            <div className="flex-1" />

            {/* 搜索 */}
            <div className="relative flex items-center">
              <Search size={10} className="absolute left-1.5 text-[#a0aec0]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索 ticker / 名称"
                className="pl-5 pr-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {/* AI 一键：批量 match top 5 + rank top 10（并发）— 替代两步点击 */}
            <button
              onClick={handleAiPipeline}
              disabled={
                aiPipelineState.loading || aiRankingState.loading || isDemoMode ||
                selectedTrends.length === 0 || candidates.length === 0
              }
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                isDemoMode ? "需要 DEEPSEEK_API_KEY" :
                `AI 一键：并发跑 top ${AI_PIPELINE_MATCH_TOP} 校验 + top 10 排序（${selectedTrends.length > 1 ? '排序用第一个勾选赛道' : '当前赛道'}）`
              }
            >
              {aiPipelineState.loading ? (
                <><Loader size={10} className="animate-spin" /> 一键 {aiPipelineState.matched}/{aiPipelineState.total}</>
              ) : (
                <><Sparkles size={10} /> AI 一键</>
              )}
            </button>

            {/* AI 排序：按 LLM 给的卡位 / 护城河打分（strategy-aware），最多 10 只候选 */}
            <button
              onClick={handleAiRank}
              disabled={
                aiRankingState.loading || isDemoMode ||
                selectedTrends.length === 0 || candidates.length === 0
              }
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                isDemoMode ? "需要 DEEPSEEK_API_KEY" :
                selectedTrends.length > 1 ? "用第一个勾选的赛道排序" :
                activeStrategy === "value"
                  ? "对 top 10 候选用 LLM 打护城河 / 价值确信度 1-5 分（价值型）"
                  : "对 top 10 候选用 LLM 打卡位独特性 1-5 分（成长型）"
              }
            >
              {aiRankingState.loading ? (
                <><Loader size={10} className="animate-spin" /> 排序中</>
              ) : (
                <><Sparkles size={10} /> AI 排序</>
              )}
            </button>

            {/* 筛选条件：成长型 = 市值上限；价值型 = 5 维财务 */}
            {activeStrategy === "growth" ? (
              <label className="flex items-center gap-1 text-[10px] text-[#a0aec0]" title="市值上限（B）— 成长型偏小市值卡位">
                max
                <input
                  type="number"
                  value={maxMcapInput}
                  onChange={(e) => setMaxMcapInput(Number(e.target.value) || 0)}
                  className="w-12 px-1 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none"
                />
                B
              </label>
            ) : (
              <ValueFilters value={valueFilters} onChange={setValueFilters} />
            )}

            {/* ETF toggle */}
            <label className="flex items-center gap-1 text-[10px] text-[#a0aec0] cursor-pointer">
              <input
                type="checkbox"
                checked={includeETF}
                onChange={(e) => setIncludeETF(e.target.checked)}
                className="accent-indigo-500"
              />
              ETF
            </label>

            {/* 精严 toggle */}
            <label
              className="flex items-center gap-1 text-[10px] text-[#a0aec0] cursor-pointer"
              title="精严：仅匹配明确赛道关键词（光通信/硅光/AI/HBM）。宽泛（默认）：扩展到通讯设备/应用软件等大池，覆盖广但有噪音。"
            >
              <input
                type="checkbox"
                checked={precise}
                onChange={(e) => setPrecise(e.target.checked)}
                className="accent-amber-400"
              />
              <span className={precise ? "text-amber-300 font-medium" : ""}>精严</span>
            </label>

            {/* 市场切换 — active 用 indigo 实色 + bold + 圆点；inactive 灰文字带删除线
                视觉差异加强：避免用户分不清"已选"和"未选"（之前 bg-indigo-500/20 vs
                bg-white/5 透明度差异太小，反复有用户报告"取消了 US 但 US 票还在"的 bug） */}
            <div className="flex items-center gap-1">
              {["US", "HK", "CN"].map((m) => {
                const on = markets.includes(m);
                const isOnlyOne = on && markets.length === 1;
                return (
                  <button
                    key={m}
                    onClick={() => {
                      // 保护：至少保留 1 个市场。点击唯一选中的市场会切换到"全选"
                      // （否则 markets=[] 永远 0 结果，对用户没意义）
                      if (isOnlyOne) {
                        setMarkets(["US", "HK", "CN"]);
                      } else {
                        setMarkets((cur) => on ? cur.filter((x) => x !== m) : [...cur, m]);
                      }
                    }}
                    title={isOnlyOne ? "至少保留 1 个市场 — 点击恢复全选" : (on ? `点击取消 ${m}` : `点击启用 ${m}`)}
                    className={`px-2 py-0.5 text-[9px] font-mono rounded border transition flex items-center gap-1 ${
                      on
                        ? "bg-indigo-500/40 border-indigo-400 text-white font-semibold shadow-sm shadow-indigo-500/20"
                        : "bg-transparent border-white/15 text-[#5a6477] line-through"
                    }`}
                  >
                    {on && <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block" />}
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* v5: AI Pipeline 结果 banner — pipeline 完成后展示总览，给用户「下一步看 top 3」的引导 */}
          {!aiPipelineState.loading && aiPipelineState.matched > 0 && (
            <div className="mx-3 mt-2 mb-1 px-3 py-2 rounded-lg border border-violet-400/35 bg-gradient-to-r from-violet-500/12 via-violet-500/5 to-transparent flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-violet-500/20 border border-violet-400/35 flex items-center justify-center shrink-0">
                <Sparkles size={13} className="text-violet-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11.5px] font-semibold text-white">AI Pipeline 已完成</div>
                <div className="text-[10px] text-[#a0aec0] mt-0.5">
                  校验 top <span className="font-mono text-white/85">{aiPipelineState.total}</span> · 命中 <span className="font-mono text-violet-200">{aiPipelineState.matched}</span> · 前 3 名已紫色高亮
                </div>
              </div>
              <button
                onClick={handleAiPipeline}
                disabled={aiPipelineState.loading || aiRankingState.loading || isDemoMode || selectedTrends.length === 0 || candidates.length === 0}
                className="text-[10px] px-2 py-1 rounded bg-violet-500/20 border border-violet-400/35 text-violet-200 hover:bg-violet-500/30 transition disabled:opacity-40"
                title="重新运行 AI Pipeline"
              >
                重新运行 →
              </button>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {selectedTrends.length === 0 && (
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                ← 在左侧勾选一个或多个超级赛道开始筛选
              </div>
            )}
            {selectedTrends.length > 0 && loadingCands && (
              <div className="h-full flex items-center justify-center gap-2 text-[11px] text-[#a0aec0]">
                <Loader size={12} className="animate-spin" /> 正在筛选 ...
              </div>
            )}
            {errorCands && (
              <div className="m-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-300/90 flex items-start gap-1">
                <AlertCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                <span>{errorCands}</span>
              </div>
            )}
            {aiRankingState.error && (
              <div className="m-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[10px] text-amber-300/90 flex items-start gap-1">
                <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
                <span>AI 排序：{aiRankingState.error}</span>
              </div>
            )}
            {/* 加入股性检测的成功 / 失败 toast */}
            {geneToast && (
              <div className={`m-3 p-2 rounded text-[10px] flex items-start gap-2 ${
                geneToast.ok
                  ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-100"
                  : "bg-red-500/10 border border-red-500/30 text-red-300/90"
              }`}>
                {geneToast.ok
                  ? <Activity size={11} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <AlertCircle size={11} className="text-red-400 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <span className="font-mono text-white">{geneToast.ticker}</span>
                  <span className="ml-1">→ 股性检测：{geneToast.msg}</span>
                  {geneToast.ok && (
                    <span className="ml-1 text-[9px] text-emerald-300/70">（去"股性检测"tab 查看评分）</span>
                  )}
                </div>
                <button onClick={() => setGeneToast(null)}
                  className="text-[#7a8497] hover:text-white p-0.5 rounded hover:bg-white/5"><X size={10} /></button>
              </div>
            )}
            {aiMatchResult && (
              // v5: 套 .lead-paragraph（紫色 3px 左边线 + 渐变 bg）— AI 赛道校验从普通卡升级为编辑式 lead paragraph
              // 与 AIStockSummaryCard / BacktestNarrationCard / ScoreExplainCard 视觉对齐
              <div className="m-3 lead-paragraph relative">
                {/* eyebrow row：AI 标识 + ticker + 关闭按钮 */}
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={11} className="text-violet-400 shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-300/90">AI 赛道校验</span>
                  <span className="font-mono text-[10px] text-white">{aiMatchResult.ticker}</span>
                  {aiMatchResult.name && (
                    <span className="text-[10px] text-[#a0aec0] truncate">{aiMatchResult.name}</span>
                  )}
                  {aiMatchResult.cached && <span className="text-[9px] text-amber-300/70">cached</span>}
                  <button
                    onClick={() => setAiMatchResult(null)}
                    className="ml-auto text-[#7a8497] hover:text-white p-0.5 rounded hover:bg-white/5 transition"
                    title="关闭"
                  >
                    <X size={11} />
                  </button>
                </div>
                {/* body */}
                {aiMatchResult.error ? (
                  <div className="text-[11px] text-amber-300/90">{aiMatchResult.error}</div>
                ) : aiMatchResult.matched && aiMatchResult.matched.length > 0 ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1 mb-2">
                      <span className="text-[10px] text-[#a0aec0]">AI 认为属于：</span>
                      {aiMatchResult.matched.map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-px rounded bg-violet-500/20 text-violet-200 border border-violet-500/40">
                          {trendName(t)}
                        </span>
                      ))}
                      <span className="text-[10px] text-[#7a8497] ml-1">
                        置信度 {(aiMatchResult.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    {aiMatchResult.reason && (
                      <p className="lead-paragraph__body" style={{ fontSize: 12 }}>{aiMatchResult.reason}</p>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-amber-300/90">
                    AI 不认为这只票属于已勾选的赛道
                    {aiMatchResult.confidence != null && (
                      <span className="text-[10px] text-[#7a8497] ml-2">
                        置信度 {(aiMatchResult.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                    {aiMatchResult.reason && (
                      <p className="lead-paragraph__body mt-1.5" style={{ fontSize: 12 }}>{aiMatchResult.reason}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {!loadingCands && !errorCands && selectedTrends.length > 0 && filteredCandidates.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-[11px] text-[#7a8497] p-4 text-center gap-3">
                <div>没有匹配的候选股</div>
                <div className="text-[10px] text-[#5a6477]">点击下方一键放宽筛选条件：</div>
                <div className="flex flex-wrap gap-1.5 justify-center max-w-[320px]">
                  {activeStrategy === "growth" && maxMcapInput > 0 && maxMcapInput < 5000 && (
                    <button
                      onClick={() => setMaxMcapInput(5000)}
                      className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/25 transition"
                      title="把市值上限放到 5000B（含全部大市值）"
                    >
                      市值放宽到 5000B
                    </button>
                  )}
                  {precise && (
                    <button
                      onClick={() => setPrecise(false)}
                      className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/25 transition"
                      title="关闭精严模式（用宽泛关键词扩大候选池）"
                    >
                      关闭精严模式
                    </button>
                  )}
                  {!includeETF && (
                    <button
                      onClick={() => setIncludeETF(true)}
                      className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/25 transition"
                      title="包含 ETF（如 SOXX、SMH 等行业 ETF）"
                    >
                      包含 ETF
                    </button>
                  )}
                  {activeStrategy === "value" && Object.values(valueFilters).some((v) => v != null) && (
                    <button
                      onClick={() => setValueFilters(DEFAULT_VALUE_FILTERS)}
                      className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/25 transition"
                      title="清空 5 维筛选保留赛道"
                    >
                      清空 5 维筛选
                    </button>
                  )}
                  {markets.length < 3 && (
                    <button
                      onClick={() => setMarkets(["US", "HK", "CN"])}
                      className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/25 transition"
                      title="启用全部 3 个市场（US / HK / CN）"
                    >
                      启用全部市场
                    </button>
                  )}
                </div>
              </div>
            )}
            {!loadingCands && filteredCandidates.length > 0 && (
              <table className="w-full text-[11px]">
                <thead className="text-[9px] text-[#7a8497] sticky top-0 bg-[var(--surface)]/95 backdrop-blur">
                  <tr>
                    <th className="text-left px-2 py-1.5">Ticker</th>
                    <th className="text-left px-2 py-1.5">名称</th>
                    <th className="text-left px-2 py-1.5">市场</th>
                    <th className="text-left px-2 py-1.5">行业</th>
                    <SortHeader
                      label="市值"
                      sortKey="marketCap"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onToggle={toggleSort}
                    />
                    {/* 价值型额外列：PE / PB / 股息 / ROE */}
                    {activeStrategy === "value" && (
                      <>
                        <SortHeader label="PE" sortKey="pe" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
                        <SortHeader label="PB" sortKey="pb" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
                        <SortHeader label="股息" sortKey="dividend_yield" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} title="按股息率排序" />
                        <SortHeader label="ROE" sortKey="roe" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
                      </>
                    )}
                    {Object.keys(aiRanking).length > 0 && (
                      <th
                        className="text-center px-2 py-1.5 text-violet-300"
                        title={activeStrategy === "value" ? "护城河强度 / 价值确信度" : "卡位独特性"}
                      >
                        AI {activeStrategy === "value" ? "护城河" : "卡位"}
                      </th>
                    )}
                    {Object.keys(aiMatchMap).length > 0 && (
                      <th
                        className="text-center px-2 py-1.5 text-amber-300"
                        title="AI 一键校验：是否真的属于勾选的赛道（绿=是 / 红=否）"
                      >AI 校验</th>
                    )}
                    <th className="text-left px-2 py-1.5">命中</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((c, idx) => {
                    const ai = aiRanking[c.ticker];
                    // v5: Top 3（已 AI 排序时）紫色高亮，引导用户优先关注
                    const isTop3 = idx < 3 && Object.keys(aiRanking).length > 0 && ai != null;
                    return (
                      <tr key={c.ticker} className={`border-t border-white/5 transition ${
                        idx === cursorIdx ? "bg-indigo-500/[0.12] ring-1 ring-inset ring-indigo-400/40"
                        : isTop3 ? "bg-violet-500/[0.06] hover:bg-violet-500/[0.10]" : "hover:bg-white/[0.04]"
                      }`}>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-white">
                          <div className="flex items-center gap-1">
                            {isTop3 && (
                              <span
                                className="text-[9px] font-mono font-bold text-violet-300 w-3.5 text-center shrink-0"
                                title={`AI 已审过 top 3 之 #${idx + 1}`}
                              >
                                {idx + 1}
                              </span>
                            )}
                            <button
                              onClick={() => setDetailItem(c)}
                              className="hover:text-cyan-300 hover:underline focus:outline-none focus:text-cyan-300"
                              title="点击查看详情"
                            >
                              {c.ticker}
                            </button>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-[#d0d7e2] truncate max-w-[140px]" title={c.name}>{c.name}</td>
                        <td className="px-2 py-1.5 text-[9px] text-[#a0aec0]">{c.market}{c.exchange && `·${c.exchange}`}</td>
                        <td className="px-2 py-1.5 text-[9px] text-[#a0aec0] truncate max-w-[100px]" title={c.sector || c.industry}>{c.sector || c.industry || "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtMcap(c.marketCap)}</td>
                        {/* 价值型额外列 */}
                        {activeStrategy === "value" && (
                          <>
                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtNum(c.pe, 1)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtNum(c.pb, 2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-emerald-300">{fmtPct(c.dividend_yield)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtPct(c.roe)}</td>
                          </>
                        )}
                        {Object.keys(aiRanking).length > 0 && (
                          <td className="px-2 py-1.5 text-center" title={ai?.reason || "未排序"}>
                            {ai ? (
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                ai.moat_score >= 4 ? "bg-violet-500/20 text-violet-200 border border-violet-500/40" :
                                ai.moat_score === 3 ? "bg-white/5 text-[#a0aec0] border border-white/15" :
                                "bg-white/[0.02] text-[#7a8497] border border-white/10"
                              }`}>{ai.moat_score}</span>
                            ) : (
                              <span className="text-[9px] text-[#5a6477]">—</span>
                            )}
                          </td>
                        )}
                        {Object.keys(aiMatchMap).length > 0 && (() => {
                          const m = aiMatchMap[c.ticker];
                          const tip = !m ? "未校验"
                            : m.error ? `错误：${m.error}`
                            : (m.matched?.length > 0
                                ? `命中：${m.matched.map(trendName).join(", ")}（置信度 ${((m.confidence || 0) * 100).toFixed(0)}%）`
                                : `未命中所选赛道（置信度 ${((m.confidence || 0) * 100).toFixed(0)}%）`);
                          return (
                            <td className="px-2 py-1.5 text-center" title={tip}>
                              {!m ? (
                                <span className="text-[9px] text-[#5a6477]">—</span>
                              ) : m.error ? (
                                <span className="text-[10px] text-red-300/80" title={m.error}>!</span>
                              ) : m.matched?.length > 0 ? (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">✓</span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-500/15 text-red-300 border border-red-500/40">✗</span>
                              )}
                            </td>
                          );
                        })()}
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-0.5">
                            {(c.matched_supertrends || []).map((t) => {
                              const reason = formatMatchReason(c.match_reasons, t);
                              const tip = reason
                                ? `${trendName(t)}\n\n命中原因：${reason}`
                                : trendName(t);
                              return (
                                <span
                                  key={t}
                                  title={tip}
                                  className="text-[9px] px-1 py-px rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 cursor-help"
                                >
                                  {trendName(t)}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleAiMatch(c)}
                              disabled={aiMatchLoading === c.ticker || isDemoMode}
                              className="flex items-center justify-center w-5 h-5 text-[9px] rounded bg-violet-500/10 hover:bg-violet-500/25 text-violet-300 border border-violet-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                              title={
                                isDemoMode ? "需要 DEEPSEEK_API_KEY" :
                                "AI 校验：让 LLM 判断这只票是否真属于已勾选赛道"
                              }
                            >
                              {aiMatchLoading === c.ticker ? (
                                <Loader size={9} className="animate-spin" />
                              ) : (
                                <Sparkles size={9} />
                              )}
                            </button>
                            <button
                              onClick={() => openAdd(c)}
                              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 transition"
                              title="加入 10x 猎手观察列表（带 thesis / 卡位 / 目标价）"
                            >
                              <Plus size={9} /> 观察
                            </button>
                            <button
                              onClick={() => handleAddToGene(c)}
                              disabled={geneAdding === c.ticker}
                              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                              title="加入股性检测：自动跑 4 引擎评分（趋势/价值/短期/风险）+ 带赛道标签"
                            >
                              {geneAdding === c.ticker
                                ? <Loader size={9} className="animate-spin" />
                                : <Activity size={9} />}
                              股性
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {/* v5.3：结果计数 + 被过滤透明化 + J/K 键盘流 hint */}
            {!loadingCands && candidates.length > 0 && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 mt-1 border-t border-white/5 text-[9px] text-[#7a8497]">
                <span className="font-mono">
                  显示 {filteredCandidates.length}/{candidates.length}
                  {candidates.length - filteredCandidates.length > 0 && (
                    <span className="text-amber-300/80"> · {candidates.length - filteredCandidates.length} 项被过滤</span>
                  )}
                </span>
                <span className="hidden md:inline-flex items-center gap-1.5">
                  <span><kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/12 font-mono text-[8px]">J</kbd>/<kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/12 font-mono text-[8px]">K</kbd> 移动</span>
                  <span className="opacity-40">·</span>
                  <span><kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/12 font-mono text-[8px]">↵</kbd> 详情</span>
                  <span className="opacity-40">·</span>
                  <span><kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/12 font-mono text-[8px]">+</kbd> 观察</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ─── 右栏：观察列表 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <Star size={12} className="text-amber-400" />
            <span className="text-[11px] font-semibold text-white">观察列表</span>
            <span className="text-[9px] text-[#a0aec0]">{items.length}</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={async () => {
                  const next = !showArchived;
                  setShowArchived(next);
                  await reloadWatchlist({ showArchived: next });
                }}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded border transition ${
                  showArchived
                    ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                    : "bg-white/5 text-[#a0aec0] border-white/15 hover:bg-white/10"
                }`}
                title={showArchived ? "当前显示含归档；点击隐藏" : "点击显示归档项"}
              >
                <Archive size={9} />
                {showArchived ? "含归档" : "显示归档"}
              </button>
              <button
                onClick={handleExport}
                disabled={isDemoMode}
                aria-label="导出观察列表 JSON"
                className="flex items-center justify-center w-5 h-5 text-[#a0aec0] hover:text-white hover:bg-white/10 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="导出 JSON 备份（含所有观察项 + 自定义赛道）"
              >
                <Download size={11} />
              </button>
              <button
                onClick={handleExportCsv}
                disabled={isDemoMode}
                className="flex items-center justify-center px-1 h-5 text-[9px] font-mono text-[#a0aec0] hover:text-white hover:bg-white/10 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="导出 CSV（Excel 友好，含 BOM 中文不乱码）"
              >
                CSV
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={isDemoMode || importLoading}
                className="flex items-center justify-center w-5 h-5 text-[#a0aec0] hover:text-white hover:bg-white/10 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="从备份文件恢复（merge / replace 可选）"
              >
                {importLoading ? <Loader size={11} className="animate-spin" /> : <Upload size={11} />}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  handleImportFile(e.target.files?.[0]);
                  e.target.value = "";   // 允许重选同一文件
                }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {items.length === 0 && (
              <EmptyState
                className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center"
                message='还没有观察项 — 从中间候选列表点击 "观察" 加入'
              />
            )}
            {items.map((it) => (
              <WatchlistCard
                key={it.ticker}
                item={it}
                trendName={trendName}
                currentPrice={pricesByTicker[it.ticker]}
                onEdit={() => openEdit(it)}
                onDelete={() => handleDelete(it.ticker)}
                onToggleArchive={() => handleToggleArchive(it.ticker, !it.archived)}
                onMarkReviewed={() => handleMarkReviewed(it.ticker)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 编辑模态框 */}
      <TenxItemEditor
        open={editorOpen}
        item={editing}
        candidate={pendingCandidate}
        supertrends={supertrends}
        currentPrice={pricesByTicker[editing?.ticker || pendingCandidate?.ticker]}
        onClose={() => { setEditorOpen(false); setEditing(null); setPendingCandidate(null); }}
      />

      {/* 候选股详情面板 — 点 ticker 弹出 */}
      <StockDetailPanel
        open={!!detailItem}
        item={detailItem}
        supertrends={supertrends}
        onClose={() => setDetailItem(null)}
        onAddObservation={openAdd}
        onSaved={handleSaved}
      />

      {/* 添加赛道对话框 */}
      <AddSupertrendDialog
        open={addTrendOpen}
        defaultStrategy={activeStrategy}   // 跟随当前 tab — value tab 加自定义赛道默认 strategy=value
        onClose={() => setAddTrendOpen(false)}
        onSaved={async () => {
          setAddTrendOpen(false);
          await reloadWatchlist();   // 刷新 supertrends 列表，新赛道立刻可勾选
        }}
      />
    </div>
  );
}
