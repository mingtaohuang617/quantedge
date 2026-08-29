import React from "react";

/**
 * Segmented — 等宽分段控件（全部/美股/港股/ETF、表现/风险/韧性…）。
 * options 可为字符串数组或 [{value,label}]。
 */
export default function Segmented({ options, value, onChange, size = "md", className = "" }) {
  const pad = size === "sm" ? "px-2 text-[11px]" : "px-2.5 text-[12px]";
  const onKeyDown = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % options.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + options.length) % options.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    const option = options[nextIndex];
    onChange?.(typeof option === "string" ? option : option.value);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')?.[nextIndex]?.focus();
  };
  return (
    <div className={`flex gap-1.5 ${className}`} role="tablist">
      {options.map((o, index) => {
        const v = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const on = v === value;
        return (
          <button
            key={v}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange?.(v)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`flex-1 min-h-11 text-center rounded-[10px] font-medium border transition active:scale-[0.98] ${pad}`}
            style={
              on
                ? { color: "var(--indigo-2)", borderColor: "rgba(99,102,241,.3)", background: "rgba(99,102,241,.15)", fontWeight: 600 }
                : { color: "var(--fg-2)", borderColor: "var(--line)", background: "var(--surface-1)" }
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
