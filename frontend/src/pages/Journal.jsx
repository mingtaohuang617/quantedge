// ─────────────────────────────────────────────────────────────
// Journal — 投资论点日志 / 持仓追踪
// 从 quant-platform.jsx 抽出（C1 重构第一步），通过 React.lazy 懒加载
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback, useContext, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Plus, Search, Loader, Check, Briefcase, Activity, BookOpen, Trash2, Eye, Layers, Globe, ChevronRight, Zap, Database, X, Upload, Sparkles } from "lucide-react";
import { searchTickers as standaloneSearch, fetchStockData, STOCK_CN_NAMES } from "../standalone.js";
import { useLang } from "../i18n.jsx";
import {
  DataContext,
  apiFetch,
  displayTicker,
  matchSectorETF,
  TAG_COLORS,
  TOOLTIP_STYLE,
  Badge,
  useWorkspace,
  wsKey,
  currencySymbol,
} from "../quant-platform.jsx";

// C16: 工作区命名空间
const loadJournal = (wsId) => {
  try {
    const raw = localStorage.getItem(wsKey("quantedge_journal", wsId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};
const saveJournal = (entries, wsId) => {
  try { localStorage.setItem(wsKey("quantedge_journal", wsId), JSON.stringify(entries)); } catch {}
};

// ─── 持仓编辑器（股数 + 持有成本） ─────────────────────────
const PositionEditor = ({ entry, currency, onUpdate }) => {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
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
  const liveStocks = ctxStocks4 || [];
  const ws = useWorkspace();
  const wsId = ws?.activeId || 'default';
  const [entries, setEntries] = useState(() => loadJournal(wsId) || []);
  // C16: 工作区切换时重新加载该工作区的日志，并清空当前选中
  useEffect(() => {
    const stored = loadJournal(wsId);
    setEntries(stored || []);
    setSel(null);
  }, [wsId]);
  const [sel, setSel] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addTicker, setAddTicker] = useState("");
  const [addThesis, setAddThesis] = useState("");
  const [addTags, setAddTags] = useState("");
  const [addSearchResults, setAddSearchResults] = useState([]);
  const [addSearching, setAddSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [addingEntry, setAddingEntry] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  // B5: AI 整理一句话日志 → 结构化字段
  const [aiOrganizing, setAiOrganizing] = useState(false);
  const [aiHint, setAiHint] = useState("");  // 解析提示文本

  useEffect(() => { if (!sel && entries.length > 0) setSel(entries[0]); }, [entries]);

  // B5: 调 /api/llm/journal-structure 把 thesis 一句话拆成 ticker/qty/price/sentiment/reason/tags
  const handleAIOrganize = useCallback(async () => {
    const text = (addThesis || "").trim();
    if (!text) {
      setAiHint("先在投资论点框里写一句话，再点 AI 整理");
      return;
    }
    setAiOrganizing(true);
    setAiHint("");
    try {
      // 把当前 watchlist 喂给 LLM 作为 ticker 候选池
      const watchlist = (liveStocks || []).map(s => s.ticker).filter(Boolean);
      // apiFetch 已 parse JSON 并在网络失败时返回 null（且 path 不需要 /api 前缀）
      const json = await apiFetch("/llm/journal-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, watchlist }),
      });
      if (!json) throw new Error("后端无响应（检查 backend 是否启动）");
      if (!json.ok) throw new Error(json.error || json.detail || "AI 服务异常");
      const s = json.structured || {};
      // 回填字段
      if (s.reason) setAddThesis(s.reason);
      if (Array.isArray(s.tags) && s.tags.length > 0) setAddTags(s.tags.join(", "));
      // 提示用户 LLM 识别出的 ticker / sentiment 等（让用户自己手动选 selectedStock）
      const hints = [];
      if (s.ticker) hints.push(`识别到标的 ${s.ticker}（请用搜索框选中）`);
      if (s.action) hints.push(`方向: ${s.action}`);
      if (s.qty) hints.push(`数量: ${s.qty}`);
      if (s.price) hints.push(`价格: ${s.price}`);
      if (s.sentiment) hints.push(`情绪: ${s.sentiment}`);
      setAiHint(hints.length > 0 ? hints.join(" · ") : "已整理 thesis 和 tags");
    } catch (e) {
      setAiHint(`AI 整理失败: ${String(e?.message || e)}`);
    } finally {
      setAiOrganizing(false);
    }
  }, [addThesis, liveStocks]);

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

  useEffect(() => { saveJournal(entries, wsId); }, [entries, wsId]);

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
    const tt = setTimeout(() => searchStocks(addTicker), 400);
    return () => clearTimeout(tt);
  }, [addTicker, searchStocks, selectedStock]);

  const handleSelectStock = (r) => {
    setSelectedStock(r);
    setAddTicker(r.symbol);
    setAddSearchResults([]);
  };

  const handleAddEntry = async () => {
    if (!selectedStock) return;
    setAddingEntry(true);
    let price = selectedStock.price;
    if (!price) {
      const stk = liveStocks.find(s => s.ticker === selectedStock.symbol);
      price = stk?.price || 0;
    }
    if (!price) {
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

  // ─── H4: AI 复盘助手（生成结构化 Claude prompt） ──────────
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAngle, setAiAngle] = useState('counterfactual');
  const [aiCopied, setAiCopied] = useState(false);

  const generatePrompt = useCallback(() => {
    if (!sel) return "";
    const stk = liveStocks.find(s => s.ticker === sel.ticker);
    const cur = currencySymbol(stk?.currency);
    const days = Math.floor((Date.now() - new Date(sel.anchorDate).getTime()) / 86400000);
    const ret = sel.anchorPrice > 0 ? ((sel.currentPrice - sel.anchorPrice) / sel.anchorPrice * 100).toFixed(2) : "0";
    const angleQuestion = {
      counterfactual: t('反事实分析：如果当时我没有买入这只股票，资金放在 SPY/QQQ 等基准上，结果会如何？我的论点哪里对了，哪里错了？'),
      exit: t('卖出策略：基于我的论点和当前 P&L，应该止盈、止损、还是继续持有？给出明确的触发条件（价格 / 时间 / 估值变化）。'),
      addmore: t('加仓时机：在什么条件下应该加仓？什么条件下绝对不能加仓？请给出具体的技术 / 基本面信号。'),
      risk:    t('风险评估：这只股票现在最大的 3 个尾部风险是什么？组合层面如何对冲？'),
    }[aiAngle] || '';
    const stkInfo = stk ? `
- 当前价格: ${cur}${stk.price}
- 52 周区间: ${cur}${stk.week52Low} ~ ${cur}${stk.week52High}
- P/E: ${stk.pe ?? 'N/A'} · ROE: ${stk.roe ?? 'N/A'}% · Beta: ${stk.beta ?? 'N/A'}
- 营收增长: ${stk.revenueGrowth ?? 'N/A'}% · 利润率: ${stk.profitMargin ?? 'N/A'}%
- 综合评分: ${stk.score?.toFixed(1) ?? 'N/A'}/100
- 行业: ${stk.sector ?? 'N/A'}` : '';
    return `# QuantEdge 投资复盘 · ${sel.ticker}

## 基本信息
- 股票代码: ${sel.ticker} (${sel.name})
- 锚定日期: ${sel.anchorDate} (${days} 天前)
- 锚定价格: ${cur}${sel.anchorPrice}
- 当前价格: ${cur}${sel.currentPrice}
- 累计收益: ${ret >= 0 ? '+' : ''}${ret}%${sel.shares ? `\n- 持仓股数: ${sel.shares} (成本 ${cur}${sel.costBasis ?? sel.anchorPrice}/股)` : ''}
${stkInfo}

## 我当时的投资论点
${sel.thesis || '(未填写)'}

## 标签
${(sel.tags || []).join(', ') || '(无)'}

## 请你帮我做以下分析

${angleQuestion}

请基于上面的真实数据给出**结构化、可执行**的回答，不要泛泛而谈。如果数据不足以支撑结论，请明确指出需要补充什么信息。`;
  }, [sel, aiAngle, liveStocks, t]);

  const copyPrompt = useCallback(async () => {
    const text = generatePrompt();
    try {
      await navigator.clipboard.writeText(text);
      setAiCopied(true);
      setTimeout(() => setAiCopied(false), 2000);
    } catch (e) {
      console.error('Clipboard failed:', e);
    }
  }, [generatePrompt]);

  // ─── C12: CSV 导入（富途 / IB / 雪球 / 通用格式） ─────────
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null); // { rows: [{ticker, qty, cost, date, _selected}] }
  const [csvImportError, setCsvImportError] = useState("");
  const fileInputRef = useRef(null);

  const parseCSV = (text) => {
    // 简单 CSV 解析 — 支持引号转义
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;
    const splitRow = (line) => {
      const out = []; let cur = ""; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { out.push(cur); cur = ""; continue; }
        cur += ch;
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    const headers = splitRow(lines[0]).map(h => h.toLowerCase());
    // 列名匹配（中英文）
    const findCol = (keys) => headers.findIndex(h => keys.some(k => h.includes(k)));
    const idxTicker = findCol(['symbol', 'ticker', '代码', '股票代码']);
    const idxQty    = findCol(['quantity', 'shares', 'qty', '数量', '股数', '持仓']);
    const idxCost   = findCol(['price', 'cost', 'avg', '成本', '均价', '买入价', '成交均价']);
    const idxDate   = findCol(['date', '日期', '时间', '买入日期', '成交日期']);
    if (idxTicker < 0) return { error: '未识别股票代码列（需含 symbol / ticker / 代码）' };
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitRow(lines[i]);
      const tk = (cols[idxTicker] || "").toUpperCase().trim();
      if (!tk) continue;
      const qty  = idxQty  >= 0 ? parseFloat(cols[idxQty])  || 0 : 0;
      const cost = idxCost >= 0 ? parseFloat(cols[idxCost]) || 0 : 0;
      const date = idxDate >= 0 ? cols[idxDate] : new Date().toISOString().slice(0, 10);
      rows.push({ ticker: tk, qty, cost, date, _selected: true });
    }
    return { rows };
  };

  const handleCsvFile = async (file) => {
    setCsvImportError("");
    if (!file) return;
    const text = await file.text();
    const result = parseCSV(text);
    if (!result || result.error) {
      setCsvImportError(result?.error || t('解析失败'));
      setCsvPreview(null);
      return;
    }
    setCsvPreview(result);
  };

  const importCsvEntries = () => {
    if (!csvPreview?.rows) return;
    const selected = csvPreview.rows.filter(r => r._selected);
    if (selected.length === 0) return;
    const newEntries = selected.map(r => {
      const stk = liveStocks.find(s => s.ticker === r.ticker);
      return {
        id: Date.now() + Math.random(),
        ticker: r.ticker,
        name: stk?.name || r.ticker,
        anchorPrice: r.cost || stk?.price || 0,
        anchorDate: r.date,
        currentPrice: stk?.price || r.cost || 0,
        thesis: t('CSV 导入'),
        tags: ['导入'],
        shares: r.qty,
        costBasis: r.cost,
        sector: stk?.sector || '未知',
      };
    });
    setEntries(prev => [...newEntries, ...prev]);
    setCsvImportOpen(false);
    setCsvPreview(null);
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
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowAdd(!showAdd)} className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 flex items-center justify-center gap-1.5">
            <Plus size={14} /> {t('新增看好标的')}
          </button>
          {/* C12: CSV 导入按钮 */}
          <button onClick={() => setCsvImportOpen(true)}
            className="px-3 py-2.5 rounded-xl text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 flex items-center gap-1.5"
            title={t('从 CSV 批量导入持仓（富途/IB/雪球）')}
          >
            <Database size={13} /> CSV
          </button>
        </div>
        {showAdd && (
          <div className="glass-card p-3 space-y-2 animate-slide-up">
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
              {addSearching && (
                <div className="absolute top-full left-0 right-0 mt-1 glass-card p-2 z-20 flex items-center justify-center text-[10px]" style={{ color: "var(--text-muted)" }}>
                  <Loader size={12} className="animate-spin mr-1.5" /> {t('搜索中...')}
                </div>
              )}
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
            <div className="relative">
              <textarea
                value={addThesis}
                onChange={e => setAddThesis(e.target.value)}
                placeholder={t("投资论点 (为什么看好这个标的？) 也可写成一句话日记，再点右上角 AI 整理")}
                rows={3}
                className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
              />
              {/* B5: AI 整理按钮（DeepSeek） */}
              <button
                type="button"
                onClick={handleAIOrganize}
                disabled={aiOrganizing || !addThesis.trim()}
                title="DeepSeek 把一句话拆成结构化字段"
                className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[10px] flex items-center gap-1 bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {aiOrganizing ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
                {aiOrganizing ? "整理中" : "AI 整理"}
              </button>
            </div>
            {aiHint && (
              <div className="text-[10px] px-2 py-1 rounded-md bg-violet-500/10 text-violet-200/90 border border-violet-500/20">
                {aiHint}
              </div>
            )}
            <input
              value={addTags}
              onChange={e => setAddTags(e.target.value)}
              placeholder={t("标签 (用逗号分隔, 如: AI, 半导体, 催化剂)")}
              className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
            />
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
            {/* S5: 持仓 → 一键加入回测 */}
            <button
              onClick={() => {
                const held = entries.filter(e => (e.shares || 0) > 0);
                if (held.length === 0) return;
                const totalValue = held.reduce((s, e) => s + (Number(e.shares) || 0) * (Number(e.currentPrice) || 0), 0);
                if (totalValue <= 0) return;
                const portfolio = {};
                held.forEach(e => {
                  const v = (Number(e.shares) || 0) * (Number(e.currentPrice) || 0);
                  const w = Math.round(v / totalValue * 1000) / 10;
                  if (w > 0) portfolio[e.ticker] = w;
                });
                window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "backtest" }));
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("quantedge:loadPortfolio", {
                    detail: { p: portfolio, ic: 100000, cb: 15, bt: "SPY", r: "1Y", rb: "quarterly" },
                  }));
                }, 80);
              }}
              className="mt-2 w-full py-1.5 rounded-lg text-[10px] font-medium bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center gap-1 transition tabular-nums"
              title={t('按当前市值占比生成组合并跳转到回测引擎')}
            >
              <Activity size={11} /> {t('按市值权重 → 加入回测')}
            </button>
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
            const currency = currencySymbol(stk?.currency);
            const hasPos = (e.shares || 0) > 0;
            const isHK = e.ticker?.endsWith(".HK");
            const mainLabel = isHK
              ? (lang === 'zh' ? (stk?.nameCN || STOCK_CN_NAMES[e.ticker] || stk?.name || e.name) : (stk?.name || e.name || STOCK_CN_NAMES[e.ticker])) || e.ticker
              : e.ticker;
            const subLabel = isHK ? e.ticker : e.name;
            return (
              <div key={e.id} className={`relative w-full text-left p-3 rounded-xl transition-all border cursor-pointer group ${sel?.id === e.id ? "bg-indigo-500/8 border-indigo-500/30" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04]"}`} onClick={() => { setSel(e); setMobileShowDetail(true); }}>
                <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${ret >= 0 ? "bg-up" : "bg-down"}`} />
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
                  {(e.tags || []).map(tag => {
                    const tc = TAG_COLORS[tag] || { bg: "bg-white/5", text: "text-[#a0aec0]", border: "border-white/10" };
                    return <span key={tag} className={`px-1.5 py-0.5 rounded text-[9px] border ${tc.bg} ${tc.text} ${tc.border}`}>{tag}</span>;
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
          const currency = currencySymbol(stk?.currency);
          return (
            <div className="flex flex-col gap-3">
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

              <PositionEditor entry={sel} currency={currency} onUpdate={(patch) => updateEntry(sel.id, patch)} />

              {/* H4: AI 复盘助手触发条 */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-500/[0.06] via-violet-500/[0.06] to-cyan-500/[0.06] border border-indigo-500/15">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base">🤖</span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-white">{t('AI 复盘助手')}</div>
                    <div className="text-[9px] text-[#a0aec0]">{t('用 Claude 帮你做反事实 / 卖出策略 / 加仓 / 风险分析')}</div>
                  </div>
                </div>
                <button onClick={() => setAiOpen(true)}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/35 border border-indigo-400/30 transition shrink-0">
                  {t('生成 Prompt')} →
                </button>
              </div>

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

      {/* C12: CSV 导入弹窗 */}
      {csvImportOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setCsvImportOpen(false); setCsvPreview(null); setCsvImportError(""); }}>
          <div className="w-full max-w-2xl max-h-[85vh] glass-card border border-white/15 shadow-2xl shadow-black/60 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
              <div className="flex items-center gap-2">
                <Database size={14} className="text-cyan-400" />
                <span className="text-sm font-medium text-white">{t('从 CSV 导入持仓')}</span>
                <span className="text-[9px] text-[#778] font-mono">{t('富途 / IB / 雪球 / 通用')}</span>
              </div>
              <button onClick={() => { setCsvImportOpen(false); setCsvPreview(null); setCsvImportError(""); }}
                className="p-1 rounded hover:bg-white/10 text-[#778] hover:text-white transition">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {!csvPreview ? (
                <>
                  <div className="text-[11px] text-[#a0aec0] leading-relaxed">
                    {t('上传 CSV 文件 — 系统会自动识别股票代码 / 数量 / 成本 / 日期列。常见列名：')}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="glass-card p-2">
                      <div className="text-[9px] text-cyan-300 mb-1 font-semibold">{t('支持的列名')}</div>
                      <div className="text-[#a0aec0] space-y-0.5">
                        <div><span className="text-[#778]">代码:</span> symbol / ticker / 代码 / 股票代码</div>
                        <div><span className="text-[#778]">数量:</span> quantity / shares / qty / 数量 / 持仓</div>
                        <div><span className="text-[#778]">成本:</span> price / cost / avg / 成本 / 均价 / 买入价</div>
                        <div><span className="text-[#778]">日期:</span> date / 日期 / 时间 / 买入日期</div>
                      </div>
                    </div>
                    <div className="glass-card p-2">
                      <div className="text-[9px] text-cyan-300 mb-1 font-semibold">{t('示例 CSV')}</div>
                      <pre className="text-[#a0aec0] text-[9px] leading-relaxed">{`代码,数量,均价,日期
NVDA,100,420.5,2025-03-15
AAPL,50,189.2,2025-04-01
00700.HK,200,310,2025-04-10`}</pre>
                    </div>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden"
                    onChange={(e) => handleCsvFile(e.target.files?.[0])} />
                  <button onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3 rounded-lg border-2 border-dashed border-cyan-500/30 hover:border-cyan-500/60 hover:bg-cyan-500/5 text-cyan-400 transition flex items-center justify-center gap-2 text-xs font-medium">
                    <Upload size={14} /> {t('选择 CSV 文件')}
                  </button>
                  {csvImportError && (
                    <div className="text-[10px] text-down bg-down/10 border border-down/20 rounded p-2">{csvImportError}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#a0aec0]">
                      {t('解析到 {n} 行，勾选后导入', { n: csvPreview.rows.length })}
                    </span>
                    <div className="flex gap-1">
                      <button onClick={() => setCsvPreview({ rows: csvPreview.rows.map(r => ({ ...r, _selected: true })) })}
                        className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0]">
                        {t('全选')}
                      </button>
                      <button onClick={() => setCsvPreview({ rows: csvPreview.rows.map(r => ({ ...r, _selected: false })) })}
                        className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0]">
                        {t('全不选')}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-auto max-h-[40vh] glass-card p-0">
                    <table className="w-full text-[10px] tabular-nums">
                      <thead className="sticky top-0 bg-[var(--bg-card)] border-b border-white/8">
                        <tr>
                          <th className="px-2 py-1.5 text-left w-8"></th>
                          <th className="px-2 py-1.5 text-left text-[#778]">{t('代码')}</th>
                          <th className="px-2 py-1.5 text-right text-[#778]">{t('数量')}</th>
                          <th className="px-2 py-1.5 text-right text-[#778]">{t('成本')}</th>
                          <th className="px-2 py-1.5 text-left text-[#778]">{t('日期')}</th>
                          <th className="px-2 py-1.5 text-right text-[#778]">{t('在库')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.rows.map((r, i) => {
                          const inLib = liveStocks.some(s => s.ticker === r.ticker);
                          return (
                            <tr key={i} className={`border-b border-white/[0.04] hover:bg-white/[0.02] ${!r._selected ? 'opacity-40' : ''}`}>
                              <td className="px-2 py-1">
                                <input type="checkbox" checked={r._selected}
                                  onChange={(e) => {
                                    const rows = [...csvPreview.rows];
                                    rows[i] = { ...rows[i], _selected: e.target.checked };
                                    setCsvPreview({ rows });
                                  }} />
                              </td>
                              <td className="px-2 py-1 font-mono text-white">{r.ticker}</td>
                              <td className="px-2 py-1 text-right font-mono text-[#a0aec0]">{r.qty}</td>
                              <td className="px-2 py-1 text-right font-mono text-[#a0aec0]">{r.cost}</td>
                              <td className="px-2 py-1 font-mono text-[#a0aec0]">{r.date}</td>
                              <td className="px-2 py-1 text-right">
                                {inLib ? (
                                  <span className="text-[9px] text-up">✓</span>
                                ) : (
                                  <span className="text-[9px] text-amber-400">{t('需添加')}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-[9px] text-[#778] leading-relaxed">
                    {t('已勾选的行将作为新的投资记录加入。「在库」标记表示该标的已在平台股票池中（可获取实时价格）。')}
                  </div>
                </>
              )}
            </div>
            {csvPreview && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/8 shrink-0">
                <button onClick={() => { setCsvPreview(null); setCsvImportError(""); }}
                  className="text-[11px] px-3 py-1.5 rounded text-[#a0aec0] hover:text-white hover:bg-white/5">
                  ← {t('重新选择文件')}
                </button>
                <button onClick={importCsvEntries}
                  disabled={csvPreview.rows.filter(r => r._selected).length === 0}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/35 border border-cyan-400/30 disabled:opacity-40 disabled:cursor-not-allowed">
                  {t('导入 {n} 条记录', { n: csvPreview.rows.filter(r => r._selected).length })}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* H4: AI 复盘助手 Modal */}
      {aiOpen && sel && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setAiOpen(false)}>
          <div className="w-full max-w-3xl max-h-[88vh] glass-card border border-white/15 shadow-2xl shadow-black/60 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-base">🤖</span>
                <span className="text-sm font-medium text-white">{t('AI 复盘助手')}</span>
                <span className="text-[9px] text-[#778] font-mono">{sel.ticker}</span>
              </div>
              <button onClick={() => setAiOpen(false)} className="p-1 rounded hover:bg-white/10 text-[#778] hover:text-white transition">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {/* 选择分析角度 */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#778] mb-1.5">{t('选择分析角度')}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { k: 'counterfactual', icon: '🔁', label: t('反事实'), desc: t('如果当时没买…') },
                    { k: 'exit',          icon: '🚪', label: t('卖出策略'), desc: t('什么时候止盈/止损') },
                    { k: 'addmore',       icon: '➕', label: t('加仓时机'), desc: t('加仓 / 不加的条件') },
                    { k: 'risk',          icon: '⚠️', label: t('风险评估'), desc: t('尾部风险 + 对冲') },
                  ].map(opt => {
                    const active = aiAngle === opt.k;
                    return (
                      <button key={opt.k}
                        onClick={() => setAiAngle(opt.k)}
                        className={`text-left px-2.5 py-2 rounded-lg border transition ${active ? 'bg-indigo-500/15 border-indigo-400/40 text-white' : 'bg-white/[0.03] border-white/8 text-[#a0aec0] hover:bg-white/[0.06]'}`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span>{opt.icon}</span>
                          <span className="text-xs font-medium">{opt.label}</span>
                          {active && <Check size={11} className="ml-auto text-indigo-300" />}
                        </div>
                        <div className="text-[9px] text-[#778]">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Prompt 预览 */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#778] mb-1.5 flex items-center justify-between">
                  <span>{t('生成的 Prompt 预览')}</span>
                  <span className="font-mono text-[#667]">{generatePrompt().length} {t('字')}</span>
                </div>
                <pre className="glass-card p-3 text-[10px] font-mono leading-relaxed text-[#a0aec0] whitespace-pre-wrap max-h-[40vh] overflow-auto select-text">{generatePrompt()}</pre>
              </div>
              <div className="text-[10px] text-[#778] leading-relaxed bg-white/[0.02] rounded p-2">
                💡 {t('当前 MVP 模式：复制 Prompt → 粘贴到 claude.ai 或 ChatGPT。下一阶段我们会接入服务端 Claude API 实现一键自动复盘（需要在 Vercel 配置 ANTHROPIC_API_KEY 环境变量）。')}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/8 shrink-0">
              <button onClick={() => setAiOpen(false)}
                className="text-[11px] px-3 py-1.5 rounded text-[#a0aec0] hover:text-white hover:bg-white/5">
                {t('取消')}
              </button>
              <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer"
                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white border border-white/10 transition">
                {t('打开 claude.ai')} ↗
              </a>
              <button onClick={copyPrompt}
                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/35 border border-indigo-400/30 transition flex items-center gap-1">
                {aiCopied ? <><Check size={11} /> {t('已复制')}</> : <>{t('复制 Prompt')} 📋</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Journal;
