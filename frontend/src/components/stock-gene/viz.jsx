// Stock Gene 可视化：EngineRadar (4 维雷达) / ScoreSparkline (评分历史折线)
import React from "react";
import { ENGINE_IDS, eng, engResult } from "./helpers.js";

// ─── EngineRadar — 4 维雷达图（trend / value / signal / risk）─────────
export function EngineRadar({ item }) {
  const size = 78;
  const cx = size / 2, cy = size / 2;
  const radius = size / 2 - 9;
  const N = ENGINE_IDS.length;
  const points = ENGINE_IDS.map((id, i) => {
    const r = engResult(item, id);
    const ratio = r && r.max_score ? r.score / r.max_score : 0;
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return {
      id, ratio, angle,
      x: cx + Math.cos(angle) * radius * ratio,
      y: cy + Math.sin(angle) * radius * ratio,
      ax: cx + Math.cos(angle) * radius,
      ay: cy + Math.sin(angle) * radius,
      label: eng(id).short,
    };
  });
  const anyScored = points.some(p => p.ratio > 0);
  if (!anyScored) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-[9px] text-[#5a6477]">雷达</span>
      </div>
    );
  }
  const polygon = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const tooltip = ENGINE_IDS.map(id => {
    const r = engResult(item, id);
    return r ? `${eng(id).short} ${r.score}/${r.max_score}` : `${eng(id).short} —`;
  }).join(" · ");
  return (
    <div title={tooltip} className="shrink-0">
      <svg width={size} height={size}>
        {[1.0, 0.66, 0.33].map((scale, i) => {
          const pts = points.map(p => {
            const x = cx + Math.cos(p.angle) * radius * scale;
            const y = cy + Math.sin(p.angle) * radius * scale;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(" ");
          return (
            <polygon key={i} points={pts} fill="none"
              stroke={i === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}
              strokeWidth="0.5"/>
          );
        })}
        {points.map(p => (
          <line key={`ax-${p.id}`} x1={cx} y1={cy} x2={p.ax} y2={p.ay}
            stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        ))}
        <polygon points={polygon} fill="rgba(99,102,241,0.18)"
          stroke="rgba(129,140,248,0.85)" strokeWidth="1.2" strokeLinejoin="round" />
        {points.map(p => (
          <g key={`pt-${p.id}`}>
            <circle cx={p.x} cy={p.y} r="1.6" fill="rgba(165,180,252,0.95)" />
            <text x={p.ax + Math.cos(p.angle) * 5} y={p.ay + Math.sin(p.angle) * 5}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="7" fill="rgba(160,170,192,0.9)"
              fontFamily="ui-monospace, monospace">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── ScoreSparkline — 评分历史 sparkline ─────────────────────────────
export function ScoreSparkline({ history, engine, maxScore }) {
  const data = (history || []).filter(h => h.engine === engine && h.score != null);
  if (data.length < 2) return null;
  const last = data.slice(-12);
  const w = 64, h = 22, pad = 2;
  const minS = 0;
  const maxS = maxScore || Math.max(...last.map(d => d.max_score || 8));
  const range = maxS - minS || 1;
  let pts = "";
  for (let i = 0; i < last.length; i++) {
    const x = pad + (i / (last.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((last[i].score - minS) / range) * (h - 2 * pad);
    pts += (i ? " " : "") + x.toFixed(1) + "," + y.toFixed(1);
  }
  const first = last[0].score, end = last[last.length - 1].score;
  const trend = end > first ? "up" : end < first ? "down" : "flat";
  const color = trend === "up" ? "#00E5A0" : trend === "down" ? "#FF6B6B" : "#888";
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }); }
    catch { return iso; }
  };
  const tooltip = `${last.length} 次历史评分：\n${last.map(d => `${fmtDate(d.checked_at)}: ${d.score}/${d.max_score}`).join("\n")}`;
  return (
    <div title={tooltip} className="flex flex-col items-end">
      <svg width={w} height={h} className="opacity-90">
        <line x1={pad} y1={pad} x2={w - pad} y2={pad} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
        <polyline fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" points={pts} />
        <circle
          cx={pad + (w - 2 * pad)} cy={h - pad - ((end - minS) / range) * (h - 2 * pad)}
          r="1.5" fill={color}
        />
      </svg>
      <div className="text-[9px] mt-0.5" style={{ color }}>
        {arrow} {first} → {end} · {last.length}次
      </div>
    </div>
  );
}
