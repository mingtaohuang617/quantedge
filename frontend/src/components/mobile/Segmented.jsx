import React from "react";

/**
 * Segmented — 等宽分段控件（全部/美股/港股/ETF、表现/风险/韧性…）。
 * options 可为字符串数组或 [{value,label}]。
 */
export default function Segmented({ options, value, onChange, size = "md", className = "" }) {
  const pad = size === "sm" ? "py-1.5 text-[11px]" : "py-2 text-[12px]";
  return (
    <div className={`flex gap-1.5 ${className}`} role="tablist">
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const on = v === value;
        return (
          <button
            key={v}
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(v)}
            className={`flex-1 text-center rounded-[9px] font-medium border transition active:scale-[0.98] ${pad}`}
            style={
              on
                ? { color: "var(--indigo-2)", borderColor: "rgba(99,102,241,.3)", background: "rgba(99,102,241,.15)", fontWeight: 600 }
                : { color: "var(--fg-2)", borderColor: "var(--line)", background: "rgba(255,255,255,.03)" }
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
