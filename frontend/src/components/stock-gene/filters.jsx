// Stock Gene 过滤组件：VerdictFilterChips / TagFilterChips / TagsInput
import React, { useState } from "react";
import { X } from "lucide-react";
import { eng, VERDICT_STYLE } from "./helpers.js";

// ─── VerdictFilterChips — 多选切换 verdict.level，空 set = 不过滤 ─────
export function VerdictFilterChips({ value, onChange, engine }) {
  const labels = eng(engine).verdictLabels;
  const levels = ["strong", "moderate", "neutral", "weak"].map(id => ({
    id, label: labels[id], style: VERDICT_STYLE[id],
  }));
  const toggle = (id) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {levels.map(lv => {
        const on = value.has(lv.id);
        return (
          <button
            key={lv.id}
            onClick={() => toggle(lv.id)}
            className={`text-[9px] px-1.5 py-px rounded border transition ${
              on
                ? `${lv.style.bg} ${lv.style.border} ${lv.style.text}`
                : "bg-white/[0.02] border-white/10 text-[#7a8497] hover:text-white hover:border-white/20"
            }`}
            title={on ? `点击移除 ${lv.label} 过滤` : `点击只看 ${lv.label}`}
          >
            {lv.label}
          </button>
        );
      })}
      {value.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="text-[9px] px-1 text-[#7a8497] hover:text-white"
          title="清空所有 verdict 过滤"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─── TagFilterChips — 按现有 tag 动态渲染 ────────────────────────────
export function TagFilterChips({ allTags, value, onChange }) {
  const toggle = (t) => {
    const next = new Set(value);
    if (next.has(t)) next.delete(t); else next.add(t);
    onChange(next);
  };
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[9px] text-[#7a8497] mr-1">tag</span>
      {allTags.slice(0, 12).map(t => {
        const on = value.has(t);
        return (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`text-[9px] px-1.5 py-px rounded border transition ${
              on
                ? "bg-violet-500/15 border-violet-500/40 text-violet-200"
                : "bg-white/[0.02] border-white/10 text-[#7a8497] hover:text-white hover:border-white/20"
            }`}
            title={on ? `点击取消 #${t} 过滤` : `点击只看有 #${t} 的`}
          >
            #{t}
          </button>
        );
      })}
      {allTags.length > 12 && (
        <span className="text-[9px] text-[#7a8497]">+{allTags.length - 12}</span>
      )}
      {value.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="text-[9px] px-1 text-[#7a8497] hover:text-white"
          title="清空所有 tag 过滤"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─── TagsInput — 多 chip 输入：Enter / 逗号 / 空格添加；Backspace 删最后一个 ──
export function TagsInput({ tags = [], onChange, placeholder = "标签" }) {
  const [input, setInput] = useState("");
  const add = (t) => {
    const v = t.trim().replace(/^#+/, "");
    if (!v || tags.includes(v)) return;
    onChange([...tags, v]);
    setInput("");
  };
  const remove = (t) => onChange(tags.filter(x => x !== t));
  return (
    <div className="w-full px-1.5 py-1 bg-white/5 border border-white/10 rounded focus-within:border-emerald-500/50 transition">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map(t => (
          <span key={t} className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-200 border border-violet-500/40">
            #{t}
            <button onClick={() => remove(t)} className="text-violet-300/70 hover:text-white" title="删除">
              <X size={8} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault();
              add(input);
            } else if (e.key === "Backspace" && !input && tags.length > 0) {
              remove(tags[tags.length - 1]);
            }
          }}
          onBlur={() => input.trim() && add(input)}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[60px] bg-transparent text-[10px] text-white placeholder-[#7a8497] focus:outline-none"
        />
      </div>
    </div>
  );
}
