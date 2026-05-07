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
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Target, Layers, Plus, Edit2, Trash2, RefreshCw, Loader, AlertCircle,
  Filter, Search, Database, Star, ChevronRight, Globe,
} from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import TenxItemEditor from "../components/TenxItemEditor.jsx";

const STRATEGY_LABEL = { growth: "成长型", value: "价值型" };

function fmtMcap(mc) {
  if (mc == null) return "—";
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(2)}T`;
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `${(mc / 1e6).toFixed(0)}M`;
  return `${mc.toFixed(0)}`;
}

export default function Screener10x() {
  // 数据状态
  const [supertrends, setSupertrends] = useState([]);
  const [items, setItems] = useState([]);                   // watchlist
  const [universeStats, setUniverseStats] = useState(null);
  // 筛选条件
  const [selectedTrends, setSelectedTrends] = useState([]); // string[]
  const [maxMcapInput, setMaxMcapInput] = useState(50);     // 单位 B（input 即时绑定）
  const [maxMcapB, setMaxMcapB] = useState(50);             // 300ms debounced，喂 runScreen
  const [includeETF, setIncludeETF] = useState(false);
  const [precise, setPrecise] = useState(false);    // 精严模式：仅核心赛道关键词
  const [markets, setMarkets] = useState(["US", "HK", "CN"]);
  const [search, setSearch] = useState("");
  // 候选 + loading
  const [candidates, setCandidates] = useState([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [errorCands, setErrorCands] = useState(null);
  // 编辑器
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);             // null = 新增
  const [pendingCandidate, setPendingCandidate] = useState(null);

  // ── 拉初始数据（watchlist + universe stats）─────────────
  const reloadWatchlist = useCallback(async () => {
    const json = await apiFetch("/watchlist/10x");
    if (json) {
      setSupertrends(json.supertrends || []);
      setItems(json.items || []);
    }
  }, []);

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
      const json = await apiFetch("/watchlist/10x/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supertrend_ids: selectedTrends,
          markets,
          max_market_cap_b: maxMcapB > 0 ? maxMcapB : null,
          include_etf: includeETF,
          exclude_in_watchlist: true,
          limit: 200,
          precise,
        }),
      });
      if (!json) throw new Error("后端无响应");
      setCandidates(json.items || []);
    } catch (e) {
      setErrorCands(String(e.message || e));
      setCandidates([]);
    } finally {
      setLoadingCands(false);
    }
  }, [selectedTrends, markets, maxMcapB, includeETF, precise]);

  // 自动 re-screen（赛道 / 市场 / 市值上限 / ETF / 精严切换都会触发）
  // 注：items 变化（加入/删除观察）不在此触发，由 handleSaved / handleDelete 主动处理：
  //   - 加入：本地 splice 掉刚加入的 ticker，省一次 screen
  //   - 删除：显式调 runScreen 让 ticker 回到候选
  useEffect(() => {
    if (selectedTrends.length > 0) runScreen();
    else setCandidates([]);
  }, [runScreen, selectedTrends]);

  // ── 候选搜索过滤（前端） ─────────────────────────────
  const filteredCandidates = useMemo(() => {
    if (!search) return candidates;
    const q = search.toLowerCase();
    return candidates.filter((c) =>
      c.ticker.toLowerCase().includes(q) || (c.name || "").toLowerCase().includes(q)
    );
  }, [candidates, search]);

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
    if (!window.confirm(`从观察列表删除 ${ticker}？`)) return;
    await apiFetch(`/watchlist/10x/${encodeURIComponent(ticker)}`, { method: "DELETE" });
    await reloadWatchlist();
    // 删除后让 ticker 重新进入候选列表
    if (selectedTrends.length > 0) runScreen();
  };

  const trendName = (id) => supertrends.find((s) => s.id === id)?.name || id;

  // ── 渲染 ────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 glass-card border border-white/10">
        <div className="flex items-center gap-3">
          <Target size={16} className="text-amber-400" />
          <span className="text-sm font-semibold text-white">10x 猎手</span>
          <span className="text-[10px] text-[#a0aec0]">成长型 · 价值型即将上线</span>
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
            {supertrends.map((s) => {
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
          <div className="px-3 py-2 border-t border-white/8 text-[9px] text-[#7a8497]">
            内置 4 个赛道，关键词在 backend/sector_mapping.py
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

            {/* 市值上限（300ms debounced） */}
            <label className="flex items-center gap-1 text-[10px] text-[#a0aec0]">
              max
              <input
                type="number"
                value={maxMcapInput}
                onChange={(e) => setMaxMcapInput(Number(e.target.value) || 0)}
                className="w-12 px-1 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none"
              />
              B
            </label>

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
                    <th className="text-left px-2 py-1.5">命中</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCandidates.map((c) => (
                    <tr key={c.ticker} className="border-t border-white/5 hover:bg-white/[0.02] transition">
                      <td className="px-2 py-1.5 font-mono text-[10px] text-white">{c.ticker}</td>
                      <td className="px-2 py-1.5 text-[10px] text-[#d0d7e2] truncate max-w-[140px]" title={c.name}>{c.name}</td>
                      <td className="px-2 py-1.5 text-[9px] text-[#a0aec0]">{c.market}{c.exchange && `·${c.exchange}`}</td>
                      <td className="px-2 py-1.5 text-[9px] text-[#a0aec0] truncate max-w-[100px]" title={c.sector || c.industry}>{c.sector || c.industry || "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtMcap(c.marketCap)}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-0.5">
                          {(c.matched_supertrends || []).map((t) => (
                            <span key={t} className="text-[8px] px-1 py-px rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30">{trendName(t)}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => openAdd(c)}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 transition"
                          title="加入观察"
                        >
                          <Plus size={9} /> 观察
                        </button>
                      </td>
                    </tr>
                  ))}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 观察项卡片
// ─────────────────────────────────────────────────────────────
function WatchlistCard({ item, trendName, onEdit, onDelete }) {
  const moat = item.moat_score || 0;
  return (
    <div className="glass-card p-2 border border-white/10 hover:border-white/20 transition group">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[12px] font-semibold text-white">{item.ticker}</span>
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
