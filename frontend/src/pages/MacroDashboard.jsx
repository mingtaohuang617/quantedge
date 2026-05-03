// ─────────────────────────────────────────────────────────────
// MacroDashboard — 市场层面宏观因子看板（Phase 1 W1-2）
// 展示 backend/factors_lib 注册的因子：当前值 + 历史分位 + sparkline。
// 数据源：GET /api/macro/factors?sparkline=120
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from "react";
import { Globe, RefreshCw, AlertCircle, Loader } from "lucide-react";
import { apiFetch, MiniSparkline } from "../quant-platform.jsx";

const CATEGORY_LABEL = {
  valuation: "估值",
  liquidity: "流动性",
  breadth: "宽度",
  sentiment: "情绪",
  macro: "宏观",
  technical: "技术",
};

const CATEGORY_COLOR = {
  valuation: "text-amber-300 bg-amber-500/10 border-amber-400/30",
  liquidity: "text-cyan-300 bg-cyan-500/10 border-cyan-400/30",
  breadth: "text-violet-300 bg-violet-500/10 border-violet-400/30",
  sentiment: "text-pink-300 bg-pink-500/10 border-pink-400/30",
  macro: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  technical: "text-slate-300 bg-slate-500/10 border-slate-400/30",
};

// 5 段配色：低 = 冷蓝；高 = 暖红；中性 = 灰。具体方向解读由 description 解释。
const PCT_BAR_BG = (pct) => {
  if (pct == null) return "bg-slate-500/30";
  if (pct < 20) return "bg-blue-400/70";
  if (pct < 40) return "bg-cyan-400/70";
  if (pct < 60) return "bg-slate-400/70";
  if (pct < 80) return "bg-orange-400/70";
  return "bg-red-400/80";
};

const PCT_TEXT = (pct) => {
  if (pct == null) return "text-slate-400";
  if (pct < 20) return "text-blue-300";
  if (pct < 40) return "text-cyan-300";
  if (pct < 60) return "text-slate-200";
  if (pct < 80) return "text-orange-300";
  return "text-red-300";
};

function fmtRaw(x) {
  if (x == null) return "—";
  const abs = Math.abs(x);
  if (abs >= 1000) return x.toFixed(0);
  if (abs >= 100) return x.toFixed(1);
  if (abs >= 10) return x.toFixed(2);
  if (abs >= 1) return x.toFixed(3);
  return x.toFixed(4);
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.round((Date.now() - d.getTime()) / 86400000);
}

function FactorCard({ f }) {
  const pct = f.latest?.percentile;
  const sparkValues = f.sparkline?.values || [];
  const since = daysSince(f.latest?.value_date);

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 hover:border-indigo-400/30 transition-colors flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLOR[f.category] || ""}`}>
          {CATEGORY_LABEL[f.category] || f.category}
        </span>
        <span className="text-[10px] text-white/40 font-mono">
          {f.market} · {f.freq}
        </span>
      </div>

      <div className="text-sm font-mono font-semibold text-white/90 mb-1">
        {f.factor_id}
      </div>
      <div className="text-[11px] text-white/55 mb-3 line-clamp-2 leading-relaxed min-h-[28px]">
        {f.name}
      </div>

      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="text-2xl font-mono font-semibold text-white tabular-nums">
          {fmtRaw(f.latest?.raw_value)}
        </div>
        {sparkValues.length >= 2 && (
          <MiniSparkline data={sparkValues} w={92} h={30} />
        )}
      </div>

      <div className="space-y-1 mb-3">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-white/50">历史分位</span>
          <span className={`font-mono ${PCT_TEXT(pct)} font-semibold`}>
            {pct != null ? `${pct.toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
          {pct != null && (
            <div
              className={`h-full rounded-full ${PCT_BAR_BG(pct)}`}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          )}
        </div>
      </div>

      <div className="text-[10px] text-white/40 mb-2 font-mono">
        最后值: {f.latest?.value_date || "—"}
        {since != null && ` (${since}天前)`}
      </div>
      <div className="text-[11px] text-white/55 line-clamp-3 leading-relaxed flex-1">
        {f.description}
      </div>
    </div>
  );
}

export default function MacroDashboard() {
  const [factors, setFactors] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    const data = await apiFetch("/macro/factors?sparkline=120");
    if (data && Array.isArray(data)) {
      setFactors(data);
    } else {
      setError("加载失败：检查 backend 是否启动 + FRED_API_KEY 已设置 + 已运行 refresh_macro.py");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const categories = useMemo(() => {
    if (!factors) return [];
    const seen = new Set();
    const order = [];
    factors.forEach(f => {
      if (!seen.has(f.category)) { seen.add(f.category); order.push(f.category); }
    });
    return order;
  }, [factors]);

  const filtered = useMemo(() => {
    if (!factors) return [];
    if (filter === "all") return factors;
    return factors.filter(f => f.category === filter);
  }, [factors, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">宏观因子看板</h2>
          <span className="text-xs text-white/50">
            {factors ? `${filtered.length} / ${factors.length} 因子` : ""}
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs flex items-center gap-1.5 disabled:opacity-50 text-white/80"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {factors && factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
              filter === "all"
                ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-200"
                : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white"
            }`}
          >
            全部 ({factors.length})
          </button>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                filter === c
                  ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-200"
                  : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white"
              }`}
            >
              {CATEGORY_LABEL[c] || c} ({factors.filter(f => f.category === c).length})
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-400/30 rounded-lg text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !factors && (
        <div className="flex items-center justify-center py-12 text-white/50">
          <Loader className="w-5 h-5 animate-spin mr-2" /> 加载中…
        </div>
      )}

      {factors && factors.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-white/50 text-sm">
          没有因子。先在 backend 跑 <code className="font-mono text-indigo-300">python refresh_macro.py</code>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map(f => (
          <FactorCard key={`${f.factor_id}@${f.market}`} f={f} />
        ))}
      </div>
    </div>
  );
}
