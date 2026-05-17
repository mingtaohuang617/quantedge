// ─────────────────────────────────────────────────────────────
// Screener10x — 10x 猎手主页面（赛道筛选 → 候选个股 → 观察列表）
// ─────────────────────────────────────────────────────────────
//
// 三段式工作流：
//   1) 左栏：勾选超级赛道（AI 算力 / 半导体 / 光通信 / 算力中心）
//   2) 中栏：根据勾选 + 市值上限筛出候选股，按市值升序（小市值优先）
//   3) 右栏：用户加入观察的标的，可编辑 thesis / 卡位等级 / 目标价 / 止损
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
  Target, Layers, Plus, Edit2, Trash2, RefreshCw, Loader, AlertCircle,
  Filter, Search, Database, Star, ChevronRight, Globe, Sparkles, X,
  Archive, ArchiveRestore,
  Download, Upload,
} from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import TenxItemEditor from "../components/TenxItemEditor.jsx";
import AddSupertrendDialog from "../components/AddSupertrendDialog.jsx";

const STRATEGY_LABEL = { growth: "成长型", value: "价值型" };

// production fallback：vercel 部署没有 FastAPI backend 时，至少能看到 7 个内置赛道。
// 数据须与 backend/sector_mapping.py SUPERTRENDS 保持一致；筛选/观察操作仍需 self-hosted backend。
const BUILTIN_SUPERTRENDS_FALLBACK = [
  { id: "ai_compute", name: "AI 算力", note: "AI 软硬件 / 加速器 / HBM / AI 应用", source: "builtin", strategy: "growth" },
  { id: "semi", name: "半导体", note: "设计、制造、设备、材料、存储", source: "builtin", strategy: "growth" },
  { id: "optical", name: "光通信", note: "光模块、硅光、CPO、激光器、光纤", source: "builtin", strategy: "growth" },
  { id: "datacenter", name: "算力中心", note: "数据中心 / 电力 / 公共事业", source: "builtin", strategy: "growth" },
  { id: "value_div", name: "高股息蓝筹", note: "公用事业 / 银行龙头 / 能源 / 电信（股息率 > 4%）", source: "builtin", strategy: "value" },
  { id: "value_cyclical", name: "周期价值", note: "银行 / 保险 / 化工 / 钢铁（低 PB 入场）", source: "builtin", strategy: "value" },
  { id: "value_consumer", name: "消费稳健", note: "食品饮料 / 必需消费（穿越周期 ROE）", source: "builtin", strategy: "value" },
];

// 价值型 5 维默认值（None = 不启用筛选）
const DEFAULT_VALUE_FILTERS = {
  max_pe: 25,
  max_pb: null,
  min_roe: null,
  min_dividend_yield: null,
  max_debt_to_equity: null,
};

