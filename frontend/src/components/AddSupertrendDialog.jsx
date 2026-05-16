// ─────────────────────────────────────────────────────────────
// AddSupertrendDialog — 添加自定义超级赛道（含 AI 关键词生成）
// ─────────────────────────────────────────────────────────────
//   id (slug, 必填) / name / note / keywords_zh / keywords_en
//   "AI 生成关键词" 按钮：根据 name + note 调 /api/llm/generate-keywords
//   提交：POST /api/watchlist/10x/supertrends
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { X, Sparkles, Loader, AlertCircle, Save } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

function emptyForm(strategy = "growth") {
  return { id: "", name: "", note: "", strategy, keywords_zh: "", keywords_en: "" };
}

function slugify(s) {
  // 仅做最低限度：去空格首尾，保留中文/字母/数字/下划线/连字符
  return String(s || "").trim().replace(/\s+/g, "_");
}

export default function AddSupertrendDialog({ open, onClose, onSaved, defaultStrategy = "growth" }) {
  const [form, setForm] = useState(emptyForm(defaultStrategy));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [llmState, setLlmState] = useState({ loading: false, error: null });

  useEffect(() => {
    if (open) {
      // 打开时按当前 tab strategy 初始化（用户在 value tab 加自定义赛道时默认 value）
      setForm(emptyForm(defaultStrategy));
      setError(null);
      setLlmState({ loading: false, error: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleGenerateKeywords = async () => {
    if (!form.name.trim()) {
      setLlmState({ loading: false, error: "请先填赛道名" });
      return;
    }
    setLlmState({ loading: true, error: null });
    try {
      const json = await apiFetch("/llm/generate-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, note: form.note, strategy: form.strategy }),
      });
      if (!json) throw new Error("后端无响应（DEEPSEEK_API_KEY 未配置或网络问题）");
      if (!json.ok) throw new Error(json.error || "LLM 生成失败");
      setForm((f) => ({
        ...f,
        keywords_zh: (json.keywords_zh || []).join(", "),
        keywords_en: (json.keywords_en || []).join(", "),
      }));
      setLlmState({ loading: false, error: null });
    } catch (e) {
      setLlmState({ loading: false, error: String(e.message || e) });
    }
  };

  const handleSave = async () => {
    const id = slugify(form.id || form.name);
    if (!id) {
      setError("赛道 ID 或名称至少要填一个");
      return;
    }
    if (!form.name.trim()) {
      setError("赛道名不能为空");
      return;
    }
    const kwZh = form.keywords_zh.split(",").map((s) => s.trim()).filter(Boolean);
    const kwEn = form.keywords_en.split(",").map((s) => s.trim()).filter(Boolean);
    if (kwZh.length === 0 && kwEn.length === 0) {
      setError("至少填一个中文或英文关键词（否则赛道勾选后筛不出股票）");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const json = await apiFetch("/watchlist/10x/supertrends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: form.name.trim(),
          note: form.note.trim(),
          strategy: form.strategy,
          keywords_zh: kwZh,
          keywords_en: kwEn,
        }),
      });
      if (!json) throw new Error("后端无响应");
      if (!json.ok) throw new Error(json.detail || json.error || "保存失败");
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
        className="w-full max-w-lg max-h-[90vh] glass-card border border-white/15 shadow-2xl shadow-black/60 overflow-hidden flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
          <span className="text-sm font-semibold text-white">添加自定义赛道</span>
          <button
            onClick={onClose}
            className="text-[#a0aec0] hover:text-white transition-colors p-1 rounded hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID（slug，留空自动用名称）">
              <input
                type="text"
                value={form.id}
                onChange={(e) => setField("id", e.target.value)}
                className="input-base"
                placeholder="如 renewable"
              />
            </Field>
            <Field label="名称 *">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                className="input-base"
                placeholder="如 新能源"
              />
            </Field>
          </div>

          <Field label="描述（可选）">
            <input
              type="text"
              value={form.note}
              onChange={(e) => setField("note", e.target.value)}
              className="input-base"
              placeholder="如 光伏 / 储能 / 风电"
            />
          </Field>

          {/* 策略归属：决定按 tab 过滤时归到哪一边，以及 AI 关键词生成的 prompt 框架 */}
          <Field label="策略归属">
            <div className="flex gap-2">
              {[
                { value: "growth", label: "成长型", note: "AI 算力 / 半导体 / 光通信 等产业链" },
                { value: "value", label: "价值型", note: "高股息 / 周期 / 必需消费 等价值赛道" },
              ].map((o) => (
                <label
                  key={o.value}
                  className={`flex-1 flex flex-col items-start gap-0.5 px-2 py-1.5 rounded border cursor-pointer transition ${
                    form.strategy === o.value
                      ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-100"
                      : "bg-white/3 border-white/10 text-[#a0aec0] hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="strategy"
                      value={o.value}
                      checked={form.strategy === o.value}
                      onChange={() => setField("strategy", o.value)}
                      className="accent-cyan-500"
                    />
                    <span className="text-[11px] font-medium">{o.label}</span>
                  </div>
                  <span className="text-[9px] text-[#7a8497] pl-4">{o.note}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field
            label="中文关键词（逗号分隔）"
            right={
              <button
                onClick={handleGenerateKeywords}
                disabled={llmState.loading || !form.name.trim()}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {llmState.loading ? (
                  <><Loader size={10} className="animate-spin" /> 生成中</>
                ) : (
                  <><Sparkles size={10} /> AI 生成</>
                )}
              </button>
            }
          >
            <textarea
              value={form.keywords_zh}
              onChange={(e) => setField("keywords_zh", e.target.value)}
              rows={3}
              className="input-base font-mono text-[11px]"
              placeholder="如 光伏, 储能, 锂电池, 新型电力"
            />
          </Field>

          <Field label="英文关键词（逗号分隔）">
            <textarea
              value={form.keywords_en}
              onChange={(e) => setField("keywords_en", e.target.value)}
              rows={3}
              className="input-base font-mono text-[11px]"
              placeholder="如 Solar, Battery, Renewable Energy"
            />
          </Field>

          {llmState.error && (
            <div className="flex items-start gap-1.5 text-[10px] text-amber-300/90 px-2 py-1 bg-amber-500/10 border border-amber-500/30 rounded">
              <AlertCircle size={11} className="text-amber-400 shrink-0 mt-0.5" />
              <span>{llmState.error}</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-1.5 text-[11px] text-red-300/90 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded">
              <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-[10px] text-[#7a8497] leading-relaxed">
            提示：关键词用于匹配股票的 sector / industry 字段（如富途/yfinance 返回的"光伏发电" / "Solar"）。
            匹配越精准的词越好；过于宽泛的词（如"科技"）会带来噪音。
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/8 bg-white/[0.02]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] rounded-md bg-white/5 hover:bg-white/10 text-[#a0aec0] hover:text-white transition border border-white/10"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/40 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader size={11} className="animate-spin" /> : <Save size={11} />}
            添加赛道
          </button>
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
        `}</style>
      </div>
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
