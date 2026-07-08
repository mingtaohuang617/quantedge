// ─────────────────────────────────────────────────────────────
// StockProfileCard — 个股「公司档案」(F10) 卡
// ─────────────────────────────────────────────────────────────
// 读 sel 上的 top10Hold(前十大股东持股合计%) + esg(华证ESG评级)，
// 由 backend/enrich_profile.py 离线灌进 data.js（仅 A股）。无数据不渲染。
// ─────────────────────────────────────────────────────────────
import React from "react";
import { useLang } from "../i18n.jsx";

export default function StockProfileCard({ stock }) {
  const { t } = useLang();
  if (!stock) return null;
  const { top10Hold, esg } = stock;
  if (top10Hold == null && !esg) return null;
  const esgColor = esg
    ? (/^AA/.test(esg) ? "#34d399" : /^(A|BBB)$/.test(esg) ? "var(--fg-1)" : "#fbbf24")
    : "var(--fg-2)";
  return (
    <div className="rounded-[14px] border p-3.5" style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}>
      <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--fg-0)" }}>{t("公司档案")}</div>
      <div className="grid grid-cols-2 gap-2">
        {top10Hold != null && (
          <div title={t("前十大股东持股比例合计")}>
            <div className="text-[9px]" style={{ color: "var(--fg-2)" }}>{t("十大股东持股")}</div>
            <div className="text-[13px] font-mono font-semibold" style={{ color: "var(--fg-0)" }}>{top10Hold.toFixed(1)}%</div>
          </div>
        )}
        {esg && (
          <div title={t("华证 ESG 评级")}>
            <div className="text-[9px]" style={{ color: "var(--fg-2)" }}>{t("ESG 评级")}</div>
            <div className="text-[13px] font-mono font-semibold" style={{ color: esgColor }}>{esg}</div>
          </div>
        )}
      </div>
    </div>
  );
}