function fmtMcap(mc) {
  if (mc == null) return "—";
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(2)}T`;
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `${(mc / 1e6).toFixed(0)}M`;
  return `${mc.toFixed(0)}`;
}

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

function fmtNum(v, prec = 1) {
  return typeof v === "number" ? v.toFixed(prec) : "—";
}

function fmtPct(v) {
  return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—";
}

/** 价值型 5 维过滤 input 组件（中栏 toolbar 内）。
 * value: { max_pe, max_pb, min_roe, min_dividend_yield, max_debt_to_equity } 都可 null
 */
function ValueFilters({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v === "" ? null : v });
  // 通用 numeric input，支持空值清除
  const Input = ({ k, placeholder, title, step }) => (
    <input
      type="number"
      step={step || "0.1"}
      value={value[k] ?? ""}
      placeholder={placeholder}
      title={title}
      onChange={(e) => set(k, e.target.value === "" ? null : Number(e.target.value))}
      className="w-12 px-1 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none placeholder:text-[#5a6477]"
    />
  );
  return (
    <div className="flex items-center gap-1 text-[10px] text-[#a0aec0]">
      <span title="PE 上限（< 0 视为亏损一律剔除）">PE≤</span>
      <Input k="max_pe" placeholder="25" title="PE 上限" />
      <span title="PB 上限">PB≤</span>
      <Input k="max_pb" placeholder="—" title="PB 上限" />
      <span title="ROE 下限（小数；输入 0.15 = 15%）">ROE≥</span>
      <Input k="min_roe" placeholder="—" title="ROE 下限（0.15 = 15%）" step="0.01" />
      <span title="股息率下限（小数；输入 0.04 = 4%）">息≥</span>
      <Input k="min_dividend_yield" placeholder="—" title="股息率下限（0.04 = 4%）" step="0.005" />
      <span title="资产负债率上限（A 股）/ 负债权益比上限（美/港股）">D/E≤</span>
      <Input k="max_debt_to_equity" placeholder="—" title="债务比例上限" />
    </div>
  );
}

export default function Screener10x() {
  // 数据状态
  const [supertrends, setSupertrends] = useState([]);
  const [items, setItems] = useState([]);                   // watchlist
  const [universeStats, setUniverseStats] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);      // production 后端不可用 → fallback
  // 策略切换（成长型 / 价值型 tab）
  const [activeStrategy, setActiveStrategy] = useState("growth"); // "growth" | "value"
  // 筛选条件
  const [selectedTrends, setSelectedTrends] = useState([]); // string[]
  const [maxMcapInput, setMaxMcapInput] = useState(50);     // 单位 B（input 即时绑定）
  const [maxMcapB, setMaxMcapB] = useState(50);             // 300ms debounced，喂 runScreen
  const [includeETF, setIncludeETF] = useState(false);
  const [precise, setPrecise] = useState(false);    // 精严模式：仅核心赛道关键词
  const [markets, setMarkets] = useState(["US", "HK", "CN"]);
  const [search, setSearch] = useState("");
  // 价值型 5 维筛选（仅 activeStrategy="value" 时启用）
  const [valueFilters, setValueFilters] = useState(DEFAULT_VALUE_FILTERS);
  // 候选 + loading
  const [candidates, setCandidates] = useState([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [errorCands, setErrorCands] = useState(null);
  // AI 排序：{ ticker: { moat_score, reason } }
  const [aiRanking, setAiRanking] = useState({});
  const [aiRankingState, setAiRankingState] = useState({ loading: false, error: null });
  // AI 赛道校验：最近一次结果
  const [aiMatchResult, setAiMatchResult] = useState(null); // { ticker, matched, reason, confidence, error? }
  const [aiMatchLoading, setAiMatchLoading] = useState(null); // 当前 loading 的 ticker
  // 编辑器
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);             // null = 新增
  const [pendingCandidate, setPendingCandidate] = useState(null);
  // 添加赛道对话框
  const [addTrendOpen, setAddTrendOpen] = useState(false);
  // 归档显示开关
  const [showArchived, setShowArchived] = useState(false);
  // 导入/导出 loading
  const [importLoading, setImportLoading] = useState(false);
  const importInputRef = useRef(null);

  // ── 拉初始数据（watchlist + universe stats）─────────────
  const reloadWatchlist = useCallback(async (opts = {}) => {
    const archivedFlag = opts.showArchived ?? showArchived;
    const url = archivedFlag ? "/watchlist/10x?include_archived=true" : "/watchlist/10x";
    const json = await apiFetch(url);
    if (json) {
      setSupertrends(json.supertrends || []);
      setItems(json.items || []);
      setIsDemoMode(false);
    } else {
      // backend 不可用（如 production vercel SPA）：退回内置赛道，让 UI 可见；
      // 筛选 / 添加观察会失败，由各路径的 errorCands 反馈
      setSupertrends(BUILTIN_SUPERTRENDS_FALLBACK);
      setItems([]);
      setIsDemoMode(true);
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

  // ── mcap input debounce（300ms）─────────────────────────
  // 用户在 input 里改数字时实时更新 maxMcapInput；停手 300ms 后才更新 maxMcapB，
  // 避免每个数字都触发后端 screen
  useEffect(() => {
    const t = setTimeout(() => setMaxMcapB(maxMcapInput), 300);
    return () => clearTimeout(t);
  }, [maxMcapInput]);

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
        limit: 200,
        precise,
      };
      if (activeStrategy === "growth") {
        // 成长型：保留 max_market_cap_b（小市值卡位）
        body.max_market_cap_b = maxMcapB > 0 ? maxMcapB : null;
      } else {
        // 价值型：5 维财务过滤（None 字段不传，避免误启用）
        for (const [k, v] of Object.entries(valueFilters)) {
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
  }, [selectedTrends, markets, maxMcapB, includeETF, precise, activeStrategy, valueFilters]);

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
      // 后端不可用 — 跳过 screen 调用，给一段友好提示替代"后端无响应"
      setCandidates([]);
      setErrorCands("演示模式：候选筛选需要后端 API。请 self-host 后端（参见 README）后再试。");
      return;
    }
    runScreen();
  }, [runScreen, selectedTrends, isDemoMode]);

  // ── 候选搜索过滤（前端） ─────────────────────────────
  const filteredCandidates = useMemo(() => {
    let cs = candidates;
    if (search) {
      const q = search.toLowerCase();
      cs = cs.filter((c) =>
        c.ticker.toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q)
      );
    }
    // AI 排序：拿到 moat_score 的标的优先，按分数降序；其余保持原顺序在后
    if (Object.keys(aiRanking).length > 0) {
      const ranked = cs.filter((c) => aiRanking[c.ticker] != null);
      const unranked = cs.filter((c) => aiRanking[c.ticker] == null);
      ranked.sort((a, b) =>
        (aiRanking[b.ticker]?.moat_score || 0) - (aiRanking[a.ticker]?.moat_score || 0)
      );
      cs = [...ranked, ...unranked];
    }
    return cs;
  }, [candidates, search, aiRanking]);

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
          {universeStats && (
            <span className="flex items-center gap-1">
              <Database size={11} /> US {universeStats.US?.count || 0} · HK {universeStats.HK?.count || 0} · CN {universeStats.CN?.count || 0}
            </span>
          )}
          <button
            onClick={() => { reloadWatchlist(); reloadUniverseStats(); runScreen(); }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
            title="刷新"
          >
            <RefreshCw size={10} /> 刷新
          </button>
        </div>
      </div>

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
                    <span className="text-[8px] text-violet-300/80">user</span>
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
            <span className="text-[9px] text-[#a0aec0]">{filteredCandidates.length} / {candidates.length}</span>

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

            {/* AI 排序：按 LLM 给的卡位独特性打分，最多 10 只候选 */}
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
                "对 top 10 候选用 LLM 打卡位独特性 1-5 分"
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

            {/* 市场切换 */}
            <div className="flex items-center gap-1">
              {["US", "HK", "CN"].map((m) => {
                const on = markets.includes(m);
                return (
                  <button
                    key={m}
                    onClick={() => setMarkets((cur) => on ? cur.filter((x) => x !== m) : [...cur, m])}
                    className={`px-1.5 py-0.5 text-[9px] font-mono rounded border transition ${
                      on
                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
                        : "bg-white/5 border-white/10 text-[#7a8497]"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

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
            {aiMatchResult && (
              <div className="m-3 p-2 bg-violet-500/10 border border-violet-500/30 rounded text-[10px] text-violet-100/90 flex items-start gap-2">
                <Sparkles size={11} className="text-violet-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="font-mono text-[10px] text-white">{aiMatchResult.ticker}</span>
                    {aiMatchResult.name && (
                      <span className="text-[9px] text-[#a0aec0] truncate">{aiMatchResult.name}</span>
                    )}
                    {aiMatchResult.cached && <span className="text-[8px] text-amber-300/70">cached</span>}
                  </div>
                  {aiMatchResult.error ? (
                    <div className="text-amber-300/90">{aiMatchResult.error}</div>
                  ) : aiMatchResult.matched && aiMatchResult.matched.length > 0 ? (
                    <>
                      <div className="flex flex-wrap items-center gap-1 mb-1">
                        <span className="text-[9px] text-[#a0aec0]">AI 认为属于：</span>
                        {aiMatchResult.matched.map((t) => (
                          <span key={t} className="text-[9px] px-1 py-px rounded bg-violet-500/20 text-violet-200 border border-violet-500/40">
                            {trendName(t)}
                          </span>
                        ))}
                        <span className="text-[8px] text-[#7a8497] ml-1">
                          置信度 {(aiMatchResult.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      {aiMatchResult.reason && (
                        <div className="text-[10px] text-[#d0d7e2]/85 leading-relaxed">{aiMatchResult.reason}</div>
                      )}
                    </>
                  ) : (
                    <div className="text-amber-300/90">
                      AI 不认为这只票属于已勾选的赛道
                      {aiMatchResult.confidence != null && (
                        <span className="text-[8px] text-[#7a8497] ml-2">
                          置信度 {(aiMatchResult.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                      {aiMatchResult.reason && (
                        <div className="text-[10px] text-[#d0d7e2]/85 leading-relaxed mt-1">{aiMatchResult.reason}</div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setAiMatchResult(null)}
                  className="text-[#7a8497] hover:text-white p-0.5 rounded hover:bg-white/5 transition"
                  title="关闭"
                >
                  <X size={10} />
                </button>
              </div>
            )}
            {!loadingCands && !errorCands && selectedTrends.length > 0 && filteredCandidates.length === 0 && (
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                没有匹配的候选股 — 尝试放宽市值上限、勾选更多赛道、{precise ? "关闭精严模式、" : ""}或启用 ETF
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
                    <th className="text-right px-2 py-1.5">市值</th>
                    {/* 价值型额外列：PE / PB / 股息 / ROE */}
                    {activeStrategy === "value" && (
                      <>
                        <th className="text-right px-2 py-1.5">PE</th>
                        <th className="text-right px-2 py-1.5">PB</th>
                        <th className="text-right px-2 py-1.5" title="股息率">股息</th>
                        <th className="text-right px-2 py-1.5">ROE</th>
                      </>
                    )}
                    {Object.keys(aiRanking).length > 0 && (
                      <th className="text-center px-2 py-1.5 text-violet-300">AI 卡位</th>
                    )}
                    <th className="text-left px-2 py-1.5">命中</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((c) => {
                    const ai = aiRanking[c.ticker];
                    return (
                      <tr key={c.ticker} className="border-t border-white/5 hover:bg-white/[0.02] transition">
                        <td className="px-2 py-1.5 font-mono text-[10px] text-white">{c.ticker}</td>
                        <td className="px-2 py-1.5 text-[10px] text-[#d0d7e2] truncate max-w-[140px]" title={c.name}>{c.name}</td>
                        <td className="px-2 py-1.5 text-[9px] text-[#a0aec0]">{c.market}{c.exchange && `·${c.exchange}`}</td>
                        <td className="px-2 py-1.5 text-[9px] text-[#a0aec0] truncate max-w-[100px]" title={c.sector || c.industry}>{c.sector || c.industry || "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtMcap(c.marketCap)}</td>
                        {/* 价值型额外列 */}
                        {activeStrategy === "value" && (
                          <>
                            <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtNum(c.pe)}</td>
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
                                  className="text-[8px] px-1 py-px rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30 cursor-help"
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
                              title="加入观察"
                            >
                              <Plus size={9} /> 观察
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                className="flex items-center justify-center w-5 h-5 text-[#a0aec0] hover:text-white hover:bg-white/10 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="导出 JSON 备份（含所有观察项 + 自定义赛道）"
              >
                <Download size={11} />
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
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                还没有观察项 — 从中间候选列表点击 "观察" 加入
              </div>
            )}
            {items.map((it) => (
              <WatchlistCard
                key={it.ticker}
                item={it}
                trendName={trendName}
                onEdit={() => openEdit(it)}
                onDelete={() => handleDelete(it.ticker)}
                onToggleArchive={() => handleToggleArchive(it.ticker, !it.archived)}
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
        onClose={() => { setEditorOpen(false); setEditing(null); setPendingCandidate(null); }}
        onSaved={handleSaved}
      />

      {/* 添加赛道对话框 */}
      <AddSupertrendDialog
        open={addTrendOpen}
        onClose={() => setAddTrendOpen(false)}
        onSaved={async () => {
          setAddTrendOpen(false);
          await reloadWatchlist();   // 刷新 supertrends 列表，新赛道立刻可勾选
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 观察项卡片
// ─────────────────────────────────────────────────────────────
function WatchlistCard({ item, trendName, onEdit, onDelete, onToggleArchive }) {
  const moat = item.moat_score || 0;
  const archived = !!item.archived;
  return (
    <div className={`glass-card p-2 border transition group ${
      archived
        ? "border-white/5 opacity-60 hover:opacity-90"
        : "border-white/10 hover:border-white/20"
    }`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[12px] font-semibold text-white">{item.ticker}</span>
            {archived && (
              <span className="text-[8px] px-1 py-px rounded bg-white/5 text-[#a0aec0] border border-white/15">归档</span>
            )}
            {item.bottleneck_layer === 2 && (
              <span className="text-[8px] px-1 py-px rounded bg-violet-500/15 text-violet-200 border border-violet-500/40">L2</span>
            )}
            {item.bottleneck_layer === 1 && (
              <span className="text-[8px] px-1 py-px rounded bg-blue-500/15 text-blue-200 border border-blue-500/40">L1</span>
            )}
          </div>
          {item.supertrend_id && (
            <div className="text-[9px] text-cyan-300/80 mt-0.5">{trendName(item.supertrend_id)}</div>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
          <button onClick={onEdit} className="p-1 rounded hover:bg-white/10 text-[#a0aec0] hover:text-white" title="编辑">
            <Edit2 size={10} />
          </button>
          <button
            onClick={onToggleArchive}
            className={`p-1 rounded hover:bg-amber-500/20 text-[#a0aec0] ${archived ? "hover:text-emerald-300" : "hover:text-amber-300"}`}
            title={archived ? "恢复（取消归档）" : "归档（保留 thesis，不再显示）"}
          >
            {archived ? <ArchiveRestore size={10} /> : <Archive size={10} />}
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-red-500/20 text-[#a0aec0] hover:text-red-300" title="删除">
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* moat score 星标 */}
      <div className="flex items-center gap-0.5 mb-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={9}
            className={n <= moat ? "text-amber-400 fill-amber-400" : "text-white/15"}
          />
        ))}
        <span className="text-[8px] text-[#7a8497] ml-1">卡位</span>
      </div>

      {item.bottleneck_tag && (
        <div className="text-[10px] text-[#d0d7e2] mb-1 flex items-start gap-1">
          <ChevronRight size={9} className="text-amber-400 mt-0.5 shrink-0" />
          <span className="break-words">{item.bottleneck_tag}</span>
        </div>
      )}

      {item.thesis && (
        <div className="text-[10px] text-[#a0aec0] leading-relaxed whitespace-pre-line line-clamp-3 mb-1">
          {item.thesis}
        </div>
      )}

      {(item.target_price || item.stop_loss) && (
        <div className="flex items-center gap-2 text-[9px] font-mono">
          {item.target_price && <span className="text-emerald-300">▲ {item.target_price}</span>}
          {item.stop_loss && <span className="text-red-300">▼ {item.stop_loss}</span>}
        </div>
      )}

      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {item.tags.map((t) => (
            <span key={t} className="text-[8px] px-1 py-px rounded bg-white/5 text-[#a0aec0] border border-white/10">#{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}
