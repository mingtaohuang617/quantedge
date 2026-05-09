import React, { useState, useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";

// 市场温度历史曲线 + W5000 + HMM 牛% 三线对照 + bear regime 红色色块
export default function CompositeChart({ history, range, setRange }) {
  const ranges = [
    { id: "1Y", days: 252 },
    { id: "3Y", days: 252 * 3 },
    { id: "5Y", days: 252 * 5 },
    { id: "ALL", days: Infinity },
  ];

  const [showHmm, setShowHmm] = useState(true);

  const { chartData, visibleRegimes } = useMemo(() => {
    if (!history?.dates?.length) return { chartData: [], visibleRegimes: [] };
    const n = history.dates.length;
    const cur = ranges.find(r => r.id === range) || ranges[2];
    const start = Math.max(0, n - cur.days);
    const hmmBull = history.hmm_history?.bull;
    const data = history.dates.slice(start).map((d, i) => {
      const idx = start + i;
      return {
        date: d,
        temp: history.market_temperature[idx],
        bench: history.benchmark?.values?.[idx],
        hmmBull: hmmBull && hmmBull[idx] != null ? hmmBull[idx] * 100 : null,
      };
    });
    if (!data.length) return { chartData: data, visibleRegimes: [] };
    const visStart = data[0].date;
    const visEnd = data[data.length - 1].date;
    const segs = (history.regimes || []).filter(s => s.regime === "bear" && s.end >= visStart && s.start <= visEnd);
    const clipped = segs.map(s => ({
      ...s,
      x1: s.start < visStart ? visStart : s.start,
      x2: s.end > visEnd ? visEnd : s.end,
    }));
    return { chartData: data, visibleRegimes: clipped };
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
    if (name === "L3 温度") return val.toFixed(1);
    if (name === "HMM 牛%") return val.toFixed(0) + "%";
    if (name === "W5000") return val.toLocaleString();
    return val;
  };

  const hasHmm = chartData.some(d => d.hmmBull != null);

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <div className="text-sm font-medium text-white/85 flex items-center gap-2">
            市场温度历史 · 与 Wilshire 5000 走势对照
            {history?.current_regime && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                history.current_regime === "bull"
                  ? "text-emerald-300 bg-emerald-500/10 border-emerald-400/30"
                  : "text-red-300 bg-red-500/10 border-red-400/30"
              }`} title="Lunde-Timmermann 20% 阈值机械标注">
                当前 · {history.current_regime === "bull" ? "牛 ↑" : "熊 ↓"}
              </span>
            )}
          </div>
          <div className="text-[10px] text-white/40 mt-0.5">
            {chartData[0]?.date} → {chartData[chartData.length - 1]?.date} · {chartData.length} 个交易日
            {visibleRegimes.length > 0 && ` · ${visibleRegimes.length} 段熊市`}
          </div>
        </div>
        <div className="flex gap-1 items-center">
          {hasHmm && (
            <button
              onClick={() => setShowHmm(!showHmm)}
              className={`px-2 py-0.5 rounded text-[11px] border transition-colors mr-2 ${
                showHmm
                  ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
                  : "bg-white/[0.03] border-white/[0.08] text-white/45 hover:text-white"
              }`}
              title="叠加 HMM 牛市概率到温度曲线"
            >HMM 牛% {showHmm ? "✓" : "○"}</button>
          )}
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
          {visibleRegimes.map((s, i) => (
            <ReferenceArea
              key={`bear-${i}`}
              yAxisId="left"
              x1={s.x1}
              x2={s.x2}
              fill="rgba(239, 68, 68, 0.10)"
              stroke="rgba(239, 68, 68, 0.25)"
              strokeWidth={0}
              ifOverflow="hidden"
            />
          ))}
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#94a3b8' }}
            formatter={tipFmt}
          />
          <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#fb923c" strokeWidth={1.8}
                dot={false} name="L3 温度" isAnimationActive={false} />
          {showHmm && hasHmm && (
            <Line yAxisId="left" type="monotone" dataKey="hmmBull" stroke="#34d399" strokeWidth={1.2}
                  strokeDasharray="3 3" dot={false} name="HMM 牛%" isAnimationActive={false} />
          )}
          <Line yAxisId="right" type="monotone" dataKey="bench" stroke="#94a3b8" strokeWidth={1}
                dot={false} name="W5000" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
