import React, { useMemo, useEffect } from "react";
import { X } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  CATEGORY_LABEL, CATEGORY_COLOR, PCT_BAR_BG, PCT_TEXT,
  DIRECTION_BADGE, fmtRaw, daysSince, factorLagThreshold,
} from "./shared.js";

// 因子详情弹窗：FactorCard 点击触发，展示完整 sparkline + 描述 + 统计
//
// 数据来源：snapshot 模式下 sparkline.values 截尾到 120 点（足够看趋势/拐点）。
// 想要全历史（数百到数千点）需扩展 export_macro_snapshot.py 的 sparkline_window，
// 但会显著增加 snapshot 体积，目前不做。
export default function FactorDetailModal({ f, onClose }) {
  // ESC 关闭 + 防滚穿
  useEffect(() => {
    if (!f) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [f, onClose]);

  const chartData = useMemo(() => {
    if (!f?.sparkline?.values) return [];
    const dates = f.sparkline.dates || [];
    return f.sparkline.values.map((v, i) => ({
      date: dates[i] || `t${i}`,
      value: v,
    }));
  }, [f]);

  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const vals = chartData.map(d => d.value).filter(v => v != null && !isNaN(v));
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    return { min, max, avg, median, n: vals.length };
  }, [chartData]);

  if (!f) return null;

  const pct = f.latest?.percentile;
  const since = daysSince(f.latest?.value_date);
  const dirBadge = DIRECTION_BADGE(f.direction, f.contrarian_at_extremes);
  const lagThresh = factorLagThreshold(f.freq);
  const lagged = since != null && since > lagThresh;

  // 时间窗口跨度
  const winLabel = chartData.length >= 2
    ? `${chartData[0].date} → ${chartData[chartData.length - 1].date}（${chartData.length} 点）`
    : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-white/[0.08] px-5 py-3 flex items-center gap-3 flex-wrap">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLOR[f.category] || ""}`}>
            {CATEGORY_LABEL[f.category] || f.category}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${dirBadge.cls}`}
                title={dirBadge.title}>
            <span className="font-mono mr-0.5">{dirBadge.icon}</span>{dirBadge.label}
          </span>
          <span className="text-base font-mono font-semibold text-white/95">{f.factor_id}</span>
          <span className="text-[11px] text-white/40 font-mono">{f.market} · {f.freq}</span>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded hover:bg-white/[0.06] text-white/50 hover:text-white/80"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 名称 + 描述 */}
          <div>
            <div className="text-sm font-medium text-white/85 mb-1">{f.name}</div>
            <div className="text-[11px] text-white/55 leading-relaxed">{f.description}</div>
          </div>

          {/* 当前值 + 分位 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
              <div className="text-[10px] text-white/45">最新原值</div>
              <div className="text-xl font-mono font-semibold text-white tabular-nums mt-0.5">
                {fmtRaw(f.latest?.raw_value)}
              </div>
              <div className={`text-[10px] mt-0.5 font-mono ${lagged ? "text-amber-300" : "text-white/40"}`}>
                {f.latest?.value_date || "—"}
                {since != null && ` (${since}d)`}
              </div>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
              <div className="text-[10px] text-white/45">历史分位</div>
              <div className={`text-xl font-mono font-semibold tabular-nums mt-0.5 ${PCT_TEXT(pct)}`}>
                {pct != null ? `${pct.toFixed(1)}%` : "—"}
              </div>
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden mt-1.5">
                {pct != null && (
                  <div className={`h-full ${PCT_BAR_BG(pct)}`} style={{ width: `${Math.max(2, pct)}%` }} />
                )}
              </div>
            </div>
            {stats && (
              <>
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
                  <div className="text-[10px] text-white/45">窗口 min / max</div>
                  <div className="text-sm font-mono font-semibold text-white/85 tabular-nums mt-0.5">
                    {fmtRaw(stats.min)} / {fmtRaw(stats.max)}
                  </div>
                  <div className="text-[10px] text-white/40 mt-0.5 font-mono">{stats.n} 个观测</div>
                </div>
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
                  <div className="text-[10px] text-white/45">均值 / 中位数</div>
                  <div className="text-sm font-mono font-semibold text-white/85 tabular-nums mt-0.5">
                    {fmtRaw(stats.avg)} / {fmtRaw(stats.median)}
                  </div>
                  <div className="text-[10px] text-white/40 mt-0.5 font-mono">{f.rolling_window_days}d 滚动窗</div>
                </div>
              </>
            )}
          </div>

          {/* 大图 sparkline */}
          {chartData.length >= 2 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-white/55">原值时间序列</div>
                <div className="text-[10px] text-white/35 font-mono">{winLabel}</div>
              </div>
              <div className="h-56 bg-white/[0.02] border border-white/[0.05] rounded-lg p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                      axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                      tickLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                      axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                      tickLine={false}
                      width={40}
                      tickFormatter={fmtRaw}
                    />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, fontSize: 11 }}
                      labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                      formatter={(v) => [fmtRaw(v), "原值"]}
                    />
                    {stats && (
                      <ReferenceLine y={stats.median} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3"
                                     label={{ value: "中位数", fontSize: 9, fill: "rgba(148,163,184,0.6)" }} />
                    )}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#818cf8"
                      strokeWidth={1.6}
                      dot={false}
                      activeDot={{ r: 3, fill: "#a5b4fc" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 最近 N 个观测表 */}
          {chartData.length > 0 && (
            <details className="bg-white/[0.02] border border-white/[0.05] rounded-lg" open={false}>
              <summary className="px-3 py-2 cursor-pointer text-[11px] text-white/55 select-none hover:text-white/75">
                最近 20 个观测（点击展开）
              </summary>
              <div className="px-3 pb-3 max-h-56 overflow-y-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead className="text-white/40 sticky top-0 bg-slate-900">
                    <tr>
                      <th className="text-left py-1">日期</th>
                      <th className="text-right py-1">原值</th>
                    </tr>
                  </thead>
                  <tbody className="text-white/75">
                    {chartData.slice(-20).reverse().map((d, i) => (
                      <tr key={i} className="border-t border-white/[0.04]">
                        <td className="py-0.5">{d.date}</td>
                        <td className="text-right tabular-nums">{fmtRaw(d.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="text-[10px] text-white/35 pt-2 border-t border-white/[0.04]">
            滚动窗 {f.rolling_window_days} 天 · {f.contrarian_at_extremes ? "极端反向（contrarian）" : "线性方向"}
          </div>
        </div>
      </div>
    </div>
  );
}
