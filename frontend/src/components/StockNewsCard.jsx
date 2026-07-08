// ─────────────────────────────────────────────────────────────
// StockNewsCard — 个股「相关资讯」卡
// ─────────────────────────────────────────────────────────────
// 读 newsSnapshot.json（离线由 backend/enrich_news.py 抓 iFinD 财经新闻烘焙，
// 定时刷新），按 sel.ticker 取 top-N 标题 + 日期 + 外链。无数据不渲染。
// ─────────────────────────────────────────────────────────────
import React from "react";
import { ExternalLink } from "lucide-react";
import { useLang } from "../i18n.jsx";
import newsSnapshot from "../newsSnapshot.json";

export default function StockNewsCard({ stock }) {
  const { t } = useLang();
  const items = (stock && newsSnapshot[stock.ticker]) || [];
  if (!items.length) return null;
  return (
    <div className="rounded-[14px] border p-3.5" style={{ borderColor: "var(--line)", background: "var(--bg-2)" }}>
      <div className="text-[12px] font-semibold mb-2" style={{ color: "var(--fg-0)" }}>{t("相关资讯")}</div>
      <div className="space-y-2">
        {items.map((n, i) => (
          <a
            key={i}
            href={n.u || undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={n.t}
            className="block group"
          >
            <div className="flex items-start gap-1.5">
              <span
                className="text-[11px] leading-snug flex-1 group-hover:text-cyan-300 transition-colors line-clamp-2"
                style={{ color: "var(--fg-1)" }}
              >
                {n.t}
              </span>
              <ExternalLink size={10} className="mt-0.5 shrink-0" style={{ color: "var(--fg-2)" }} />
            </div>
            {n.d && <div className="text-[9px] mt-0.5" style={{ color: "var(--fg-2)" }}>{n.d}</div>}
          </a>
        ))}
      </div>
    </div>
  );
}
