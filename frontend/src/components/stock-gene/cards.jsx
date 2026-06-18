// Stock Gene 卡片组件：VerdictBadge / FeatureRow / PositionCard / PeersTable / NotesBlock / TagsRow
import React, { useEffect, useState } from "react";
import {
  AlertCircle, Award, Briefcase, Check, Edit2, Loader, Plus, X,
} from "lucide-react";
import { eng, verdictStyle } from "./helpers.js";
import { TagsInput } from "./filters.jsx";
import { useLang } from "../../i18n.jsx";

// ─── VerdictBadge ───────────────────────────────────────────────────
export function VerdictBadge({ verdict, score, maxScore, available }) {
  const v = verdictStyle(verdict);
  return (
    <div className={`inline-flex flex-col items-center px-3 py-2 rounded-lg border ${v.bg} ${v.border}`}>
      <div className="flex items-center gap-1">
        <Award size={12} className={v.text} />
        <span className={`text-[11px] font-semibold ${v.text}`}>{verdict?.label || "—"}</span>
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={`text-[18px] font-bold font-mono ${v.text}`}>{score}</span>
        <span className="text-[10px] text-[#a0aec0]">/ {maxScore}</span>
      </div>
      {available != null && available < maxScore && (
        <div className="text-[9px] text-[#7a8497] mt-0.5">
          {available} 项可判断
        </div>
      )}
    </div>
  );
}

