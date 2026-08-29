import React, { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Database, RefreshCw, Wifi } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { useLang } from "../../i18n.jsx";

const LIVE_MS = 2 * 60 * 1000;
const CACHED_MS = 12 * 60 * 60 * 1000;

export function deriveAppStatus({ apiOnline, updatedAt, refreshing }) {
  if (refreshing) return "refreshing";
  const age = updatedAt ? Math.max(0, Date.now() - updatedAt) : Infinity;
  if (!apiOnline) return "offline";
  if (age <= LIVE_MS) return "live";
  if (age <= CACHED_MS) return "cached";
  return "stale";
}

function formatAge(updatedAt, t) {
  if (!updatedAt) return t("暂无更新时间");
  const seconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (seconds < 60) return t("刚刚更新");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("{n} 分钟前", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{n} 小时前", { n: hours });
  return t("{n} 天前", { n: Math.floor(hours / 24) });
}

const STATUS_META = {
  live: { icon: Wifi, label: "实时", color: "var(--sem-up)", bg: "color-mix(in srgb, var(--sem-up) 12%, transparent)" },
  cached: { icon: Database, label: "缓存", color: "var(--sem-warn)", bg: "color-mix(in srgb, var(--sem-warn) 12%, transparent)" },
  stale: { icon: AlertTriangle, label: "数据滞后", color: "var(--sem-warn)", bg: "color-mix(in srgb, var(--sem-warn) 12%, transparent)" },
  offline: { icon: CloudOff, label: "离线", color: "var(--sem-down)", bg: "color-mix(in srgb, var(--sem-down) 12%, transparent)" },
  refreshing: { icon: RefreshCw, label: "刷新中", color: "var(--sem-brand)", bg: "color-mix(in srgb, var(--sem-brand) 12%, transparent)" },
};

export function AppStatusChip({ apiOnline, updatedAt, refreshing, onClick, compact = false, className = "" }) {
  const { t } = useLang();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const state = deriveAppStatus({ apiOnline, updatedAt, refreshing });
  const meta = STATUS_META[state];
  const Icon = meta.icon;
  const age = formatAge(updatedAt, t);
  const label = t(meta.label);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mobile-status-chip ${compact ? "is-compact" : ""} ${className}`}
      style={{ color: meta.color, background: meta.bg, borderColor: `color-mix(in srgb, ${meta.color} 28%, transparent)` }}
      aria-label={`${label}，${age}，${t("查看数据状态")}`}
    >
      <Icon size={14} className={state === "refreshing" ? "animate-spin" : ""} aria-hidden="true" />
      <span>{label}</span>
      {!compact && <span className="mobile-status-age">{age}</span>}
    </button>
  );
}

export default function AppStatusSheet({
  open,
  onClose,
  apiOnline,
  updatedAt,
  refreshing,
  onRefresh,
  sourceLabel,
  installAvailable,
  updateAvailable,
  onInstall,
  onUpdate,
}) {
  const { t, lang } = useLang();
  const titleId = useId();
  const state = deriveAppStatus({ apiOnline, updatedAt, refreshing });
  const meta = STATUS_META[state];
  const Icon = meta.icon;
  const updatedText = updatedAt
    ? new Date(updatedAt).toLocaleString(lang === "en" ? "en-US" : lang === "zh-TW" ? "zh-TW" : "zh-CN")
    : "—";
  const details = useMemo(() => [
    [t("连接状态"), apiOnline ? t("在线") : t("离线")],
    [t("数据来源"), sourceLabel || (apiOnline ? "API" : t("本地缓存"))],
    [t("最近更新"), updatedText],
    [t("缓存年龄"), formatAge(updatedAt, t)],
  ], [apiOnline, sourceLabel, updatedText, updatedAt, t]);

  return (
    <BottomSheet open={open} onClose={onClose} title={<span id={titleId}>{t("系统与数据状态")}</span>} ariaLabelledBy={titleId}>
      <div className="pb-5 space-y-4">
        <section className="mobile-status-hero" style={{ borderColor: `color-mix(in srgb, ${meta.color} 28%, var(--line))` }}>
          <span className="mobile-status-hero-icon" style={{ color: meta.color, background: meta.bg }}><Icon size={21} className={state === "refreshing" ? "animate-spin" : ""} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold" style={{ color: "var(--fg-0)" }}>{t(meta.label)}</div>
            <div className="text-[12px] leading-5" style={{ color: "var(--fg-2)" }}>
              {state === "live" && t("数据处于实时窗口，可用于当前判断。")}
              {state === "cached" && t("正在使用近期缓存，关键操作前建议刷新。")}
              {state === "stale" && t("数据已明显滞后，请刷新后再作决策。")}
              {state === "offline" && t("网络不可用，页面继续展示本地缓存。")}
              {state === "refreshing" && t("正在获取最新行情，请稍候。")}
            </div>
          </div>
        </section>

        <dl className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}>
          {details.map(([label, value], index) => (
            <div key={label} className="flex items-center gap-4 min-h-12 px-4" style={index ? { borderTop: "1px solid var(--line)" } : undefined}>
              <dt className="text-[12px]" style={{ color: "var(--fg-2)" }}>{label}</dt>
              <dd className="ml-auto text-[12px] font-mono text-right" style={{ color: "var(--fg-1)" }}>{value}</dd>
            </div>
          ))}
        </dl>

        <button type="button" onClick={onRefresh} disabled={refreshing} className="mobile-primary-button w-full">
          {refreshing ? <RefreshCw size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          {refreshing ? t("正在刷新") : t("刷新全部行情")}
        </button>

        {(installAvailable || updateAvailable) && (
          <section className="rounded-2xl border p-3.5 space-y-2.5" style={{ borderColor: "var(--line)", background: "var(--surface-1)" }}>
            <div className="text-[12px] font-semibold" style={{ color: "var(--fg-1)" }}>{t("应用状态")}</div>
            {installAvailable && <button type="button" onClick={onInstall} className="mobile-secondary-button w-full">{t("安装 QuantEdge")}</button>}
            {updateAvailable && <button type="button" onClick={onUpdate} className="mobile-secondary-button w-full"><CheckCircle2 size={16} />{t("更新到最新版本")}</button>}
          </section>
        )}
      </div>
    </BottomSheet>
  );
}
