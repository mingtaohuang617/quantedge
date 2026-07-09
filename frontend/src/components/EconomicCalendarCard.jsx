// ─────────────────────────────────────────────────────────────
// EconomicCalendarCard — 宏观看板「财经日历」卡
// ─────────────────────────────────────────────────────────────
// 读 calendarSnapshot.json（backend/enrich_calendar.py 离线抓 jin10 本周财经
// 日历，star>=3 高影响事件，随每日管道刷新）。无数据不渲染。
// ─────────────────────────────────────────────────────────────
import React from "react";
import { Calendar } from "lucide-react";
import { useLang } from "../i18n.jsx";
import calendarSnapshot from "../calendarSnapshot.json";

export default function EconomicCalendarCard() {
  const { t } = useLang();
  const events = Array.isArray(calendarSnapshot) ? calendarSnapshot : [];
  if (!events.length) return null;
  return (
    <div className="rounded-[14px] border p-3.5" style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Calendar className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[12px] font-semibold" style={{ color: "var(--fg-0)" }}>{t("财经日历")}</span>
        <span className="text-[10px]" style={{ color: "var(--fg-2)" }}>{t("本周 · 高影响")}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-1.5">
        {events.slice(0, 12).map((e, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] min-w-0">
            <span className="font-mono shrink-0" style={{ color: "var(--fg-2)" }}>{(e.time || "").slice(5, 16)}</span>
            <span className="text-amber-400 shrink-0 text-[9px]" title={`${e.star}`}>{"★".repeat(Math.min(e.star || 0, 4))}</span>
            <span className="flex-1 truncate" style={{ color: "var(--fg-1)" }} title={e.t}>{e.t}</span>
            {(e.cons != null || e.prev != null) && (
              <span className="font-mono shrink-0 text-[10px]" style={{ color: "var(--fg-2)" }} title={t("预期 / 前值")}>
                {e.cons != null ? e.cons : "—"}/{e.prev != null ? e.prev : "—"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
