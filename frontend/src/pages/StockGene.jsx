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
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Activity, Plus, Trash2, RefreshCw, Loader, AlertCircle, Check, X,
  Sparkles, Target, BarChart3, TrendingUp, Layers, ChevronRight,
  Edit2, Award,
} from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

const VERDICT_STYLE = {
  strong: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300" },
  moderate: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300" },
  neutral: { bg: "bg-slate-500/15", border: "border-slate-500/40", text: "text-slate-300" },
  weak: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300" },
  unknown: { bg: "bg-white/5", border: "border-white/15", text: "text-[#a0aec0]" },
};

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

export default function StockGene() {
  // 观察列表
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  // 引擎切换："trend" = 牛股特征器（8 维趋势）/"value" = 价值健康度（6 维）
  const [engine, setEngine] = useState("trend");
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
  const [addError, setAddError] = useState(null);
  // 横向对比
  const [peersInput, setPeersInput] = useState("");
  const [peersResults, setPeersResults] = useState(null);
  const [peersLoading, setPeersLoading] = useState(false);
  const [peersError, setPeersError] = useState(null);

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
      }),
    });
    if (!res?.ok) {
      setAddError(res?.detail || "添加失败");
      return;
    }
    // 重置表单
    setNewTicker(""); setNewName(""); setNewSector(""); setNewNotes("");
    setShowAddForm(false);
    await reload();
    setSelectedTicker(ticker);
    // 自动跑一次评分
    handleScore(ticker);
  };

  // ── 评分（单个，持久化） ───────────────────────────────
  // 根据当前 engine 调用对应路由：趋势 = /score，价值 = /value-score
  const handleScore = useCallback(async (ticker, eng = engine) => {
    setScoringTicker(ticker);
    try {
      const path = eng === "value"
        ? `/stock-gene/${encodeURIComponent(ticker)}/value-score`
        : `/stock-gene/${encodeURIComponent(ticker)}/score`;
      await apiFetch(path, { method: "POST" });
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
      const path = engine === "value" ? "/stock-gene/value/score-all" : "/stock-gene/score-all";
      await apiFetch(path, { method: "POST" });
      await reload();
    } finally {
      setBatchScoring(false);
    }
  };

  // ── 删除 ────────────────────────────────────────────────
  const handleDelete = async (ticker) => {
    if (!window.confirm(`从股性观察列表删除 ${ticker}？`)) return;
    await apiFetch(`/stock-gene/${encodeURIComponent(ticker)}`, { method: "DELETE" });
    if (selectedTicker === ticker) setSelectedTicker(null);
    await reload();
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
      const path = engine === "value"
        ? "/stock-gene/value/compare-peers"
        : "/stock-gene/compare-peers";
      const res = await apiFetch(path, {
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

  // ── 渲染 ────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 glass-card border border-white/10">
        <div className="flex items-center gap-3">
          <Activity size={16} className="text-emerald-400" />
          <span className="text-sm font-semibold text-white">股性检测 · Stock Gene</span>
          {/* 引擎切换：牛股特征器（趋势）/ 价值健康度 */}
          <div className="flex items-center gap-0.5 bg-white/5 rounded border border-white/10 p-0.5">
            <button
              onClick={() => setEngine("trend")}
              className={`px-2 py-0.5 text-[10px] rounded transition ${
                engine === "trend"
                  ? "bg-emerald-500/20 text-emerald-100 font-medium"
                  : "text-[#a0aec0] hover:text-white"
              }`}
              title="牛股特征器：米勒维尼趋势模板 + 欧奈尔 CANSLIM（8 维趋势）"
            >
              趋势 · 牛股
            </button>
            <button
              onClick={() => setEngine("value")}
              className={`px-2 py-0.5 text-[10px] rounded transition ${
                engine === "value"
                  ? "bg-cyan-500/20 text-cyan-100 font-medium"
                  : "text-[#a0aec0] hover:text-white"
              }`}
              title="价值健康度：Graham + Buffett（6 维基本面）"
            >
              价值 · 健康度
            </button>
          </div>
          <span className="text-[10px] text-[#a0aec0] hidden lg:inline">
            {engine === "trend"
              ? "8 个牛股特征 — 趋势/动量/相对强度"
              : "6 个价值特征 — 估值/盈利/现金流/负债"}
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
            title={`对所有观察项跑${engine === "value" ? "价值" : "趋势"}评分`}
          >
            {batchScoring ? <Loader size={11} className="animate-spin" /> : <Sparkles size={11} />}
            批量评分
          </button>
          <button
            onClick={reload}
            className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
          >
            <RefreshCw size={10} /> 刷新
          </button>
        </div>
      </div>

      {/* 三栏 grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_340px] gap-3 overflow-hidden min-h-0">

        {/* ─── 左栏：观察列表 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <Layers size={12} className="text-emerald-300" />
            <span className="text-[11px] font-semibold text-white">观察列表</span>
            <span className="text-[9px] text-[#a0aec0] ml-auto">{items.length} 只</span>
          </div>

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
            {items.map((it) => {
              // 双引擎评分：trend = last_result（8 维）/ value = last_value_result（6 维）
              const tR = it.last_result;
              const vR = it.last_value_result;
              const activeR = engine === "value" ? vR : tR;
              const tStyle = verdictStyle(tR?.verdict);
              const vStyle = verdictStyle(vR?.verdict);
              const aStyle = engine === "value" ? vStyle : tStyle;
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
                    {/* 双引擎评分徽章：T = 趋势 / V = 价值 */}
                    <div className="ml-auto flex items-center gap-1">
                      <span
                        className={`px-1 py-0.5 rounded text-[9px] font-mono font-semibold border ${
                          tR ? `${tStyle.bg} ${tStyle.border} ${tStyle.text}`
                             : "bg-white/5 text-[#7a8497] border-white/15"
                        } ${engine === "trend" ? "ring-1 ring-emerald-400/50" : ""}`}
                        title={tR ? `趋势 ${tR.score}/${tR.max_score} · ${tR.verdict.label}` : "趋势未评分"}
                      >
                        T {tR ? `${tR.score}/${tR.max_score}` : "—"}
                      </span>
                      <span
                        className={`px-1 py-0.5 rounded text-[9px] font-mono font-semibold border ${
                          vR ? `${vStyle.bg} ${vStyle.border} ${vStyle.text}`
                             : "bg-white/5 text-[#7a8497] border-white/15"
                        } ${engine === "value" ? "ring-1 ring-cyan-400/50" : ""}`}
                        title={vR ? `价值 ${vR.score}/${vR.max_score} · ${vR.verdict.label}` : "价值未评分"}
                      >
                        V {vR ? `${vR.score}/${vR.max_score}` : "—"}
                      </span>
                    </div>
                  </div>
                  {it.name && (
                    <div className="text-[10px] text-[#d0d7e2] truncate">{it.name}</div>
                  )}
                  {activeR?.verdict && (
                    <div className={`text-[9px] mt-0.5 ${aStyle.text}`}>{activeR.verdict.label}</div>
                  )}
                  {it.sector && (
                    <div className="text-[9px] text-[#7a8497] mt-0.5 truncate">行业：{it.sector}</div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-white/8">
            {showAddForm ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <input
                    value={newTicker}
                    onChange={(e) => setNewTicker(e.target.value)}
                    placeholder="ticker (AAPL)"
                    className="flex-1 px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
                    autoFocus
                  />
                  <select
                    value={newMarket}
                    onChange={(e) => setNewMarket(e.target.value)}
                    className="px-1 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white"
                  >
                    <option value="US">US</option>
                    <option value="HK">HK</option>
                    <option value="CN">CN</option>
                  </select>
                </div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="名称（可选）"
                  className="w-full px-2 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
                />
                <input
                  value={newSector}
                  onChange={(e) => setNewSector(e.target.value)}
                  placeholder="行业（如 半导体 / Technology）"
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
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                disabled={isDemoMode}
                className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={11} /> 添加观察
              </button>
            )}
          </div>
        </div>

        {/* ─── 中栏：评分详情 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          {!selectedItem ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
              ← 选择左侧的观察项查看{engine === "value" ? "价值健康度（6 维）" : "牛股特征（8 维）"}评分
            </div>
          ) : (
            <ScoreDetail
              item={selectedItem}
              engine={engine}
              onRescore={() => handleScore(selectedItem.ticker)}
              onDelete={() => handleDelete(selectedItem.ticker)}
              scoring={scoringTicker === selectedItem.ticker}
            />
          )}
        </div>

        {/* ─── 右栏：同行业横向对比 ─── */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <BarChart3 size={12} className="text-cyan-300" />
            <span className="text-[11px] font-semibold text-white">同行业横向对比</span>
            <span className={`text-[9px] px-1 py-px rounded border ${
              engine === "value"
                ? "bg-cyan-500/15 text-cyan-200 border-cyan-500/40"
                : "bg-emerald-500/15 text-emerald-200 border-emerald-500/40"
            }`}>
              {engine === "value" ? "价值" : "趋势"}
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
function ScoreDetail({ item, engine, onRescore, onDelete, scoring }) {
  // engine = "trend" → last_result（8 维）；"value" → last_value_result（6 维）
  const r = engine === "value" ? item.last_value_result : item.last_result;
  const engineLabel = engine === "value" ? "价值" : "趋势";
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
            <div className="text-right">
              <VerdictBadge verdict={r.verdict} score={r.score} maxScore={r.max_score} available={r.available} />
              <div className="text-[9px] text-[#7a8497] mt-1">
                {formatChecked(r.checked_at)}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onRescore}
            disabled={scoring}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition disabled:opacity-40 disabled:cursor-not-allowed ${
              engine === "value"
                ? "bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-500/40"
                : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40"
            }`}
            title={`重新跑${engineLabel}评分（${engine === "value" ? "6 个价值特征" : "8 个牛股特征"}）`}
          >
            {scoring ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
            {r ? `重新评分（${engineLabel}）` : `立即评分（${engineLabel}）`}
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-white/5 hover:bg-red-500/20 text-[#a0aec0] hover:text-red-300 border border-white/10 hover:border-red-500/30 transition"
          >
            <Trash2 size={10} /> 删除
          </button>
        </div>
        {item.notes && (
          <div className="mt-2 px-2 py-1.5 bg-white/[0.02] border-l-2 border-amber-500/40 rounded text-[10px] text-[#d0d7e2] leading-relaxed">
            {item.notes}
          </div>
        )}
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
          <FeatureRow key={f.id} feature={f} index={idx + 1} prefix={engine === "value" ? "V" : "F"} />
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
        <div className="text-[8px] text-[#7a8497] mt-0.5">
          {available} 项可判断
        </div>
      )}
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
        共 {result.count} 只 · 按{engine === "value" ? "价值" : "趋势"}评分降序
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
                  className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[8px] ${
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
