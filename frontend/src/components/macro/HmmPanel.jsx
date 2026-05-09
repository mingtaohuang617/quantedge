import React from "react";

// L4 HMM 三态识别面板：stacked bar + 转移矩阵 + vs Bry-Boschan 一致性
export default function HmmPanel({ hmm, temp }) {
  const cur = hmm.current || {};
  const means = hmm.state_means_annual_pct || {};
  const vols = hmm.state_vols_annual_pct || {};
  const tm = hmm.transition_matrix || [];
  const labels = hmm.transition_labels || ["bull", "neutral", "bear"];
  const cnLabel = { bull: "牛", neutral: "震荡", bear: "熊" };
  const cnColor = {
    bull: "bg-emerald-400/80 text-emerald-300",
    neutral: "bg-slate-400/70 text-slate-200",
    bear: "bg-red-400/80 text-red-300",
  };

  // 主导状态 = current 最高的
  const dom = ["bull", "neutral", "bear"].reduce((a, b) => (cur[a] || 0) >= (cur[b] || 0) ? a : b, "bull");

  // 与 L3 温度对比的解读
  const tempBullish = temp != null && temp >= 50;
  const hmmBullish = dom === "bull";
  const divergence = tempBullish !== hmmBullish && temp != null;

  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/55">L4 HMM 三态识别（W5000 价格行为视角）</span>
          {divergence && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-400/30 text-amber-200"
                  title="HMM（短期价格行为）与 L3 温度（基本面+估值+情绪）方向分歧——常见于顶/底前期">
              ⚠ 与 L3 温度分歧
            </span>
          )}
        </div>
        <span className="text-[10px] text-white/35 font-mono">
          训练样本 {hmm.n_obs} 个交易日
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* 三态 stacked bar */}
        <div className="flex-1 min-w-[280px]">
          <div className="flex w-full h-3 rounded overflow-hidden bg-white/[0.04]">
            {["bull", "neutral", "bear"].map(s => {
              const p = (cur[s] || 0) * 100;
              if (p < 0.5) return null;
              return (
                <div key={s}
                     className={cnColor[s].split(" ")[0]}
                     style={{ width: `${p}%` }}
                     title={`${cnLabel[s]} ${p.toFixed(1)}%`} />
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {["bull", "neutral", "bear"].map(s => (
              <div key={s} className="text-center">
                <div className={`text-[10px] ${cnColor[s].split(" ")[1]} font-medium`}>{cnLabel[s]}</div>
                <div className={`text-lg font-mono font-semibold tabular-nums ${cnColor[s].split(" ")[1]}`}>
                  {((cur[s] || 0) * 100).toFixed(1)}%
                </div>
                <div className="text-[10px] text-white/40 font-mono">
                  μ {means[s] >= 0 ? "+" : ""}{means[s]}% σ {vols[s]}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 转移矩阵 */}
        {tm.length === 3 && (
          <div className="flex-shrink-0">
            <div className="text-[10px] text-white/45 mb-1">状态转移矩阵（行=今 / 列=明）</div>
            <div className="text-[10px] font-mono">
              <div className="grid grid-cols-4 gap-x-1.5 gap-y-0.5">
                <div></div>
                {labels.map(l => <div key={l} className={`${cnColor[l].split(" ")[1]} text-center`}>{cnLabel[l]}</div>)}
                {labels.map((row, i) => (
                  <React.Fragment key={row}>
                    <div className={`${cnColor[row].split(" ")[1]} text-right`}>{cnLabel[row]}</div>
                    {tm[i].map((v, j) => (
                      <div key={j} className={`text-center tabular-nums ${i === j ? "text-white/85 font-semibold" : "text-white/45"}`}>
                        {(v * 100).toFixed(0)}
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </div>
              <div className="text-[9px] text-white/30 mt-1">单位 %；对角持续，离对角转换</div>
            </div>
          </div>
        )}
      </div>

      {hmm.vs_bb && (
        <div className="mt-3 pt-3 border-t border-white/[0.04]">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <span className="text-[10px] text-white/45">
              vs Bry-Boschan 机械标注（
              {hmm.vs_bb.bb_threshold * 100}% 阈值，{hmm.vs_bb.total_days} 个交易日）
            </span>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-white/55">严格一致</span>
              <span className={`font-mono font-semibold ${
                hmm.vs_bb.strict_agreement_pct >= 70 ? "text-emerald-300"
                : hmm.vs_bb.strict_agreement_pct >= 50 ? "text-lime-300" : "text-amber-300"
              }`}>
                {hmm.vs_bb.strict_agreement_pct}%
              </span>
              <span className="text-white/30">·</span>
              <span className="text-white/55">宽松（neutral 算过渡）</span>
              <span className={`font-mono font-semibold ${
                hmm.vs_bb.loose_agreement_pct >= 80 ? "text-emerald-300"
                : hmm.vs_bb.loose_agreement_pct >= 60 ? "text-lime-300" : "text-amber-300"
              }`}>
                {hmm.vs_bb.loose_agreement_pct}%
              </span>
            </div>
          </div>
          {/* 行%矩阵：BB → HMM 分布 */}
          <div className="text-[10px] font-mono">
            <div className="grid grid-cols-5 gap-x-2 gap-y-0.5">
              <div></div>
              <div className="text-center text-white/45">HMM 牛</div>
              <div className="text-center text-white/45">HMM 震荡</div>
              <div className="text-center text-white/45">HMM 熊</div>
              <div className="text-right text-white/45">总计</div>
              {["bull", "bear"].map(bb => (
                <React.Fragment key={bb}>
                  <div className={`text-right ${cnColor[bb].split(" ")[1]}`}>BB {cnLabel[bb]}</div>
                  {["bull", "neutral", "bear"].map(hm => {
                    const pct = hmm.vs_bb.row_pct?.[bb]?.[hm];
                    const isMatch = bb === hm;
                    return (
                      <div key={hm} className={`text-center tabular-nums ${
                        isMatch ? "text-white/90 font-semibold" : "text-white/45"
                      }`}>
                        {pct != null ? `${pct.toFixed(0)}%` : "—"}
                      </div>
                    );
                  })}
                  <div className="text-right text-white/55 tabular-nums">
                    {bb === "bull" ? hmm.vs_bb.bb_bull_total : hmm.vs_bb.bb_bear_total}d
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
