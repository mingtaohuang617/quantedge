import React, { useState, useMemo } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { daysSince, factorLagThreshold } from "./shared.js";

// 数据状态横幅：聚合 composite 子模块 error + 因子级数据滞后/缺失，折叠展示。
// 没问题时不渲染（除非 alwaysShow），避免干扰主信息流。
//
// 检测 4 类问题：
//   1. composite.hmm.error            — HMM 训练失败
//   2. composite.survival.error       — Kaplan-Meier 生存分析失败
//   3. factors 中 latest=null         — 因子完全没数据（同步失败）
//   4. factors 中 latest 滞后 > 阈值   — 数据陈旧（按频率分级）
//
function classifyFactorIssue(f) {
  if (!f.latest || f.latest.value_date == null) {
    return { kind: "missing", msg: "无最新数据" };
  }
  const lag = daysSince(f.latest.value_date);
  if (lag == null) return null;
  const threshold = factorLagThreshold(f.freq);
  if (lag > threshold) {
    return { kind: "lag", msg: `数据滞后 ${lag} 天（${f.freq} 频率阈值 ${threshold}d）`, lag };
  }
  return null;
}

export default function DataStatusBanner({ composite, factors }) {
  const [expanded, setExpanded] = useState(false);

  const issues = useMemo(() => {
    const list = [];
    if (composite?.hmm?.error) {
      list.push({ kind: "hmm", level: "warn", title: "HMM 三态模型不可用",
                  detail: composite.hmm.error });
    }
    if (composite?.survival?.error) {
      list.push({ kind: "survival", level: "info", title: "持续期预测不可用",
                  detail: composite.survival.error });
    }
    if (factors && factors.length > 0) {
      const factorIssues = factors
        .map(f => ({ f, issue: classifyFactorIssue(f) }))
        .filter(x => x.issue);
      if (factorIssues.length > 0) {
        const missing = factorIssues.filter(x => x.issue.kind === "missing").length;
        const lagged = factorIssues.filter(x => x.issue.kind === "lag").length;
        const parts = [];
        if (missing) parts.push(`${missing} 个无数据`);
        if (lagged) parts.push(`${lagged} 个滞后`);
        list.push({
          kind: "factors", level: lagged > 5 ? "warn" : "info",
          title: `${factorIssues.length} / ${factors.length} 个因子数据存在问题`,
          detail: parts.join(" · "),
          rows: factorIssues,
        });
      }
    }
    return list;
  }, [composite, factors]);

  if (issues.length === 0) return null;

  const hasWarn = issues.some(x => x.level === "warn");
  const tone = hasWarn
    ? "bg-amber-500/[0.06] border-amber-400/25 text-amber-200"
    : "bg-slate-500/[0.06] border-slate-400/20 text-slate-200";

  return (
    <div className={`border rounded-lg mb-4 ${tone}`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] rounded-lg transition-colors"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="text-xs font-medium">数据状态</span>
        <span className="text-[10px] opacity-70">· {issues.length} 项需关注</span>
        <span className="ml-auto text-[10px] opacity-60 font-mono">
          {issues.map(i => i.title.split(/[（(]/)[0]).slice(0, 2).join(" / ")}
          {issues.length > 2 && " …"}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/[0.06] pt-2">
          {issues.map((iss, i) => (
            <div key={i} className="text-[11px]">
              <div className="flex items-baseline gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[9px] border font-medium ${
                  iss.level === "warn"
                    ? "bg-amber-500/15 border-amber-400/40 text-amber-200"
                    : "bg-slate-500/15 border-slate-400/30 text-slate-300"
                }`}>
                  {iss.level === "warn" ? "WARN" : "INFO"}
                </span>
                <span className="font-medium opacity-90">{iss.title}</span>
                {iss.detail && <span className="opacity-60">— {iss.detail}</span>}
              </div>
              {iss.rows && iss.rows.length > 0 && (
                <div className="mt-1 ml-2 pl-2 border-l border-white/[0.08] space-y-0.5 max-h-40 overflow-y-auto">
                  {iss.rows.slice(0, 30).map((r, j) => (
                    <div key={j} className="text-[10px] font-mono opacity-75 flex items-baseline gap-2">
                      <span className="opacity-50">·</span>
                      <span className="flex-1 truncate">{r.f.factor_id}</span>
                      <span className="opacity-60">{r.f.market}/{r.f.freq}</span>
                      <span className="text-right w-32 truncate opacity-80">{r.issue.msg}</span>
                    </div>
                  ))}
                  {iss.rows.length > 30 && (
                    <div className="text-[10px] opacity-50">…还有 {iss.rows.length - 30} 个</div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="text-[10px] opacity-50 pt-1 border-t border-white/[0.05]">
            非致命错误，主面板仍可用。修复方法：本地跑 <code className="font-mono opacity-90">python backend/refresh_macro.py</code> 然后 <code className="font-mono opacity-90">python backend/export_macro_snapshot.py</code>。
          </div>
        </div>
      )}
    </div>
  );
}
