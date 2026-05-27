// ─────────────────────────────────────────────────────────────
// StockGene — 股性检测 / 牛股特征器
// ─────────────────────────────────────────────────────────────
//
// 三段式工作流：
//   1) 左栏：用户添加观察的股票列表，显示评分徽章
//   2) 中栏：选中股票的 8 维特征详情 + 评价
//   3) 右栏：同行业横向对比（输入 2-10 个 ticker 一次评分）
//
// 数据来源：
//   - GET    /api/stock-gene                     列出观察项
//   - POST   /api/stock-gene                     加入观察
//   - PUT    /api/stock-gene/{ticker}            编辑元数据
//   - DELETE /api/stock-gene/{ticker}            删除
//   - POST   /api/stock-gene/score               临时评分（不入库）
//   - POST   /api/stock-gene/{ticker}/score      评分并持久化
//   - POST   /api/stock-gene/score-all           批量评分
//   - POST   /api/stock-gene/compare-peers       横向对比
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Activity, Plus, Trash2, RefreshCw, Loader, AlertCircle, Check, X,
  Sparkles, BarChart3, TrendingUp, Layers, Search,
  ArrowUpDown, Download, Upload, Sliders, Briefcase, Bell, Clock,
} from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import {
  ENGINES, ENGINE_IDS, eng, engResult,
  DEFAULT_WEIGHTS, WEIGHTS_STORAGE_KEY, compositeScore, compositeStyle,
  verdictStyle, formatChecked, formatFreshness,
  ACTIVE_LIST_STORAGE_KEY, LAST_SEEN_ALERTS_KEY, NOTIFY_PERMISSION_KEY,
} from "../components/stock-gene/helpers.js";
import { ConfirmDialog, ShortcutsHelp, WeightsPanel, ListDialog, AlertsPanel, SchedulerPanel } from "../components/stock-gene/dialogs.jsx";
import { VerdictFilterChips, TagFilterChips, TagsInput } from "../components/stock-gene/filters.jsx";
import { PeersTable } from "../components/stock-gene/cards.jsx";
import { ListsTabBar } from "../components/stock-gene/ListsTabBar.jsx";
import { ScoreDetail } from "../components/stock-gene/ScoreDetail.jsx";
import { TickerSearchBox } from "../components/stock-gene/TickerSearchBox.jsx";
import EmptyState from "../components/EmptyState.jsx";


