// TickerSearchBox — 添加表单的 ticker 搜索自动补全
import React, { useEffect, useRef, useState } from "react";
import { Loader, Search } from "lucide-react";
import { apiFetch } from "../../quant-platform.jsx";

export function TickerSearchBox({ ticker, onTickerChange, market, onMarketChange, onPick, existingTickers }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef(null);
  const reqIdRef = useRef(0);

  // 点外面关下拉
  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // debounce 搜索：用户停手 300ms 才发请求；竞态用 reqId 守护
  useEffect(() => {
    const q = ticker.trim();
    if (q.length < 1) {
      setResults([]); setOpen(false); return;
    }
    setLoading(true);
    const myReq = ++reqIdRef.current;
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/search?q=${encodeURIComponent(q)}`);
      if (myReq !== reqIdRef.current) return;
      setLoading(false);
      if (res?.results) {
        setResults(res.results);
        setOpen(res.results.length > 0);
        setHighlight(0);
      } else {
        setResults([]); setOpen(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [ticker]);

  const handlePick = (r) => {
    onPick(r);
    setOpen(false);
  };

  const handleKey = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handlePick(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search size={9} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#7a8497]" />
          <input
            value={ticker}
            onChange={(e) => onTickerChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={handleKey}
            placeholder="ticker / 中文名 / 港股代码"
            className="w-full pl-5 pr-7 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white placeholder-[#7a8497] focus:outline-none focus:border-emerald-500/50"
            autoFocus
            autoComplete="off"
          />
          {loading && (
            <Loader size={9} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#7a8497] animate-spin" />
          )}
        </div>
        <select
          value={market}
          onChange={(e) => onMarketChange(e.target.value)}
          className="px-1 py-1 text-[10px] bg-white/5 border border-white/10 rounded text-white"
        >
          <option value="US">US</option>
          <option value="HK">HK</option>
          <option value="CN">CN</option>
        </select>
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded border border-white/15 bg-[var(--surface,#1a1f2e)] shadow-2xl">
          {results.map((r, i) => {
            const already = existingTickers?.includes(r.symbol) || r.alreadyAdded;
            const active = i === highlight;
            return (
              <button
                key={r.symbol}
                onClick={() => handlePick(r)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-2 py-1.5 text-[10px] border-b border-white/5 last:border-b-0 transition ${
                  active ? "bg-emerald-500/15" : "hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-white">{r.symbol}</span>
                  <span className="text-[9px] text-[#7a8497]">{r.market}</span>
                  {already && (
                    <span className="text-[9px] px-1 py-px rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">已在观察</span>
                  )}
                  {r.price > 0 && (
                    <span className="ml-auto text-[9px] font-mono text-[#a0aec0]">
                      {r.currency === "HKD" ? "HK$" : "$"}{r.price}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[#d0d7e2] truncate">{r.name}</div>
                {r.sector && (
                  <div className="text-[9px] text-[#7a8497]">{r.sector}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
