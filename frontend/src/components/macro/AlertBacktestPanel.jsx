import React, { useState, useMemo } from "react";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { useLang } from "../../i18n.jsx";
import { backtestAlerts, RULE_META } from "../../lib/alertBacktest.js";

// L5 告警回测面板 — 过去 5Y 历史上每条规则触发后 SPX 21d/63d/252d 前向收益
//
// 折叠默认；点击展开 → 表格 + 横向 mean bar
// 用 composite_history 在前端计算（pure JS，无后端调用）
//
// 不渲染：history 缺、计算结果空
export default function AlertBacktestPanel({ history }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const result = useMemo(() => backtestAlerts(history), [history]);
  if (!result || Object.keys(result.rules).length === 0) return null;

  const period = `${result.period.start} → ${result.period.end} · ${result.period.days} ${t("个交易日")}`;

  // 按触发次数降序（neutral 通常最多，放最后参考）
  const sortedRules = Object.entries(result.rules).sort((a, b) => {
    // neutral 放最后做基线
    if (a[0] === "rule_neutral") return 1;
    if (b[0] === "rule_neutral") return -1;
    return b[1].count - a[1].count;
  });

  const fmtPct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const cls = (v) => v == null ? "text-white/40" : v >= 0 ? "text-emerald-300" : "text-rose-300";

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-left hover:bg-white/[0.02] rounded transition-colors -m-1 p-1"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-sm font-medium text-white/85">{t("L5 告警历史回测")}</span>
          <span className="text-[10px] text-white/45">· {period}</span>
        </div>
        <span className="text-[10px] text-white/45">
          {sortedRules.length} {t("条规则")}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_3rem_4rem_4rem_4rem] gap-2 text-[9px] text-white/45 uppercase px-1">
            <span>{t("规则")}</span>
            <span className="text-right">{t("触发")}</span>
            <span className="text-right">21d</span>
            <span className="text-right">63d</span>
            <span className="text-right">252d</span>
          </div>

          {sortedRules.map(([id, stats]) => {
            const meta = RULE_META[id];
            if (!meta) return null;
            const r21 = stats.forward[21];
            const r63 = stats.forward[63];
            const r252 = stats.forward[252];
            return (
              <details key={id} className="text-[10px] font-mono">
                <summary className="grid grid-cols-[1fr_3rem_4rem_4rem_4rem] gap-2 items-center px-1 py-1 hover:bg-white/[0.02] rounded cursor-pointer">
                  <span className="font-sans text-white/85 truncate" title={meta.desc}>
                    {t(meta.label)}
                  </span>
                  <span className="text-right text-white/65 tabular-nums">{stats.count}</span>
                  <span className={`text-right tabular-nums ${cls(r21?.mean)}`}>{fmtPct(r21?.mean)}</span>
                  <span className={`text-right tabular-nums ${cls(r63?.mean)}`}>{fmtPct(r63?.mean)}</span>
                  <span className={`text-right tabular-nums ${cls(r252?.mean)}`}>{fmtPct(r252?.mean)}</span>
                </summary>
                {/* 展开后：median + 胜率 + 触发期范围 */}
                <div className="mt-1 ml-4 mb-1 grid grid-cols-3 gap-2 text-[9px] text-white/55">
                  {[
                    ["21d", r21],
                    ["63d", r63],
                    ["252d", r252],
                  ].map(([h, st]) => (
                    <div key={h} className="bg-white/[0.02] border border-white/[0.04] rounded p-1.5">
                      <div className="text-white/40">{h}</div>
                      {st ? (
                        <>
                          <div>n={st.n} · {t("中位")} {fmtPct(st.median)}</div>
                          <div>{t("胜率")} {(st.winRate * 100).toFixed(0)}%</div>
                        </>
                      ) : (
                        <div className="text-white/30">{t("数据不足")}</div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="ml-4 mb-2 text-[9px] text-white/35 font-sans">
                  {t(meta.desc)} · {stats.first} → {stats.last}
                </div>
              </details>
            );
          })}

          <div className="text-[9px] text-white/30 pt-1 border-t border-white/[0.04]">
            {t("回测仅覆盖 composite-level 规则（temp / 子分），per-factor 信用/VIX 规则未涵盖；触发去抖 5 个交易日")}
          </div>
        </div>
      )}
    </div>
  );
}
