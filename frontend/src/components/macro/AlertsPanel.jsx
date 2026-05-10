import React, { useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { useLang } from "../../i18n.jsx";

// 告警 ID 持久化 set — 用于"NEW"标记
// 第一次看到的 alert id 会高亮 ~3 秒，之后写入 localStorage 不再标记
const SEEN_KEY = "quantedge_macro_seen_alerts";
function readSeenAlerts() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function writeSeenAlerts(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set))); } catch {}
}

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

function AlertCard({ a, isNew }) {
  const { t } = useLang();
  const st = ALERT_STYLE[a.level] || ALERT_STYLE.info;
  return (
    <div className={`border rounded-lg p-3 ${st.cls} ${isNew ? "ring-1 ring-amber-300/40" : ""}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${st.badge}`}>
          {t(st.label)}
        </span>
        {isNew && (
          <span
            className="text-[9px] px-1 py-0.5 rounded font-bold border bg-amber-300/20 text-amber-200 border-amber-300/50 animate-pulse"
            title={t("自上次访问后新增的告警")}
          >
            NEW
          </span>
        )}
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
          {t("建议")}：{a.action}
        </div>
      )}
      <button
        onClick={() => {
          // 先切 tab（触发 lazy load + 挂载），再 setTimeout 派发信号，
          // 确保 ScoringDashboard 的 useEffect listener 已注册。
          // 30ms 与现有 selectStock 跨 tab 模式一致。
          window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "scoring" }));
          setTimeout(() => window.dispatchEvent(new CustomEvent("quantedge:macroSignal", {
            detail: { id: a.id, kind: a.kind, level: a.level, title: a.title, summary: a.summary, action: a.action },
          })), 30);
        }}
        className="mt-2 text-[11px] font-medium flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity group"
        title={t("切到评分仪表盘，结合此宏观信号评估持仓")}
      >
        {t("查看对持仓的影响")}
        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  );
}

export default function AlertsPanel({ alerts }) {
  const { t } = useLang();
  // 启动时快照"已见 ID"：避免 useEffect 写后立即清空"NEW"
  const [seenAtMount] = useState(() => readSeenAlerts());

  // 在 alerts 渲染后 ~2 秒，把当前所有 id 写入 localStorage
  // → 下次访问这些 id 不再有 NEW 标记
  useEffect(() => {
    if (!alerts || alerts.length === 0) return;
    const tid = setTimeout(() => {
      const merged = new Set(seenAtMount);
      alerts.forEach(a => { if (a.id) merged.add(a.id); });
      writeSeenAlerts(merged);
    }, 2000);
    return () => clearTimeout(tid);
  }, [alerts, seenAtMount]);

  if (!alerts || alerts.length === 0) return null;
  // 排序：critical → warning → info；同级按 kind=top→bottom→neutral
  const order = { critical: 0, warning: 1, info: 2 };
  const kindOrder = { top: 0, bottom: 1, neutral: 2 };
  const sorted = [...alerts].sort((a, b) =>
    (order[a.level] - order[b.level]) || (kindOrder[a.kind] - kindOrder[b.kind])
  );
  const newCount = sorted.filter(a => a.id && !seenAtMount.has(a.id)).length;
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 mb-4">
      <div className="text-xs text-white/55 mb-2 flex items-center gap-2">
        <span>{t("L5 双重确认告警")}</span>
        <span className="text-white/30">· {alerts.length} {t("条活跃")}</span>
        {newCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-300/20 text-amber-200 border border-amber-300/40 animate-pulse">
            {newCount} {t("新")}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {sorted.map((a, i) => (
          <AlertCard key={a.id || i} a={a} isNew={a.id && !seenAtMount.has(a.id)} />
        ))}
      </div>
    </div>
  );
}
