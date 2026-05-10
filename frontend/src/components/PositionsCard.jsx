// ─────────────────────────────────────────────────────────────
// 持仓盈亏卡（A6 - Sprint 3）
// ─────────────────────────────────────────────────────────────
//
// 读后端 /api/positions（基于 transactions 表 + daily_bars 最新 close 计算）
// 仅在后端可用时显示；离线 / 后端 503 时静默隐藏（不阻塞主流程）
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from "react";
import { Briefcase, Plus, Loader, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch } from "../quant-platform.jsx";

export default function PositionsCard({ onAddClick }) {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(false);  // 后端不可用时隐藏整张卡

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await apiFetch("/positions");
      if (!json) {
        setHidden(true);  // 后端不通 → 静默隐藏
        return;
      }
      if (json.detail) throw new Error(json.detail);
      setPositions(json.positions || []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (txId, ticker) => {
    if (!confirm(`删除 ${ticker} 的最近一笔交易？(此操作不可撤销)`)) return;
    // 拿该 ticker 最新一笔 tx
    const txList = await apiFetch(`/transactions?ticker=${ticker}&limit=1`);
    if (!txList?.transactions?.length) return;
    const lastTx = txList.transactions[0];
    await apiFetch(`/transactions/${lastTx.id}`, { method: "DELETE" });
    reload();
  };

  if (hidden) return null;

  const open = positions.filter(p => !p.closed);
  const closed = positions.filter(p => p.closed);
  const totalUnreal = open.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
  const totalReal = positions.reduce((s, p) => s + (p.realized_pnl || 0), 0);

  return (
    <div className="glass-card p-3 border border-emerald-500/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Briefcase size={12} className="text-emerald-400" />
          <span className="text-[11px] font-medium text-emerald-300">我的持仓</span>
          {open.length > 0 && (
            <span className="text-[9px] text-[#778]">· {open.length} 只在仓</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onAddClick && (
            <button
              onClick={onAddClick}
              title="录入交易"
              className="px-1.5 py-0.5 text-[10px] rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border border-emerald-500/30 transition flex items-center gap-1"
            >
              <Plus size={10} /> 录入
            </button>
          )}
          <button
            onClick={reload}
            title="刷新"
            disabled={loading}
            className="p-0.5 text-[#a0aec0] hover:text-white transition disabled:opacity-40"
          >
            {loading ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-[10px] text-amber-300/90 mb-1">⚠ {error}</div>
      )}

      {!loading && positions.length === 0 && !error && (
        <div className="text-[10px] text-[#778] py-2">
          还没有交易记录。点"录入"开始追踪持仓。
        </div>
      )}

      {open.length > 0 && (
        <>
          <div className="space-y-1 mb-2">
            {open.slice(0, 8).map(p => {
              const isWin = (p.unrealized_pnl_pct ?? 0) >= 0;
              return (
                <div key={p.ticker} className="flex items-center justify-between text-[10px] tabular-nums gap-2">
                  <span className="font-mono text-[#d0d7e2] shrink-0 w-16 truncate">{p.ticker}</span>
                  <span className="text-[#778] shrink-0 w-12 text-right">{p.net_qty}</span>
                  <span className="text-[#a0aec0] shrink-0 w-16 text-right">{p.avg_cost}</span>
                  <span className={`shrink-0 w-16 text-right font-mono ${isWin ? 'text-up' : 'text-down'}`}>
                    {(p.unrealized_pnl_pct ?? 0) >= 0 ? '+' : ''}{p.unrealized_pnl_pct?.toFixed(1) ?? '—'}%
                  </span>
                  <button
                    onClick={() => handleDelete(null, p.ticker)}
                    className="text-[#556] hover:text-down transition shrink-0"
                    title="删除最新一笔交易"
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-emerald-500/10 text-[10px]">
            <span className="text-[#778]">合计浮盈</span>
            <span className={`font-mono font-bold ${totalUnreal >= 0 ? 'text-up' : 'text-down'}`}>
              {totalUnreal >= 0 ? '+' : ''}{totalUnreal.toFixed(2)}
            </span>
          </div>
        </>
      )}

      {closed.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[9px] text-[#778]">
          已平仓 {closed.length} 只 · 已实现盈亏 <span className={totalReal >= 0 ? 'text-up' : 'text-down'}>{totalReal >= 0 ? '+' : ''}{totalReal.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
