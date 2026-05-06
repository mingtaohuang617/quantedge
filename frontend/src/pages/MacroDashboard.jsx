// ─────────────────────────────────────────────────────────────
// MacroDashboard — 市场层面宏观因子看板（Phase 1 W1-2）
// 展示 backend/factors_lib 注册的因子：当前值 + 历史分位 + sparkline。
// 数据源：GET /api/macro/factors?sparkline=120
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from "react";
import { Globe, RefreshCw, AlertCircle, Loader } from "lucide-react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
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

// 0-100 牛熊温度配色（与因子卡片的"分位"配色不同：这是方向化的）
const TEMP_BAR = (s) => {
  if (s == null) return "bg-slate-500/30";
  if (s < 20) return "bg-red-400/80";
  if (s < 40) return "bg-orange-400/70";
  if (s < 60) return "bg-slate-400/70";
  if (s < 80) return "bg-lime-400/70";
  return "bg-emerald-400/80";
};

const TEMP_TEXT = (s) => {
  if (s == null) return "text-slate-400";
  if (s < 20) return "text-red-300";
  if (s < 40) return "text-orange-300";
  if (s < 60) return "text-slate-200";
  if (s < 80) return "text-lime-300";
  return "text-emerald-300";
};

const TEMP_LABEL = (s) => {
  if (s == null) return "—";
  if (s < 15) return "极熊";
  if (s < 35) return "偏熊";
  if (s < 50) return "中性偏熊";
  if (s < 65) return "中性偏牛";
  if (s < 85) return "偏牛";
  return "极牛";
};

