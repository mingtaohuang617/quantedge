// ─────────────────────────────────────────────────────────────
// TenxItemEditor — 10x 观察项编辑模态框
// ─────────────────────────────────────────────────────────────
// 用法：
//   <TenxItemEditor
//     open={editing != null}
//     item={editing}                  // null = 新增, 对象 = 编辑
//     supertrends={supertrends}
//     onClose={() => setEditing(null)}
//     onSaved={(updated) => { reload(); setEditing(null); }}
//   />
//
// 字段：strategy / supertrend / bottleneck_layer / bottleneck_tag /
//      moat_score / thesis / target_price / stop_loss / tags
// "AI 生成草稿" 按钮：调 /api/llm/10x-thesis，把返回的 5 段文本拼到 thesis
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { X, Sparkles, Loader, AlertCircle, Save, Zap } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

const STRATEGY_OPTIONS = [
  { value: "growth", label: "成长型" },
  { value: "value", label: "价值型 (即将上线)", disabled: true },
];

const BOTTLENECK_OPTIONS = [
  { value: 1, label: "L1 共识层" },
  { value: 2, label: "L2 深度认知" },
];

function emptyForm() {
  return {
    strategy: "growth",
    supertrend_id: "",
    bottleneck_layer: 2,
    bottleneck_tag: "",
    moat_score: 3,
    thesis: "",
    target_price: "",
    stop_loss: "",
    tags: "",
  };
}

function itemToForm(item) {
  if (!item) return emptyForm();
  return {
    strategy: item.strategy || "growth",
    supertrend_id: item.supertrend_id || "",
    bottleneck_layer: item.bottleneck_layer ?? 2,
    bottleneck_tag: item.bottleneck_tag || "",
    moat_score: item.moat_score ?? 3,
    thesis: item.thesis || "",
    target_price: item.target_price ?? "",
    stop_loss: item.stop_loss ?? "",
    tags: (item.tags || []).join(", "),
  };
}

function toNumberOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export default function TenxItemEditor({ open, item, candidate, supertrends, onClose, onSaved }) {
  // candidate: 来自候选股表，含 ticker / name / sector / marketCap (用于 LLM 草稿)
  // item: 已存在的 watchlist item（编辑模式）
  const isNew = !item;
  const ticker = item?.ticker || candidate?.ticker || "";
  const displayName = item?.name || candidate?.name || ticker;

  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [llmState, setLlmState] = useState({ loading: false, error: null, cached: false });

  useEffect(() => {
    if (open) {
      setForm(itemToForm(item));
      setError(null);
      setLlmState({ loading: false, error: null, cached: false });
    }
  }, [open, item]);

  if (!open) return null;

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleGenerateThesis = async () => {
    if (!form.supertrend_id) {
      setLlmState({ loading: false, error: "请先选超级赛道", cached: false });
      return;
    }
    const stockMeta = candidate || item || {};
    const payload = {
      ticker,
      name: stockMeta.name || displayName,
      sector: stockMeta.sector ?? null,
      industry: stockMeta.industry ?? null,
      marketCap: stockMeta.marketCap ?? null,
      descriptionCN: stockMeta.descriptionCN ?? null,
      description: stockMeta.description ?? null,
      supertrend_id: form.supertrend_id,
    };
    setLlmState({ loading: true, error: null, cached: false });
    try {
      const json = await apiFetch("/llm/10x-thesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!json) throw new Error("后端无响应（检查 backend 是否启动）");
      if (!json.ok) throw new Error(json.error || json.detail || "LLM 调用失败");
      const t = json.thesis || {};
      const merged = [
        t["超级趋势"] && `🌊 超级趋势：${t["超级趋势"]}`,
        t["瓶颈层"] && `🧱 瓶颈层：${t["瓶颈层"]}`,
        t["卡位逻辑"] && `🎯 卡位逻辑：${t["卡位逻辑"]}`,
        t["风险"] && `⚠️ 风险：${t["风险"]}`,
        t["推演结论"] && `🔮 推演：${t["推演结论"]}`,
      ].filter(Boolean).join("\n");
      // LLM 给的结构化数字（瓶颈层级 1-2 / 卡位等级 1-5）预填到表单；
      // 非数字时保留原值，避免覆盖用户已手填的数字
      const layerInt = t["瓶颈层级_int"];
      const moatInt = t["卡位等级_int"];
      setForm((f) => ({
        ...f,
        thesis: merged,
        bottleneck_layer: Number.isInteger(layerInt) ? layerInt : f.bottleneck_layer,
        moat_score: Number.isInteger(moatInt) ? moatInt : f.moat_score,
      }));
      setLlmState({ loading: false, error: null, cached: !!json.cached });
    } catch (e) {
      setLlmState({ loading: false, error: String(e.message || e), cached: false });
    }
  };

  const handleSave = async () => {
    if (!form.supertrend_id) {
      setError("必须选择超级赛道");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      strategy: form.strategy,
      supertrend_id: form.supertrend_id,
      bottleneck_layer: Number(form.bottleneck_layer) || null,
      bottleneck_tag: form.bottleneck_tag || "",
      moat_score: Number(form.moat_score) || null,
      thesis: form.thesis || "",
      target_price: toNumberOrNull(form.target_price),
      stop_loss: toNumberOrNull(form.stop_loss),
      tags: form.tags
        ? form.tags.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    };
    try {
      const url = isNew ? "/watchlist/10x" : `/watchlist/10x/${encodeURIComponent(ticker)}`;
      const method = isNew ? "POST" : "PUT";
      const payload = isNew ? { ticker, ...body } : body;
      const json = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!json) throw new Error("后端无响应");
      if (!json.ok && !json.item) throw new Error(json.detail || json.error || "保存失败");
      onSaved?.(json.item);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">
              {isNew ? "加入观察列表" : "编辑观察项"}
            </span>
            <span className="text-[10px] font-mono text-[#a0aec0]">{ticker}</span>
            {displayName && displayName !== ticker && (
              <span className="text-[10px] text-[#a0aec0]">{displayName}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#a0aec0] hover:text-white transition-colors p-1 rounded hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          {/* row: strategy + supertrend */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="策略">
              <select
                value={form.strategy}
                onChange={(e) => setField("strategy", e.target.value)}
                className="input-base"
              >
                {STRATEGY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="超级赛道 *">
              <select
                value={form.supertrend_id}
                onChange={(e) => setField("supertrend_id", e.target.value)}
                className="input-base"
              >
                <option value="">— 选择 —</option>
                {(supertrends || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* row: bottleneck layer + moat score */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="瓶颈层级">
              <select
                value={form.bottleneck_layer}
                onChange={(e) => setField("bottleneck_layer", Number(e.target.value))}
                className="input-base"
              >
                {BOTTLENECK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={`卡位等级 ${form.moat_score} / 5`}>
              <input
                type="range"
                min="1"
                max="5"
                value={form.moat_score}
                onChange={(e) => setField("moat_score", Number(e.target.value))}
                className="w-full"
              />
            </Field>
          </div>

          {/* bottleneck_tag */}
          <Field label="瓶颈标签（如：硅光/CPO 关键供应）">
            <input
              type="text"
              value={form.bottleneck_tag}
              onChange={(e) => setField("bottleneck_tag", e.target.value)}
              className="input-base"
              placeholder="一句话描述卡的是哪个瓶颈"
            />
          </Field>

          {/* thesis with AI button */}
          <Field
            label="卡位 thesis"
            right={
              <button
                onClick={handleGenerateThesis}
                disabled={llmState.loading || !form.supertrend_id}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {llmState.loading ? (
                  <><Loader size={10} className="animate-spin" /> 生成中</>
                ) : (
                  <><Sparkles size={10} /> AI 生成草稿</>
                )}
                {llmState.cached && !llmState.loading && (
                  <Zap size={9} className="text-amber-300" />
                )}
              </button>
            }
          >
            <textarea
              value={form.thesis}
              onChange={(e) => setField("thesis", e.target.value)}
              rows={6}
              className="input-base font-mono text-[11px] leading-relaxed"
              placeholder="超级趋势 / 瓶颈层 / 卡位逻辑 / 风险 / 推演结论 — 可手写或 AI 生成草稿后修改"
            />
            {llmState.error && (
              <div className="flex items-start gap-1.5 mt-1 text-[10px] text-amber-300/90">
                <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
                <span className="break-all">{llmState.error}</span>
              </div>
            )}
          </Field>

          {/* row: target / stop */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="目标价（可选）">
              <input
                type="number"
                step="any"
                value={form.target_price}
                onChange={(e) => setField("target_price", e.target.value)}
                className="input-base"
                placeholder="例如 50"
              />
            </Field>
            <Field label="止损位（可选）">
              <input
                type="number"
                step="any"
                value={form.stop_loss}
                onChange={(e) => setField("stop_loss", e.target.value)}
                className="input-base"
                placeholder="例如 25"
              />
            </Field>
          </div>

          {/* tags */}
          <Field label="标签（逗号分隔）">
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setField("tags", e.target.value)}
              className="input-base"
              placeholder="例如：AI算力, 光通信, 小市值"
            />
          </Field>

          {error && (
            <div className="flex items-start gap-1.5 text-[11px] text-red-300/90 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded">
              <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/8 bg-white/[0.02]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] rounded-md bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.supertrend_id}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader size={11} className="animate-spin" /> : <Save size={11} />}
            {isNew ? "加入观察" : "保存"}
          </button>
        </div>
      </div>

      <style>{`
        .input-base {
          width: 100%;
          padding: 6px 8px;
          font-size: 11px;
          color: #e6ecf3;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px;
          outline: none;
          transition: all 0.15s;
        }
        .input-base:focus {
          border-color: rgba(99,102,241,0.5);
          background: rgba(255,255,255,0.06);
        }
        .input-base[type="range"] {
          padding: 0;
          background: transparent;
          border: none;
        }
      `}</style>
    </div>
  );
}

function Field({ label, right, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-[#a0aec0]">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
