// ─────────────────────────────────────────────────────────────
// ValueScreener — 价值股池主页面（独立 Tab）
// ─────────────────────────────────────────────────────────────
//
// 三段式工作流：
//   1) 顶栏：权重预设 / 自定义滑杆 + 筛选阈值（min_score / min_moat / max_pe / 分红年数）
//   2) 中栏：候选个股表（美股 universe top N → 评分 → 阈值过滤 → 排序）
//   3) 右栏：观察列表（已加入 strategy=value 的标的，可点详情看 ValueScoreCard）
//
// 端点：
//   GET    /api/value/weight-presets
//   GET    /api/watchlist/value
//   POST   /api/watchlist/value             加入观察（自动评分 + LLM 双调）
//   DELETE /api/watchlist/value/{ticker}
//   POST   /api/watchlist/value/screen      候选筛选
//   GET    /api/watchlist/value/{ticker}/score   实时重算
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Award, Plus, Trash2, RefreshCw, Loader, AlertCircle, Filter,
  Search, TrendingUp, Settings, Eye, X, BarChart3, Star,
} from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";
import ValueScoreCard from "../components/ValueScoreCard.jsx";
import BacktestModal from "../components/BacktestModal.jsx";

const DEFAULT_WEIGHTS = { moat: 30, financial: 25, mgmt: 15, valuation: 20, compound: 10 };

function fmtMcap(v) {
  if (v == null) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  return `${(v / 1e6).toFixed(0)}M`;
}

