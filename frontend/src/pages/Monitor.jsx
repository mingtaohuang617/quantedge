// ─────────────────────────────────────────────────────────────
// Monitor — 实时监控 / 智能预警 / 板块情绪
// 从 quant-platform.jsx 抽出（C1 重构第二步），通过 React.lazy 懒加载
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { Activity, Bell, BellOff, Check, Globe, ChevronLeft, BellRing, RefreshCw } from "lucide-react";
import { useLang, isZh } from "../i18n.jsx";
import useIsMobile from "../hooks/useIsMobile";
import { BottomSheet, MobileAppBar, ThumbActionBar } from "../components/mobile";
import {
  DataContext,
  displayTicker,
  safeChange,
  fmtChange,
  SECTOR_ETF_MAP,
  Badge,
  MobileAccordion,
  MiniSparkline,
  get5DSparkData,
  currencySymbol,
} from "../quant-platform.jsx";
import macroSnapshot from "../macroSnapshot.json";
import { TEMP_TEXT, TEMP_LABEL } from "../components/macro/shared.js";
import FavoritesAnomalyCard from "../components/FavoritesAnomalyCard.jsx";

const ALERT_RULES_KEY = "quantedge_alert_rules";

const AlertRulesPanel = ({ liveStocks, t, lang }) => {
  const candidates = useMemo(() => {
    const rules = [];
    liveStocks.forEach(s => {
      if (typeof s.rsi === "number" && s.rsi > 65) {
        rules.push({ id: `rsi_${s.ticker}`, tk: s.ticker, ruleKey: "RSI超买", value: `RSI > 70 (${t('当前')} ${s.rsi.toFixed(1)})` });
      }
    });
    liveStocks.filter(s => typeof s.score === "number" && s.score >= 80).slice(0, 2).forEach(s => {
      rules.push({ id: `score_${s.ticker}`, tk: s.ticker, ruleKey: "评分突变", value: `${t('排名变化')} > 3` });
    });
    liveStocks.filter(s => Math.abs(safeChange(s.change)) >= 5).slice(0, 1).forEach(s => {
      rules.push({ id: `price_${s.ticker}`, tk: s.ticker, ruleKey: "价格突破", value: `${t('单日')} ±5%` });
    });
    return rules.slice(0, 6);
  }, [liveStocks, t]);

  const [activeRules, setActiveRules] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(ALERT_RULES_KEY) || "[]")); }
    catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(ALERT_RULES_KEY, JSON.stringify([...activeRules])); } catch {}
  }, [activeRules]);

  const toggle = (id) => setActiveRules(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (candidates.length === 0) {
    return <div className="text-[11px] text-center py-6" style={{ color: "var(--text-muted)" }}>{t('暂无预警规则候选')}</div>;
  }

  return (
    <div className="space-y-3">
      {candidates.map(r => {
        const stk = liveStocks.find(s => s.ticker === r.tk);
        const nameLabel = displayTicker(r.tk, stk, lang);
        const isActive = activeRules.has(r.id);
        return (
          <button key={r.id} onClick={() => toggle(r.id)} className="w-full flex items-center justify-between gap-2 text-left hover:bg-white/[0.04] -mx-1 px-1 py-0.5 rounded transition-colors">
            <div className="min-w-0">
              <div className="text-xs text-white truncate" title={r.tk}>{nameLabel} {t(r.ruleKey)}</div>
              <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{r.value}</div>
            </div>
            <div className={`w-10 h-5 md:w-8 md:h-4 rounded-full p-0.5 transition-colors shrink-0 ${isActive ? "bg-indigo-500" : "bg-white/10"}`}>
              <div className={`w-4 h-4 md:w-3 md:h-3 rounded-full bg-white transition-transform ${isActive ? "translate-x-5 md:translate-x-4" : ""}`} />
            </div>
          </button>
        );
      })}
      <div className="text-[9px] pt-1" style={{ color: "var(--text-dim)" }}>{t('规则开关已持久化到本地')}</div>
    </div>
  );
};

// ─── v6 移动端：告警 Hero 大卡 + 行滑动操作 ───────────────────
// 轻量 swipe-reveal 行，只暴露「已读 / 静音」两个操作
function MAlertRow({ alert: a, onAck, onMute, t, lang, liveStocks, onTap }) {
  const [dx, setDx] = useState(0);
  const startX = useRef(null);
  const trackingRef = useRef(false);
  const REVEAL = 128; // 两个 64px 按钮

  const sev = a.severity;
  const dotColor = sev === "high" ? "var(--down)" : sev === "warning" ? "var(--warn)" : "var(--indigo-2)";
  const boxShadow = `0 0 8px ${dotColor}`;

  const onTouchStart = (e) => {
    startX.current = e.touches[0].clientX;
    trackingRef.current = true;
  };
  const onTouchMove = (e) => {
    if (!trackingRef.current || startX.current == null) return;
    const d = e.touches[0].clientX - startX.current;
    if (d < 0) setDx(Math.max(-REVEAL, d));
  };
  const onTouchEnd = () => {
    trackingRef.current = false;
    // snap: if dragged past half, stay open; else snap back
    setDx((prev) => (prev < -REVEAL / 2 ? -REVEAL : 0));
    startX.current = null;
  };

  const stkLabel = a.type === "macro" ? t("宏观") :
    (() => {
      const s = liveStocks.find((x) => x.ticker === a.ticker);
      return s ? (isZh(lang) ? (s.nameCN || s.name) : s.name) : a.ticker;
    })();

  return (
    <div style={{ position: "relative", marginBottom: 8, borderRadius: 12, overflow: "hidden" }}>
      {/* swipe-revealed actions */}
      <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => { onAck(a.id); setDx(0); }}
          style={{ width: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "rgba(30,211,149,.18)", border: "none", cursor: "pointer" }}
        >
          <Check size={18} style={{ color: "var(--up)" }} />
          <span style={{ fontSize: 9, color: "var(--up)" }}>{t("已读")}</span>
        </button>
        {a.type !== "macro" && (
          <button
            onClick={() => { onMute(a.ticker); setDx(0); }}
            style={{ width: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "rgba(255,255,255,.07)", border: "none", cursor: "pointer" }}
          >
            <BellOff size={18} style={{ color: "var(--fg-2)" }} />
            <span style={{ fontSize: 9, color: "var(--fg-2)" }}>{t("静音")}</span>
          </button>
        )}
      </div>
      {/* row content */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => { if (dx === 0) onTap(a); else setDx(0); }}
        style={{
          position: "relative",
          transform: `translateX(${dx}px)`,
          transition: trackingRef.current ? "none" : "transform 0.22s ease",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 12px",
          borderRadius: 12,
          background: "var(--bg-1)",
          border: "1px solid var(--line)",
          cursor: "pointer",
          touchAction: "pan-y",
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: 4, background: dotColor, boxShadow, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 600, color: "var(--fg-0)" }}>{a.ticker}</span>
            <span style={{ fontSize: 8, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {a.type === "macro" ? t("宏观") : a.type === "price" ? t("价格") : a.type === "technical" ? t("技术") : a.type === "score" ? t("评级") : a.type}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-1)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.message}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--fg-3)" }}>{a.time}</span>
          <ChevronLeft size={13} style={{ color: "var(--fg-4)", transform: "rotate(180deg)" }} />
        </div>
      </div>
    </div>
  );
}

