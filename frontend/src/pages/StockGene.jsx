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
  Sparkles, Target, BarChart3, TrendingUp, Layers, ChevronRight,
  Edit2, Award, Search, ArrowUpDown, Download, Upload, Sliders,
} from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

const VERDICT_STYLE = {
  strong: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300" },
  moderate: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300" },
  neutral: { bg: "bg-slate-500/15", border: "border-slate-500/40", text: "text-slate-300" },
  weak: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300" },
  unknown: { bg: "bg-white/5", border: "border-white/15", text: "text-[#a0aec0]" },
};

// ─────────────────────────────────────────────────────────────
// 引擎配置——所有引擎相关的差异都在这里查表
// 添加新引擎时：1) 加一行 ENGINES 配置  2) 后端注册对应路由
// ─────────────────────────────────────────────────────────────
const ENGINES = {
  trend: {
    id: "trend",
    label: "趋势 · 牛股",
    short: "T",
    framework: "牛股趋势",
    featurePrefix: "F",
    featureCount: 8,
    resultKey: "last_result",
    checkedAtKey: "last_checked_at",
    scoreRoute: "score",
    scoreAllRoute: "score-all",
    comparePeersRoute: "compare-peers",
    activeBg: "bg-emerald-500/20",
    activeText: "text-emerald-100",
    btnBg: "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40",
    badgeRing: "ring-emerald-400/50",
    headerTagline: "8 个牛股特征 — 趋势/动量/相对强度",
    verdictLabels: {
      strong: "牛股潜质", moderate: "中性偏强", neutral: "中性", weak: "待观察",
    },
  },
  value: {
    id: "value",
    label: "价值 · 健康度",
    short: "V",
    framework: "价值健康度",
    featurePrefix: "V",
    featureCount: 6,
    resultKey: "last_value_result",
    checkedAtKey: "last_value_checked_at",
    scoreRoute: "value-score",
    scoreAllRoute: "value/score-all",
    comparePeersRoute: "value/compare-peers",
    activeBg: "bg-cyan-500/20",
    activeText: "text-cyan-100",
    btnBg: "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-500/40",
    badgeRing: "ring-cyan-400/50",
    headerTagline: "6 个价值特征 — 估值/盈利/现金流/负债",
    verdictLabels: {
      strong: "优质标的", moderate: "质量合格", neutral: "中性", weak: "不推荐",
    },
  },
  signal: {
    id: "signal",
    label: "短期 · 信号",
    short: "S",
    framework: "短期信号",
    featurePrefix: "S",
    featureCount: 6,
    resultKey: "last_signal_result",
    checkedAtKey: "last_signal_checked_at",
    scoreRoute: "signal-score",
    scoreAllRoute: "signal/score-all",
    comparePeersRoute: "signal/compare-peers",
    activeBg: "bg-amber-500/20",
    activeText: "text-amber-100",
    btnBg: "bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/40",
    badgeRing: "ring-amber-400/50",
    headerTagline: "6 个短期信号 — 突破/量能/MACD/RSI",
    verdictLabels: {
      strong: "入场窗口", moderate: "可关注", neutral: "观望", weak: "暂避",
    },
  },
  risk: {
    id: "risk",
    label: "风险 · 画像",
    short: "R",
    framework: "风险画像",
    featurePrefix: "R",
    featureCount: 6,
    resultKey: "last_risk_result",
    checkedAtKey: "last_risk_checked_at",
    scoreRoute: "risk-score",
    scoreAllRoute: "risk/score-all",
    comparePeersRoute: "risk/compare-peers",
    activeBg: "bg-violet-500/20",
    activeText: "text-violet-100",
    btnBg: "bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border-violet-500/40",
    badgeRing: "ring-violet-400/50",
    headerTagline: "6 个风险维度 — 回撤/波动/Beta/流动性",
    verdictLabels: {
      strong: "低风险", moderate: "风险可控", neutral: "中等风险", weak: "高风险",
    },
  },
};
const ENGINE_IDS = Object.keys(ENGINES);
const eng = (id) => ENGINES[id] || ENGINES.trend;
const engResult = (item, id) => item?.[eng(id).resultKey];
const engCheckedAt = (item, id) => item?.[eng(id).checkedAtKey];

// 默认权重：trend 30 + value 30 + risk 30 + signal 10（长期质量重于短期入场时机）
const DEFAULT_WEIGHTS = { trend: 30, value: 30, signal: 10, risk: 30 };
const WEIGHTS_STORAGE_KEY = "stockgene.weights";

