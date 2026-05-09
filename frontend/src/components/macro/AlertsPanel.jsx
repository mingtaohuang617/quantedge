import React from "react";

// L5 双重确认告警面板配色
const ALERT_STYLE = {
  critical: {
    cls: "bg-red-500/10 border-red-400/40 text-red-200",
    badge: "bg-red-500/20 text-red-100 border-red-400/40",
    label: "严重",
  },
  warning: {
    cls: "bg-orange-500/8 border-orange-400/30 text-orange-100",
    badge: "bg-orange-500/15 text-orange-100 border-orange-400/30",
    label: "警示",
  },
  info: {
    cls: "bg-slate-500/8 border-slate-400/20 text-slate-200",
    badge: "bg-slate-500/15 text-slate-200 border-slate-400/20",
    label: "提示",
  },
};

const KIND_ICON = { top: "▲", bottom: "▼", neutral: "─" };

function AlertCard({ a }) {
  const st = ALERT_STYLE[a.level] || ALERT_STYLE.info;
  return (
    <div className={`border rounded-lg p-3 ${st.cls}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${st.badge}`}>
          {st.label}
        </span>
        <span className="text-base font-mono mr-0.5 opacity-70">{KIND_ICON[a.kind]}</span>
        <span className="text-sm font-medium flex-1 min-w-0">{a.title}</span>
      </div>
      <div className="text-[11px] opacity-85 mb-2 leading-relaxed">{a.summary}</div>
      {a.evidence?.length > 0 && (
        <div className="space-y-1 mb-2 pl-2 border-l border-white/10">
          {a.evidence.map((e, i) => (
            <div key={i} className="text-[10px] flex items-baseline gap-2 font-mono opacity-80">
              <span className="opacity-60">·</span>
              <span className="flex-1 truncate">{e.name}</span>
              <span className="tabular-nums">
                {e.raw_value != null ? Number(e.raw_value).toFixed(2) : "—"}
              </span>
              <span className="text-white/50 tabular-nums w-10 text-right">
                {e.percentile != null ? `${e.percentile.toFixed(0)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      {a.action && (
        <div className="text-[11px] font-medium pt-1 border-t border-white/5 opacity-90">
          建议：{a.action}
        </div>
      )}
    </div>
  );
}

export default function AlertsPanel({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  // 排序：critical → warning → info；同级按 kind=top→bottom→neutral
  const order = { critical: 0, warning: 1, info: 2 };
  const kindOrder = { top: 0, bottom: 1, neutral: 2 };
  const sorted = [...alerts].sort((a, b) =>
    (order[a.level] - order[b.level]) || (kindOrder[a.kind] - kindOrder[b.kind])
  );
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 mb-4">
      <div className="text-xs text-white/55 mb-2 flex items-center gap-2">
        <span>L5 双重确认告警</span>
        <span className="text-white/30">· {alerts.length} 条活跃</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {sorted.map((a, i) => <AlertCard key={a.id || i} a={a} />)}
      </div>
    </div>
  );
}
