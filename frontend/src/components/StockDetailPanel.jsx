// ─────────────────────────────────────────────────────────────
// StockDetailPanel — 候选股详情面板（点 ticker 弹出）
// ─────────────────────────────────────────────────────────────
// 用途：用户在中栏候选股表点击 ticker 时，弹出公司概览：
//   - 基本信息（ticker / name / market·exchange / sector·industry / marketCap）
//   - 5 维财务（PE / PB / 股息率 / ROE / D/E）— 直接读 universe item 上的字段
//   - 命中赛道 chips（matched_supertrends + match_reasons tooltip）
//   - 「加入观察」CTA
//
// 设计：
//   - 字段直接从 candidate 取，零额外 fetch（universe 已包含全部）
//   - 缺字段显示 "—" 不报错
//   - 与 WatchlistCard 视觉风格一致（glass-card + 8/9/10 字号纪律）
// ─────────────────────────────────────────────────────────────
import React from "react";
import { X, Plus, Activity } from "lucide-react";

function fmtMcap(mc) {
  if (mc == null) return "—";
  if (mc >= 1e12) return `${(mc / 1e12).toFixed(2)}T`;
  if (mc >= 1e9) return `${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `${(mc / 1e6).toFixed(0)}M`;
  return `${mc.toFixed(0)}`;
}

function fmtNum(v, prec = 2) {
  return typeof v === "number" && isFinite(v) ? v.toFixed(prec) : "—";
}

function fmtPct(v) {
  return typeof v === "number" && isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—";
}

/** 取赛道名（与 Screener10x.trendName 同逻辑，但本地拷贝） */
function defaultTrendName(supertrends) {
  return (id) => supertrends.find((s) => s.id === id)?.name || id;
}

export default function StockDetailPanel({
  open,
  item,
  supertrends = [],
  onClose,
  onAddObservation,
}) {
  if (!open || !item) return null;
  const trendName = defaultTrendName(supertrends);
  const mc = item.marketCap;
  const mcStr = fmtMcap(mc);

  // 5 维财务行
  const financialRows = [
    { label: "PE", value: fmtNum(item.pe, 1), hint: "市盈率 — 越低越便宜" },
    { label: "PB", value: fmtNum(item.pb, 2), hint: "市净率 — 银行/REIT 更重要" },
    { label: "股息率", value: fmtPct(item.dividend_yield), hint: "年化股息率" },
    { label: "ROE", value: fmtPct(item.roe), hint: "净资产收益率 — > 15% 优秀" },
    { label: "D/E", value: fmtNum(item.debt_to_equity, 2), hint: "负债权益比 — 越低越安全" },
  ];

  const hasAnyFinancial = financialRows.some((r) => r.value !== "—");

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/8">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[14px] font-bold text-white">{item.ticker}</span>
            <span className="text-[11px] text-[#d0d7e2] truncate" title={item.name}>
              {item.name || item.ticker}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#a0aec0] hover:text-white transition-colors p-1 rounded hover:bg-white/10"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
          {/* 基本信息 grid */}
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <Cell label="市场" value={[item.market, item.exchange].filter(Boolean).join(" · ") || "—"} />
            <Cell label="市值" value={mcStr} valueClass="font-mono" />
            <Cell label="板块" value={item.sector || "—"} fullWidth />
            <Cell label="行业" value={item.industry || "—"} fullWidth />
          </div>

          {/* 5 维财务（仅有任一字段时显示）*/}
          {hasAnyFinancial && (
            <div className="border border-emerald-500/20 rounded p-2 bg-emerald-500/[0.02]">
              <div className="text-[9px] text-emerald-300 font-medium mb-1 flex items-center gap-1">
                <Activity size={9} /> 财务指标
              </div>
              <div className="grid grid-cols-5 gap-1">
                {financialRows.map((r) => (
                  <div key={r.label} className="text-center" title={r.hint}>
                    <div className="text-[9px] text-[#7a8497]">{r.label}</div>
                    <div className={`text-[11px] font-mono ${r.value === "—" ? "text-[#5a6477]" : "text-white"}`}>
                      {r.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[8px] text-[#5a6477] mt-1">
                ⓘ 缺数据显示 — ；可跑 Finnhub enrich 补齐
              </div>
            </div>
          )}

          {/* 命中赛道 */}
          {Array.isArray(item.matched_supertrends) && item.matched_supertrends.length > 0 && (
            <div>
              <div className="text-[9px] text-[#a0aec0] mb-1">命中赛道</div>
              <div className="flex flex-wrap gap-1">
                {item.matched_supertrends.map((tid) => (
                  <span
                    key={tid}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30"
                  >
                    {trendName(tid)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* match_reasons 诊断（如有）*/}
          {item.match_reasons && Object.keys(item.match_reasons).length > 0 && (
            <details className="text-[9px] text-[#7a8497]">
              <summary className="cursor-pointer hover:text-[#a0aec0]">查看命中诊断</summary>
              <div className="mt-1 space-y-1 pl-2">
                {Object.entries(item.match_reasons).map(([tid, reasons]) => (
                  <div key={tid}>
                    <span className="text-cyan-300/80">{trendName(tid)}:</span>{" "}
                    {reasons.map((r, i) => (
                      <span key={i} className="text-[#a0aec0]">
                        {r.field}="{r.value}" 含 {(r.keywords || []).join("、")}
                        {i < reasons.length - 1 && " | "}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Footer — 加入观察 CTA */}
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-white/8 bg-white/[0.02]">
          <button
            onClick={onClose}
            className="px-3 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
          >
            关闭
          </button>
          {onAddObservation && (
            <button
              onClick={() => {
                onAddObservation(item);
                onClose?.();
              }}
              className="flex items-center gap-1 px-3 py-1 text-[11px] rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 transition"
            >
              <Plus size={11} /> 加入观察
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, valueClass = "", fullWidth = false }) {
  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <div className="text-[9px] text-[#7a8497]">{label}</div>
      <div className={`text-[11px] text-white ${valueClass}`} title={value}>{value}</div>
    </div>
  );
}
