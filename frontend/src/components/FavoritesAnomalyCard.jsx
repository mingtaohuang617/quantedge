// FavoritesAnomalyCard — 关注股异动（自包含卡片）
//
// 读 GET /api/anomaly/scan（本地 futu_anomaly_scan.py 工作日 09:00 写入的快照）。
// 自己拉数据、自己处理 加载/空/有数据 三态。放在「实时监控」页左栏顶部。
import React, { useState, useEffect } from "react";
import { Radar, AlertTriangle } from "lucide-react";
import { apiFetch, displayTicker } from "../quant-platform.jsx";

const DIM_LABEL = { capital: "资金", technical: "技术", derivative: "衍生品" };

export default function FavoritesAnomalyCard({ t = (x) => x }) {
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await apiFetch("/anomaly/scan");
      if (!cancelled) {
        setSnap(d && Array.isArray(d.items) ? d : { items: [], skipped: [], errors: [], scanned_at: null });
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const items = snap?.items || [];
  const anom = items.filter((it) => it.has_anomaly);
  const calm = items.length - anom.length;
  const skipped = snap?.skipped?.length || 0;
  const errors = snap?.errors?.length || 0;

  const when = snap?.scanned_at
    ? new Date(snap.scanned_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="glass-card p-3 md:p-3.5">
      <div className="section-header mb-2" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Radar size={12} className="text-indigo-400" />
          <span className="section-title">{t("关注股异动")}</span>
        </span>
        {when && <span style={{ fontSize: 10, color: "var(--fg-3)" }}>{when}</span>}
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--fg-3)", padding: "8px 0" }}>{t("加载中…")}</div>
      ) : !snap?.scanned_at ? (
        <div style={{ fontSize: 12, color: "var(--fg-3)", padding: "8px 0", lineHeight: 1.6 }}>
          {t("尚未扫描")} —— {t("工作日 09:00 自动对关注股跑富途异动检测")}
        </div>
      ) : anom.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--up)", padding: "8px 0", display: "flex", alignItems: "center", gap: 6 }}>
          <span>✓ {t("关注池暂无异动")}</span>
          <span style={{ color: "var(--fg-3)" }}>({items.length} {t("只已扫")})</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {anom.map((it) => (
            <div key={it.ticker} style={{ borderLeft: "2px solid var(--amber-400, #f5a524)", paddingLeft: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <AlertTriangle size={11} style={{ color: "var(--amber-400, #f5a524)" }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: "var(--fg-0)" }}>{displayTicker ? displayTicker(it.ticker) : it.ticker}</span>
                <span style={{ fontSize: 10, color: "var(--fg-3)" }}>{it.anomaly_count} {t("条信号")}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {["capital", "technical", "derivative"].map((dim) => {
                  const d = it.dims?.[dim];
                  if (!d || !d.count) return null;
                  return (
                    <div key={dim} style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.5 }}>
                      <span style={{ color: "var(--indigo-2)", marginRight: 4 }}>{t(DIM_LABEL[dim])}</span>
                      {(d.signals && d.signals.length) ? d.signals.slice(0, 2).join("；") : `${d.count} ${t("条")}`}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {(calm > 0 || skipped > 0 || errors > 0) && (
            <div style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 2 }}>
              {calm > 0 && `${calm} ${t("只无异动")}`}
              {skipped > 0 && ` · ${skipped} ${t("跳过")}`}
              {errors > 0 && ` · ${errors} ${t("出错")}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