/**
 * 计算综合分（0-100）。
 *   - 每个引擎归一化到 0-1：r.score / r.max_score
 *   - 加权平均（仅计入有评分的引擎）
 *   - 返回：{ composite: 0-100 整数, scored: 评分引擎数 }；全无评分时 composite = null
 */
function compositeScore(item, weights = DEFAULT_WEIGHTS) {
  let weightedSum = 0;
  let weightTotal = 0;
  let scoredCount = 0;
  for (const id of ENGINE_IDS) {
    const r = engResult(item, id);
    if (!r || r.max_score === 0 || r.score == null) continue;
    const w = weights[id] ?? 0;
    if (w <= 0) continue;
    weightedSum += w * (r.score / r.max_score);
    weightTotal += w;
    scoredCount += 1;
  }
  if (weightTotal === 0) return { composite: null, scored: 0 };
  return { composite: Math.round((weightedSum / weightTotal) * 100), scored: scoredCount };
}

/**
 * 综合分配色：80+ 绿 / 60+ 琥珀 / 40+ 灰 / <40 红
 */
function compositeStyle(composite) {
  if (composite == null) return VERDICT_STYLE.unknown;
  if (composite >= 80) return VERDICT_STYLE.strong;
  if (composite >= 60) return VERDICT_STYLE.moderate;
  if (composite >= 40) return VERDICT_STYLE.neutral;
  return VERDICT_STYLE.weak;
}

function verdictStyle(verdict) {
  return VERDICT_STYLE[verdict?.level] || VERDICT_STYLE.unknown;
}