export default function StockGene() {
  // 观察列表
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  // Lists（多 watchlist 分组）
  const [lists, setLists] = useState([{ id: "default", name: "默认", color: "indigo" }]);
  const [activeListId, setActiveListId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_LIST_STORAGE_KEY) || "default"; }
    catch { return "default"; }
  });
  // List 管理 modal: { mode: 'create' | 'rename' | 'delete', list? }
  const [listDialog, setListDialog] = useState(null);
  // 评分变化 alerts
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);
  // 评分定时刷新 scheduler
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [showScheduler, setShowScheduler] = useState(false);
  // 评分是否在当前部署可用（Vercel serverless 上不可用，需 self-host backend）
  const [scoringUnavailable, setScoringUnavailable] = useState(false);
  const [dismissedScoringBanner, setDismissedScoringBanner] = useState(false);
  // 上次看过 alerts 的时间戳（localStorage），用于计算未读
  const [lastSeenAlertsAt, setLastSeenAlertsAt] = useState(() => {
    try { return localStorage.getItem(LAST_SEEN_ALERTS_KEY) || ""; }
    catch { return ""; }
  });
  // 持久化 activeListId
  useEffect(() => {
    try { localStorage.setItem(ACTIVE_LIST_STORAGE_KEY, activeListId); } catch {}
  }, [activeListId]);
  // 引擎切换："trend" = 牛股特征器（8 维趋势）/"value" = 价值健康度（6 维）
  const [engine, setEngine] = useState("trend");
  // 排序方式：当前引擎评分 / 添加时间 / ticker 字母
  const [sortBy, setSortBy] = useState("score");
  // 当前选中
  const [selectedTicker, setSelectedTicker] = useState(null);
  // 评分中的 ticker（loading 状态）
  const [scoringTicker, setScoringTicker] = useState(null);
  const [batchScoring, setBatchScoring] = useState(false);
  // 添加表单
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [newMarket, setNewMarket] = useState("US");
  const [newSector, setNewSector] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newTags, setNewTags] = useState([]);
  const [addError, setAddError] = useState(null);
  // 快捷键帮助 overlay
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Tag 过滤（OR 逻辑）
  const [filterTags, setFilterTags] = useState(() => new Set());
  // 综合分阈值过滤（0 = 不过滤）
  const [minComposite, setMinComposite] = useState(0);
  // "仅持仓" 过滤
  const [onlyHeld, setOnlyHeld] = useState(false);
  // 持仓数据：Map<ticker, position>
  const [positions, setPositions] = useState({});
  // 引擎权重（localStorage 持久化）
  const [weights, setWeights] = useState(() => {
    try {
      const raw = localStorage.getItem(WEIGHTS_STORAGE_KEY);
      if (raw) return { ...DEFAULT_WEIGHTS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_WEIGHTS;
  });
  // 权重设置面板
  const [showWeightsPanel, setShowWeightsPanel] = useState(false);
  // 同步 weights 到 localStorage
  useEffect(() => {
    try { localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify(weights)); } catch {}
  }, [weights]);
  // 确认对话框：{ title, message, onConfirm } | null
  const [confirmDialog, setConfirmDialog] = useState(null);
  // 横向对比
  const [peersInput, setPeersInput] = useState("");
  const [peersResults, setPeersResults] = useState(null);
  const [peersLoading, setPeersLoading] = useState(false);
  const [peersError, setPeersError] = useState(null);
  // 导入 loading
  const [importLoading, setImportLoading] = useState(false);
  const importInputRef = useRef(null);
  // AI 解读：key 为 `${ticker}:${engine}`，避免不同股票/引擎相互覆盖
  const [aiNarratives, setAiNarratives] = useState({});
  const [aiLoading, setAiLoading] = useState(null); // 当前 loading 的 ticker:engine key
  // 左栏过滤
  const [filterText, setFilterText] = useState("");
  const [filterVerdicts, setFilterVerdicts] = useState(() => new Set()); // 空 = 不过滤
  // 批量加入
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchInput, setBatchInput] = useState("");
  const [batchMarket, setBatchMarket] = useState("US");
  const [batchError, setBatchError] = useState(null);
  // {phase: 'adding'|'scoring', done, total} | null
  const [batchProgress, setBatchProgress] = useState(null);
  // Notes 内联编辑
  const [editingNotesTicker, setEditingNotesTicker] = useState(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  // ── 拉观察列表 + lists ─────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const json = await apiFetch("/stock-gene");
    setLoading(false);
    if (json && Array.isArray(json.items)) {
      setItems(json.items);
      if (Array.isArray(json.lists)) setLists(json.lists);
      setIsDemoMode(false);
      // 默认选中第一项
      if (json.items.length > 0 && !selectedTicker) {
        setSelectedTicker(json.items[0].ticker);
      }
    } else {
      // 后端不可达 → 灌 demo 数据让 Vercel 等纯前端部署也能展示完整功能。
      // Dynamic import 拆独立 chunk，只在 fallback 时下载，不污染本地 dev bundle。
      try {
        const demo = await import("../data/stockGeneDemo.js");
        setItems(demo.demoStockGene.items);
        setLists(demo.demoStockGene.lists);
        if (demo.demoStockGene.items.length > 0 && !selectedTicker) {
          setSelectedTicker(demo.demoStockGene.items[0].ticker);
        }
        setIsDemoMode(true);
        setError(null);
      } catch {
        // demo 模块加载也失败（罕见）→ 回到原来的空列表 + 提示
        setItems([]);
        setIsDemoMode(true);
        setError("后端不可用 — 股性检测需要 self-hosted backend（参见 README）");
      }
    }
  // selectedTicker 只用作首次默认，不进依赖避免回环
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── 拉持仓数据 ─────────────────────────────────────────
  // 用户的实际持仓（来自 /api/positions）→ 在观察列表里高亮 + 详情面板显示成本 / P&L
  const reloadPositions = useCallback(async () => {
    const json = await apiFetch("/positions");
    if (json && Array.isArray(json.positions)) {
      const map = {};
      for (const p of json.positions) {
        if (p.ticker && !p.closed) map[p.ticker] = p;
      }
      setPositions(map);
    }
  }, []);
  useEffect(() => { reloadPositions(); }, [reloadPositions]);

  // ── 拉评分变化 alerts ──────────────────────────────────
  const reloadAlerts = useCallback(async () => {
    const json = await apiFetch("/stock-gene/alerts?days=30&min_delta=1");
    if (json && Array.isArray(json.alerts)) {
      setAlerts(json.alerts);
      // 浏览器通知：仅给"未读"alerts 触发，避免重复打扰
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const lastSeen = localStorage.getItem(LAST_SEEN_ALERTS_KEY) || "";
          const fresh = json.alerts.filter(a => a.checked_at > lastSeen);
          // 单条通知概括多个 alerts，避免轰炸
          if (fresh.length > 0) {
            const up = fresh.filter(a => a.delta > 0).length;
            const down = fresh.filter(a => a.delta < 0).length;
            new Notification("Stock Gene 评分变化", {
              body: `${fresh.length} 条新预警：↑${up} · ↓${down}\n${fresh.slice(0, 3).map(a => `${a.ticker} ${a.engine} ${a.from_score}→${a.to_score}`).join(" · ")}`,
              tag: "stockgene-alerts",
            });
          }
        } catch {}
      }
    }
  }, []);
  useEffect(() => { reloadAlerts(); }, [reloadAlerts]);

  // ── Scheduler 控制 ───────────────────────────────────────
  const reloadSchedulerStatus = useCallback(async () => {
    const json = await apiFetch("/stock-gene/scheduler/status");
    if (json && typeof json.enabled !== "undefined") setSchedulerStatus(json);
  }, []);
  useEffect(() => { reloadSchedulerStatus(); }, [reloadSchedulerStatus]);

  const handleToggleScheduler = useCallback(async (enabled) => {
    const json = await apiFetch("/stock-gene/scheduler/enabled", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    if (json) setSchedulerStatus(json);
  }, []);

  const handleSetSchedule = useCallback(async (hour_utc, minute_utc) => {
    const json = await apiFetch("/stock-gene/scheduler/schedule", {
      method: "POST",
      body: JSON.stringify({ hour_utc, minute_utc }),
    });
    if (json) setSchedulerStatus(json);
  }, []);

  const handleSchedulerRunNow = useCallback(async () => {
    const json = await apiFetch("/stock-gene/scheduler/run-now", { method: "POST" });
    if (json) setSchedulerStatus(json);
    await reload();
    await reloadAlerts();
  }, [reload, reloadAlerts]);

  // 未读 alerts 数量（checked_at 晚于 lastSeenAlertsAt 的）
  const unreadAlertsCount = useMemo(
    () => alerts.filter(a => a.checked_at > lastSeenAlertsAt).length,
    [alerts, lastSeenAlertsAt],
  );

  // 打开 alerts panel → 把"已读时间"推到最新一条之后
  const handleOpenAlerts = useCallback(() => {
    setShowAlerts(true);
    if (alerts.length > 0) {
      const latest = alerts[0].checked_at;  // alerts 已按 checked_at desc
      setLastSeenAlertsAt(latest);
      try { localStorage.setItem(LAST_SEEN_ALERTS_KEY, latest); } catch {}
    }
  }, [alerts]);

  // 请求浏览器通知权限
  const handleRequestNotifyPermission = useCallback(async () => {
    if (typeof Notification === "undefined") {
      window.alert("当前浏览器不支持桌面通知");
      return;
    }
    if (Notification.permission === "granted") return;
    if (Notification.permission === "denied") {
      window.alert("通知权限已被拒绝。请到浏览器设置里手动开启。");
      return;
    }
    const perm = await Notification.requestPermission();
    try { localStorage.setItem(NOTIFY_PERMISSION_KEY, perm); } catch {}
    if (perm === "granted") {
      new Notification("Stock Gene", { body: "桌面通知已启用 — 评分变化会主动推送", tag: "stockgene-welcome" });
    }
  }, []);

  // 持仓但未在观察列表里的 ticker（用于建议导入 banner）
  const untrackedHoldings = useMemo(() => {
    const inWatchlist = new Set(items.map(it => it.ticker));
    return Object.keys(positions).filter(t => !inWatchlist.has(t));
  }, [positions, items]);

  // 一键把所有未跟踪的持仓加入股性检测
  const handleAddAllHoldings = useCallback(async () => {
    if (untrackedHoldings.length === 0) return;
    setBatchProgress({ phase: "adding", done: 0, total: untrackedHoldings.length });
    const added = [];
    for (const t of untrackedHoldings) {
      const res = await apiFetch("/stock-gene", {
        method: "POST",
        body: JSON.stringify({
          ticker: t,
          market: "US",  // 简化：持仓默认 US，用户可后续编辑
          tags: ["持仓"],
        }),
      });
      if (res?.ok) added.push(t);
      setBatchProgress(p => ({ ...p, done: p.done + 1 }));
    }
    await reload();
    // 并行跑 4 引擎评分
    if (added.length > 0) {
      setBatchProgress({ phase: "scoring", done: 0, total: added.length });
      for (const t of added) {
        await Promise.allSettled(
          ENGINE_IDS.map(id => apiFetch(
            `/stock-gene/${encodeURIComponent(t)}/${eng(id).scoreRoute}`,
            { method: "POST" },
          ))
        );
        setBatchProgress(p => ({ ...p, done: p.done + 1 }));
      }
      await reload();
    }
    setBatchProgress(null);
  }, [untrackedHoldings, reload]);

  // ── 添加 ───────────────────────────────────────────────
  // 加入观察后同时跑两个引擎（趋势 + 价值），一次点击双评分齐全
  const handleAdd = async () => {
    setAddError(null);
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker) {
      setAddError("ticker 不能为空");
      return;
    }
    const res = await apiFetch("/stock-gene", {
      method: "POST",
      body: JSON.stringify({
        ticker, name: newName.trim(),
        market: newMarket, sector: newSector.trim(), notes: newNotes.trim(),
        tags: newTags,
        list_id: activeListId,
      }),
    });
    if (!res?.ok) {
      setAddError(res?.detail || "添加失败");
      return;
    }
    // 重置表单
    setNewTicker(""); setNewName(""); setNewSector(""); setNewNotes(""); setNewTags([]);
    setShowAddForm(false);
    await reload();
    setSelectedTicker(ticker);
    // 并行跑所有引擎；任一失败不影响其它
    setScoringTicker(ticker);
    try {
      const results = await Promise.allSettled(
        ENGINE_IDS.map(id => apiFetch(
          `/stock-gene/${encodeURIComponent(ticker)}/${eng(id).scoreRoute}`,
          { method: "POST" },
        ))
      );
      // 任一返回 scoring_requires_self_hosted_backend 即标记不可用
      if (results.some(r => r.status === "fulfilled" && r.value?.error === "scoring_requires_self_hosted_backend")) {
        setScoringUnavailable(true);
      }
      await reload();
    } finally {
      setScoringTicker(null);
    }
  };

  // ── 评分（单个，持久化） ───────────────────────────────
  // 通过 ENGINES 配置查表，避免 if/else 多分支
  // Vercel serverless 上 score 路由会返回 503 (error=scoring_requires_self_hosted_backend)
  // → 设 scoringUnavailable=true 触发友好提示，但不阻断 CRUD
  const handleScore = useCallback(async (ticker, engineId = engine) => {
    setScoringTicker(ticker);
    try {
      const cfg = eng(engineId);
      const res = await apiFetch(
        `/stock-gene/${encodeURIComponent(ticker)}/${cfg.scoreRoute}`,
        { method: "POST" },
      );
      if (res?.error === "scoring_requires_self_hosted_backend") {
        setScoringUnavailable(true);
      }
      await reload();
    } finally {
      setScoringTicker(null);
    }
  }, [reload, engine]);

  // ── 批量评分 ────────────────────────────────────────────
  const handleScoreAll = async () => {
    if (items.length === 0) return;
    setBatchScoring(true);
    try {
      const res = await apiFetch(`/stock-gene/${eng(engine).scoreAllRoute}`, { method: "POST" });
      if (res?.error === "scoring_requires_self_hosted_backend") {
        setScoringUnavailable(true);
      }
      await reload();
    } finally {
      setBatchScoring(false);
    }
  };

  // ── 批量加入 ticker（粘贴多行 → 顺序添加 + 并行所有引擎评分）─
  const handleBatchAdd = useCallback(async () => {
    setBatchError(null);
    const tickers = [...new Set(
      batchInput.split(/[\s,，、;\n]+/)
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
    )];
    if (tickers.length === 0) {
      setBatchError("请输入至少 1 个 ticker");
      return;
    }
    if (tickers.length > 30) {
      setBatchError("一次最多 30 只");
      return;
    }
    // 1) 顺序添加（避免后端文件 IO 冲突）
    setBatchProgress({ phase: "adding", done: 0, total: tickers.length });
    const added = [];
    for (const t of tickers) {
      const res = await apiFetch("/stock-gene", {
        method: "POST",
        body: JSON.stringify({ ticker: t, market: batchMarket, list_id: activeListId }),
      });
      if (res?.ok) added.push(t);
      setBatchProgress(p => ({ ...p, done: p.done + 1 }));
    }
    await reload();
    // 2) 仅对成功添加的 ticker 跑所有引擎评分（同 ticker 内并行，跨 ticker 顺序）
    if (added.length > 0) {
      setBatchProgress({ phase: "scoring", done: 0, total: added.length });
      for (const t of added) {
        await Promise.allSettled(
          ENGINE_IDS.map(id => apiFetch(
            `/stock-gene/${encodeURIComponent(t)}/${eng(id).scoreRoute}`,
            { method: "POST" },
          ))
        );
        setBatchProgress(p => ({ ...p, done: p.done + 1 }));
      }
      await reload();
    }
    setBatchProgress(null);
    setBatchInput("");
    setShowBatchForm(false);
  }, [batchInput, batchMarket, reload, activeListId]);

  // ── Lists 管理 ──────────────────────────────────────────
  const handleCreateList = useCallback(async (name, color) => {
    const res = await apiFetch("/stock-gene/lists", {
      method: "POST",
      body: JSON.stringify({ name, color }),
    });
    if (res?.ok && res.list) {
      await reload();
      setActiveListId(res.list.id);
      return res.list;
    }
    return null;
  }, [reload]);

  const handleRenameList = useCallback(async (listId, name, color) => {
    const res = await apiFetch(`/stock-gene/lists/${encodeURIComponent(listId)}`, {
      method: "PUT",
      body: JSON.stringify({ name, color }),
    });
    if (res?.ok) await reload();
  }, [reload]);

  const handleDeleteList = useCallback(async (listId) => {
    const res = await apiFetch(`/stock-gene/lists/${encodeURIComponent(listId)}`, {
      method: "DELETE",
    });
    if (res?.ok) {
      // 切回 default
      if (activeListId === listId) setActiveListId("default");
      await reload();
    }
    return res;
  }, [reload, activeListId]);

  const handleMoveItem = useCallback(async (ticker, targetListId) => {
    const res = await apiFetch(`/stock-gene/${encodeURIComponent(ticker)}/move`, {
      method: "PUT",
      body: JSON.stringify({ list_id: targetListId }),
    });
    if (res?.ok) await reload();
  }, [reload]);

  // ── Tags 编辑（PUT /api/stock-gene/{ticker}）─────────────
  const handleSaveTags = useCallback(async (ticker, nextTags) => {
    const res = await apiFetch(`/stock-gene/${encodeURIComponent(ticker)}`, {
      method: "PUT",
      body: JSON.stringify({ tags: nextTags }),
    });
    if (res?.ok) await reload();
  }, [reload]);

  // ── Notes 内联编辑（PUT /api/stock-gene/{ticker}）────────
  const handleEditNotes = (item) => {
    setEditingNotesTicker(item.ticker);
    setNotesDraft(item.notes || "");
  };
  const handleSaveNotes = async (ticker) => {
    setNotesSaving(true);
    try {
      const res = await apiFetch(`/stock-gene/${encodeURIComponent(ticker)}`, {
        method: "PUT",
        body: JSON.stringify({ notes: notesDraft }),
      });
      if (res?.ok) {
        await reload();
        setEditingNotesTicker(null);
      }
    } finally {
      setNotesSaving(false);
    }
  };

  // ── AI 解读评分（LLM 一段话画像）────────────────────────
  const handleExplain = useCallback(async (item, eng) => {
    const r = eng === "value" ? item.last_value_result : item.last_result;
    if (!r) return;
    const key = `${item.ticker}:${eng}`;
    setAiLoading(key);
    try {
      const res = await apiFetch("/stock-gene/explain", {
        method: "POST",
        body: JSON.stringify({
          ticker: item.ticker,
          name: item.name || "",
          market: item.market || "US",
          sector: item.sector || "",
          engine: eng,
          score: r.score,
          max_score: r.max_score,
          available: r.available,
          verdict: r.verdict?.label || "",
          features: (r.features || []).map(f => ({
            label: f.label, pass: f.pass, value: f.value,
            detail: f.detail, available: f.available,
          })),
        }),
      });
      setAiNarratives(prev => ({
        ...prev,
        [key]: res?.ok
          ? { text: res.narrative, cached: !!res.cached }
          : { error: res?.error || res?.detail || "AI 解读失败" },
      }));
    } finally {
      setAiLoading(null);
    }
  }, []);

  // ── 导出 / 导入（备份）──────────────────────────────────
  const handleExport = async () => {
    const json = await apiFetch("/stock-gene/export");
    if (!json) {
      window.alert("导出失败：后端不可用");
      return;
    }
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-gene-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ── CSV 导出（前端转换，无需新后端路由）─────────────────
  const handleExportCsv = () => {
    if (items.length === 0) return;
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v);
      // 含逗号 / 引号 / 换行需用双引号包裹，内部引号转义为 ""
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    // 列：基础元数据 + 每个引擎的 score/max/verdict + tags/notes/时间戳
    const engineCols = ENGINE_IDS.flatMap(id => [
      `${id}_score`, `${id}_max`, `${id}_verdict`, `${id}_checked_at`,
    ]);
    const headers = [
      "ticker", "name", "market", "sector",
      ...engineCols,
      "tags", "notes", "added_at",
    ];
    const rows = items.map(it => {
      const base = [it.ticker, it.name || "", it.market || "", it.sector || ""];
      const engVals = ENGINE_IDS.flatMap(id => {
        const r = engResult(it, id);
        return [r?.score ?? "", r?.max_score ?? "", r?.verdict?.label || "", r?.checked_at || ""];
      });
      return [...base, ...engVals, (it.tags || []).join("|"), it.notes || "", it.added_at || ""]
        .map(esc).join(",");
    });
    // BOM 让 Excel 正确识别 UTF-8
    const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-gene-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file) => {
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (e) {
      window.alert(`文件解析失败：${e.message}`);
      return;
    }
    if (!payload?.items || !Array.isArray(payload.items)) {
      window.alert("文件格式不对：应为 { items: [...], version }");
      return;
    }
    const mode = window.prompt(
      `观察项 ${payload.items.length} 条。\n\n输入 'merge'：同 ticker 跳过，新增 append（推荐）\n输入 'replace'：清空后导入（不可撤销）\n其他取消。`,
      "merge",
    );
    if (mode !== "merge" && mode !== "replace") return;
    setImportLoading(true);
    const res = await apiFetch("/stock-gene/import", {
      method: "POST",
      body: JSON.stringify({ mode, items: payload.items, version: payload.version }),
    });
    setImportLoading(false);
    if (res?.ok) {
      window.alert(`导入成功（${res.mode}）\n新增 ${res.items_added} · 跳过 ${res.items_skipped}`);
      await reload();
    } else {
      window.alert(`导入失败：${res?.detail || "未知错误"}`);
    }
  };

  // ── 删除（用 ConfirmDialog 替换 window.confirm）─────────
  const handleDelete = (ticker) => {
    setConfirmDialog({
      title: "删除观察项",
      message: `确定从股性观察列表删除 ${ticker}？同时清除 8/6 维评分、历史记录、备注与标签。`,
      confirmLabel: "删除",
      danger: true,
      onConfirm: async () => {
        await apiFetch(`/stock-gene/${encodeURIComponent(ticker)}`, { method: "DELETE" });
        if (selectedTicker === ticker) setSelectedTicker(null);
        await reload();
      },
    });
  };

  // ── 横向对比 ────────────────────────────────────────────
  const handleComparePeers = async () => {
    const list = peersInput
      .split(/[,\s，、]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    if (list.length === 0) {
      setPeersError("请输入至少 1 个 ticker");
      return;
    }
    if (list.length > 10) {
      setPeersError("一次最多对比 10 只");
      return;
    }
    setPeersLoading(true);
    setPeersError(null);
    setPeersResults(null);
    try {
      // 默认用当前选中项的 sector / market 作为对比上下文（如有）
      const sel = items.find(i => i.ticker === selectedTicker);
      const res = await apiFetch(`/stock-gene/${eng(engine).comparePeersRoute}`, {
        method: "POST",
        body: JSON.stringify({
          tickers: list,
          sector: sel?.sector || "",
          market: sel?.market || "US",
        }),
      });
      if (!res || !Array.isArray(res.items)) {
        setPeersError("后端无响应或返回格式错误");
      } else {
        setPeersResults(res);
      }
    } catch (e) {
      setPeersError(String(e.message || e));
    } finally {
      setPeersLoading(false);
    }
  };

  const selectedItem = useMemo(
    () => items.find(i => i.ticker === selectedTicker),
    [items, selectedTicker]
  );

  // 排序 + 过滤后的列表
  // 过滤：filterText 匹配 ticker / name / sector（不区分大小写）
  //       filterVerdicts 多选限制评价等级（空 = 全部通过）
  // 排序：按 sortBy 在过滤后的子集上排序
  const sortedItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const arr = items.filter((it) => {
      // 当前 list 过滤
      if ((it.list_id || "default") !== activeListId) return false;
      // 文本搜索
      if (q) {
        const haystack = [it.ticker, it.name, it.sector].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // 评价过滤（按当前 engine 的 verdict.level）
      if (filterVerdicts.size > 0) {
        const r = engResult(it, engine);
        const lvl = r?.verdict?.level || "_unscored";
        if (!filterVerdicts.has(lvl)) return false;
      }
      // Tag 过滤（OR 逻辑：标的有任一选中 tag 即通过）
      if (filterTags.size > 0) {
        const itemTags = it.tags || [];
        if (!itemTags.some(t => filterTags.has(t))) return false;
      }
      // 综合分阈值：minComposite > 0 时仅显示综合分 ≥ 阈值的
      if (minComposite > 0) {
        const { composite } = compositeScore(it, weights);
        if (composite == null || composite < minComposite) return false;
      }
      // 仅持仓：只保留 positions 里的 ticker
      if (onlyHeld && !positions[it.ticker]) return false;
      return true;
    });
    if (sortBy === "composite") {
      arr.sort((a, b) => {
        const sa = compositeScore(a, weights).composite ?? -1;
        const sb = compositeScore(b, weights).composite ?? -1;
        return sb - sa;
      });
    } else if (sortBy === "score") {
      arr.sort((a, b) => {
        const sa = engResult(a, engine)?.score ?? -1;
        const sb = engResult(b, engine)?.score ?? -1;
        return sb - sa;
      });
    } else if (sortBy === "added") {
      arr.sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""));
    } else if (sortBy === "ticker") {
      arr.sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
    return arr;
  }, [items, sortBy, engine, filterText, filterVerdicts, filterTags, minComposite, weights, onlyHeld, positions, activeListId]);

  // 所有 items 已存在的 unique tags（用于 tag 过滤 chips）
  const allTags = useMemo(() => {
    const s = new Set();
    items.forEach(it => (it.tags || []).forEach(t => s.add(t)));
    return [...s].sort();
  }, [items]);

  // 每个 list 的 item 数量（用于 tab 显示）
  const listItemCounts = useMemo(() => {
    const counts = {};
    for (const it of items) {
      const lid = it.list_id || "default";
      counts[lid] = (counts[lid] || 0) + 1;
    }
    return counts;
  }, [items]);

  // ── 快捷键 ────────────────────────────────────────────────
  // j/k 选择上下条 · / 聚焦搜索 · t/v 切换引擎 · r 刷新 · esc 清过滤 · ? 帮助
  useEffect(() => {
    const onKey = (e) => {
      // 输入框 / textarea / 选择框 / Modal 内不触发（除 Esc 之外）
      // 注意 e.target 可能是 window（dispatchEvent 时），需 guard
      const inField = e.target && typeof e.target.closest === "function"
        ? e.target.closest('input, textarea, select')
        : null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // ? 帮助：?  或  Shift + /
      if (e.key === "?" && !inField) {
        e.preventDefault();
        setShowShortcuts(s => !s);
        return;
      }
      if (e.key === "Escape") {
        if (confirmDialog) { setConfirmDialog(null); return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (inField) return;
        if (filterText || filterVerdicts.size > 0 || filterTags.size > 0) {
          setFilterText("");
          setFilterVerdicts(new Set());
          setFilterTags(new Set());
          return;
        }
      }
      if (inField) return;
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector('input[placeholder*="过滤"]')?.focus();
        return;
      }
      if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (sortedItems.length === 0) return;
        e.preventDefault();
        const idx = sortedItems.findIndex(it => it.ticker === selectedTicker);
        const next = (e.key === "j" || e.key === "ArrowDown")
          ? Math.min(sortedItems.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx < 0 ? 0 : idx - 1);
        setSelectedTicker(sortedItems[next].ticker);
        return;
      }
      if (e.key === "t") { setEngine("trend"); return; }
      if (e.key === "v") { setEngine("value"); return; }
      if (e.key === "r") { e.preventDefault(); reload(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sortedItems, selectedTicker, filterText, filterVerdicts, filterTags, showShortcuts, confirmDialog, reload]);

  // ── 渲染 ────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 glass-card border border-white/10">
        <div className="flex items-center gap-3">
          <Activity size={16} className="text-emerald-400" />
          <span className="text-sm font-semibold text-white">股性检测 · Stock Gene</span>
          {/* 引擎切换：动态从 ENGINES 渲染 */}
          <div className="flex items-center gap-0.5 bg-white/5 rounded border border-white/10 p-0.5">
            {ENGINE_IDS.map(id => {
              const cfg = eng(id);
              const active = engine === id;
              return (
                <button
                  key={id}
                  onClick={() => setEngine(id)}
                  className={`px-2 py-0.5 text-[10px] rounded transition ${
                    active ? `${cfg.activeBg} ${cfg.activeText} font-medium` : "text-[#a0aec0] hover:text-white"
                  }`}
                  title={`${cfg.framework}（${cfg.featureCount} 维）`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] text-[#a0aec0] hidden lg:inline">
            {eng(engine).headerTagline}
          </span>
          {isDemoMode && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 cursor-help"
              title="当前是示例数据（Vercel 等无后端部署）。要看真实评分: cd backend && python server.py 后访问 localhost:5173"
            >
              DEMO 模式
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#a0aec0]">
          <button
            onClick={handleScoreAll}
            disabled={isDemoMode || batchScoring || items.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={`对所有观察项跑${eng(engine).framework}评分`}
          >
            {batchScoring ? <Loader size={11} className="animate-spin" /> : <Sparkles size={11} />}
            批量评分
          </button>
          {/* 导出 JSON 备份 */}
          <button
            onClick={handleExport}
            disabled={isDemoMode || items.length === 0}
            aria-label="导出股性检测 JSON 备份"
            className="flex items-center justify-center w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="导出 JSON 备份（含所有观察项 + 双引擎评分 + 历史）"
          >
            <Download size={11} />
          </button>
          {/* 导出 CSV（Excel 友好） */}
          <button
            onClick={handleExportCsv}
            disabled={items.length === 0}
            className="flex items-center justify-center px-1.5 h-7 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-[9px] font-mono"
            title="导出 CSV（Excel 友好，含 trend/value 双评分 + 标签 + 备注）"
          >
            CSV
          </button>
          {/* 导入 JSON 备份 */}
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={isDemoMode || importLoading}
            className="flex items-center justify-center w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="从备份恢复（merge / replace 可选）"
          >
            {importLoading ? <Loader size={11} className="animate-spin" /> : <Upload size={11} />}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => { handleImportFile(e.target.files?.[0]); e.target.value = ""; }}
          />
          {/* 评分定时刷新 调度器 */}
          <button
            onClick={() => setShowScheduler(true)}
            className={`relative flex items-center justify-center w-7 h-7 rounded transition border ${
              schedulerStatus?.enabled
                ? "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-500/40"
                : "bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border-white/10"
            }`}
            title={
              schedulerStatus?.enabled
                ? `每日 ${String(schedulerStatus.schedule?.hour_utc ?? 6).padStart(2, "0")}:${String(schedulerStatus.schedule?.minute_utc ?? 0).padStart(2, "0")} UTC 自动评分`
                : "评分定时刷新（已关闭）"
            }
          >
            <Clock size={11} />
            {schedulerStatus?.enabled && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-1 ring-[#1a1f2e]" />
            )}
          </button>
          {/* 评分变化预警 铃铛 */}
          <button
            onClick={handleOpenAlerts}
            className="relative flex items-center justify-center w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
            title={`评分变化预警（${alerts.length} 条，${unreadAlertsCount} 未读）`}
          >
            <Bell size={11} />
            {unreadAlertsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-mono font-bold flex items-center justify-center">
                {unreadAlertsCount > 9 ? "9+" : unreadAlertsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { reload(); reloadPositions(); reloadAlerts(); }}
            className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
            title="刷新（快捷键：r）"
          >
            <RefreshCw size={10} /> 刷新
          </button>
          {/* 权重设置 */}
          <button
            onClick={() => setShowWeightsPanel(true)}
            className="flex items-center justify-center w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
            title={`综合分权重：${ENGINE_IDS.map(id => `${eng(id).short}${weights[id]}`).join("/")}`}
          >
            <Sliders size={11} />
          </button>
          {/* 快捷键帮助 */}
          <button
            onClick={() => setShowShortcuts(true)}
            className="flex items-center justify-center w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10 font-mono text-[11px]"
            title="键盘快捷键（?）"
          >
            ?
          </button>
        </div>
      </div>

      {/* Vercel 上评分不可用提示（仅评分受影响；CRUD/分组/标签/导入导出可用） */}
      {scoringUnavailable && !dismissedScoringBanner && (
        <div className="px-3 py-1.5 glass-card border border-amber-500/30 bg-amber-500/5 flex items-center gap-2 text-[10px]">
          <AlertCircle size={12} className="text-amber-400 shrink-0" />
          <span className="text-amber-100">
            <span className="font-semibold">评分功能未启用</span>
            ：当前部署是 Vercel serverless（无 pandas/numpy）。可以加股票、改标签、分组、备份，
            但 4 引擎评分需 self-hosted backend。
            <a
              href="https://github.com/mingtaohuang617/quantedge/blob/main/docs/STOCK_GENE_ONBOARDING.md"
              target="_blank" rel="noreferrer"
              className="ml-1 underline text-amber-300/90 hover:text-amber-200"
            >上手指南 ↗</a>
          </span>
          <button
            onClick={() => setDismissedScoringBanner(true)}
            className="ml-auto text-amber-300/70 hover:text-amber-100"
            title="本次会话不再显示"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* 未跟踪的持仓：建议一键加入观察 */}
      {untrackedHoldings.length > 0 && !batchProgress && (
        <div className="px-3 py-1.5 glass-card border border-amber-500/30 bg-amber-500/5 flex items-center gap-2 text-[10px]">
          <Briefcase size={12} className="text-amber-400 shrink-0" />
          <span className="text-amber-100">
            <span className="font-semibold">{untrackedHoldings.length}</span> 只持仓还没在股性检测里：
            <span className="ml-1 font-mono text-amber-300/80">
              {untrackedHoldings.slice(0, 5).join(" · ")}
              {untrackedHoldings.length > 5 && ` 等 ${untrackedHoldings.length} 只`}
            </span>
          </span>
          <button
            onClick={handleAddAllHoldings}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-100 border border-amber-500/40 transition text-[10px]"
            title="把全部持仓加入股性检测 + 跑 4 引擎评分"
          >
            <Plus size={10} /> 全部加入 + 评分
          </button>
        </div>
      )}

      {/* 快捷键帮助 overlay */}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}

      {/* 权重设置面板 */}
      {showWeightsPanel && (
        <WeightsPanel
          weights={weights}
          onChange={setWeights}
          onClose={() => setShowWeightsPanel(false)}
          onReset={() => setWeights(DEFAULT_WEIGHTS)}
        />
      )}

      {/* 评分定时刷新 scheduler panel */}
      {showScheduler && (
        <SchedulerPanel
          status={schedulerStatus}
          onToggle={handleToggleScheduler}
          onSetSchedule={handleSetSchedule}
          onRunNow={handleSchedulerRunNow}
          onClose={() => setShowScheduler(false)}
        />
      )}

      {/* 评分变化 alerts panel */}
      {showAlerts && (
        <AlertsPanel
          alerts={alerts}
          onSelect={(ticker, list_id) => {
            // 切到对应 list + 选中 ticker
            if (list_id && lists.some(l => l.id === list_id)) {
              setActiveListId(list_id);
            }
            setSelectedTicker(ticker);
            setShowAlerts(false);
          }}
          onClose={() => setShowAlerts(false)}
          onRequestNotify={handleRequestNotifyPermission}
        />
      )}

      {/* List 管理 modal */}
      {listDialog && (
        <ListDialog
          mode={listDialog.mode}
          list={listDialog.list}
          onCreate={async (name, color) => {
            await handleCreateList(name, color);
            setListDialog(null);
          }}
          onRename={async (name, color) => {
            await handleRenameList(listDialog.list.id, name, color);
            setListDialog(null);
          }}
          onDelete={async () => {
            await handleDeleteList(listDialog.list.id);
            setListDialog(null);
          }}
          onCancel={() => setListDialog(null)}
        />
      )}

      {/* 确认对话框（删除等不可逆操作） */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger}
          onConfirm={async () => {
            const cb = confirmDialog.onConfirm;
            setConfirmDialog(null);
            if (cb) await cb();
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* List tabs（多 watchlist 切换 + 创建） */}
      <ListsTabBar
        lists={lists}
        activeId={activeListId}
        onSelect={setActiveListId}
        onCreate={() => setListDialog({ mode: "create" })}
        onRename={(list) => setListDialog({ mode: "rename", list })}
        onDelete={(list) => setListDialog({ mode: "delete", list })}
        itemCounts={listItemCounts}
      />

      {/* 三栏 grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_340px] gap-3 overflow-hidden min-h-0">

        {/* ─── 左栏：观察列表 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <Layers size={12} className="text-emerald-300" />
            <span className="text-[11px] font-semibold text-white">观察列表</span>
            <span className="text-[9px] text-[#a0aec0]">
              {sortedItems.length}{sortedItems.length !== items.length ? `/${items.length}` : ""} 只
            </span>
            {/* 排序选择器 */}
            <div className="ml-auto flex items-center gap-1" title="排序方式">
              <ArrowUpDown size={9} className="text-[#7a8497]" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="text-[9px] bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[#d0d7e2] focus:outline-none focus:border-emerald-500/40"
              >
                <option value="composite">按综合分</option>
                <option value="score">按{eng(engine).short} 分</option>
                <option value="added">按添加时间</option>
                <option value="ticker">按代码</option>
              </select>
            </div>
          </div>

          {/* 搜索 + verdict 过滤 chips */}
          {items.length > 0 && (
            <div className="px-2 py-1.5 border-b border-white/8 space-y-1.5">
              <div className="relative">
                <Search size={9} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#7a8497]" />
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="过滤：ticker / 名称 / 行业"
                  className="w-full pl-5 pr-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
                />
                {filterText && (
                  <button
                    onClick={() => setFilterText("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#7a8497] hover:text-white"
                    title="清空"
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
              <VerdictFilterChips
                value={filterVerdicts}
                onChange={setFilterVerdicts}
                engine={engine}
              />
              {/* Tag 过滤 chips：仅当有标签时显示 */}
              {allTags.length > 0 && (
                <TagFilterChips
                  allTags={allTags}
                  value={filterTags}
                  onChange={setFilterTags}
                />
              )}
              {/* 持仓筛选：仅当有持仓时显示 */}
              {Object.keys(positions).length > 0 && (
                <div className="flex items-center gap-1 text-[9px] text-[#7a8497]">
                  <Briefcase size={9} className="text-amber-400" />
                  <span>持仓</span>
                  <button
                    onClick={() => setOnlyHeld(!onlyHeld)}
                    className={`text-[9px] px-1.5 py-px rounded border transition ${
                      onlyHeld
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                        : "bg-white/[0.02] border-white/10 text-[#7a8497] hover:text-white hover:border-white/20"
                    }`}
                    title={onlyHeld ? "点击取消，显示全部" : "只看我已购买的"}
                  >
                    仅持仓
                  </button>
                  <span className="text-[#5a6477]">·</span>
                  <span className="text-[#a0aec0]">{Object.keys(positions).length} 只持仓</span>
                </div>
              )}
              {/* 综合分阈值滑块 */}
              <div className="flex items-center gap-1.5 text-[9px] text-[#7a8497]">
                <span className="shrink-0">综合分 ≥</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minComposite}
                  onChange={(e) => setMinComposite(Number(e.target.value))}
                  className="flex-1 h-1 accent-emerald-500 cursor-pointer"
                />
                <span className={`font-mono font-semibold w-7 text-right ${minComposite > 0 ? "text-emerald-300" : "text-[#5a6477]"}`}>
                  {minComposite}
                </span>
                {minComposite > 0 && (
                  <button
                    onClick={() => setMinComposite(0)}
                    className="text-[#7a8497] hover:text-white"
                    title="清空阈值"
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto p-2 space-y-1.5">
            {error && (
              <div className="m-1 p-2 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-300/90 flex items-start gap-1">
                <AlertCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {!error && items.length === 0 && !loading && (
              <EmptyState
                className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center"
                message='还没有观察项 — 下方"添加"按钮加入第一只'
              />
            )}
            {!error && items.length > 0 && sortedItems.length === 0 && (
              <EmptyState
                className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center"
                message="没有匹配的观察项 — 调整搜索或清空过滤"
              />
            )}
            {sortedItems.map((it) => {
              // 各引擎评分一并取出，下面按 ENGINE_IDS 渲染徽章
              const activeR = engResult(it, engine);
              const aStyle = verdictStyle(activeR?.verdict);
              const { composite, scored } = compositeScore(it, weights);
              const cStyle = compositeStyle(composite);
              const active = it.ticker === selectedTicker;
              return (
                <button
                  key={it.ticker}
                  onClick={() => setSelectedTicker(it.ticker)}
                  className={`w-full text-left px-2 py-2 rounded border transition ${
                    active
                      ? "bg-emerald-500/15 border-emerald-500/40"
                      : "bg-white/[0.02] border-white/8 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[12px] font-semibold text-white">{it.ticker}</span>
                    <span className="text-[9px] text-[#7a8497]">{it.market}</span>
                    {/* 持仓徽章：金色，表示已购买 */}
                    {positions[it.ticker] && (
                      <span
                        className="text-[9px] px-1 py-px rounded bg-amber-500/15 text-amber-200 border border-amber-500/40 flex items-center gap-0.5"
                        title={`持仓 ${positions[it.ticker].net_qty} 股 @ $${positions[it.ticker].avg_cost}（${
                          positions[it.ticker].unrealized_pnl_pct != null
                            ? `浮${positions[it.ticker].unrealized_pnl_pct >= 0 ? "盈" : "亏"} ${positions[it.ticker].unrealized_pnl_pct.toFixed(1)}%`
                            : "—"
                        }）`}
                      >
                        <Briefcase size={8} />
                        持仓
                      </span>
                    )}
                    {/* 多引擎评分徽章：每个引擎一个，当前 engine 加 ring 高亮 */}
                    <div className="ml-auto flex items-center gap-1">
                      {ENGINE_IDS.map(id => {
                        const cfg = eng(id);
                        const r = engResult(it, id);
                        const s = verdictStyle(r?.verdict);
                        return (
                          <span
                            key={id}
                            className={`px-1 py-0.5 rounded text-[9px] font-mono font-semibold border ${
                              r ? `${s.bg} ${s.border} ${s.text}` : "bg-white/5 text-[#7a8497] border-white/15"
                            } ${engine === id ? `ring-1 ${cfg.badgeRing}` : ""}`}
                            title={r
                              ? `${cfg.framework} ${r.score}/${r.max_score} · ${r.verdict.label}`
                              : `${cfg.framework} 未评分`}
                          >
                            {cfg.short} {r ? `${r.score}/${r.max_score}` : "—"}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {it.name && (
                    <div className="text-[10px] text-[#d0d7e2] truncate">{it.name}</div>
                  )}
                  {activeR?.verdict && (
                    <div className={`text-[9px] mt-0.5 ${aStyle.text}`}>{activeR.verdict.label}</div>
                  )}
                  {/* 综合分（4 引擎加权平均，0-100）*/}
                  {composite != null && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`text-[9px] px-1 py-px rounded border font-mono font-semibold ${cStyle.bg} ${cStyle.border} ${cStyle.text}`}
                        title={`综合分（按权重 ${ENGINE_IDS.map(id => `${eng(id).short}${weights[id]}`).join("/")}，${scored}/${ENGINE_IDS.length} 引擎有评分）`}>
                        综合 {composite}
                      </span>
                      {scored < ENGINE_IDS.length && (
                        <span className="text-[9px] text-[#5a6477]" title="部分引擎未评分">部分</span>
                      )}
                    </div>
                  )}
                  {it.sector && (
                    <div className="text-[9px] text-[#7a8497] mt-0.5 truncate">行业：{it.sector}</div>
                  )}
                  {/* 评分新鲜度：显示当前 engine 的最近评分时间 */}
                  {(activeR?.checked_at) && (
                    <div className="text-[9px] text-[#5a6477] mt-0.5">
                      评分 {formatFreshness(activeR.checked_at)}
                    </div>
                  )}
                  {/* 用户自定义标签 */}
                  {it.tags && it.tags.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1">
                      {it.tags.slice(0, 5).map(t => (
                        <span key={t} className="text-[9px] px-1 py-px rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
                          #{t}
                        </span>
                      ))}
                      {it.tags.length > 5 && (
                        <span className="text-[9px] text-[#5a6477]">+{it.tags.length - 5}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-white/8">
            {showAddForm ? (
              <div className="space-y-1.5">
                {/* Ticker 搜索框：选中后自动填名称 / 市场 / 行业 */}
                <TickerSearchBox
                  ticker={newTicker}
                  onTickerChange={setNewTicker}
                  market={newMarket}
                  onMarketChange={setNewMarket}
                  onPick={(r) => {
                    setNewTicker(r.symbol);
                    setNewName(r.name || "");
                    if (r.market) setNewMarket(r.market);
                    if (r.sector) setNewSector(r.sector);
                  }}
                  existingTickers={items.map(i => i.ticker)}
                />
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="名称（搜索选中后自动填）"
                  className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
                />
                <input
                  value={newSector}
                  onChange={(e) => setNewSector(e.target.value)}
                  placeholder="行业（搜索选中后自动填）"
                  className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
                  title="用于『行业走强』特征判断，可填中文或 yfinance 英文"
                />
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="备注（可选）"
                  rows={2}
                  className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50 resize-none"
                />
                <TagsInput
                  tags={newTags}
                  onChange={setNewTags}
                  placeholder="标签：核心 / 投机 / 长持 …"
                />
                {addError && (
                  <div className="text-[10px] text-red-300">{addError}</div>
                )}
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleAdd}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 transition"
                  >
                    <Check size={10} /> 加入并评分
                  </button>
                  <button
                    onClick={() => { setShowAddForm(false); setAddError(null); }}
                    className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] border border-white/10"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : showBatchForm ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 mb-1">
                  <Layers size={10} className="text-emerald-300" />
                  <span className="text-[10px] font-semibold text-white">批量加入</span>
                  <select
                    value={batchMarket}
                    onChange={(e) => setBatchMarket(e.target.value)}
                    className="ml-auto px-1 py-0.5 text-[9px] bg-white/5 border border-white/10 rounded text-white"
                    disabled={!!batchProgress}
                  >
                    <option value="US">US</option>
                    <option value="HK">HK</option>
                    <option value="CN">CN</option>
                  </select>
                </div>
                <textarea
                  value={batchInput}
                  onChange={(e) => setBatchInput(e.target.value)}
                  placeholder="一行一个 ticker（或逗号/空格分隔），最多 30 个"
                  rows={4}
                  disabled={!!batchProgress}
                  className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50 resize-none font-mono disabled:opacity-50"
                />
                {batchError && (
                  <div className="text-[10px] text-red-300">{batchError}</div>
                )}
                {batchProgress && (
                  <div className="text-[10px] text-emerald-300/90 flex items-center gap-1">
                    <Loader size={10} className="animate-spin" />
                    {batchProgress.phase === "adding" ? "加入" : "评分"} {batchProgress.done}/{batchProgress.total} ...
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleBatchAdd}
                    disabled={!!batchProgress || !batchInput.trim()}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Check size={10} /> 全部加入 + 评分
                  </button>
                  <button
                    onClick={() => { setShowBatchForm(false); setBatchError(null); setBatchInput(""); }}
                    disabled={!!batchProgress}
                    className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowAddForm(true)}
                  disabled={isDemoMode}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={11} /> 添加观察
                </button>
                <button
                  onClick={() => setShowBatchForm(true)}
                  disabled={isDemoMode}
                  className="flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  title="批量粘贴 ticker 列表，一键加入 + 双引擎评分"
                >
                  <Layers size={11} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── 中栏：评分详情 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          {!selectedItem ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
              ← 选择左侧的观察项查看{eng(engine).framework}（{eng(engine).featureCount} 维）评分
            </div>
          ) : (
            <ScoreDetail
              item={selectedItem}
              engine={engine}
              onRescore={() => handleScore(selectedItem.ticker)}
              onDelete={() => handleDelete(selectedItem.ticker)}
              scoring={scoringTicker === selectedItem.ticker}
              onExplain={() => handleExplain(selectedItem, engine)}
              explainLoading={aiLoading === `${selectedItem.ticker}:${engine}`}
              narrative={aiNarratives[`${selectedItem.ticker}:${engine}`]}
              editingNotes={editingNotesTicker}
              notesDraft={notesDraft}
              setNotesDraft={setNotesDraft}
              onEditNotes={handleEditNotes}
              onSaveNotes={handleSaveNotes}
              onCancelNotes={() => setEditingNotesTicker(null)}
              notesSaving={notesSaving}
              onSaveTags={(nextTags) => handleSaveTags(selectedItem.ticker, nextTags)}
              weights={weights}
              position={positions[selectedItem.ticker]}
              lists={lists}
              onMove={(targetListId) => handleMoveItem(selectedItem.ticker, targetListId)}
            />
          )}
        </div>

        {/* ─── 右栏：同行业横向对比 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <BarChart3 size={12} className="text-cyan-300" />
            <span className="text-[11px] font-semibold text-white">同行业横向对比</span>
            <span className={`text-[9px] px-1 py-px rounded border ${eng(engine).btnBg}`}>
              {eng(engine).short} · {eng(engine).framework}
            </span>
          </div>
          <div className="px-3 py-2 border-b border-white/8 space-y-1.5">
            <div className="text-[10px] text-[#a0aec0]">
              输入 2-10 个 ticker（逗号 / 空格分隔），按当前引擎和选中项的行业上下文打分
              {selectedItem?.sector && (
                <span className="text-emerald-300/80"> · 行业：{selectedItem.sector}</span>
              )}
            </div>
            <textarea
              value={peersInput}
              onChange={(e) => setPeersInput(e.target.value)}
              placeholder="AAPL, MSFT, GOOGL"
              rows={2}
              className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-cyan-500/50 resize-none font-mono"
            />
            <button
              onClick={handleComparePeers}
              disabled={isDemoMode || peersLoading || !peersInput.trim()}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {peersLoading ? <Loader size={10} className="animate-spin" /> : <TrendingUp size={10} />}
              对比评分
            </button>
            {peersError && (
              <div className="text-[10px] text-red-300 flex items-start gap-1">
                <AlertCircle size={10} className="text-red-400 shrink-0 mt-0.5" />
                <span>{peersError}</span>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-2">
            {!peersResults && !peersLoading && (
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                对比结果将在此显示
              </div>
            )}
            {peersResults && <PeersTable result={peersResults} engine={engine} onAdd={(t, n, m, s) => {
              setNewTicker(t); setNewName(n); setNewMarket(m); setNewSector(s);
              setShowAddForm(true);
            }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