function fmtPct(v, digits = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export default function ValueScreener() {
  // 数据
  const [items, setItems] = useState([]);
  const [presets, setPresets] = useState({});
  // 权重
  const [weightPreset, setWeightPreset] = useState("user_default");
  const [customMode, setCustomMode] = useState(false);
  const [customWeights, setCustomWeights] = useState(DEFAULT_WEIGHTS);
  // 筛选
  const [minScore, setMinScore] = useState(60);
  const [minMoat, setMinMoat] = useState(0);
  const [maxPe, setMaxPe] = useState(0);  // 0 = 不限
  const [minDivStreak, setMinDivStreak] = useState(0);
  const [topN, setTopN] = useState(50);   // universe top N（保守起步）
  // 候选
  const [candidates, setCandidates] = useState([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [errCands, setErrCands] = useState(null);
  // 加入观察
  const [adding, setAdding] = useState(null);  // ticker 字符串
  // 详情
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // V5: 白名单 + 回测
  const [whitelist, setWhitelist] = useState([]);
  const [showWhitelist, setShowWhitelist] = useState(false);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [backtestData, setBacktestData] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestErr, setBacktestErr] = useState(null);

  // ── 初始拉数据 ─────────────────────────────────
  const reloadItems = useCallback(async () => {
    const json = await apiFetch("/watchlist/value");
    if (json && json.items) setItems(json.items);
  }, []);

  const reloadPresets = useCallback(async () => {
    const json = await apiFetch("/value/weight-presets");
    if (json && json.presets) setPresets(json.presets);
  }, []);

  const reloadWhitelist = useCallback(async () => {
    const json = await apiFetch("/value/whitelist");
    if (json && json.items) setWhitelist(json.items);
  }, []);

  useEffect(() => {
    reloadItems();
    reloadPresets();
    reloadWhitelist();
  }, [reloadItems, reloadPresets, reloadWhitelist]);

  const activeWeights = useMemo(
    () => (customMode ? customWeights : presets[weightPreset] || DEFAULT_WEIGHTS),
    [customMode, customWeights, weightPreset, presets]
  );
  const totalW = activeWeights.moat + activeWeights.financial + activeWeights.mgmt + activeWeights.valuation + activeWeights.compound;

  // ── 候选筛选 ───────────────────────────────────
  const runScreen = useCallback(async () => {
    setLoadingCands(true);
    setErrCands(null);
    try {
      const json = await apiFetch("/watchlist/value/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_value_score: minScore,
          min_moat: minMoat > 0 ? minMoat : null,
          max_pe: maxPe > 0 ? maxPe : null,
          min_div_streak: minDivStreak > 0 ? minDivStreak : null,
          weights_preset: customMode ? "user_default" : weightPreset,
          markets: ["US"],
          universe_top_n: topN,
          limit: 50,
        }),
      });
      if (!json) throw new Error("后端无响应");
      setCandidates(json.items || []);
    } catch (e) {
      setErrCands(String(e.message || e));
    } finally {
      setLoadingCands(false);
    }
  }, [minScore, minMoat, maxPe, minDivStreak, weightPreset, customMode, topN]);

  // ── 加入观察 ──────────────────────────────────
  const addToWatchlist = async (ticker) => {
    setAdding(ticker);
    try {
      const json = await apiFetch("/watchlist/value", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          weights_preset: customMode ? "user_default" : weightPreset,
        }),
      });
      if (!json || !json.ok) {
        alert("加入失败：" + (json?.detail || json?.error || "未知错误"));
      } else {
        await reloadItems();
        await runScreen();
      }
    } catch (e) {
      alert("网络错误：" + e.message);
    } finally {
      setAdding(null);
    }
  };

  // ── 删除 ──────────────────────────────────────
  const removeItem = async (ticker) => {
    if (!window.confirm(`从价值股池删除 ${ticker}？`)) return;
    await apiFetch(`/watchlist/value/${encodeURIComponent(ticker)}`, { method: "DELETE" });
    await reloadItems();
  };

  // ── 回测 ──────────────────────────────────────
  const runBacktest = async () => {
    setBacktestOpen(true);
    setBacktestLoading(true);
    setBacktestData(null);
    setBacktestErr(null);
    try {
      const json = await apiFetch("/value/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: [],
          lookback_years: 5,
          top_n: 30,
          weights_preset: customMode ? "user_default" : weightPreset,
          benchmark: "SPY",
          include_whitelist: true,
          include_watchlist: true,
        }),
      });
      if (!json) throw new Error("后端无响应");
      if (json.detail) throw new Error(json.detail);
      setBacktestData(json);
    } catch (e) {
      setBacktestErr(String(e.message || e));
    } finally {
      setBacktestLoading(false);
    }
  };

  // ── 一键加入白名单 ─────────────────────────────
  const addAllWhitelist = async () => {
    if (!window.confirm(`一键加入 ${whitelist.length} 只巴菲特持仓？\n每只都会跑评分 + LLM，预计 ${whitelist.length * 15} 秒。`)) return;
    const inWl = new Set(items.map((it) => it.ticker));
    for (const w of whitelist) {
      if (inWl.has(w.ticker)) continue;
      try {
        await apiFetch("/watchlist/value", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: w.ticker,
            thesis: w.thesis,
            tags: ["buffett", w.type],
            weights_preset: customMode ? "user_default" : weightPreset,
          }),
        });
      } catch (e) {
        console.warn(`加入 ${w.ticker} 失败`, e);
      }
    }
    await reloadItems();
  };

  // ── 详情 ──────────────────────────────────────
  const showDetail = async (ticker) => {
    setDetailLoading(true);
    try {
      const json = await apiFetch(`/watchlist/value/${encodeURIComponent(ticker)}/score?weights_preset=${customMode ? "user_default" : weightPreset}`);
      if (json) setDetailData(json);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── 渲染 ──────────────────────────────────────
  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      {/* 顶栏：权重 + 筛选 */}
      <div className="px-3 py-2 glass-card border border-white/10 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Award size={16} className="text-amber-400" />
          <span className="text-sm font-semibold text-white">价值股池</span>
          <span className="text-[10px] text-[#a0aec0]">巴菲特式 · 复利韧性</span>
          <div className="flex-1" />

          <button
            onClick={addAllWhitelist}
            disabled={whitelist.length === 0}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/40 transition disabled:opacity-50"
            title="一键加入巴菲特持仓 10 只作为对照基准"
          >
            <Star size={10} /> 巴菲特白名单
          </button>
          <button
            onClick={runBacktest}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition"
            title="基于当前权重 + 白名单 + 观察列表 跑 5 年历史回测"
          >
            <BarChart3 size={10} /> 历史回测
          </button>

          {/* 权重预设 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#a0aec0]">权重</span>
            <select
              value={customMode ? "_custom" : weightPreset}
              onChange={(e) => {
                if (e.target.value === "_custom") {
                  setCustomMode(true);
                } else {
                  setCustomMode(false);
                  setWeightPreset(e.target.value);
                }
              }}
              className="px-1.5 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none"
            >
              {Object.keys(presets).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
              <option value="_custom">自定义</option>
            </select>
          </div>
        </div>

        {/* 自定义权重滑杆 */}
        {customMode && (
          <div className="grid grid-cols-5 gap-2 pt-1 border-t border-white/8">
            {Object.entries(customWeights).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-[9px] text-[#a0aec0] mb-0.5">
                  <span>{({moat:"护城河",financial:"财务",mgmt:"管理层",valuation:"估值",compound:"复利"})[k]}</span>
                  <span className="font-mono text-white">{v}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={v}
                  onChange={(e) => setCustomWeights((w) => ({ ...w, [k]: parseInt(e.target.value) }))}
                  className="w-full"
                />
              </div>
            ))}
            <div className="col-span-5 text-[9px] text-[#7a8497] text-right">总和: {totalW}（自动归一化）</div>
          </div>
        )}

        {/* 筛选阈值 */}
        <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-white/8">
          <Filter size={11} className="text-indigo-300" />
          <Threshold label="最低总分" value={minScore} setValue={setMinScore} suffix="" />
          <Threshold label="最低护城河" value={minMoat} setValue={setMinMoat} suffix="" placeholder="0=不限" />
          <Threshold label="最高PE" value={maxPe} setValue={setMaxPe} suffix="" placeholder="0=不限" />
          <Threshold label="分红≥年" value={minDivStreak} setValue={setMinDivStreak} suffix="" placeholder="0=不限" />
          <Threshold label="扫描top" value={topN} setValue={setTopN} suffix="" />

          <div className="flex-1" />
          <button
            onClick={runScreen}
            disabled={loadingCands}
            className="flex items-center gap-1 px-3 py-1 text-[10px] rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 transition disabled:opacity-50"
          >
            {loadingCands ? <><Loader size={10} className="animate-spin" /> 扫描中</> : <><TrendingUp size={10} /> 开始筛选</>}
          </button>
        </div>
      </div>

      {/* 主体：左候选 + 右观察 */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 overflow-hidden min-h-0">

        {/* 中栏：候选股 */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <Filter size={12} className="text-amber-300" />
            <span className="text-[11px] font-semibold text-white">候选个股</span>
            <span className="text-[9px] text-[#a0aec0]">{candidates.length} 只</span>
          </div>
          <div className="flex-1 overflow-auto">
            {!loadingCands && candidates.length === 0 && !errCands && (
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                调好筛选条件后，点上方"开始筛选"<br />
                <span className="text-[9px]">（扫描 50 只约 1-2 分钟，每只调 yfinance 拉财报）</span>
              </div>
            )}
            {loadingCands && (
              <div className="h-full flex items-center justify-center gap-2 text-[11px] text-[#a0aec0]">
                <Loader size={12} className="animate-spin" /> 正在拉取财务 + 评分...
              </div>
            )}
            {errCands && (
              <div className="m-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-300/90 flex items-start gap-1">
                <AlertCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                <span>{errCands}</span>
              </div>
            )}
            {!loadingCands && candidates.length > 0 && (
              <table className="w-full text-[11px]">
                <thead className="text-[9px] text-[#7a8497] sticky top-0 bg-[var(--surface)]/95 backdrop-blur">
                  <tr>
                    <th className="text-left px-2 py-1.5">Ticker</th>
                    <th className="text-left px-2 py-1.5">名称</th>
                    <th className="text-right px-2 py-1.5">市值</th>
                    <th className="text-right px-2 py-1.5">PE</th>
                    <th className="text-right px-2 py-1.5">ROE</th>
                    <th className="text-right px-2 py-1.5">分红年</th>
                    <th className="text-right px-2 py-1.5">分</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const valScore = c.sub_scores?.valuation;
                    const undervalued = valScore != null && valScore >= 80;
                    const overvalued = valScore != null && valScore <= 20;
                    return (
                    <tr key={c.ticker} className="border-t border-white/5 hover:bg-white/[0.02] transition">
                      <td className="px-2 py-1.5 font-mono text-[10px] text-white flex items-center gap-1">
                        {c.ticker}
                        {undervalued && <span className="text-[7px] px-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">低估</span>}
                        {overvalued && <span className="text-[7px] px-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">高估</span>}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-[#d0d7e2] truncate max-w-[160px]" title={c.name}>{c.name || "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtMcap(c.marketCap)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{c.pe_ttm != null ? c.pe_ttm.toFixed(1) : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{fmtPct(c.roe_ttm, 0)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[#d0d7e2]">{c.dividend_streak_years || 0}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-[11px] font-bold text-amber-300">{c.value_score?.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => addToWatchlist(c.ticker)}
                          disabled={adding === c.ticker}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 transition disabled:opacity-50"
                        >
                          {adding === c.ticker ? <Loader size={9} className="animate-spin" /> : <Plus size={9} />}
                          观察
                        </button>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 右栏：观察列表 */}
        <div className="glass-card border border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center gap-2">
            <Award size={12} className="text-amber-400" />
            <span className="text-[11px] font-semibold text-white">观察列表</span>
            <span className="text-[9px] text-[#a0aec0]">{items.length}</span>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2">
            {items.length === 0 && (
              <div className="h-full flex items-center justify-center text-[11px] text-[#7a8497] p-4 text-center">
                还没有价值型观察项<br />
                <span className="text-[9px]">从中间候选表点 "观察" 加入</span>
              </div>
            )}
            {items.map((it) => (
              <ValueWatchCard
                key={it.ticker}
                item={it}
                onView={() => showDetail(it.ticker)}
                onDelete={() => removeItem(it.ticker)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 详情卡片 */}
      {detailLoading && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="text-white flex items-center gap-2"><Loader className="animate-spin" /> 加载评分中...</div>
        </div>
      )}
      {detailData && !detailLoading && (
        <ValueScoreCard
          ticker={detailData.ticker}
          data={detailData}
          onClose={() => setDetailData(null)}
        />
      )}

      {/* 回测结果 modal */}
      {backtestOpen && (
        <BacktestModal
          data={backtestData}
          loading={backtestLoading}
          error={backtestErr}
          onClose={() => setBacktestOpen(false)}
        />
      )}
    </div>
  );
}

// ── 子组件 ──────────────────────────────────────────────
function Threshold({ label, value, setValue, suffix = "", placeholder = "" }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-[#a0aec0]">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
        placeholder={placeholder}
        className="w-14 px-1 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none"
      />
      {suffix}
    </label>
  );
}

function ValueWatchCard({ item, onView, onDelete }) {
  const score = item.value_score;
  const subs = item.value_sub_scores || {};
  const tags = item.tags || [];
  const isBuffett = tags.includes("buffett");
  const valScore = subs.valuation;
  const undervalued = valScore != null && valScore >= 80;
  const overvalued = valScore != null && valScore <= 20;
  return (
    <div className="glass-card p-2 border border-white/10 hover:border-amber-500/30 transition group">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[12px] font-semibold text-white">{item.ticker}</span>
            {score != null && (
              <span className="text-[10px] font-mono text-amber-300">{score.toFixed(1)}</span>
            )}
            {isBuffett && (
              <span className="text-[8px] px-1 py-px rounded bg-violet-500/20 text-violet-200 border border-violet-500/40" title="巴菲特持仓">BUFFETT</span>
            )}
            {undervalued && (
              <span className="text-[8px] px-1 py-px rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" title="估值低估">低估</span>
            )}
            {overvalued && (
              <span className="text-[8px] px-1 py-px rounded bg-red-500/20 text-red-300 border border-red-500/40" title="估值高估">高估</span>
            )}
          </div>
          <div className="text-[9px] text-[#7a8497]">{item.weights_preset || "user_default"} · {item.scored_at?.slice(0, 10)}</div>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
          <button onClick={onView} className="p-1 rounded hover:bg-white/10 text-[#a0aec0] hover:text-amber-300" title="详情">
            <Eye size={10} />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-red-500/20 text-[#a0aec0] hover:text-red-300" title="删除">
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* 5 维子分迷你条 */}
      <div className="space-y-0.5 my-1">
        {[
          ["moat", "护"], ["financial", "财"], ["mgmt", "管"], ["valuation", "估"], ["compound", "复"],
        ].map(([k, label]) => {
          const v = subs[k];
          return (
            <div key={k} className="flex items-center gap-1.5 text-[9px]">
              <span className="text-[#7a8497] w-3">{label}</span>
              <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-amber-300/70 rounded-full"
                  style={{ width: `${v != null ? Math.max(2, Math.min(100, v)) : 0}%` }}
                />
              </div>
              <span className="font-mono text-white w-7 text-right">{v != null ? v.toFixed(0) : "—"}</span>
            </div>
          );
        })}
      </div>

      {item.explain?.总评 && (
        <div className="text-[9px] text-[#a0aec0] line-clamp-2 mt-1">
          {item.explain.总评}
        </div>
      )}
    </div>
  );
}