// ─── FeatureRow — 单个特征行 ────────────────────────────────────────
export function FeatureRow({ feature, index, prefix = "F" }) {
  const passed = feature.pass;
  const unavailable = feature.available === false;
  const Icon = passed ? Check : (unavailable ? AlertCircle : X);
  const iconColor = passed ? "text-emerald-400" : (unavailable ? "text-amber-400" : "text-rose-400");
  const borderColor = passed ? "border-emerald-500/30" : (unavailable ? "border-amber-500/20" : "border-white/8");
  const bgHover = passed ? "hover:bg-emerald-500/5" : "hover:bg-white/[0.02]";
  return (
    <div className={`mb-2 p-2.5 rounded border ${borderColor} ${bgHover} transition`}>
      <div className="flex items-start gap-2">
        <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-white/5 ${iconColor}`}>
          <Icon size={12} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[#7a8497] font-mono">{prefix}{index}</span>
            <span className={`text-[11px] font-medium ${passed ? "text-emerald-200" : (unavailable ? "text-amber-300/80" : "text-[#d0d7e2]")}`}>
              {feature.label}
            </span>
          </div>
          {feature.value && feature.value !== "—" && (
            <div className="text-[10px] text-[#a0aec0] mt-1 font-mono tabular-nums">
              {feature.value}
            </div>
          )}
          {feature.detail && (
            <div className="text-[10px] text-[#7a8497] mt-1 leading-relaxed">
              {feature.detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PositionCard — 详情面板的持仓信息卡 ────────────────────────────
export function PositionCard({ position }) {
  const { t } = useLang();
  const p = position;
  const upPct = p.unrealized_pnl_pct;
  const pnlColor = upPct == null ? "text-[#a0aec0]" : upPct >= 0 ? "text-emerald-300" : "text-rose-300";
  const arrow = upPct == null ? "" : upPct >= 0 ? "▲" : "▼";
  const fmt = (v, prec = 2) => v == null ? "—" : v.toLocaleString("en-US", {
    minimumFractionDigits: prec, maximumFractionDigits: prec,
  });
  return (
    <div className="mt-2 px-2 py-2 bg-amber-500/8 border-l-2 border-amber-500/50 rounded">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Briefcase size={11} className="text-amber-400" />
        <span className="text-[10px] font-semibold text-amber-100">{t('持仓信息')}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums">
        <div className="flex justify-between">
          <span className="text-[#a0aec0]">{t('持股')}</span>
          <span className="font-mono text-white">{fmt(p.net_qty, 0)} {t('股')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#a0aec0]">{t('均价')}</span>
          <span className="font-mono text-white">${fmt(p.avg_cost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#a0aec0]">{t('现价')}</span>
          <span className="font-mono text-white">${fmt(p.latest_close)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#a0aec0]">{t('市值')}</span>
          <span className="font-mono text-white">${fmt(p.market_value)}</span>
        </div>
        <div className="col-span-2 mt-1 pt-1 border-t border-amber-500/15 flex justify-between">
          <span className="text-[#a0aec0]">{t('浮动 P&L')}</span>
          <span className={`font-mono font-semibold ${pnlColor}`}>
            {arrow} ${fmt(p.unrealized_pnl)}
            {upPct != null && (
              <span className="ml-1 text-[9px]">({upPct >= 0 ? "+" : ""}{fmt(upPct, 1)}%)</span>
            )}
          </span>
        </div>
        {p.realized_pnl !== 0 && (
          <div className="col-span-2 flex justify-between">
            <span className="text-[#a0aec0]">{t('已实现 P&L')}</span>
            <span className={`font-mono ${p.realized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              ${fmt(p.realized_pnl)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PeersTable — 横向对比表格（右栏结果）─────────────────────────────
export function PeersTable({ result, onAdd, engine = "trend" }) {
  const { t } = useLang();
  const items = result.items || [];
  const sorted = [...items].sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    return sb - sa;
  });
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-[#7a8497] px-1">
        {t('共')} {result.count} {t('只 · 按 {f} 评分降序', { f: eng(engine).framework })}
      </div>
      {sorted.map((it) => {
        if (it.error) {
          return (
            <div key={it.ticker} className="p-2 bg-red-500/5 border border-red-500/20 rounded text-[10px]">
              <div className="flex items-center gap-1">
                <span className="font-mono text-white">{it.ticker}</span>
                <span className="text-red-300 ml-auto">{t('错误')}</span>
              </div>
              <div className="text-[9px] text-red-300/80 mt-0.5">{it.error}</div>
            </div>
          );
        }
        const v = verdictStyle(it.verdict);
        return (
          <div key={it.ticker} className={`p-2 rounded border ${v.bg} ${v.border}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-mono text-[11px] font-semibold text-white">{it.ticker}</span>
              <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${v.text}`}>
                {it.score}/{it.max_score}
              </span>
              <button
                onClick={() => onAdd(it.ticker, "", it.market || "US", it.sector || "")}
                className="p-0.5 rounded hover:bg-white/10 text-[#a0aec0] hover:text-white transition"
                title="加入观察列表"
              >
                <Plus size={11} />
              </button>
            </div>
            <div className={`text-[9px] ${v.text}`}>{it.verdict?.label}</div>
            <div className="flex items-center gap-0.5 mt-1.5">
              {(it.features || []).map((f) => (
                <div
                  key={f.id}
                  title={`${f.label}: ${f.pass ? "PASS" : (f.available === false ? "N/A" : "FAIL")} — ${f.value || ""}`}
                  className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[9px] ${
                    f.pass
                      ? "bg-emerald-500/30 text-emerald-200"
                      : f.available === false
                      ? "bg-amber-500/15 text-amber-300/60"
                      : "bg-white/5 text-[#5a6477]"
                  }`}
                >
                  {f.pass ? "✓" : (f.available === false ? "?" : "·")}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── NotesBlock — 备注卡（hover 编辑铅笔，空态"添加备注"）──────────
export function NotesBlock({ item, editing, draft, onDraftChange, onEdit, onSave, onCancel, saving }) {
  if (editing) {
    return (
      <div className="mt-2 px-2 py-1.5 bg-amber-500/5 border border-amber-500/30 rounded space-y-1">
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="备注（空字符串可清除）"
          rows={3}
          autoFocus
          className="w-full px-1.5 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-[#d0d7e2] focus:outline-none focus:border-amber-500/50 resize-none leading-relaxed"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader size={9} className="animate-spin" /> : <Check size={9} />} 保存
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] border border-white/10 disabled:opacity-40"
          >
            取消
          </button>
        </div>
      </div>
    );
  }
  if (item.notes) {
    return (
      <div className="mt-2 px-2 py-1.5 bg-white/[0.02] border-l-2 border-amber-500/40 rounded text-[10px] text-[#d0d7e2] leading-relaxed group/notes relative">
        <span className="whitespace-pre-line">{item.notes}</span>
        <button
          onClick={onEdit}
          aria-label="编辑备注"
          className="absolute top-1 right-1 opacity-0 group-hover/notes:opacity-100 p-0.5 rounded hover:bg-white/10 text-[#a0aec0] hover:text-white transition"
          title="编辑备注"
        >
          <Edit2 size={9} />
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={onEdit}
      className="mt-2 px-2 py-1 text-[9px] text-[#7a8497] hover:text-white hover:bg-white/5 rounded transition flex items-center gap-1"
      title="添加备注"
    >
      <Edit2 size={9} /> 添加备注
    </button>
  );
}

// ─── TagsRow — 详情面板的紧凑 tags 行（直接增删，自动 PUT 保存）─────
export function TagsRow({ tags, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tags);
  useEffect(() => { setDraft(tags); }, [tags]);
  if (!editing && tags.length === 0) {
    return (
      <button
        onClick={() => { setDraft([]); setEditing(true); }}
        className="mt-2 px-2 py-1 text-[9px] text-[#7a8497] hover:text-violet-300 hover:bg-violet-500/10 rounded transition flex items-center gap-1"
        title="添加标签"
      >
        <Plus size={9} /> 添加标签
      </button>
    );
  }
  if (editing) {
    return (
      <div className="mt-2 space-y-1">
        <TagsInput tags={draft} onChange={setDraft} placeholder="回车 / 逗号 / 空格添加" />
        <div className="flex items-center gap-1">
          <button
            onClick={async () => { await onChange(draft); setEditing(false); }}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/40 transition"
          >
            <Check size={9} /> 保存
          </button>
          <button
            onClick={() => { setDraft(tags); setEditing(false); }}
            className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[#a0aec0] border border-white/10"
          >
            取消
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 group/tags">
      {tags.map(t => (
        <span key={t} className="text-[9px] px-1 py-px rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
          #{t}
        </span>
      ))}
      <button
        onClick={() => { setDraft(tags); setEditing(true); }}
        className="opacity-0 group-hover/tags:opacity-100 transition p-0.5 rounded hover:bg-white/10 text-[#7a8497] hover:text-white"
        title="编辑标签"
      >
        <Edit2 size={9} />
      </button>
    </div>
  );
}