function formatChecked(iso) {
  if (!iso) return "未评分";
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// 评分新鲜度：用相对时间标签，让用户一眼知道数据多旧
function formatFreshness(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMin = (Date.now() - t) / 60000;
  if (diffMin < 60) return `${Math.max(1, Math.round(diffMin))}分钟前`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}小时前`;
  if (diffMin < 60 * 24 * 30) return `${Math.round(diffMin / (60 * 24))}天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function StockGene() {
  // 观察列表
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
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

  // ── 拉观察列表 ─────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const json = await apiFetch("/stock-gene");
    setLoading(false);
    if (json && Array.isArray(json.items)) {
      setItems(json.items);
      setIsDemoMode(false);
      // 默认选中第一项
      if (json.items.length > 0 && !selectedTicker) {
        setSelectedTicker(json.items[0].ticker);
      }
    } else {
      setItems([]);
      setIsDemoMode(true);
      setError("后端不可用 — 股性检测需要 self-hosted backend（参见 README）");
    }
  // selectedTicker 只用作首次默认，不进依赖避免回环
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
      await Promise.allSettled(
        ENGINE_IDS.map(id => apiFetch(
          `/stock-gene/${encodeURIComponent(ticker)}/${eng(id).scoreRoute}`,
          { method: "POST" },
        ))
      );
      await reload();
    } finally {
      setScoringTicker(null);
    }
  };

  // ── 评分（单个，持久化） ───────────────────────────────
  // 通过 ENGINES 配置查表，避免 if/else 多分支
  const handleScore = useCallback(async (ticker, engineId = engine) => {
    setScoringTicker(ticker);
    try {
      const cfg = eng(engineId);
      await apiFetch(
        `/stock-gene/${encodeURIComponent(ticker)}/${cfg.scoreRoute}`,
        { method: "POST" },
      );
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
      await apiFetch(`/stock-gene/${eng(engine).scoreAllRoute}`, { method: "POST" });
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
        body: JSON.stringify({ ticker: t, market: batchMarket }),
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
  }, [batchInput, batchMarket, reload]);

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
  }, [items, sortBy, engine, filterText, filterVerdicts, filterTags, minComposite, weights]);

  // 所有 items 已存在的 unique tags（用于 tag 过滤 chips）
  const allTags = useMemo(() => {
    const s = new Set();
    items.forEach(it => (it.tags || []).forEach(t => s.add(t)));
    return [...s].sort();
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
              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30"
              title="后端不可用 — 评分需 self-hosted backend"
            >
              演示模式
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
          <button
            onClick={reload}
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
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                还没有观察项 — 下方"添加"按钮加入第一只
              </div>
            )}
            {!error && items.length > 0 && sortedItems.length === 0 && (
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                没有匹配的观察项 — 调整搜索或清空过滤
              </div>
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
                        <span className="text-[8px] text-[#5a6477]" title="部分引擎未评分">部分</span>
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

// ─────────────────────────────────────────────────────────────
// 评分详情面板（中栏）
// ─────────────────────────────────────────────────────────────
function ScoreDetail({
  item, engine, onRescore, onDelete, scoring, onExplain, explainLoading, narrative,
  editingNotes, notesDraft, setNotesDraft, onEditNotes, onSaveNotes, onCancelNotes, notesSaving,
  onSaveTags, weights,
}) {
  const cfg = eng(engine);
  const r = engResult(item, engine);
  const engineLabel = cfg.framework;
  const { composite, scored } = compositeScore(item, weights);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部：ticker + verdict 大徽章 */}
      <div className="px-4 py-3 border-b border-white/8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[18px] font-bold text-white">{item.ticker}</span>
              <span className="text-[10px] text-[#a0aec0]">{item.market}</span>
            </div>
            {item.name && (
              <div className="text-[12px] text-[#d0d7e2]">{item.name}</div>
            )}
            {item.sector && (
              <div className="text-[10px] text-[#7a8497] mt-0.5">行业：{item.sector}</div>
            )}
          </div>
          {r && (
            <div className="flex items-end gap-2">
              {/* 4 维雷达图（综合 trend/value/signal/risk）*/}
              <EngineRadar item={item} />
              {/* 评分历史 sparkline（仅当前 engine，≥2 条才有意义） */}
              <ScoreSparkline
                history={item.score_history}
                engine={engine}
                maxScore={r.max_score}
              />
              <div className="text-right">
                <VerdictBadge verdict={r.verdict} score={r.score} maxScore={r.max_score} available={r.available} />
                <div className="text-[9px] text-[#7a8497] mt-1">
                  {formatChecked(r.checked_at)}
                </div>
                {composite != null && (
                  <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-white/5 border-white/15">
                    <span className="text-[8px] text-[#7a8497]">综合</span>
                    <span className={`text-[11px] font-mono font-bold ${compositeStyle(composite).text}`}>
                      {composite}
                    </span>
                    <span className="text-[8px] text-[#7a8497]">/100</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onRescore}
            disabled={scoring}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition disabled:opacity-40 disabled:cursor-not-allowed ${cfg.btnBg}`}
            title={`重新跑${engineLabel}评分（${cfg.featureCount} 个特征）`}
          >
            {scoring ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
            {r ? `重新评分（${engineLabel}）` : `立即评分（${engineLabel}）`}
          </button>
          {/* AI 解读按钮 — 仅当已有评分时可点 */}
          {r && onExplain && (
            <button
              onClick={onExplain}
              disabled={explainLoading}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="让 DeepSeek 用一段话解读这只票的强项 / 弱项 / 建议"
            >
              {explainLoading ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
              AI 解读
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-red-500/20 text-[#a0aec0] hover:text-red-300 border border-white/10 hover:border-red-500/30 transition"
          >
            <Trash2 size={10} /> 删除
          </button>
        </div>
        {/* AI narrative card */}
        {narrative && (
          <div className="mt-2 px-2 py-2 bg-violet-500/8 border border-violet-500/30 rounded text-[10px] text-[#d0d7e2] leading-relaxed">
            <div className="flex items-center gap-1 mb-1 text-[9px] text-violet-300">
              <Sparkles size={9} />
              <span>AI 解读（DeepSeek · {engineLabel}）</span>
              {narrative.cached && <span className="ml-auto text-[9px] text-violet-300/60">cached</span>}
            </div>
            {narrative.error ? (
              <span className="text-amber-300/90">{narrative.error}</span>
            ) : (
              <span>{narrative.text}</span>
            )}
          </div>
        )}
        {/* 备注：hover 显示编辑按钮 / 点击进入内联编辑 */}
        <NotesBlock
          item={item}
          editing={editingNotes === item.ticker}
          draft={notesDraft}
          onDraftChange={setNotesDraft}
          onEdit={() => onEditNotes(item)}
          onSave={() => onSaveNotes(item.ticker)}
          onCancel={onCancelNotes}
          saving={notesSaving}
        />
        {/* Tags 行：紧凑展示 + 直接增删 */}
        <TagsRow tags={item.tags || []} onChange={onSaveTags} />
      </div>

      {/* 特征列表（趋势 8 维 / 价值 6 维） */}
      <div className="flex-1 overflow-auto p-3">
        {!r && (
          <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] text-center">
            尚未评分（{engineLabel}） — 点击上方"立即评分"按钮
          </div>
        )}
        {r && r.warnings && r.warnings.length > 0 && (
          <div className="mb-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[10px] text-amber-300/90">
            {r.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1">
                <AlertCircle size={10} className="text-amber-400 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        {r && r.features && r.features.length === 0 && (
          <div className="p-3 text-[11px] text-[#7a8497] text-center">
            无法获取历史数据，请检查 ticker 是否正确
          </div>
        )}
        {r && r.features && r.features.map((f, idx) => (
          <FeatureRow key={f.id} feature={f} index={idx + 1} prefix={cfg.featurePrefix} />
        ))}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict, score, maxScore, available }) {
  const v = verdictStyle(verdict);
  return (
    <div className={`inline-flex flex-col items-center px-3 py-2 rounded-lg border ${v.bg} ${v.border}`}>
      <div className="flex items-center gap-1">
        <Award size={12} className={v.text} />
        <span className={`text-[11px] font-semibold ${v.text}`}>{verdict?.label || "—"}</span>
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={`text-[18px] font-bold font-mono ${v.text}`}>{score}</span>
        <span className="text-[10px] text-[#a0aec0]">/ {maxScore}</span>
      </div>
      {available != null && available < maxScore && (
        <div className="text-[9px] text-[#7a8497] mt-0.5">
          {available} 项可判断
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 评分历史 sparkline — 显示当前 engine 最近评分的走势
// ─────────────────────────────────────────────────────────────
function ScoreSparkline({ history, engine, maxScore }) {
  // 过滤当前 engine 的历史评分；不足 2 条不画
  const data = (history || []).filter(h => h.engine === engine && h.score != null);
  if (data.length < 2) return null;
  const last = data.slice(-12);             // 最多显示最近 12 次
  const w = 64, h = 22, pad = 2;
  const minS = 0;
  const maxS = maxScore || Math.max(...last.map(d => d.max_score || 8));
  const range = maxS - minS || 1;
  let pts = "";
  for (let i = 0; i < last.length; i++) {
    const x = pad + (i / (last.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((last[i].score - minS) / range) * (h - 2 * pad);
    pts += (i ? " " : "") + x.toFixed(1) + "," + y.toFixed(1);
  }
  const first = last[0].score, end = last[last.length - 1].score;
  const trend = end > first ? "up" : end < first ? "down" : "flat";
  const color = trend === "up" ? "#00E5A0" : trend === "down" ? "#FF6B6B" : "#888";
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }); }
    catch { return iso; }
  };
  const tooltip = `${last.length} 次历史评分：\n${last.map(d => `${fmtDate(d.checked_at)}: ${d.score}/${d.max_score}`).join("\n")}`;
  return (
    <div title={tooltip} className="flex flex-col items-end">
      <svg width={w} height={h} className="opacity-90">
        {/* 顶/底基准线 */}
        <line x1={pad} y1={pad} x2={w - pad} y2={pad} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        <polyline fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" points={pts} />
        {/* 末点小圆 */}
        <circle
          cx={pad + (w - 2 * pad)} cy={h - pad - ((end - minS) / range) * (h - 2 * pad)}
          r="1.5" fill={color}
        />
      </svg>
      <div className="text-[9px] mt-0.5" style={{ color }}>
        {arrow} {first} → {end} · {last.length}次
      </div>
    </div>
  );
}

function FeatureRow({ feature, index, prefix = "F" }) {
  const passed = feature.pass;
  const unavailable = feature.available === false;
  const Icon = passed ? Check : (unavailable ? AlertCircle : X);
  const iconColor = passed ? "text-emerald-400" : (unavailable ? "text-amber-400" : "text-rose-400");
  const borderColor = passed ? "border-emerald-500/30" : (unavailable ? "border-amber-500/20" : "border-white/8");
  const bgHover = passed ? "hover:bg-emerald-500/5" : "hover:bg-white/[0.02]";
  return (
    <div className={`mb-2 p-2.5 rounded border ${borderColor} ${bgHover} transition`}>
      <div className="flex items-start gap-2">
        <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-white/5 ${iconColor}`}>
          <Icon size={12} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[#7a8497] font-mono">{prefix}{index}</span>
            <span className={`text-[11px] font-medium ${passed ? "text-emerald-200" : (unavailable ? "text-amber-300/80" : "text-[#d0d7e2]")}`}>
              {feature.label}
            </span>
          </div>
          {feature.value && feature.value !== "—" && (
            <div className="text-[10px] text-[#a0aec0] mt-1 font-mono tabular-nums">
              {feature.value}
            </div>
          )}
          {feature.detail && (
            <div className="text-[10px] text-[#7a8497] mt-1 leading-relaxed">
              {feature.detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 横向对比表格（右栏结果）
// ─────────────────────────────────────────────────────────────
function PeersTable({ result, onAdd, engine = "trend" }) {
  const items = result.items || [];
  // 按评分降序
  const sorted = [...items].sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    return sb - sa;
  });
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-[#7a8497] px-1">
        共 {result.count} 只 · 按{eng(engine).framework}评分降序
      </div>
      {sorted.map((it) => {
        if (it.error) {
          return (
            <div key={it.ticker} className="p-2 bg-red-500/5 border border-red-500/20 rounded text-[10px]">
              <div className="flex items-center gap-1">
                <span className="font-mono text-white">{it.ticker}</span>
                <span className="text-red-300 ml-auto">错误</span>
              </div>
              <div className="text-[9px] text-red-300/80 mt-0.5">{it.error}</div>
            </div>
          );
        }
        const v = verdictStyle(it.verdict);
        return (
          <div key={it.ticker} className={`p-2 rounded border ${v.bg} ${v.border}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-mono text-[11px] font-semibold text-white">{it.ticker}</span>
              <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${v.text}`}>
                {it.score}/{it.max_score}
              </span>
              <button
                onClick={() => onAdd(it.ticker, "", it.market || "US", it.sector || "")}
                className="p-0.5 rounded hover:bg-white/10 text-[#a0aec0] hover:text-white transition"
                title="加入观察列表"
              >
                <Plus size={11} />
              </button>
            </div>
            <div className={`text-[9px] ${v.text}`}>{it.verdict?.label}</div>
            {/* 8/6 个特征的迷你 pass/fail 指示器（按 engine 自适应） */}
            <div className="flex items-center gap-0.5 mt-1.5">
              {(it.features || []).map((f) => (
                <div
                  key={f.id}
                  title={`${f.label}: ${f.pass ? "PASS" : (f.available === false ? "N/A" : "FAIL")} — ${f.value || ""}`}
                  className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[9px] ${
                    f.pass
                      ? "bg-emerald-500/30 text-emerald-200"
                      : f.available === false
                      ? "bg-amber-500/15 text-amber-300/60"
                      : "bg-white/5 text-[#5a6477]"
                  }`}
                >
                  {f.pass ? "✓" : (f.available === false ? "?" : "·")}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ticker 搜索自动补全（debounced 300ms，命中 /api/search）
// ─────────────────────────────────────────────────────────────
function TickerSearchBox({ ticker, onTickerChange, market, onMarketChange, onPick, existingTickers }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);
  const reqIdRef = useRef(0);

  // 点外面关下拉
  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // debounce 搜索：用户停手 300ms 才发请求；竞态用 reqId 守护
  useEffect(() => {
    const q = ticker.trim();
    if (q.length < 1) {
      setResults([]); setOpen(false); return;
    }
    setLoading(true);
    const myReq = ++reqIdRef.current;
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/search?q=${encodeURIComponent(q)}`);
      if (myReq !== reqIdRef.current) return;   // 过期请求丢弃
      setLoading(false);
      if (res?.results) {
        setResults(res.results);
        setOpen(res.results.length > 0);
        setHighlight(0);
      } else {
        setResults([]); setOpen(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [ticker]);

  const handlePick = (r) => {
    onPick(r);
    setOpen(false);
  };

  const handleKey = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handlePick(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search size={9} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#7a8497]" />
          <input
            value={ticker}
            onChange={(e) => onTickerChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={handleKey}
            placeholder="ticker / 中文名 / 港股代码"
            className="w-full pl-5 pr-7 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
            autoFocus
            autoComplete="off"
          />
          {loading && (
            <Loader size={9} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#7a8497] animate-spin" />
          )}
        </div>
        <select
          value={market}
          onChange={(e) => onMarketChange(e.target.value)}
          className="px-1 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white"
        >
          <option value="US">US</option>
          <option value="HK">HK</option>
          <option value="CN">CN</option>
        </select>
      </div>
      {/* 搜索结果下拉 */}
      {open && results.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded border border-white/15 bg-[var(--surface,#1a1f2e)] shadow-2xl">
          {results.map((r, i) => {
            const already = existingTickers?.includes(r.symbol) || r.alreadyAdded;
            const active = i === highlight;
            return (
              <button
                key={r.symbol}
                onClick={() => handlePick(r)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-2 py-1.5 text-[10px] border-b border-white/5 last:border-b-0 transition ${
                  active ? "bg-emerald-500/15" : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-white">{r.symbol}</span>
                  <span className="text-[9px] text-[#7a8497]">{r.market}</span>
                  {already && (
                    <span className="text-[9px] px-1 py-px rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">已在观察</span>
                  )}
                  {r.price > 0 && (
                    <span className="ml-auto text-[9px] font-mono text-[#a0aec0]">
                      {r.currency === "HKD" ? "HK$" : "$"}{r.price}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[#d0d7e2] truncate">{r.name}</div>
                {r.sector && (
                  <div className="text-[9px] text-[#7a8497]">{r.sector}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Verdict 过滤 chips — 多选切换 verdict.level，空 set = 不过滤
// ─────────────────────────────────────────────────────────────
function VerdictFilterChips({ value, onChange, engine }) {
  // 从 ENGINES 配置读取 verdict label 文案
  const labels = eng(engine).verdictLabels;
  const levels = ["strong", "moderate", "neutral", "weak"].map(id => ({
    id, label: labels[id], style: VERDICT_STYLE[id],
  }));
  const toggle = (id) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {levels.map(lv => {
        const on = value.has(lv.id);
        return (
          <button
            key={lv.id}
            onClick={() => toggle(lv.id)}
            className={`text-[9px] px-1.5 py-px rounded border transition ${
              on
                ? `${lv.style.bg} ${lv.style.border} ${lv.style.text}`
                : "bg-white/[0.02] border-white/10 text-[#7a8497] hover:text-white hover:border-white/20"
            }`}
            title={on ? `点击移除 ${lv.label} 过滤` : `点击只看 ${lv.label}`}
          >
            {lv.label}
          </button>
        );
      })}
      {value.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="text-[9px] px-1 text-[#7a8497] hover:text-white"
          title="清空所有 verdict 过滤"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Notes block — 默认显示 / hover 出编辑按钮 / 点击进入 textarea 编辑
// ─────────────────────────────────────────────────────────────
function NotesBlock({ item, editing, draft, onDraftChange, onEdit, onSave, onCancel, saving }) {
  if (editing) {
    return (
      <div className="mt-2 px-2 py-1.5 bg-amber-500/5 border border-amber-500/30 rounded space-y-1">
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="备注（空字符串可清除）"
          rows={3}
          autoFocus
          className="w-full px-1.5 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-[#d0d7e2] focus:outline-none focus:border-amber-500/50 resize-none leading-relaxed"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader size={9} className="animate-spin" /> : <Check size={9} />} 保存
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] border border-white/10 disabled:opacity-40"
          >
            取消
          </button>
        </div>
      </div>
    );
  }
  // 显示模式：有 notes 渲染卡片，无 notes 渲染"添加备注"占位
  if (item.notes) {
    return (
      <div className="mt-2 px-2 py-1.5 bg-white/[0.02] border-l-2 border-amber-500/40 rounded text-[10px] text-[#d0d7e2] leading-relaxed group/notes relative">
        <span className="whitespace-pre-line">{item.notes}</span>
        <button
          onClick={onEdit}
          className="absolute top-1 right-1 opacity-0 group-hover/notes:opacity-100 p-0.5 rounded hover:bg-white/10 text-[#a0aec0] hover:text-white transition"
          title="编辑备注"
        >
          <Edit2 size={9} />
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onEdit}
      className="mt-2 px-2 py-1 text-[9px] text-[#7a8497] hover:text-white hover:bg-white/5 rounded transition flex items-center gap-1"
      title="添加备注"
    >
      <Edit2 size={9} /> 添加备注
    </button>
  );
}


// ─────────────────────────────────────────────────────────────
// TagsInput — 多 chip 输入：Enter / 逗号 / 空格添加；Backspace 删最后一个
// ─────────────────────────────────────────────────────────────
function TagsInput({ tags = [], onChange, placeholder = "标签" }) {
  const [input, setInput] = useState("");
  const add = (t) => {
    const v = t.trim().replace(/^#+/, "");
    if (!v || tags.includes(v)) return;
    onChange([...tags, v]);
    setInput("");
  };
  const remove = (t) => onChange(tags.filter(x => x !== t));
  return (
    <div className="w-full px-1.5 py-1 bg-white/5 border border-white/10 rounded focus-within:border-emerald-500/50 transition">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-200 border border-violet-500/40">
            #{t}
            <button onClick={() => remove(t)} className="text-violet-300/70 hover:text-white" title="删除">
              <X size={8} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault();
              add(input);
            } else if (e.key === "Backspace" && !input && tags.length > 0) {
              remove(tags[tags.length - 1]);
            }
          }}
          onBlur={() => input.trim() && add(input)}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[60px] bg-transparent text-[10px] text-white placeholder-[#7a8497] focus:outline-none"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TagsRow — 详情面板的紧凑 tags 行（直接增删，自动 PUT 保存）
// ─────────────────────────────────────────────────────────────
function TagsRow({ tags, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tags);
  useEffect(() => { setDraft(tags); }, [tags]);
  if (!editing && tags.length === 0) {
    return (
      <button
        onClick={() => { setDraft([]); setEditing(true); }}
        className="mt-2 px-2 py-1 text-[9px] text-[#7a8497] hover:text-violet-300 hover:bg-violet-500/10 rounded transition flex items-center gap-1"
        title="添加标签"
      >
        <Plus size={9} /> 添加标签
      </button>
    );
  }
  if (editing) {
    return (
      <div className="mt-2 space-y-1">
        <TagsInput tags={draft} onChange={setDraft} placeholder="回车 / 逗号 / 空格添加" />
        <div className="flex items-center gap-1">
          <button
            onClick={async () => { await onChange(draft); setEditing(false); }}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/40 transition"
          >
            <Check size={9} /> 保存
          </button>
          <button
            onClick={() => { setDraft(tags); setEditing(false); }}
            className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] border border-white/10"
          >
            取消
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 group/tags">
      {tags.map(t => (
        <span key={t} className="text-[9px] px-1 py-px rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
          #{t}
        </span>
      ))}
      <button
        onClick={() => { setDraft(tags); setEditing(true); }}
        className="opacity-0 group-hover/tags:opacity-100 transition p-0.5 rounded hover:bg-white/10 text-[#7a8497] hover:text-white"
        title="编辑标签"
      >
        <Edit2 size={9} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 快捷键帮助 overlay
// ─────────────────────────────────────────────────────────────
function ShortcutsHelp({ onClose }) {
  const rows = [
    { keys: ["j", "↓"], desc: "选择下一只" },
    { keys: ["k", "↑"], desc: "选择上一只" },
    { keys: ["/"], desc: "聚焦搜索框" },
    { keys: ["t"], desc: "切到趋势引擎" },
    { keys: ["v"], desc: "切到价值引擎" },
    { keys: ["r"], desc: "刷新列表" },
    { keys: ["Esc"], desc: "清过滤 / 关弹层" },
    { keys: ["?"], desc: "显示此帮助" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card border border-white/15 rounded-lg p-4 min-w-[280px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-semibold text-white">键盘快捷键</span>
          <button onClick={onClose} className="text-[#a0aec0] hover:text-white" title="关闭"><X size={12} /></button>
        </div>
        <div className="space-y-1.5">
          {rows.map(r => (
            <div key={r.desc} className="flex items-center justify-between text-[11px]">
              <span className="text-[#d0d7e2]">{r.desc}</span>
              <span className="flex items-center gap-1">
                {r.keys.map(k => (
                  <kbd key={k} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10px] font-mono text-white">{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t border-white/10 text-[9px] text-[#7a8497]">
          ⓘ 焦点在输入框 / 弹层内时快捷键不触发
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// TagFilterChips — 与 VerdictFilterChips 并列，按现有 tag 动态渲染
// ─────────────────────────────────────────────────────────────
function TagFilterChips({ allTags, value, onChange }) {
  const toggle = (t) => {
    const next = new Set(value);
    if (next.has(t)) next.delete(t); else next.add(t);
    onChange(next);
  };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[9px] text-[#7a8497] mr-1">tag</span>
      {allTags.slice(0, 12).map(t => {
        const on = value.has(t);
        return (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`text-[9px] px-1.5 py-px rounded border transition ${
              on
                ? "bg-violet-500/15 border-violet-500/40 text-violet-200"
                : "bg-white/[0.02] border-white/10 text-[#7a8497] hover:text-white hover:border-white/20"
            }`}
            title={on ? `点击取消 #${t} 过滤` : `点击只看有 #${t} 的`}
          >
            #{t}
          </button>
        );
      })}
      {allTags.length > 12 && (
        <span className="text-[9px] text-[#7a8497]">+{allTags.length - 12}</span>
      )}
      {value.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="text-[9px] px-1 text-[#7a8497] hover:text-white"
          title="清空所有 tag 过滤"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ConfirmDialog — 不可逆操作确认弹层（替代 window.confirm）
// ─────────────────────────────────────────────────────────────
function ConfirmDialog({ title, message, confirmLabel = "确认", danger = false, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="glass-card border border-white/15 rounded-lg p-4 min-w-[300px] max-w-[420px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          {danger
            ? <AlertCircle size={14} className="text-rose-400" />
            : <AlertCircle size={14} className="text-amber-400" />}
          <span className="text-[12px] font-semibold text-white">{title}</span>
        </div>
        <div className="text-[11px] text-[#d0d7e2] leading-relaxed mb-3">
          {message}
        </div>
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10 disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={handle}
            disabled={busy}
            className={`flex items-center gap-1 px-3 py-1 text-[10px] rounded border transition disabled:opacity-40 ${
              danger
                ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border-rose-500/40"
                : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40"
            }`}
            autoFocus
          >
            {busy ? <Loader size={9} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// EngineRadar — 4 维雷达图（trend / value / signal / risk）
// ─────────────────────────────────────────────────────────────
function EngineRadar({ item }) {
  const size = 78;
  const cx = size / 2, cy = size / 2;
  const radius = size / 2 - 9;
  const N = ENGINE_IDS.length;
  // 按 ENGINE_IDS 顺序算每个点的归一化分（0-1）
  const points = ENGINE_IDS.map((id, i) => {
    const r = engResult(item, id);
    const ratio = r && r.max_score ? r.score / r.max_score : 0;
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N; // 从顶开始顺时针
    return {
      id,
      ratio,
      angle,
      x: cx + Math.cos(angle) * radius * ratio,
      y: cy + Math.sin(angle) * radius * ratio,
      ax: cx + Math.cos(angle) * radius,
      ay: cy + Math.sin(angle) * radius,
      label: eng(id).short,
    };
  });
  const anyScored = points.some(p => p.ratio > 0);
  if (!anyScored) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-[8px] text-[#5a6477]">雷达</span>
      </div>
    );
  }
  const polygon = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const tooltip = ENGINE_IDS.map(id => {
    const r = engResult(item, id);
    return r ? `${eng(id).short} ${r.score}/${r.max_score}` : `${eng(id).short} —`;
  }).join(" · ");
  return (
    <div title={tooltip} className="shrink-0">
      <svg width={size} height={size}>
        {[1.0, 0.66, 0.33].map((scale, i) => {
          const pts = points.map(p => {
            const x = cx + Math.cos(p.angle) * radius * scale;
            const y = cy + Math.sin(p.angle) * radius * scale;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(" ");
          return (
            <polygon key={i} points={pts} fill="none"
              stroke={i === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}
              strokeWidth="0.5"/>
          );
        })}
        {points.map(p => (
          <line key={`ax-${p.id}`} x1={cx} y1={cy} x2={p.ax} y2={p.ay}
            stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        ))}
        <polygon points={polygon} fill="rgba(99,102,241,0.18)"
          stroke="rgba(129,140,248,0.85)" strokeWidth="1.2" strokeLinejoin="round" />
        {points.map(p => (
          <g key={`pt-${p.id}`}>
            <circle cx={p.x} cy={p.y} r="1.6" fill="rgba(165,180,252,0.95)" />
            <text x={p.ax + Math.cos(p.angle) * 5} y={p.ay + Math.sin(p.angle) * 5}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="7" fill="rgba(160,170,192,0.9)"
              fontFamily="ui-monospace, monospace">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// WeightsPanel — 调节综合分权重（localStorage 持久化）
// ─────────────────────────────────────────────────────────────
function WeightsPanel({ weights, onChange, onReset, onClose }) {
  const total = ENGINE_IDS.reduce((s, id) => s + (weights[id] || 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card border border-white/15 rounded-lg p-4 min-w-[340px] max-w-[440px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sliders size={13} className="text-indigo-300" />
            <span className="text-[12px] font-semibold text-white">综合分权重</span>
          </div>
          <button onClick={onClose} className="text-[#a0aec0] hover:text-white" title="关闭"><X size={12} /></button>
        </div>
        <div className="text-[10px] text-[#7a8497] mb-3 leading-relaxed">
          各引擎在综合分里的权重（总和不需等于 100，会自动归一化）。调整会立即重算所有综合分 + 重新排序。
        </div>
        <div className="space-y-2.5">
          {ENGINE_IDS.map(id => {
            const cfg = eng(id);
            const w = weights[id] || 0;
            return (
              <div key={id} className="flex items-center gap-2">
                <span className={`text-[10px] w-20 shrink-0 ${cfg.activeText || "text-white"}`}>{cfg.label}</span>
                <input
                  type="range" min={0} max={100} step={5}
                  value={w}
                  onChange={(e) => onChange({ ...weights, [id]: Number(e.target.value) })}
                  className="flex-1 h-1 accent-indigo-500 cursor-pointer"
                />
                <span className="font-mono text-[10px] text-white w-10 text-right">{w}</span>
                <span className="text-[9px] text-[#7a8497] w-10 text-right">
                  {total > 0 ? `${Math.round(w / total * 100)}%` : "0%"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
          <button onClick={onReset}
            className="px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10">
            恢复默认
          </button>
          <button onClick={onClose}
            className="px-3 py-1 text-[10px] rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/40">
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