const Monitor = () => {
  const { t, lang } = useLang();
  const isMobile = useIsMobile();
  const { stocks: ctxStocks3, alerts: ctxAlerts3 } = useContext(DataContext) || {};
  const liveStocks = ctxStocks3 || [];
  const allAlerts = ctxAlerts3 || [];
  const [selSector, setSelSector] = useState(null);

  const [ackedIds, setAckedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('quantedge_acked_alerts') || '[]')); }
    catch { return new Set(); }
  });
  // 过滤：severity (high/warning/info/all) + type (macro/price/technical/score/all)
  const [filterSev, setFilterSev] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [mutedTickers, setMutedTickers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('quantedge_muted_tickers') || '{}'); }
    catch { return {}; }
  });
  const [showAcked, setShowAcked] = useState(false);
  const [lastBulkAck, setLastBulkAck] = useState(null);  // v5.3：记录"全部标记已读"批次，支持撤销

  useEffect(() => { try { localStorage.setItem('quantedge_acked_alerts', JSON.stringify([...ackedIds])); } catch {} }, [ackedIds]);
  useEffect(() => { try { localStorage.setItem('quantedge_muted_tickers', JSON.stringify(mutedTickers)); } catch {} }, [mutedTickers]);

  const now = Date.now();
  const isMuted = (ticker) => mutedTickers[ticker] && mutedTickers[ticker] > now;
  const ackAlert = (id) => setAckedIds(prev => new Set([...prev, id]));
  const unackAlert = (id) => setAckedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  const muteTicker = (ticker) => setMutedTickers(prev => ({ ...prev, [ticker]: now + 24 * 3600 * 1000 }));
  const unmuteTicker = (ticker) => setMutedTickers(prev => { const n = { ...prev }; delete n[ticker]; return n; });

  const dynamicAlerts = useMemo(() => {
    const alerts = [];
    liveStocks.forEach(s => {
      const chg = safeChange(s.change);
      if (!isFinite(chg)) return;
      if (Math.abs(chg) >= 5) {
        alerts.push({
          id: `dyn_price_${s.ticker}`,
          ticker: s.ticker,
          type: "price",
          severity: Math.abs(chg) >= 10 ? "high" : "warning",
          message: `${t('今日')}${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% · ${t('显著')}${chg >= 0 ? t("上涨") : t("下跌")}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      }
      if (typeof s.rsi === "number" && s.rsi > 70) {
        alerts.push({
          id: `dyn_rsi_h_${s.ticker}`,
          ticker: s.ticker,
          type: "technical",
          severity: "warning",
          message: `RSI ${s.rsi.toFixed(1)} · ${t('超买区间，注意回调风险')}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      } else if (typeof s.rsi === "number" && s.rsi < 30) {
        alerts.push({
          id: `dyn_rsi_l_${s.ticker}`,
          ticker: s.ticker,
          type: "technical",
          severity: "info",
          message: `RSI ${s.rsi.toFixed(1)} · ${t('超卖区间，可能反弹')}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      }
      if (typeof s.score === "number" && s.score >= 85) {
        alerts.push({
          id: `dyn_score_${s.ticker}`,
          ticker: s.ticker,
          type: "score",
          severity: "info",
          message: `${t('评分')} ${s.score.toFixed(1)}/100 · ${t('顶级评级')}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        });
      }
    });
    alerts.sort((a, b) => {
      const rank = { high: 0, warning: 1, info: 2 };
      return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    });
    return alerts.slice(0, 20);
  }, [liveStocks, t]);

  // 把 macro L5 alerts 转成 Monitor 同形 shape，注入到 alerts 流首部
  // critical → high, warning → warning, info → info
  const macroAlertsAsItems = useMemo(() => {
    const ml = macroSnapshot?.composite?.alerts || [];
    return ml.map(a => ({
      id: `macro_${a.id}`,
      ticker: "MACRO",
      type: "macro",
      severity: a.level === "critical" ? "high" : a.level === "warning" ? "warning" : "info",
      message: a.summary ? `${a.title} — ${a.summary}` : a.title,
      time: macroSnapshot?.generated_at?.slice(11, 16) || "—",
      kind: a.kind,
      action: a.action,
    }));
  }, []);

  const mergedAlerts = useMemo(() => {
    const base = allAlerts.length > 0 ? allAlerts : dynamicAlerts;
    return [...macroAlertsAsItems, ...base];
  }, [allAlerts, dynamicAlerts, macroAlertsAsItems]);
  const liveAlerts = mergedAlerts.filter(a => {
    if (isMuted(a.ticker)) return false;
    if (!showAcked && ackedIds.has(a.id)) return false;
    if (filterSev !== "all" && a.severity !== filterSev) return false;
    if (filterType !== "all" && a.type !== filterType) return false;
    return true;
  });
  const hiddenCount = mergedAlerts.length - liveAlerts.length;
  // v5 主从节奏：抽取第一条 high severity 作为 featured spotlight；其余进入"其余告警"
  // 仅在「全部 / 严重」筛选下显示 spotlight，避免与用户主动筛选冲突
  const featuredAlert = (filterSev === "all" || filterSev === "high")
    ? liveAlerts.find(a => a.severity === "high")
    : null;
  const restAlerts = featuredAlert ? liveAlerts.filter(a => a.id !== featuredAlert.id) : liveAlerts;

  // v5.3：批量标记已读 + 撤销（闭环：处理完不悬空，误操作可逆）
  const ackAllRest = () => {
    const ids = restAlerts.filter(a => !ackedIds.has(a.id)).map(a => a.id);
    if (ids.length === 0) return;
    setAckedIds(prev => new Set([...prev, ...ids]));
    setLastBulkAck(ids);
  };
  const undoBulkAck = () => {
    if (!lastBulkAck?.length) return;
    setAckedIds(prev => { const s = new Set(prev); lastBulkAck.forEach(id => s.delete(id)); return s; });
    setLastBulkAck(null);
  };

  // 每个 severity/type 的当前 count（用于 chip badge）
  const sevCounts = useMemo(() => {
    const c = { all: 0, high: 0, warning: 0, info: 0 };
    mergedAlerts.forEach(a => {
      if (isMuted(a.ticker)) return;
      if (!showAcked && ackedIds.has(a.id)) return;
      c.all += 1;
      if (c[a.severity] != null) c[a.severity] += 1;
    });
    return c;
  }, [mergedAlerts, mutedTickers, ackedIds, showAcked]);
  const typeCounts = useMemo(() => {
    const c = { all: 0, macro: 0, price: 0, technical: 0, score: 0 };
    mergedAlerts.forEach(a => {
      if (isMuted(a.ticker)) return;
      if (!showAcked && ackedIds.has(a.id)) return;
      c.all += 1;
      if (c[a.type] != null) c[a.type] += 1;
    });
    return c;
  }, [mergedAlerts, mutedTickers, ackedIds, showAcked]);

  // ── C6: 浏览器 Notification 桌面通知 ───────────────────────
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem('quantedge_notif_enabled') === 'true'; } catch { return false; }
  });
  const [notifPermission, setNotifPermission] = useState(() => {
    return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  });
  const lastNotifiedIds = useRef(new Set()); // 防止重复推送同一个 alert

  useEffect(() => {
    try { localStorage.setItem('quantedge_notif_enabled', String(notifEnabled)); } catch {}
  }, [notifEnabled]);

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      setNotifEnabled(true);
      setNotifPermission('granted');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === 'granted') setNotifEnabled(true);
    } catch (e) { console.warn('[Notif] permission request failed:', e); }
  }, []);

  // 监听 liveAlerts 变化，对新出现的 high / warning 推送桌面通知
  useEffect(() => {
    if (!notifEnabled || notifPermission !== 'granted') return;
    if (typeof Notification === 'undefined') return;
    const toNotify = liveAlerts.filter(a =>
      !lastNotifiedIds.current.has(a.id) &&
      !ackedIds.has(a.id) &&
      (a.severity === 'high' || a.severity === 'warning')
    );
    if (toNotify.length === 0) return;
    // 限速：单次最多 3 条，避免刷屏
    toNotify.slice(0, 3).forEach(a => {
      const title = a.severity === 'high' ? `🔴 ${a.ticker}` : `🟡 ${a.ticker}`;
      try {
        const n = new Notification(title, {
          body: a.message,
          tag: a.id, // 同 id 自动替换
          requireInteraction: a.severity === 'high',
          silent: false,
        });
        // 点击通知 → 聚焦窗口
        n.onclick = () => { window.focus(); n.close(); };
        // 自动关闭（仅 warning 等级）
        if (a.severity !== 'high') setTimeout(() => n.close(), 8000);
      } catch (e) { /* 静默失败 */ }
      lastNotifiedIds.current.add(a.id);
    });
  }, [liveAlerts, notifEnabled, notifPermission, ackedIds]);

  const sectors = useMemo(() => {
    const groups = {};
    liveStocks.forEach(s => {
      const chg = safeChange(s.change);
      if (!isFinite(chg) || !s.sector) return;
      const key = s.sector.split("/")[0];
      if (!groups[key]) groups[key] = { sum: 0, count: 0 };
      groups[key].sum += chg;
      groups[key].count += 1;
    });
    const result = Object.entries(groups)
      .map(([name, { sum, count }]) => ({ name, value: +(sum / count).toFixed(2), count }))
      .filter(s => s.count >= 2)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 6);
    return result.map(s => ({ ...s, displayName: t(s.name) }));
  }, [liveStocks, t]);

  // TODO[data-source]: 当前 fearGreed 是 watchlist-only proxy —— 用 6-30 个标的的平均涨跌幅
  // (60%) + 市场宽度 (40%) 估算，并非真正的大盘恐惧贪婪指数。未来候选数据源（按性价比降序）：
  //   1. CNN Fear & Greed Index（无官方 API，需 scrape；moneycnn.com/data/fear-and-greed/）
  //   2. Alternative.me Crypto F&G API（仅加密，参考实现）
  //   3. 自建：SPX 5d 动量 + VIX 倒数 + 期权 P/C ratio + breadth 加权（要 IBKR/Polygon 数据）
  // 在数据源确定前保持当前实现，UI 文案已注明"基于 N 个标的"避免误导。
  const fearGreed = useMemo(() => {
    if (!liveStocks || liveStocks.length === 0) return 50;
    const valid = liveStocks.map(s => safeChange(s.change)).filter(c => isFinite(c));
    if (valid.length === 0) return 50;
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    const up = valid.filter(c => c > 0).length;
    const breadth = up / valid.length;
    const avgScore = Math.min(100, Math.max(0, 50 + avg * 8));
    const breadthScore = breadth * 100;
    return Math.round((avgScore * 0.6 + breadthScore * 0.4));
  }, [liveStocks]);

  // v6 移动端：下钻详情弹层 + 筛选类型 chip state
  const [mDetailAlert, setMDetailAlert] = useState(null); // 当前下钻的 alert
  const [mFilterType, setMFilterType] = useState("all");  // mobile 独立类型 chip

  // v5 编辑式：SPY 作为板块超额收益基准（若 SPY 在 watchlist 内）
  const spyChange = useMemo(() => {
    const spy = liveStocks.find(s => s.ticker === "SPY");
    if (!spy) return null;
    const c = safeChange(spy.change);
    return isFinite(c) ? c : null;
  }, [liveStocks]);

  // v5.2：featured alert 键盘快捷 — E 标记已处理 / M 静音（仅 spotlight 存在且未聚焦输入时）
  useEffect(() => {
    if (!featuredAlert) return;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "e") { e.preventDefault(); ackAlert(featuredAlert.id); }
      else if (k === "m" && featuredAlert.type !== "macro") { e.preventDefault(); muteTicker(featuredAlert.ticker); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [featuredAlert]);

  // ─── v6 移动端分支 ─────────────────────────────────────────────
  if (isMobile) {
    // 移动端独立类型过滤（复用 mergedAlerts / ackedIds / isMuted）
    const mLiveAlerts = mergedAlerts.filter((a) => {
      if (isMuted(a.ticker)) return false;
      if (ackedIds.has(a.id)) return false;
      if (mFilterType !== "all" && a.type !== mFilterType) return false;
      return true;
    });

    const mFeatured = mLiveAlerts.find((a) => a.severity === "high") || null;
    const mRest = mFeatured ? mLiveAlerts.filter((a) => a.id !== mFeatured.id) : mLiveAlerts;

    // chip counts
    const mTypeCounts = { all: 0, macro: 0, price: 0, technical: 0, score: 0 };
    mergedAlerts.forEach((a) => {
      if (isMuted(a.ticker) || ackedIds.has(a.id)) return;
      mTypeCounts.all += 1;
      if (mTypeCounts[a.type] != null) mTypeCounts[a.type] += 1;
    });

    const unreadCount = mTypeCounts.all;

    // 告警类型的显示颜色
    const sevColor = (sev) =>
      sev === "high" ? "var(--down)" : sev === "warning" ? "var(--warn)" : "var(--indigo-2)";

    // detail overlay: 当前选中告警的完整信息
    const DetailOverlay = mDetailAlert ? (() => {
      const a = mDetailAlert;
      const stk = liveStocks.find((s) => s.ticker === a.ticker);
      const dc = sevColor(a.severity);
      const isAcked = ackedIds.has(a.id);
      return (
        <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "var(--bg-0)" }}>
          <MobileAppBar
            onBack={() => setMDetailAlert(null)}
            title={
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 15, fontWeight: 700, color: "var(--fg-0)" }}>{a.ticker}</span>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: `color-mix(in srgb, ${dc} 18%, transparent)`, color: dc, border: `1px solid color-mix(in srgb, ${dc} 35%, transparent)` }}>
                  {a.severity === "high" ? t("严重") : a.severity === "warning" ? t("警示") : t("提示")}
                </span>
              </span>
            }
          />
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4" style={{ paddingBottom: "calc(80px + env(safe-area-inset-bottom))" }}>
            {/* severity stripe */}
            <div style={{ height: 3, borderRadius: 2, background: `linear-gradient(90deg, ${dc}, transparent)`, marginBottom: 16 }} />

            {/* time + type */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 10, color: "var(--fg-3)", fontFamily: "JetBrains Mono, monospace" }}>{a.time}</span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid var(--line)", color: "var(--fg-2)" }}>
                {a.type === "macro" ? t("宏观") : a.type === "price" ? t("价格") : a.type === "technical" ? t("技术") : a.type === "score" ? t("评级") : a.type}
              </span>
            </div>

            {/* message */}
            <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--fg-1)", marginBottom: 20 }}>{a.message}</p>

            {/* action recommendation */}
            {a.action && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.2)", marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: "var(--violet)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("建议")}</div>
                <p style={{ fontSize: 13, color: "rgba(221,214,254,.85)", lineHeight: 1.55, margin: 0 }}>{a.action}</p>
              </div>
            )}

            {/* 52-week price bar (if we have stk data) */}
            {a.type !== "macro" && stk && stk.week52Low != null && stk.week52High != null && stk.price > 0 && (() => {
              const lo = stk.week52Low, hi = stk.week52High;
              const range = hi - lo || 1;
              const pct = Math.max(0, Math.min(100, ((stk.price - lo) / range) * 100));
              const distHigh = ((stk.price - hi) / hi) * 100;
              const distLow = ((stk.price - lo) / lo) * 100;
              return (
                <div style={{ marginBottom: 20, padding: "14px", borderRadius: 12, background: "rgba(255,255,255,.025)", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("52周价格位置")}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--fg-3)", marginBottom: 6, fontFamily: "JetBrains Mono, monospace" }}>
                    <span>{lo}</span><span>{hi}</span>
                  </div>
                  <div style={{ position: "relative", height: 6, borderRadius: 3, background: "linear-gradient(90deg, rgba(239,68,68,.3), rgba(245,158,11,.2), rgba(30,211,149,.3))" }}>
                    <div style={{ position: "absolute", top: "50%", left: `${pct}%`, transform: "translate(-50%,-50%)", width: 12, height: 12, borderRadius: "50%", background: "white", border: "2px solid var(--indigo-2)", boxShadow: "0 0 6px rgba(99,102,241,.6)" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 6, fontFamily: "JetBrains Mono, monospace" }}>
                    <span style={{ color: "var(--up)" }}>{t("距低")} +{distLow.toFixed(0)}%</span>
                    <span style={{ color: "var(--fg-0)", fontWeight: 600 }}>{stk.price} · {pct.toFixed(0)}%</span>
                    <span style={{ color: "var(--down)" }}>{t("距高")} {distHigh.toFixed(0)}%</span>
                  </div>
                </div>
              );
            })()}

            {/* macro nav link */}
            {a.type === "macro" && (
              <button
                onClick={() => { window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "macro" })); setMDetailAlert(null); }}
                style={{ width: "100%", padding: "12px 0", borderRadius: 12, border: "1px solid var(--line-2)", background: "rgba(139,92,246,.08)", color: "var(--violet)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                → {t("打开宏观看板")}
              </button>
            )}
          </div>

          {/* thumb actions */}
          <ThumbActionBar
            secondary={a.type !== "macro" ? [{ icon: <BellOff size={20} />, label: t("静音 24h"), onClick: () => { muteTicker(a.ticker); setMDetailAlert(null); } }] : []}
            primary={isAcked
              ? { icon: <RefreshCw size={18} />, label: t("撤销已读"), onClick: () => { unackAlert(a.id); setMDetailAlert(null); } }
              : { icon: <Check size={18} />, label: t("标记已处理"), onClick: () => { ackAlert(a.id); setMDetailAlert(null); } }
            }
          />
        </div>
      );
    })() : null;

    return (
      <div className="h-full flex flex-col" style={{ background: "var(--bg-0)" }}>
        {/* detail overlay mounts on top */}
        {DetailOverlay}

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* ── 顶部 pull-to-refresh 提示 ── */}
          <div style={{ textAlign: "center", padding: "8px 0 4px", fontSize: 10, color: "var(--fg-3)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <RefreshCw size={11} className="animate-pulse" style={{ color: "var(--fg-3)" }} />
            {t("下拉刷新")} · {t("刚刚更新")}
          </div>

          <div className="px-4 pt-1 pb-2">
            {/* ── 标题行 ── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "var(--fg-0)" }}>{t("实时监控")}</h1>
                {/* live pulse dot */}
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--up)", boxShadow: "0 0 0 0 rgba(30,211,149,.4)", animation: "breathe 1.8s infinite", flexShrink: 0 }} />
              </div>
              {/* 全部已读 */}
              {unreadCount > 0 ? (
                <button
                  onClick={ackAllRest}
                  style={{ fontSize: 12, color: "var(--indigo-2)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <Check size={14} style={{ color: "var(--indigo-2)" }} />
                  {t("全部已读")}
                </button>
              ) : (
                <span style={{ fontSize: 12, color: "var(--up)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                  <Check size={14} style={{ color: "var(--up)" }} />
                  {t("暂无预警")}
                </span>
              )}
            </div>

            {/* ── 关注股异动 ── */}
            <div style={{ marginBottom: 16 }}><FavoritesAnomalyCard t={t} /></div>

            {/* ── 类型过滤 chips ── */}
            <div style={{ display: "flex", gap: 7, overflowX: "auto", marginBottom: 16, paddingBottom: 2 }}>
              {[
                ["all", t("全部"), mTypeCounts.all],
                ["price", t("价格"), mTypeCounts.price],
                ["macro", t("宏观"), mTypeCounts.macro],
                ["technical", t("技术"), mTypeCounts.technical],
                ["score", t("评级"), mTypeCounts.score],
              ].map(([key, label, count]) => {
                const on = mFilterType === key;
                return (
                  <button
                    key={key}
                    onClick={() => setMFilterType(key)}
                    style={{
                      flexShrink: 0,
                      padding: "6px 12px",
                      borderRadius: 18,
                      fontSize: 12,
                      fontWeight: on ? 600 : 500,
                      background: on ? "rgba(99,102,241,.15)" : "rgba(255,255,255,.03)",
                      color: on ? "var(--indigo-2)" : "var(--fg-2)",
                      border: `1px solid ${on ? "rgba(99,102,241,.3)" : "var(--line)"}`,
                      cursor: "pointer",
                    }}
                  >
                    {label} <span style={{ fontFamily: "JetBrains Mono, monospace", opacity: 0.7 }}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* ── HERO: 最严重告警 ── */}
            {mFeatured ? (
              <div
                style={{
                  padding: "16px 16px 14px",
                  borderRadius: 16,
                  background: "linear-gradient(160deg, rgba(239,68,68,.13), rgba(239,68,68,.03))",
                  border: "1px solid rgba(239,68,68,.3)",
                  position: "relative",
                  overflow: "hidden",
                  marginBottom: 18,
                }}
              >
                {/* top highlight line */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, var(--down), transparent)" }} />

                {/* header row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ padding: "3px 8px", borderRadius: 10, background: "rgba(239,68,68,.18)", border: "1px solid rgba(239,68,68,.35)", fontSize: 10, color: "var(--down)", fontWeight: 600 }}>
                    ● {t("严重")} · {mFeatured.type === "macro" ? t("宏观") : mFeatured.type === "price" ? t("止损") : mFeatured.type === "technical" ? t("技术") : t("评级")}
                  </span>
                  <span style={{ fontSize: 9, color: "var(--down)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {t("严重度")} #1 / {mLiveAlerts.length}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--fg-3)" }}>{mFeatured.time}</span>
                </div>

                {/* ticker + price */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 22, fontWeight: 700, color: "var(--fg-0)" }}>
                    {mFeatured.ticker}
                  </span>
                  {(() => {
                    const stk = liveStocks.find((s) => s.ticker === mFeatured.ticker);
                    if (!stk || stk.price == null) return null;
                    const chg = typeof stk.change === "number" ? stk.change : parseFloat(stk.change);
                    return (
                      <>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 17, fontWeight: 600, color: "var(--down)" }}>{stk.price}</span>
                        {isFinite(chg) && (
                          <span style={{ padding: "2px 7px", borderRadius: 6, background: "rgba(239,68,68,.18)", color: "var(--down)", fontSize: 11, fontWeight: 600 }}>
                            {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* message */}
                <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.6, color: "var(--fg-1)" }}>{mFeatured.message}</p>

                {/* CTA buttons */}
                <div style={{ display: "flex", gap: 9 }}>
                  <button
                    onClick={() => setMDetailAlert(mFeatured)}
                    style={{ flex: 1, height: 44, borderRadius: 12, border: "1px solid var(--line-2)", background: "rgba(255,255,255,.05)", color: "var(--fg-1)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    {t("查看详情")}
                  </button>
                  <button
                    onClick={() => { ackAlert(mFeatured.id); }}
                    style={{ flex: 1.4, height: 44, borderRadius: 12, border: "none", background: "linear-gradient(180deg,#FF8585,#EF4444)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 20px -6px rgba(239,68,68,.55)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <Check size={16} style={{ color: "#fff" }} />
                    {t("标记已处理")}
                  </button>
                  {mFeatured.type !== "macro" && (
                    <button
                      onClick={() => muteTicker(mFeatured.ticker)}
                      style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid var(--line-2)", background: "rgba(255,255,255,.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}
                      aria-label={t("静音 24h")}
                    >
                      <BellOff size={18} style={{ color: "var(--fg-2)" }} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* 空状态 */
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0 24px", gap: 10 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(30,211,149,.1)", border: "1px solid rgba(30,211,149,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={20} style={{ color: "var(--up)" }} />
                </div>
                <span style={{ fontSize: 13, color: "var(--fg-2)", fontWeight: 500 }}>{t("暂无严重预警")}</span>
                <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{t("所有标的运行正常")}</span>
              </div>
            )}

            {/* ── 其余告警列表 ── */}
            {mRest.length > 0 && (
              <>
                <div style={{ fontSize: 9, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, paddingLeft: 2 }}>
                  {t("其余告警")} · {t("今天")} · {t("左滑可操作")}
                </div>
                {mRest.map((a) => (
                  <MAlertRow
                    key={a.id}
                    alert={a}
                    onAck={ackAlert}
                    onMute={muteTicker}
                    onTap={setMDetailAlert}
                    t={t}
                    lang={lang}
                    liveStocks={liveStocks}
                  />
                ))}
              </>
            )}

            {/* undo bulk ack */}
            {lastBulkAck?.length > 0 && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button
                  onClick={undoBulkAck}
                  style={{ fontSize: 12, color: "var(--indigo-2)", background: "none", border: "none", cursor: "pointer" }}
                >
                  ↶ {t("撤销")}
                </button>
              </div>
            )}

            {/* muted tickers */}
            {Object.entries(mutedTickers).filter(([, u]) => u > now).length > 0 && (
              <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,.025)", border: "1px solid var(--line)" }}>
                <div style={{ fontSize: 10, color: "var(--fg-3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("静音中")}</div>
                {Object.entries(mutedTickers).filter(([, u]) => u > now).map(([tk, until]) => {
                  const remain = Math.ceil((until - now) / 3600000);
                  return (
                    <div key={tk} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--fg-0)" }}>{tk}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, color: "var(--fg-3)", fontFamily: "JetBrains Mono, monospace" }}>⏱ {remain}h</span>
                        <button onClick={() => unmuteTicker(tk)} style={{ fontSize: 10, color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* bottom spacer for nav bar */}
            <div style={{ height: 24 }} />
          </div>
        </div>
      </div>
    );
  }
  // ─── END 移动端分支 ─────────────────────────────────────────────

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      <div className="md:col-span-4 flex flex-col gap-4 md:gap-3 md:min-h-0 md:overflow-auto pr-0 md:pr-1">
        {/* 关注股异动 — 本地 09:00 扫描结果 */}
        <FavoritesAnomalyCard t={t} />
        {/* v5 编辑式：F&G + 宏观温度 双徽章 ribbon — 替代单一 100px 圆环，让两个视角并列 + AI 一句话解读 */}
        <div className="glass-card p-3 md:p-3.5">
          <div className="section-header mb-2">
            <Activity size={12} className="text-indigo-400" />
            <span className="section-title">{t('情绪 · 温度 双视角')}</span>
          </div>
          {(() => {
            const macroTemp = macroSnapshot?.composite?.market_temperature;
            const fgTone = fearGreed > 60 ? "up" : fearGreed > 40 ? "amber" : "down";
            const fgLabel = fearGreed > 75 ? t("极度贪婪") : fearGreed > 60 ? t("贪婪") : fearGreed > 40 ? t("中性偏贪") : fearGreed > 25 ? t("恐惧") : t("极度恐惧");
            // 双视角分歧 → AI 一句话解读
            const fgBullish = fearGreed > 60;
            const macroBullish = macroTemp != null && macroTemp > 60;
            const divergent = macroTemp != null && (fgBullish !== macroBullish);
            const insight = macroTemp == null
              ? t('短期情绪指数 · 综合涨跌幅与市场宽度')
              : divergent
                ? (macroBullish && !fgBullish
                    ? t('短期情绪偏弱，但基本面温度偏热 — 关注回调买入机会')
                    : t('短期情绪偏强，但基本面温度偏冷 — 警惕高位回吐'))
                : (fgBullish ? t('两个视角一致看多，趋势确立') : fgLabel === t('恐惧') || fgLabel === t('极度恐惧')
                    ? t('两个视角一致看空，控仓优先')
                    : t('两个视角均为中性 — 维持当前仓位'));
            return (
              <>
                <div className="flex items-stretch gap-2">
                  {/* F&G badge */}
                  <div className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-${fgTone === "up" ? "up" : fgTone === "amber" ? "amber" : "down"}-500/[0.08] border-${fgTone === "up" ? "up" : fgTone === "amber" ? "amber" : "down"}-400/25`}>
                    <div className="w-9 h-9 rounded-md flex items-center justify-center bg-white/[0.04] shrink-0">
                      <span className={`text-base font-bold font-mono tabular-nums ${
                        fgTone === "up" ? "text-up" : fgTone === "amber" ? "text-amber-300" : "text-down"
                      }`}>{fearGreed}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[9px] text-[#778] uppercase tracking-wider">F&G · {t('短期情绪')}</div>
                      <div className={`text-[12px] font-semibold mt-0.5 ${
                        fgTone === "up" ? "text-up" : fgTone === "amber" ? "text-amber-300" : "text-down"
                      }`}>{fgLabel}</div>
                    </div>
                  </div>
                  {/* Macro temp badge */}
                  {macroTemp != null && (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "macro" }))}
                      className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-white/[0.022] border-white/10 hover:bg-white/[0.04] transition cursor-pointer text-left`}
                      title={t('点击进入宏观看板 · 综合 17 因子方向化温度')}
                    >
                      <div className="w-9 h-9 rounded-md flex items-center justify-center bg-white/[0.04] shrink-0">
                        <span className={`text-base font-bold font-mono tabular-nums ${TEMP_TEXT(macroTemp)}`}>{macroTemp.toFixed(0)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px] text-[#778] uppercase tracking-wider flex items-center gap-1">
                          <Globe size={9} /> {t('宏观温度')} · 17 {t('因子')}
                        </div>
                        <div className={`text-[12px] font-semibold mt-0.5 ${TEMP_TEXT(macroTemp)}`}>{t(TEMP_LABEL(macroTemp))}</div>
                      </div>
                    </button>
                  )}
                </div>
                {/* AI 一句话解读 */}
                <div className="mt-2 px-3 py-2 rounded-md bg-violet-500/[0.06] border border-violet-400/15 flex items-start gap-2">
                  <Activity size={10} className="text-violet-300 mt-0.5 shrink-0" />
                  <span className="text-[11px] leading-snug text-violet-100/85">{insight}</span>
                </div>
                <div className="text-[9px] mt-2 pt-1.5 border-t border-white/5 text-center" style={{ color: "var(--text-dim)" }}>
                  {t('F&G 基于 {n} 个标的的平均涨跌幅与市场宽度', {n: liveStocks.length})}
                </div>
              </>
            );
          })()}
        </div>

        <MobileAccordion title={spyChange != null ? t("关注板块 · vs SPY") : t("关注板块表现 (今日)")}>
          {sectors.length === 0 ? (
            <div className="text-[11px] py-4 text-center" style={{ color: "var(--text-dim)" }}>{t('暂无足够数据计算板块')}</div>
          ) : (
            <div className="space-y-2">
              {sectors.map((s, i) => {
                // v5: 双值列 — 绝对 + vs SPY 超额（pp），零点对称 mini bar
                const vsSpy = spyChange != null ? s.value - spyChange : null;
                return (
                <button key={s.name} onClick={() => setSelSector(s.name.split("/")[0])} className={`w-full flex flex-col gap-1 p-2 rounded-lg transition-all ${selSector === s.name.split("/")[0] ? "bg-indigo-500/10 border border-indigo-500/20" : "hover:bg-white/5 border border-transparent"}`}>
                  <div className="w-full flex items-center justify-between">
                    <span className="text-xs text-white">{s.displayName}<span className="ml-1.5 text-[9px]" style={{ color: "var(--text-dim)" }}>({s.count})</span>
                      {/* v5.2：板块排名 pip — 在所有板块中即刻定位领涨/领跌 */}
                      <span className={`ml-1.5 text-[8px] font-mono font-bold ${s.value >= 0 ? "text-up" : "text-down"}`} title={t('今日板块排名')}>{s.value >= 0 ? "▲" : "▼"}#{i + 1}</span>
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[10px] font-mono ${s.value >= 0 ? "text-[#a0aec0]" : "text-[#7a8497]"}`} title={t('今日绝对涨跌')}>{s.value >= 0 ? "+" : ""}{s.value}%</span>
                      {vsSpy != null && (
                        <span className={`text-xs font-mono font-semibold ${vsSpy >= 0 ? "text-up" : "text-down"}`} title={t('相对 SPY 超额')}>
                          {vsSpy >= 0 ? "+" : ""}{vsSpy.toFixed(2)}pp
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 零点对称 mini bar — vs SPY 是核心 */}
                  {vsSpy != null && (
                    <div className="relative w-full h-1 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
                      <div
                        className={`absolute inset-y-0 rounded-full ${vsSpy >= 0 ? "bg-up/60" : "bg-down/60"}`}
                        style={{
                          left: vsSpy >= 0 ? "50%" : `${50 + Math.max(-50, vsSpy / 3 * 100)}%`,
                          width: `${Math.min(50, Math.abs(vsSpy) / 3 * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </button>
                );
              })}
            </div>
          )}
        </MobileAccordion>

        <MobileAccordion title={t("板块-ETF 映射")} className="md:flex-1">
          {selSector ? (
            <>
              <div className="text-[10px] mb-3" style={{ color: "var(--text-secondary)" }}>{t('已选: {s}', {s: selSector})}</div>
              {SECTOR_ETF_MAP[selSector] ? (
                <div className="space-y-2">
                  <div className="text-sm font-bold text-white">{SECTOR_ETF_MAP[selSector].etf}</div>
                  <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{SECTOR_ETF_MAP[selSector].name}</div>
                </div>
              ) : (
                <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>{t('暂无此板块的 ETF 映射')}</div>
              )}
            </>
          ) : (
            <div className="text-[11px] py-4 text-center" style={{ color: "var(--text-dim)" }}>{t('点击上方板块查看对应 ETF')}</div>
          )}
        </MobileAccordion>
      </div>

      <div className="md:col-span-5 flex flex-col gap-4 md:gap-3 md:min-h-0">
        <MobileAccordion
          title={t("智能预警")}
          icon={<Bell size={14} className="text-indigo-400" />}
          badge={<Badge variant="accent">{liveAlerts.length}</Badge>}
          extra={<>
            <div className="live-dot" /><span className="text-[10px] text-[#a0aec0]">{t('实时数据流')}</span>
            {/* C6: 桌面通知开关 */}
            {notifPermission !== 'unsupported' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (notifPermission === 'granted') {
                    setNotifEnabled(v => !v);
                  } else {
                    requestNotifPermission();
                  }
                }}
                title={
                  notifPermission === 'denied' ? t('浏览器已拒绝通知权限 — 请在地址栏左侧的锁图标里手动开启') :
                  notifEnabled && notifPermission === 'granted' ? t('桌面通知已开启 · 高/警告级预警会推送（点击关闭）') :
                  t('开启桌面通知（点击授权）')
                }
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border transition ${
                  notifEnabled && notifPermission === 'granted'
                    ? 'bg-up/15 text-up border-up/30'
                    : notifPermission === 'denied'
                      ? 'bg-down/10 text-down/80 border-down/20 cursor-not-allowed'
                      : 'bg-white/[0.04] text-[#a0aec0] border-white/10 hover:text-white hover:bg-white/[0.08]'
                }`}
                disabled={notifPermission === 'denied'}
              >
                {notifEnabled && notifPermission === 'granted' ? <Bell size={9} /> : <BellOff size={9} />}
                {notifPermission === 'denied' ? t('被拒') : (notifEnabled && notifPermission === 'granted' ? t('已开') : t('桌面通知'))}
              </button>
            )}
          </>}
          flex
          className="md:flex-1 flex flex-col md:min-h-0"
        >
          {/* v7 盯盘墙 — 实时 tile 网格（桌面常驻；告警标的红/黄框高亮，对齐设计稿 SECTION 03 盯盘墙）*/}
          {(() => {
            const alertTickers = new Set(liveAlerts.filter(a => a.ticker).map(a => a.ticker));
            const highTickers = new Set(liveAlerts.filter(a => a.ticker && a.severity === 'high').map(a => a.ticker));
            const ordered = [
              ...liveStocks.filter(s => alertTickers.has(s.ticker)),
              ...liveStocks.filter(s => !alertTickers.has(s.ticker)),
            ].slice(0, 12);
            if (ordered.length === 0) return null;
            return (
              <div className="hidden md:block mb-3">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-[11px] font-semibold text-white">{t('盯盘墙')}</span>
                  <span className="text-[9px] text-[#778] font-mono">{ordered.length} {t('标的')} · {t('实时')}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ordered.map(s => {
                    const chg = Number(s.change) || 0;
                    const up = chg >= 0;
                    const hasAlert = alertTickers.has(s.ticker);
                    const isHigh = highTickers.has(s.ticker);
                    return (
                      <div key={s.ticker}
                        className={`relative px-2 py-1.5 rounded-lg border ${isHigh ? 'bg-down/[0.07] border-down/30' : hasAlert ? 'bg-amber-500/[0.06] border-amber-500/25' : 'bg-white/[0.02] border-white/8'}`}>
                        {hasAlert && <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${isHigh ? 'bg-down shadow-[0_0_6px_rgba(255,107,107,0.8)] animate-breathe' : 'bg-amber-400'}`} />}
                        <div className="flex items-baseline gap-1">
                          <span className="text-[11px] font-mono font-bold text-white truncate">{s.ticker}</span>
                          <span className={`text-[10px] font-mono ${up ? 'text-up' : 'text-down'}`}>{up ? '+' : ''}{chg.toFixed(1)}%</span>
                        </div>
                        <div className="text-[11px] font-mono text-[#cdd5e0] mt-0.5">{s.price}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {/* Severity + type filter chips */}
          {mergedAlerts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mb-2 px-1">
              <span className="text-[9px] text-[#778] uppercase mr-1">{t('级别')}:</span>
              {[
                ["all", t("全部"), null],
                ["high", t("严重"), "text-down"],
                ["warning", t("警示"), "text-amber-400"],
                ["info", t("提示"), "text-sky-400"],
              ].map(([key, label, accent]) => {
                const c = sevCounts[key] ?? 0;
                const active = filterSev === key;
                return (
                  <button
                    key={key}
                    onClick={() => setFilterSev(key)}
                    className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                      active
                        ? "bg-indigo-500/15 border-indigo-400/40 text-indigo-200"
                        : `bg-white/[0.02] border-white/[0.06] ${accent || "text-[#a0aec0]"} hover:bg-white/[0.06]`
                    }`}
                  >
                    {label} {c > 0 && <span className="opacity-70 font-mono">({c})</span>}
                  </button>
                );
              })}
              <span className="w-3" />
              <span className="text-[9px] text-[#778] uppercase mr-1">{t('类型')}:</span>
              {[
                ["all", t("全部")],
                ["macro", t("宏观")],
                ["price", t("价格")],
                ["technical", t("技术")],
                ["score", t("评级")],
              ].map(([key, label]) => {
                const c = typeCounts[key] ?? 0;
                const active = filterType === key;
                return (
                  <button
                    key={key}
                    onClick={() => setFilterType(key)}
                    className={`px-1.5 py-0.5 rounded text-[9px] border transition-colors ${
                      active
                        ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-200"
                        : "bg-white/[0.02] border-white/[0.06] text-[#a0aec0] hover:bg-white/[0.06]"
                    }`}
                  >
                    {label} {c > 0 && <span className="opacity-70 font-mono">({c})</span>}
                  </button>
                );
              })}
              {(filterSev !== "all" || filterType !== "all") && (
                <button
                  onClick={() => { setFilterSev("all"); setFilterType("all"); }}
                  className="ml-1 px-1.5 py-0.5 rounded text-[9px] border bg-rose-500/10 border-rose-400/30 text-rose-300 hover:bg-rose-500/20"
                >
                  {t('清除筛选')}
                </button>
              )}
            </div>
          )}

          {(hiddenCount > 0 || Object.keys(mutedTickers).some(k => mutedTickers[k] > now)) && (
            <div className="flex items-center justify-between mb-2 px-1 text-[10px]">
              <button
                onClick={() => setShowAcked(v => !v)}
                className="text-[#a0aec0] hover:text-indigo-300 transition-colors underline-offset-2 hover:underline">
                {showAcked ? t('隐藏已处理') : t('显示已处理')} ({hiddenCount})
              </button>
              {Object.entries(mutedTickers).filter(([, until]) => until > now).map(([tk, until]) => (
                <button key={tk} onClick={() => unmuteTicker(tk)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-white/[0.08] hover:text-white transition-all ml-1"
                  title={`${t('点击取消静音')} (${Math.ceil((until - now) / 3600000)}h)`}>
                  <span className="text-[9px] font-mono">{tk}</span>
                  <span className="text-[9px]">🔕</span>
                </button>
              ))}
            </div>
          )}
          {/* v5 编辑式：Featured Alert Spotlight — 最严重的一条单独成大卡 + 3 个明确 CTA（不藏 hover） */}
          {featuredAlert && (
            <div className="mb-2 p-3 rounded-xl border border-rose-500/35 bg-gradient-to-br from-rose-500/12 via-rose-500/4 to-transparent relative overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-rose-400 to-transparent" />
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(248,113,113,0.7)] animate-breathe" />
                <span className="text-[9px] uppercase tracking-wider font-semibold text-rose-300">{t('需要处理 · 当下最重要')}</span>
                {/* v5.3：严重度排名 pill — 让"为什么是它被 spotlight"有量化依据 */}
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-200 border border-rose-400/30" title={t('在全部告警中的严重度位次')}>{t('严重度')} #1/{liveAlerts.length}</span>
                <span className="text-[9px] text-[#778] font-mono ml-auto">{featuredAlert.time}</span>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
                {featuredAlert.type === "macro" ? (
                  <span className="flex items-center gap-1 text-lg font-semibold text-violet-200">
                    <Globe size={14} /> {t("宏观")}
                  </span>
                ) : (
                  <span className="text-lg font-bold font-mono text-white" title={featuredAlert.ticker}>
                    {displayTicker(featuredAlert.ticker, liveStocks.find(s => s.ticker === featuredAlert.ticker), lang)}
                  </span>
                )}
                <Badge variant="danger">
                  {featuredAlert.type === "macro" ? t("L5") :
                   featuredAlert.type === "score" ? t("评级") :
                   featuredAlert.type === "technical" ? t("技术") :
                   featuredAlert.type === "price" ? t("价格") : t("新闻")}
                </Badge>
              </div>
              <p className="text-xs text-[#cdd5e0] leading-relaxed mb-2">{featuredAlert.message}</p>
              {featuredAlert.action && (
                <p className="text-[11px] text-violet-200/90 leading-relaxed mb-2 pt-1.5 border-t border-white/[0.04]">
                  {t('建议')}：{featuredAlert.action}
                </p>
              )}
              {/* v5: 价格位置条 — 用真实 52周高低 + 现价，告诉用户告警价在年内什么位置。
                   注：持仓%/影响$ 需要持仓数据、止损 mini bar 需要止损价，Monitor 没有这些
                   数据源，故诚实只渲染能被真实数据驱动的 52周位置条，不臆造持仓与止损线。 */}
              {featuredAlert.type !== "macro" && (() => {
                const stk = liveStocks.find(s => s.ticker === featuredAlert.ticker);
                if (!stk || stk.week52Low == null || stk.week52High == null || !(stk.price > 0)) return null;
                const lo = stk.week52Low, hi = stk.week52High;
                const range = hi - lo || 1;
                const pct = Math.max(0, Math.min(100, ((stk.price - lo) / range) * 100));
                const cur = currencySymbol(stk.currency);
                const distHigh = ((stk.price - hi) / hi) * 100; // ≤ 0
                const distLow = ((stk.price - lo) / lo) * 100;   // ≥ 0
                return (
                  <div className="mb-2 pt-1.5 border-t border-white/[0.04]">
                    <div className="flex items-center justify-between text-[9px] text-[#778] mb-1">
                      <span className="font-mono">{cur}{lo}</span>
                      <span className="uppercase tracking-wider">{t('52周价格位置')}</span>
                      <span className="font-mono">{cur}{hi}</span>
                    </div>
                    <div className="relative w-full h-1.5 rounded-full bg-gradient-to-r from-down/30 via-amber-500/25 to-up/30">
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.6)]" style={{ left: `${pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[9px] mt-1 tabular-nums">
                      <span className="text-up font-mono">{t('距低')} +{distLow.toFixed(0)}%</span>
                      <span className="font-mono text-white font-semibold">{cur}{stk.price} · {pct.toFixed(0)}%</span>
                      <span className="text-down font-mono">{t('距高')} {distHigh.toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })()}
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-rose-400/15">
                {featuredAlert.type === "macro" && (
                  <button onClick={() => window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "macro" }))}
                    aria-label={t('打开宏观看板')}
                    className="text-[10px] px-2.5 py-1 rounded-md bg-rose-500/15 border border-rose-400/35 text-rose-100 hover:bg-rose-500/25 transition font-medium">
                    → {t('打开宏观看板')}
                  </button>
                )}
                <button onClick={() => ackAlert(featuredAlert.id)}
                  aria-label={t('标记为已处理')}
                  className="text-[10px] px-2.5 py-1 rounded-md bg-up/15 border border-up/30 text-up hover:bg-up/25 transition font-medium">
                  ✓ {t('标记已处理')}
                </button>
                {featuredAlert.type !== "macro" && (
                  <button onClick={() => muteTicker(featuredAlert.ticker)}
                    aria-label={`${t('静音')} ${featuredAlert.ticker} 24h`}
                    className="text-[10px] px-2.5 py-1 rounded-md bg-white/[0.05] border border-white/15 text-[#a0aec0] hover:bg-amber-400/15 hover:text-amber-200 hover:border-amber-400/35 transition font-medium">
                    🔕 {t('静音 24h')}
                  </button>
                )}
                {/* v5.2：键盘快捷 hint（E/M 已接入 keydown）— 重度用户 1 秒处理 */}
                <span className="ml-auto hidden md:inline-flex items-center gap-1 text-[9px] text-[#778]">
                  <kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/12 font-mono text-[8px] text-[#a0aec0]">E</kbd>{t('处置')}
                  <span className="opacity-40">·</span>
                  {featuredAlert.type !== "macro" && (<>
                    <kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/12 font-mono text-[8px] text-[#a0aec0]">M</kbd>{t('静音')}
                  </>)}
                </span>
              </div>
            </div>
          )}
          <div className="md:flex-1 md:overflow-auto space-y-2">
            {liveAlerts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <div className="w-10 h-10 rounded-full bg-up/10 border border-up/20 flex items-center justify-center">
                  <Check size={16} className="text-up" />
                </div>
                <div className="text-[11px] text-[#a0aec0] font-medium">{t('暂无预警')}</div>
                <div className="text-[9px] text-[#778]">
                  {hiddenCount > 0 ? `${hiddenCount} ${t('条已处理或静音')}` : t('所有标的运行正常')}
                </div>
              </div>
            )}
            {restAlerts.map((a, idx) => {
              const isAcked = ackedIds.has(a.id);
              const stkForAlert = liveStocks.find(s => s.ticker === a.ticker);
              const alertLabel = displayTicker(a.ticker, stkForAlert, lang);
              return (
              <div key={a.id} className={`p-3 rounded-lg border transition-all hover:bg-white/[0.04] animate-stagger relative group ${isAcked ? 'opacity-50' : ''} ${a.severity === "high" ? "border-red-500/20 bg-red-500/5" : a.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-sky-500/20 bg-sky-500/5"}`} style={{ animationDelay: `${idx * 0.06}s` }}>
                {a.severity === "high" && !isAcked && <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-down animate-breathe" />}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {a.type === "macro" ? (
                      <span className="flex items-center gap-1 text-sm font-semibold text-violet-300">
                        <Globe size={11} /> {t("宏观")}
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-white" title={a.ticker}>{alertLabel}</span>
                    )}
                    <Badge variant={
                      a.type === "macro" ? "accent" :
                      a.type === "score" ? "accent" :
                      a.type === "technical" ? "warning" :
                      a.type === "price" ? "danger" : "info"
                    }>
                      {a.type === "macro" ? t("L5") :
                       a.type === "score" ? t("评级") :
                       a.type === "technical" ? t("技术") :
                       a.type === "price" ? t("价格") : t("新闻")}
                    </Badge>
                    {isAcked && <span className="text-[9px] text-[#778]">✓ {t('已处理')}</span>}
                  </div>
                  <span className="text-[10px] text-[#a0aec0] font-mono">{a.time}</span>
                </div>
                <p className="text-xs text-[#a0aec0] leading-relaxed">{a.message}</p>
                {a.action && (
                  <p className="text-[10px] text-violet-300/80 leading-relaxed mt-1 pt-1 border-t border-white/[0.04]">
                    {t('建议')}：{a.action}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {a.type === "macro" && (
                    <button onClick={() => window.dispatchEvent(new CustomEvent("quantedge:nav", { detail: "macro" }))}
                      aria-label={t('打开宏观看板')}
                      className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-violet-300 hover:bg-violet-500/10 hover:border-violet-400/30 transition-all">
                      → {t('打开宏观看板')}
                    </button>
                  )}
                  {!isAcked ? (
                    <button onClick={() => ackAlert(a.id)} aria-label={t('标记为已处理')}
                      className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-up/10 hover:text-up hover:border-up/30 transition-all">
                      ✓ {t('已处理')}
                    </button>
                  ) : (
                    <button onClick={() => unackAlert(a.id)} aria-label={t('取消已处理')}
                      className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-white/[0.08] transition-all">
                      ↶ {t('撤销')}
                    </button>
                  )}
                  {a.type !== "macro" && (
                    <button onClick={() => muteTicker(a.ticker)} aria-label={`${t('静音')} ${a.ticker} 24h`}
                      className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-amber-400/10 hover:text-amber-300 hover:border-amber-400/30 transition-all">
                      🔕 {t('静音')} 24h
                    </button>
                  )}
                </div>
              </div>
              );
            })}
            {/* v5.3：列表收尾行 — 全部标记已读 + 撤销（清空闭环 + 可逆） */}
            {restAlerts.length > 0 && (() => {
              const ackedCount = restAlerts.filter(a => ackedIds.has(a.id)).length;
              const pending = restAlerts.filter(a => !ackedIds.has(a.id));
              return (
                <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-white/5 text-[10px]">
                  <span style={{ color: "var(--text-dim)" }}>
                    {ackedCount > 0 ? t('已处理 {n} 条', { n: ackedCount }) : t('共 {n} 条', { n: restAlerts.length })}
                    {lastBulkAck?.length > 0 && (
                      <button onClick={undoBulkAck} className="ml-2 text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline">↶ {t('撤销')}</button>
                    )}
                  </span>
                  {pending.length > 0 && (
                    <button onClick={ackAllRest}
                      className="px-2 py-0.5 rounded-md bg-up/10 text-up border border-up/25 hover:bg-up/20 transition font-medium">
                      ✓ {t('全部标记已读')}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        </MobileAccordion>
      </div>

      <div className="md:col-span-3 flex flex-col gap-4 md:gap-3 md:min-h-0 md:overflow-auto pr-0 md:pr-1">
        <MobileAccordion title={t("标的实时概览")} badge={<span className="text-[9px]" style={{ color: "var(--text-dim)" }}>{liveStocks.length}</span>}>
          <div className="space-y-2 max-h-[400px] md:max-h-none overflow-auto">
            {[...liveStocks].sort((a, b) => Math.abs(safeChange(b.change)) - Math.abs(safeChange(a.change))).slice(0, 30).map((s, idx) => {
              const isHK = s.ticker?.endsWith(".HK");
              const label = displayTicker(s.ticker, s, lang);
              return (
              <div key={s.ticker} className="flex items-center justify-between gap-2 p-1.5 rounded bg-white/[0.02] animate-stagger" style={{ animationDelay: `${Math.min(idx, 10) * 0.02}s` }}>
                <span className={`text-xs text-white truncate min-w-0 ${isHK ? "" : "font-mono"}`} title={s.ticker}>{label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <MiniSparkline data={get5DSparkData(s)} w={40} h={12} />
                  <span className="text-xs font-mono tabular-nums text-[#a0aec0]">{currencySymbol(s.currency)}{s.price}</span>
                  <span className={`text-[10px] font-mono tabular-nums ${safeChange(s.change) >= 0 ? "text-up" : "text-down"}`}>
                    {safeChange(s.change) >= 0 ? "+" : ""}{fmtChange(s.change)}%
                  </span>
                </div>
              </div>
              );
            })}
            {liveStocks.length > 30 && (
              <div className="text-[9px] pt-2 text-center" style={{ color: "var(--text-dim)" }}>
                {t('按涨跌幅排序 · 显示前 30 / 共 {n}', {n: liveStocks.length})}
              </div>
            )}
          </div>
        </MobileAccordion>

        {/* v5: 静音倒计时独立面板 — 让"打扰预算"对用户透明 */}
        {(() => {
          const activeMutes = Object.entries(mutedTickers).filter(([, until]) => until > now);
          if (activeMutes.length === 0) return null;
          return (
            <MobileAccordion title={t("静音中 · 倒计时")} badge={<span className="text-[9px]" style={{ color: "var(--text-dim)" }}>{activeMutes.length}</span>}>
              <div className="space-y-1.5">
                {activeMutes
                  .sort((a, b) => a[1] - b[1])
                  .map(([tk, until]) => {
                    const remainMs = until - now;
                    const remainH = Math.floor(remainMs / 3600000);
                    const remainM = Math.floor((remainMs % 3600000) / 60000);
                    const urgent = remainMs < 2 * 3600 * 1000;
                    return (
                      <div key={tk} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/[0.022] border border-white/8">
                        <span className="font-mono text-[11px] text-white font-semibold w-14 shrink-0">{tk}</span>
                        <span className="text-[9px] text-[#7a8497] flex-1">{t('价格 + 评级')}</span>
                        <span className={`font-mono text-[10px] ${urgent ? "text-amber-300" : "text-[#a0aec0]"}`}>
                          ⏱ {remainH}h {remainM}m
                        </span>
                        <button
                          onClick={() => unmuteTicker(tk)}
                          className="text-[9px] text-[#7a8497] hover:text-white px-1 py-0.5 rounded hover:bg-white/10 transition"
                          title={t('点击取消静音')}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
              </div>
            </MobileAccordion>
          );
        })()}

        <MobileAccordion title={t("预警规则")} className="md:flex-1">
          <AlertRulesPanel liveStocks={liveStocks} t={t} lang={lang} />
        </MobileAccordion>
      </div>
    </div>
  );
};

export default Monitor;
