import React, { useMemo, useState } from "react";
import { Loader, RefreshCw, Copy, Check } from "lucide-react";
import { useLang } from "../../i18n.jsx";
import { PANEL } from "./shared.js";

// 把 LLM 输出尝试拆成 3 段：主要矛盾 / 关键观察 / 风险机会
// 优先匹配【】或 ## 标题，其次按双换行分段，再不行整段一坨展示。
// 注：label 保留中文 key，渲染时通过 t() 翻译
const SECTION_KEYS = [
  { key: "矛盾",   label: "主要矛盾", color: "text-amber-200" },
  { key: "观察",   label: "关键观察", color: "text-cyan-200" },
  { key: "风险|机会", label: "风险/机会", color: "text-violet-200" },
];

function parseSections(text) {
  if (!text || typeof text !== "string") return null;
  // 尝试按【...】或 **...**: 提取段落
  const sections = [];
  for (const cfg of SECTION_KEYS) {
    const re = new RegExp(`[【(*\\s]*(${cfg.key})[)】*：:\\s]*([^【]+?)(?=[【*]|$)`, "s");
    const m = text.match(re);
    if (m) {
      const body = m[2].trim().replace(/^[：:\s\-—]+/, "").trim();
      if (body.length > 10) sections.push({ label: cfg.label, color: cfg.color, body });
    }
  }
  if (sections.length >= 2) return sections;
  // 按双换行分段
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 5);
  if (paras.length >= 2) {
    return paras.slice(0, 3).map((body, i) => ({
      label: SECTION_KEYS[i]?.label || "",
      color: SECTION_KEYS[i]?.color || "text-white/85",
      body,
    }));
  }
  return null;
}

// AI 市场画像（DeepSeek 生成 150-200 字解读）
// onForceRefresh: 仅 dev 模式注入；点击跳过 12h 缓存重新生成
export default function NarrativePanel({ narrative, loading, onForceRefresh }) {
  const { t } = useLang();
  const sections = useMemo(() => parseSections(narrative), [narrative]);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!narrative) return;
    try {
      await navigator.clipboard.writeText(narrative);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 退回 textarea 方案 — Safari/特殊环境
      const ta = document.createElement("textarea");
      ta.value = narrative;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1800); }
      catch {}
      document.body.removeChild(ta);
    }
  };

  if (!narrative && !loading) return null;
  return (
    <div className={PANEL.ai}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium border bg-indigo-500/20 text-indigo-100 border-indigo-400/40">
          {t("AI 解读")}
        </span>
        <span className="text-xs text-white/55">{t("DeepSeek 当日宏观画像")}</span>
        <div className="ml-auto flex items-center gap-1">
          {narrative && !loading && (
            <button
              onClick={handleCopy}
              className={`p-1 rounded hover:bg-white/[0.06] transition-colors ${
                copied ? "text-emerald-300" : "text-white/45 hover:text-white/85"
              }`}
              title={copied ? t("已复制") : t("复制全文到剪贴板")}
              aria-label={copied ? t("已复制") : t("复制全文到剪贴板")}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          )}
          {onForceRefresh && (
            <button
              onClick={onForceRefresh}
              disabled={loading}
              className="p-1 rounded hover:bg-white/[0.06] text-white/45 hover:text-white/85 disabled:opacity-50"
              title={t("跳过 12 小时缓存重新生成")}
              aria-label={t("跳过 12 小时缓存重新生成")}
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div className="text-xs text-white/50 flex items-center gap-2">
          <Loader className="w-3 h-3 animate-spin" />
          {t("生成中…")}
        </div>
      ) : sections ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {sections.map((s, i) => (
            <div key={i} className="space-y-1.5">
              {s.label && (
                <div className={`text-[10px] font-medium uppercase tracking-wider ${s.color}`}>
                  {t(s.label)}
                </div>
              )}
              <div className="text-[12.5px] text-white/85 leading-relaxed">{s.body}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-white/85 leading-relaxed whitespace-pre-wrap">
          {narrative}
        </div>
      )}
    </div>
  );
}
