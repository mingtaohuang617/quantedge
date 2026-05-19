// ─────────────────────────────────────────────────────────────
// useMiningAlphaData — 因子挖掘面板的数据 hook
// ─────────────────────────────────────────────────────────────
//
// 收纳 MiningAlpha 主组件原本散落的 9 个 useState + fetchAll + onSwitchRun
// + 卸载/竞态守卫，让组件只剩纯渲染。
//
// 行为约定：
//   - mount 时自动 fetchAll。
//   - fetchAll 先 await /status → 锁住 current_run_id → 把它显式带进
//     后续 6 个 GET（防 switch-run 中途改写 latest.txt 导致跨 run 混读）。
//   - fetchSeq 计数器：快速切 run A→B 时，A 的回包失效不会覆盖 B 状态。
//   - 卸载时 ++fetchSeq 让 in-flight 全部失效。
//
// 返回值：服务端数据 + loading/error + refetch/switchRun 动作。
// 派生值（regimeSegments / allDone / summary）留给组件用 useMemo 算。
// pickedAlpha 是纯 UI state，不属于这个 hook。
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../quant-platform.jsx";

export function useMiningAlphaData() {
  const [status, setStatus] = useState(null);
  const [ic, setIC] = useState([]);
  const [importance, setImportance] = useState([]);
  const [backtest, setBacktest] = useState(null);
  const [topHoldings, setTopHoldings] = useState({ as_of: "", holdings: [] });
  const [regime, setRegime] = useState([]);
  const [foldIC, setFoldIC] = useState([]);
  const [heatmap, setHeatmap] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchSeqRef = useRef(0);

  const fetchAll = async () => {
    const mySeq = ++fetchSeqRef.current;
    const isStale = () => fetchSeqRef.current !== mySeq;
    setLoading(true);
    setError(null);
    try {
      const s = await apiFetch("/mining-alpha/status").catch(() => null);
      if (isStale()) return;
      setStatus(s);
      const guarded = (setter) => (val) => { if (!isStale()) setter(val); };
      const rid = s?.current_run_id ? `&run_id=${encodeURIComponent(s.current_run_id)}` : "";
      const ridFirst = s?.current_run_id ? `?run_id=${encodeURIComponent(s.current_run_id)}` : "";
      const tasks = [];
      if (s?.files?.ic_report) {
        tasks.push(apiFetch(`/mining-alpha/ic-report?top_n=20${rid}`).catch(() => []).then(guarded(setIC)));
        tasks.push(apiFetch(`/mining-alpha/ic-heatmap?top_n=20&recent_months=24${rid}`).catch(() => null).then(guarded(setHeatmap)));
      }
      if (s?.files?.feature_importance) tasks.push(apiFetch(`/mining-alpha/feature-importance?top_n=20${rid}`).catch(() => []).then(guarded(setImportance)));
      if (s?.files?.backtest_report) tasks.push(apiFetch(`/mining-alpha/backtest${ridFirst}`).catch(() => null).then(guarded(setBacktest)));
      if (s?.files?.predictions) tasks.push(apiFetch(`/mining-alpha/top-holdings?top_n=20${rid}`).catch(() => ({})).then(guarded(setTopHoldings)));
      if (s?.files?.regime) tasks.push(apiFetch(`/mining-alpha/regime${ridFirst}`).catch(() => []).then(guarded(setRegime)));
      if (s?.files?.fold_ic) tasks.push(apiFetch(`/mining-alpha/fold-ic${ridFirst}`).catch(() => []).then(guarded(setFoldIC)));
      // alerts 是全局 log，不属于某个 run
      tasks.push(apiFetch("/mining-alpha/alerts").catch(() => ({ alerts: [] })).then(r => { if (!isStale()) setAlerts(r?.alerts || []); }));
      await Promise.all(tasks);
    } catch (e) {
      if (!isStale()) setError(String(e));
    } finally {
      if (!isStale()) setLoading(false);
    }
  };

  const switchRun = async (runId) => {
    try {
      await apiFetch(`/mining-alpha/switch-run/${runId}`, { method: "POST" });
      await fetchAll();
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    fetchAll();
    return () => { fetchSeqRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status, ic, importance, backtest, topHoldings, regime, foldIC, heatmap, alerts,
    loading, error,
    refetch: fetchAll,
    switchRun,
  };
}
