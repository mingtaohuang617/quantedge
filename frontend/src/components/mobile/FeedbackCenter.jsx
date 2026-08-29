import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, WifiOff, X } from "lucide-react";
import { useLang } from "../../i18n.jsx";

export const notifyApp = (detail) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("quantedge:feedback", { detail }));
};

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  offline: WifiOff,
  loading: Loader2,
  info: Info,
};

export default function FeedbackCenter() {
  const { t } = useLang();
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  useEffect(() => {
    const remove = (id) => {
      setItems((current) => current.filter((item) => item.id !== id));
      const timer = timers.current.get(id);
      if (timer) clearTimeout(timer);
      timers.current.delete(id);
    };
    const onFeedback = (event) => {
      const incoming = event.detail || {};
      const id = incoming.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const item = { type: "info", duration: 3600, ...incoming, id };
      setItems((current) => [...current.filter((x) => x.id !== id), item].slice(-3));
      if (item.type !== "loading" && item.duration !== 0) {
        const timer = setTimeout(() => remove(id), item.duration);
        timers.current.set(id, timer);
      }
    };
    window.addEventListener("quantedge:feedback", onFeedback);
    return () => {
      window.removeEventListener("quantedge:feedback", onFeedback);
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
  }, []);

  const dismiss = (id) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  };

  return (
    <div className="app-feedback-viewport" aria-live="polite" aria-atomic="false">
      {items.map((item) => {
        const Icon = ICONS[item.type] || Info;
        return (
          <div key={item.id} className={`app-feedback app-feedback-${item.type}`} role={item.type === "error" ? "alert" : "status"}>
            <Icon size={18} className={item.type === "loading" ? "animate-spin" : ""} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold leading-5">{item.title || item.message}</div>
              {item.title && item.message && <div className="text-[12px] leading-5 opacity-80">{item.message}</div>}
            </div>
            {item.actionLabel && <button type="button" className="app-feedback-action" onClick={() => { item.onAction?.(); dismiss(item.id); }}>{item.actionLabel}</button>}
            <button type="button" className="app-feedback-close" onClick={() => dismiss(item.id)} aria-label={t("关闭提示")}><X size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}