function CompositeChart({ history, range, setRange }) {
  const ranges = [
    { id: "1Y", days: 252 },
    { id: "3Y", days: 252 * 3 },
    { id: "5Y", days: 252 * 5 },
    { id: "ALL", days: Infinity },
  ];

  const chartData = useMemo(() => {
    if (!history?.dates?.length) return [];
    const n = history.dates.length;
    const cur = ranges.find(r => r.id === range) || ranges[2];
    const start = Math.max(0, n - cur.days);
    return history.dates.slice(start).map((d, i) => {
      const idx = start + i;
      return {
        date: d,
        temp: history.market_temperature[idx],
        bench: history.benchmark?.values?.[idx],
      };
    });
  }, [history, range]);

  if (!history?.dates?.length) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-4 text-center text-white/50 text-sm">
        加载历史温度曲线中…
      </div>
    );
  }

  const tickFmt = (d) => d?.length === 10 ? d.slice(2, 7) : d;
  const tipFmt = (val, name) => {
    if (val == null) return "—";
    if (name === "温度") return val.toFixed(1);
    if (name === "W5000") return val.toLocaleString();
    return val;
  };

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <div className="text-sm font-medium text-white/85">市场温度历史 · 与 Wilshire 5000 走势对照</div>
          <div className="text-[10px] text-white/40 mt-0.5">
            {chartData[0]?.date} → {chartData[chartData.length - 1]?.date} · {chartData.length} 个交易日
          </div>
        </div>
        <div className="flex gap-1">
          {ranges.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                range === r.id
                  ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-200"
                  : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white"
              }`}
            >{r.id}</button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tickFormatter={tickFmt} minTickGap={60}
                 tick={{ fill: '#64748b', fontSize: 10 }} stroke="rgba(255,255,255,0.1)" />
          <YAxis yAxisId="left" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]}
                 tick={{ fill: '#fb923c', fontSize: 10 }} stroke="rgba(251,146,60,0.3)" width={32} />
          <YAxis yAxisId="right" orientation="right"
                 tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="rgba(148,163,184,0.3)" width={50}
                 tickFormatter={(v) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
          <ReferenceLine yAxisId="left" y={50} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={tipFmt}
          />
          <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#fb923c" strokeWidth={1.8}
                dot={false} name="温度" isAnimationActive={false} />
          <Line yAxisId="right" type="monotone" dataKey="bench" stroke="#94a3b8" strokeWidth={1}
                dot={false} name="W5000" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}


function CompositePanel({ data }) {
  if (!data) return null;
  const temp = data.market_temperature;
  const cats = data.by_category || {};
  const order = ["valuation", "liquidity", "sentiment", "breadth"];

  return (
    <div className="bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] rounded-xl p-5 mb-4">
      <div className="flex items-start gap-6 flex-wrap">
        {/* 市场温度大数字 */}
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs text-white/55 mb-1.5">市场温度（综合 17 因子方向化加权）</div>
          <div className="flex items-baseline gap-3">
            <span className={`text-5xl font-mono font-bold tabular-nums ${TEMP_TEXT(temp)}`}>
              {temp != null ? temp.toFixed(1) : "—"}
            </span>
            <span className="text-white/40 text-sm">/ 100</span>
            <span className={`text-sm font-medium ${TEMP_TEXT(temp)}`}>
              {TEMP_LABEL(temp)}
            </span>
          </div>
          <div className="mt-3 h-2 bg-white/[0.05] rounded-full overflow-hidden">
            {temp != null && (
              <div className={`h-full rounded-full ${TEMP_BAR(temp)}`} style={{ width: `${Math.max(2, temp)}%` }} />
            )}
          </div>
          <div className="mt-2 text-[10px] text-white/40 flex justify-between font-mono">
            <span>0 极熊</span><span>50 中性</span><span>100 极牛</span>
          </div>
        </div>

        {/* 4 类子分 */}
        <div className="flex-[2] min-w-[400px] grid grid-cols-2 sm:grid-cols-4 gap-3">
          {order.map(cat => {
            const info = cats[cat];
            const score = info?.score;
            const w = data.weights?.[cat];
            const cnLabel = CATEGORY_LABEL[cat] || cat;
            return (
              <div key={cat} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-white/60 font-medium">{cnLabel}</span>
                  <span className="text-[10px] text-white/35 font-mono">w{w != null ? Math.round(w*100) : "?"}</span>
                </div>
                <div className={`text-2xl font-mono font-semibold tabular-nums ${TEMP_TEXT(score)}`}>
                  {score != null ? score.toFixed(1) : "—"}
                </div>
                <div className="mt-1.5 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                  {score != null && (
                    <div className={`h-full rounded-full ${TEMP_BAR(score)}`} style={{ width: `${Math.max(2, score)}%` }} />
                  )}
                </div>
                <div className="text-[10px] text-white/40 mt-1.5">
                  {info?.factor_count ?? 0} 因子均值
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 因子方向 badge：让"高=牛 vs 高=熊"一目了然
const DIRECTION_BADGE = (direction, contrarian) => {
  if (direction === "higher_bullish") {
    return {
      icon: "↑", label: "高=牛", title: "分位越高越利好（如 ERP/200MA 占比/Fed 扩表）",
      cls: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
    };
  }
  if (direction === "lower_bullish" && contrarian) {
    return {
      icon: "↕", label: "低=牛·极端反向", title: "正常区低分位利好；极端区（<10/>90%）反向。VIX/SKEW/HY 这类。",
      cls: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-400/30",
    };
  }
  if (direction === "lower_bullish") {
    return {
      icon: "↓", label: "低=牛", title: "分位越低越利好（如 PE/CAPE/Buffett，估值越便宜越好）",
      cls: "text-sky-300 bg-sky-500/10 border-sky-400/30",
    };
  }
  return {
    icon: "─", label: "中性", title: "无明确单调方向",
    cls: "text-slate-300 bg-slate-500/10 border-slate-400/30",
  };
};

function FactorCard({ f }) {
  const pct = f.latest?.percentile;
  const sparkValues = f.sparkline?.values || [];
  const since = daysSince(f.latest?.value_date);
  const dirBadge = DIRECTION_BADGE(f.direction, f.contrarian_at_extremes);

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 hover:border-indigo-400/30 transition-colors flex flex-col">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLOR[f.category] || ""}`}>
            {CATEGORY_LABEL[f.category] || f.category}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${dirBadge.cls} cursor-help select-none`}
            title={dirBadge.title}
          >
            <span className="font-mono mr-0.5">{dirBadge.icon}</span>
            {dirBadge.label}
          </span>
        </div>
        <span className="text-[10px] text-white/40 font-mono shrink-0">
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
  const [composite, setComposite] = useState(null);
  const [history, setHistory] = useState(null);
  const [range, setRange] = useState("3Y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    const [data, comp] = await Promise.all([
      apiFetch("/macro/factors?sparkline=120"),
      apiFetch("/macro/composite"),
    ]);
    if (data && Array.isArray(data)) {
      setFactors(data);
      setComposite(comp || null);
    } else {
      setError("加载失败：检查 backend 是否启动 + FRED_API_KEY 已设置 + 已运行 refresh_macro.py");
    }
    setLoading(false);
    // 历史曲线异步加载（不阻塞首屏）
    apiFetch("/macro/composite/history?start=2018-01-01").then(setHistory);
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
    <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
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

      <CompositePanel data={composite} />

      <CompositeChart history={history} range={range} setRange={setRange} />

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
