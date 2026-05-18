// ─────────────────────────────────────────────────────────────
// ValueFilters — 价值型 5 维过滤 input 组件（Screener10x 中栏 toolbar 内）
// ─────────────────────────────────────────────────────────────
// 从 Screener10x.jsx 抽出独立，便于：
//   1) 继续瘦 Screener10x.jsx
//   2) 组件渲染测试（输入校验 / 清空逻辑 / step 区分）
//
// Props:
//   value: { max_pe, max_pb, min_roe, min_dividend_yield, max_debt_to_equity }
//          5 维都可 null（null = 不启用筛选）
//   onChange: (newValue) => void，传整个新对象（不是 partial）
//
// UX 约定：
//   - PE 默认 25（避免亏损股 + 极高估值）；其它默认 null
//   - 输入框允许空值清除（清空 = 不启用该维筛选）
//   - 小数 step：ROE / 股息率 用更细 step 适配百分比小数
// ─────────────────────────────────────────────────────────────
import React from "react";

export default function ValueFilters({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v === "" ? null : v });
  // 通用 numeric input，支持空值清除
  const Input = ({ k, placeholder, title, step }) => (
    <input
      type="number"
      step={step || "0.1"}
      value={value[k] ?? ""}
      placeholder={placeholder}
      title={title}
      onChange={(e) => set(k, e.target.value === "" ? null : Number(e.target.value))}
      className="w-12 px-1 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none placeholder:text-[#5a6477]"
    />
  );
  return (
    <div className="flex items-center gap-1 text-[10px] text-[#a0aec0]">
      <span title="PE 上限（< 0 视为亏损一律剔除）">PE≤</span>
      <Input k="max_pe" placeholder="25" title="PE 上限" />
      <span title="PB 上限">PB≤</span>
      <Input k="max_pb" placeholder="—" title="PB 上限" />
      <span title="ROE 下限（小数；输入 0.15 = 15%）">ROE≥</span>
      <Input k="min_roe" placeholder="—" title="ROE 下限（0.15 = 15%）" step="0.01" />
      <span title="股息率下限（小数；输入 0.04 = 4%）">息≥</span>
      <Input k="min_dividend_yield" placeholder="—" title="股息率下限（0.04 = 4%）" step="0.005" />
      <span title="资产负债率上限（A 股）/ 负债权益比上限（美/港股）">D/E≤</span>
      <Input k="max_debt_to_equity" placeholder="—" title="债务比例上限" />
    </div>
  );
}
