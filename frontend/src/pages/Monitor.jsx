// ─────────────────────────────────────────────────────────────
// Monitor — 实时监控 / 智能预警 / 板块情绪
// 从 quant-platform.jsx 抽出（C1 重构第二步），通过 React.lazy 懒加载
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { Activity, Bell, BellOff, Check } from "lucide-react";
import { useLang } from "../i18n.jsx";
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
          <button key={r.id} onClick={() => toggle(r.id)} className="w-full flex items-center justify-between gap-2 text-left hover:bg-white/[0.02] -mx-1 px-1 py-0.5 rounded transition-colors">
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

const Monitor = () => {
  const { t, lang } = useLang();
  const { stocks: ctxStocks3, alerts: ctxAlerts3 } = useContext(DataContext) || {};
  const liveStocks = ctxStocks3 || [];
  const allAlerts = ctxAlerts3 || [];
  const [selSector, setSelSector] = useState(null);

  const [ackedIds, setAckedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('quantedge_acked_alerts') || '[]')); }
    catch { return new Set(); }
  });
  const [mutedTickers, setMutedTickers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('quantedge_muted_tickers') || '{}'); }
    catch { return {}; }
  });
  const [showAcked, setShowAcked] = useState(false);

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

  const mergedAlerts = allAlerts.length > 0 ? allAlerts : dynamicAlerts;
  const liveAlerts = mergedAlerts.filter(a => {
    if (isMuted(a.ticker)) return false;
    if (!showAcked && ackedIds.has(a.id)) return false;
    return true;
  });
  const hiddenCount = mergedAlerts.length - liveAlerts.length;

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

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 gap-4 h-full min-h-0 overflow-auto md:overflow-hidden">
      <div className="md:col-span-4 flex flex-col gap-4 md:gap-3 md:min-h-0 md:overflow-auto pr-0 md:pr-1">
        <div className="glass-card p-3 md:p-4">
          <div className="section-header mb-3">
            <Activity size={12} className="text-indigo-400" />
            <span className="section-title">{t('市场情绪指数')}</span>
          </div>
          <div className="flex items-center justify-center gap-5">
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--bg-muted)" strokeWidth="7" />
                <circle cx="50" cy="50" r="42" fill="none" stroke={`var(--accent-${fearGreed > 60 ? "up" : fearGreed > 40 ? "amber" : "down"})`} strokeWidth="7" strokeDasharray={`${fearGreed * 2.64} 264`} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 8px var(--accent-${fearGreed > 60 ? "up-soft" : fearGreed > 40 ? "amber-soft" : "down-soft"}))` }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold font-mono tabular-nums text-white leading-none">{fearGreed}</span>
                <span className={`text-[10px] font-medium mt-0.5 ${fearGreed > 60 ? "text-up" : fearGreed > 40 ? "text-amber-400" : "text-down"}`}>
                  {fearGreed > 75 ? t("极度贪婪") : fearGreed > 60 ? t("贪婪") : fearGreed > 40 ? t("中性偏贪") : fearGreed > 25 ? t("恐惧") : t("极度恐惧")}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              {[
                [75, 100, t("极度贪婪"), "text-up", "bg-up"],
                [50, 75, t("贪婪"), "text-up", "bg-up"],
                [25, 50, t("恐惧"), "text-amber-400", "bg-amber-400"],
                [0, 25, t("极度恐惧"), "text-down", "bg-down"],
              ].map(([lo, hi, label, color, bg]) => {
                const active = fearGreed >= lo && fearGreed < hi;
                return (
                  <div key={label} className={`flex items-center gap-2 px-2 py-0.5 rounded ${active ? "bg-white/5" : ""}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${bg} ${active ? "opacity-100" : "opacity-30"}`} />
                    <span className={`text-[10px] ${active ? color + " font-semibold" : "text-[#778]"}`}>{lo}–{hi} {label}</span>
                    {active && <span className="text-[9px] text-[#778]">←</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-[9px] mt-3 pt-2 border-t border-white/5 text-center" style={{ color: "var(--text-dim)" }}>
            {t('基于 {n} 个标的的平均涨跌幅和市场宽度计算', {n: liveStocks.length})}
          </div>
        </div>

        <MobileAccordion title={t("关注板块表现 (今日)")}>
          {sectors.length === 0 ? (
            <div className="text-[11px] py-4 text-center" style={{ color: "var(--text-dim)" }}>{t('暂无足够数据计算板块')}</div>
          ) : (
            <div className="space-y-2">
              {sectors.map(s => (
                <button key={s.name} onClick={() => setSelSector(s.name.split("/")[0])} className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selSector === s.name.split("/")[0] ? "bg-indigo-500/10 border border-indigo-500/20" : "hover:bg-white/5 border border-transparent"}`}>
                  <span className="text-xs text-white">{s.displayName}<span className="ml-1.5 text-[9px]" style={{ color: "var(--text-dim)" }}>({s.count})</span></span>
                  <span className={`text-xs font-mono ${s.value >= 0 ? "text-up" : "text-down"}`}>{s.value >= 0 ? "+" : ""}{s.value}%</span>
                </button>
              ))}
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
            {liveAlerts.map((a, idx) => {
              const isAcked = ackedIds.has(a.id);
              const stkForAlert = liveStocks.find(s => s.ticker === a.ticker);
              const alertLabel = displayTicker(a.ticker, stkForAlert, lang);
              return (
              <div key={a.id} className={`p-3 rounded-lg border transition-all hover:bg-white/[0.02] animate-stagger relative group ${isAcked ? 'opacity-50' : ''} ${a.severity === "high" ? "border-red-500/20 bg-red-500/5" : a.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-sky-500/20 bg-sky-500/5"}`} style={{ animationDelay: `${idx * 0.06}s` }}>
                {a.severity === "high" && !isAcked && <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-down animate-breathe" />}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white" title={a.ticker}>{alertLabel}</span>
                    <Badge variant={a.type === "score" ? "accent" : a.type === "technical" ? "warning" : a.type === "price" ? "danger" : "info"}>
                      {a.type === "score" ? t("评级") : a.type === "technical" ? t("技术") : a.type === "price" ? t("价格") : t("新闻")}
                    </Badge>
                    {isAcked && <span className="text-[9px] text-[#778]">✓ {t('已处理')}</span>}
                  </div>
                  <span className="text-[10px] text-[#a0aec0] font-mono">{a.time}</span>
                </div>
                <p className="text-xs text-[#a0aec0] leading-relaxed">{a.message}</p>
                <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                  <button onClick={() => muteTicker(a.ticker)} aria-label={`${t('静音')} ${a.ticker} 24h`}
                    className="text-[9px] px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-[#a0aec0] hover:bg-amber-400/10 hover:text-amber-300 hover:border-amber-400/30 transition-all">
                    🔕 {t('静音')} 24h
                  </button>
                </div>
              </div>
              );
            })}
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

        <MobileAccordion title={t("预警规则")} className="md:flex-1">
          <AlertRulesPanel liveStocks={liveStocks} t={t} lang={lang} />
        </MobileAccordion>
      </div>
    </div>
  );
};

export default Monitor;
