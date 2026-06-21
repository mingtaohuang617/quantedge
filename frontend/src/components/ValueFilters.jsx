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
//   - Quick preset chips：一键切常用组合（深度低估 / 高股息 / 质量价值）
// ─────────────────────────────────────────────────────────────
import React from "react";
import { useLang } from "../i18n.jsx";

// 常用价值型筛选预设（数据驱动 UI，便于扩展 / 测试）
export const VALUE_PRESETS = [
  {
    id: "deep_value",
    label: "深度低估",
    title: "Graham 风格 — PE ≤ 15 / PB ≤ 2",
    filters: { max_pe: 15, max_pb: 2, min_roe: null, min_dividend_yield: null, max_debt_to_equity: null },
  },
  {
    id: "high_div",
    label: "高股息",
    title: "蓝筹股息策略 — 股息率 ≥ 4%（PE 上限放宽到 30）",
    filters: { max_pe: 30, max_pb: null, min_roe: null, min_dividend_yield: 0.04, max_debt_to_equity: null },
  },
  {
    id: "quality_value",
    label: "质量价值",
    title: "Buffett 风格 — PE ≤ 20 / ROE ≥ 15%",
    filters: { max_pe: 20, max_pb: null, min_roe: 0.15, min_dividend_yield: null, max_debt_to_equity: null },
  },
];

const EMPTY_FILTERS = { max_pe: null, max_pb: null, min_roe: null, min_dividend_yield: null, max_debt_to_equity: null };

/** 判断当前 value 是否完全匹配某 preset（用于高亮 active chip）。 */
export function matchesPreset(value, presetFilters) {
  for (const k of Object.keys(presetFilters)) {
    const a = value[k];
    const b = presetFilters[k];
    // 数字按 epsilon 比；null 全等
    if (a == null && b == null) continue;
    if (a == null || b == null) return false;
    if (Math.abs(Number(a) - Number(b)) > 1e-9) return false;
  }
  return true;
}

export default function ValueFilters({ value, onChange }) {
  const { t } = useLang();
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
    <div className="flex items-center gap-1 text-[10px] text-[#a0aec0] flex-wrap">
      {/* Quick preset chips */}
      {VALUE_PRESETS.map((p) => {
        const active = matchesPreset(value, p.filters);
        return (
          <button
            key={p.id}
            onClick={() => onChange({ ...EMPTY_FILTERS, ...p.filters })}
            title={p.title}
            className={`px-1.5 py-0.5 rounded text-[9px] border transition ${
              active
                ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/40"
                : "bg-white/5 text-[#a0aec0] border-white/10 hover:bg-white/10 hover:text-white"
            }`}
          >
            {p.label}
          </button>
        );
      })}
      <button
        onClick={() => onChange({ ...EMPTY_FILTERS })}
        title={t("清空 5 维筛选（保留赛道）")}
        className="px-1.5 py-0.5 rounded text-[9px] text-[#7a8497] hover:text-white hover:bg-white/10 transition border border-transparent"
      >
        清空
      </button>
      <span className="text-[#5a6477]">|</span>
      <span title={t("PE 上限（< 0 视为亏损一律剔除）")}>PE≤</span>
      <Input k="max_pe" placeholder="25" title={t("PE 上限")} />
      <span title={t("PB 上限")}>PB≤</span>
      <Input k="max_pb" placeholder="—" title={t("PB 上限")} />
      <span title={t("ROE 下限（小数；输入 0.15 = 15%）")}>ROE≥</span>
      <Input k="min_roe" placeholder="—" title={t("ROE 下限（0.15 = 15%）")} step="0.01" />
      <span title={t('股息率下限（小数；输入 0.04 = 4%）')}>{t('息≥')}</span>
      <Input k="min_dividend_yield" placeholder="—" title={t("股息率下限（0.04 = 4%）")} step="0.005" />
      <span title={t("资产负债率上限（A 股）/ 负债权益比上限（美/港股）")}>D/E≤</span>
      <Input k="max_debt_to_equity" placeholder="—" title={t("债务比例上限")} />
    </div>
  );
}
