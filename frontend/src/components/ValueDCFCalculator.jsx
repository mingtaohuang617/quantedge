// ─────────────────────────────────────────────────────────────
// ValueDCFCalculator — 价值型 DCF 估值计算器（TenxItemEditor 内嵌）
// ─────────────────────────────────────────────────────────────
// 用途：价值型观察项编辑时，让用户输入 FCF / 增速 / 折现率 算内在价值，
//      与当前价对比得「安全边际」，可一键填到「目标价」字段。
//
// UI：默认 collapsed（不打扰主流程），点击 header 展开输入面板。
//     展开后实时算（不需点"计算"按钮）。
//
// Props:
//   currentPrice: number | null  当前价（可选；有则显示安全边际）
//   onApplyTarget: (value) => void  把内在价值填到调用方的 target_price
//                                  字段（点击「应用」按钮触发）
// ─────────────────────────────────────────────────────────────
import React, { useState, useMemo } from 'react';
import { useLang } from '../i18n.jsx';
import { Calculator, ChevronDown, ChevronRight, Check, AlertCircle } from 'lucide-react';
import { calcDCF, marginOfSafety, DCF_DEFAULTS } from '../lib/dcf.js';

const INPUT_DEFAULTS = {
  fcfPerShare: '',
  shortTermGrowth: 0.08,
  shortTermYears: DCF_DEFAULTS.shortTermYears,
  terminalGrowth: DCF_DEFAULTS.terminalGrowth,
  discountRate: DCF_DEFAULTS.discountRate,
};

export default function ValueDCFCalculator({ currentPrice, onApplyTarget }) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const [inputs, setInputs] = useState(INPUT_DEFAULTS);

  const result = useMemo(() => {
    const fcf = Number(inputs.fcfPerShare);
    if (!fcf || fcf <= 0) return null;
    return calcDCF({
      fcfPerShare: fcf,
      shortTermGrowth: Number(inputs.shortTermGrowth),
      shortTermYears: Number(inputs.shortTermYears),
      terminalGrowth: Number(inputs.terminalGrowth),
      discountRate: Number(inputs.discountRate),
    });
  }, [inputs]);

  const safety = useMemo(() => {
    if (!result || result.error) return null;
    return marginOfSafety(result.intrinsicValue, currentPrice);
  }, [result, currentPrice]);

  const set = (k, v) => setInputs((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="border border-emerald-500/20 rounded bg-emerald-500/[0.02]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] hover:bg-white/5 transition rounded"
      >
        <div className="flex items-center gap-1.5 text-emerald-300">
          <Calculator size={11} />
          <span className="font-medium">{t('DCF 估算（两阶段，Gordon 终值）')}</span>
          {result && !result.error && (
            <span className="text-[10px] text-emerald-200/80 font-mono">
              · 内在 {result.intrinsicValue.toFixed(2)}
            </span>
          )}
        </div>
        {expanded ? <ChevronDown size={11} className="text-[#a0aec0]" /> : <ChevronRight size={11} className="text-[#a0aec0]" />}
      </button>

      {expanded && (
        <div className="px-2 pb-2 pt-1 space-y-2 border-t border-emerald-500/15">
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="每股 FCF"
              value={inputs.fcfPerShare}
              onChange={(v) => set('fcfPerShare', v)}
              placeholder="如 3.5"
              hint="自由现金流 / 流通股数；从年报算（运营现金流 - capex）"
              required
            />
            <NumField
              label="短期年增速"
              value={inputs.shortTermGrowth}
              onChange={(v) => set('shortTermGrowth', v)}
              step="0.01"
              hint="年化小数；0.08 = 8%。参考过去 5 年 FCF CAGR"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumField
              label="短期年数"
              value={inputs.shortTermYears}
              onChange={(v) => set('shortTermYears', v)}
              step="1"
              hint="预测期；通常 5-10 年"
            />
            <NumField
              label="永续增速"
              value={inputs.terminalGrowth}
              onChange={(v) => set('terminalGrowth', v)}
              step="0.005"
              hint="≤ 长期 GDP；保守 2-3%"
            />
            <NumField
              label="折现率 r"
              value={inputs.discountRate}
              onChange={(v) => set('discountRate', v)}
              step="0.01"
              hint="WACC；股票常用 9-12%（高 = 更保守）"
            />
          </div>

          {/* 结果区 */}
          {result?.error && (
            <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 px-2 py-1 bg-amber-500/10 border border-amber-500/30 rounded">
              <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
              <span>{result.error}</span>
            </div>
          )}

          {result && !result.error && (
            <div className="space-y-1">
              {/* 内在价值 */}
              <div className="flex items-center justify-between px-2 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded">
                <div className="flex flex-col">
                  <span className="text-[9px] text-[#a0aec0]">{t('内在价值（每股）')}</span>
                  <span className="text-[9px] text-[#7a8497]">
                    短期 {result.shortTermPV.toFixed(2)} + 终值 {result.terminalValuePV.toFixed(2)}
                  </span>
                </div>
                <span className="text-[14px] font-mono font-bold text-emerald-300">
                  {result.intrinsicValue.toFixed(2)}
                </span>
              </div>

              {/* 安全边际（仅有 currentPrice 时） */}
              {safety != null && (
                <div
                  className={`flex items-center justify-between px-2 py-1 rounded border ${
                    safety >= 0.33
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      : safety >= 0
                      ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                      : 'bg-red-500/10 text-red-300 border-red-500/30'
                  }`}
                  title={
                    safety >= 0.33
                      ? 'Graham 安全边际充足（≥ 33%）'
                      : safety >= 0
                      ? '当前价 < 内在价值，但安全边际偏薄'
                      : '当前价 > 内在价值，高估'
                  }
                >
                  <span className="text-[10px]">
                    {safety >= 0 ? '安全边际' : '高估幅度'}
                    <span className="text-[9px] text-[#7a8497] ml-1">
                      (当前 {Number(currentPrice).toFixed(2)})
                    </span>
                  </span>
                  <span className="text-[12px] font-mono font-bold">
                    {safety >= 0 ? '+' : ''}{(safety * 100).toFixed(1)}%
                  </span>
                </div>
              )}

              {/* 一键应用到目标价 */}
              {onApplyTarget && (
                <button
                  type="button"
                  onClick={() => onApplyTarget(Math.round(result.intrinsicValue * 100) / 100)}
                  className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[10px] rounded bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 border border-indigo-500/30 transition"
                  title="把内在价值填到「目标价」字段"
                >
                  <Check size={10} /> 应用到目标价：{result.intrinsicValue.toFixed(2)}
                </button>
              )}
            </div>
          )}

          <div className="text-[9px] text-[#7a8497] leading-relaxed">
            ⓘ DCF 适合现金流稳定的票（消费/公用/银行），不适合周期股或纯成长股。
            数字略变化会放大终值差异 — 多跑几组参数试敏感性。
          </div>
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, step = '0.01', placeholder, hint, required }) {
  return (
    <div>
      <label className="text-[9px] text-[#a0aec0] block mb-0.5" title={hint}>
        {label}{required && <span className="text-amber-400 ml-0.5">*</span>}
      </label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        title={hint}
        className="w-full px-1.5 py-0.5 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-emerald-500/40 placeholder:text-[#5a6477]"
      />
    </div>
  );
}
