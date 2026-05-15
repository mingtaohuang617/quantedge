// ─────────────────────────────────────────────────────────────
// 录入交易弹窗（A6 - Sprint 3）
// ─────────────────────────────────────────────────────────────
import React, { useState, useContext, useMemo } from "react";
import { X, Loader, Plus, AlertTriangle } from "lucide-react";
import { apiFetch, DataContext } from "../quant-platform.jsx";
import { useLang } from "../i18n.jsx";
import macroSnapshot from "../macroSnapshot.json";
import { TEMP_TEXT, TEMP_LABEL } from "./macro/shared.js";
import { macroDelta, macroAdjustExplain } from "../lib/macroAdjust.js";

export default function AddTransactionModal({ open, onClose, onAdded, defaultTicker = "" }) {
  const { t } = useLang();
  const { stocks } = useContext(DataContext) || {};
  const [ticker, setTicker] = useState(defaultTicker);
  const [side, setSide] = useState("buy");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [tradedAt, setTradedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // 宏观风格契合度预警 — 仅在 buy 时显示且 |Δ| ≥ 3 (即"明显逆风/顺风")
  const macroWarning = useMemo(() => {
    if (side !== "buy") return null;
    if (!ticker.trim()) return null;
    const temp = macroSnapshot?.composite?.market_temperature;
    if (temp == null) return null;
    const tk = ticker.trim().toUpperCase();
    const stk = (stocks || []).find(s => s.ticker === tk || s.ticker?.toUpperCase() === tk);
    if (!stk || !stk.subScores) return null;
    const delta = macroDelta(stk, temp);
    if (delta == null || Math.abs(delta) < 3) return null;
    return {
      delta,
      temp,
      tempLabel: TEMP_LABEL(temp),
      tempCls: TEMP_TEXT(temp),
      explain: macroAdjustExplain(stk, temp),
      stk,
    };
  }, [ticker, side, stocks]);

  if (!open) return null;

  const handleSubmit = async () => {
    setError(null);
    if (!ticker.trim()) return setError("请填 ticker");
    const qN = parseFloat(qty), pN = parseFloat(price);
    if (!qN || qN <= 0) return setError("数量必须 > 0");
    if (!pN || pN <= 0) return setError("价格必须 > 0");
    setSubmitting(true);
    try {
      const json = await apiFetch("/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          side, qty: qN, price: pN,
          fee: parseFloat(fee) || 0,
          traded_at: tradedAt || null,
          notes: notes.trim() || null,
        }),
      });
      if (!json) throw new Error("后端无响应");
      if (!json.success) throw new Error(json.detail || "提交失败");
      onAdded?.();
      onClose();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card p-4 w-[360px] max-w-[90vw] border border-emerald-500/30" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-emerald-300">录入交易</span>
          <button onClick={onClose} className="text-[#778] hover:text-white"><X size={14} /></button>
        </div>

        <div className="space-y-2">
          {/* Ticker */}
          <div>
            <label className="text-[9px] text-[#778] uppercase tracking-wider">Ticker</label>
            <input
              list="ticker-suggestions"
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              placeholder="如 NVDA / 00700.HK"
              className="w-full px-2 py-1.5 mt-0.5 text-xs bg-[var(--bg-input)] border border-[var(--border-default)] rounded outline-none text-white"
            />
            <datalist id="ticker-suggestions">
              {(stocks || []).slice(0, 200).map(s => (
                <option key={s.ticker} value={s.ticker}>{s.name}</option>
              ))}
            </datalist>
          </div>

          {/* Side toggle */}
          <div className="grid grid-cols-2 gap-1">
            {["buy", "sell"].map(s => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`py-1.5 text-xs rounded font-medium transition ${
                  side === s
                    ? (s === "buy" ? "bg-up/20 text-up border border-up/40" : "bg-down/20 text-down border border-down/40")
                    : "bg-white/5 text-[#a0aec0] border border-white/10 hover:bg-white/10"
                }`}
              >
                {s === "buy" ? "买入" : "卖出"}
              </button>
            ))}
          </div>

          {/* Qty + Price */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-[#778] uppercase tracking-wider">数量</label>
              <input
                type="number" step="any" value={qty} onChange={e => setQty(e.target.value)}
                placeholder="100"
                className="w-full px-2 py-1.5 mt-0.5 text-xs bg-[var(--bg-input)] border border-[var(--border-default)] rounded outline-none text-white tabular-nums"
              />
            </div>
            <div>
              <label className="text-[9px] text-[#778] uppercase tracking-wider">单价</label>
              <input
                type="number" step="any" value={price} onChange={e => setPrice(e.target.value)}
                placeholder="201.50"
                className="w-full px-2 py-1.5 mt-0.5 text-xs bg-[var(--bg-input)] border border-[var(--border-default)] rounded outline-none text-white tabular-nums"
              />
            </div>
          </div>

          {/* Fee + Date */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-[#778] uppercase tracking-wider">手续费</label>
              <input
                type="number" step="any" value={fee} onChange={e => setFee(e.target.value)}
                className="w-full px-2 py-1.5 mt-0.5 text-xs bg-[var(--bg-input)] border border-[var(--border-default)] rounded outline-none text-white tabular-nums"
              />
            </div>
            <div>
              <label className="text-[9px] text-[#778] uppercase tracking-wider">交易日期</label>
              <input
                type="date" value={tradedAt} onChange={e => setTradedAt(e.target.value)}
                className="w-full px-2 py-1.5 mt-0.5 text-xs bg-[var(--bg-input)] border border-[var(--border-default)] rounded outline-none text-white"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[9px] text-[#778] uppercase tracking-wider">备注（可选）</label>
            <input
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="财报前加仓 / 止盈"
              className="w-full px-2 py-1.5 mt-0.5 text-xs bg-[var(--bg-input)] border border-[var(--border-default)] rounded outline-none text-white"
            />
          </div>

          {/* 宏观风格契合度预警（buy 时 |Δ| ≥ 3 显示） */}
          {macroWarning && (
            <div className={`flex items-start gap-2 px-2 py-1.5 rounded text-[10px] leading-relaxed border ${
              macroWarning.delta < 0
                ? 'bg-rose-500/10 border-rose-400/30 text-rose-200'
                : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
            }`}>
              <AlertTriangle size={11} className="shrink-0 mt-0.5 opacity-80" />
              <div className="min-w-0">
                <div className="font-medium">
                  {macroWarning.delta < 0 ? t('风格逆风') : t('风格顺风')}：
                  <span className="font-mono ml-1">{macroWarning.delta > 0 ? '+' : ''}{macroWarning.delta.toFixed(1)}</span>
                </div>
                <div className="opacity-85 mt-0.5">
                  {t('当前市场温度')} <span className={`font-mono font-bold ${macroWarning.tempCls}`}>{macroWarning.temp.toFixed(0)}</span>
                  <span className="opacity-70"> {t(macroWarning.tempLabel)}</span>
                  {macroWarning.explain && <> · {t(macroWarning.explain)}</>}
                </div>
              </div>
            </div>
          )}

          {error && <div className="text-[10px] text-amber-300/90">⚠ {error}</div>}

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 py-1.5 text-xs rounded bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold flex items-center justify-center gap-1 disabled:opacity-40"
            >
              {submitting ? <Loader size={11} className="animate-spin" /> : <Plus size={11} />}
              {submitting ? "提交中..." : "确认录入"}
            </button>
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-white/5 text-[#a0aec0] hover:bg-white/10 transition">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
