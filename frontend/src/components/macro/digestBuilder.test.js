import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildDigest } from "./digestBuilder.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("buildDigest", () => {
  it("renders a minimum digest with just temperature", () => {
    const out = buildDigest({
      composite: { market_temperature: 33.6 },
      history: null,
      factors: null,
      generatedAt: null,
    });
    expect(out).toContain("2026-05-11 宏观快照");
    expect(out).toContain("市场温度：33.6 / 100");
    expect(out).toContain("偏熊");
  });

  it("adds WoW Δ when history available", () => {
    const history = {
      dates: ["a", "b", "c", "d", "e", "f"],
      market_temperature: [40, 39, 38, 37, 36, 35],
    };
    const out = buildDigest({
      composite: { market_temperature: 35 },
      history, factors: null, generatedAt: null,
    });
    expect(out).toContain("WoW -5.0");
  });

  it("renders HMM 3-state distribution", () => {
    const out = buildDigest({
      composite: {
        market_temperature: 33.6,
        hmm: { current: { bull: 0.08, neutral: 0.16, bear: 0.76 } },
      },
      history: null, factors: null, generatedAt: null,
    });
    expect(out).toContain("HMM 三态：牛 8% · 震荡 16% · 熊 76%");
  });

  it("renders survival duration line", () => {
    const out = buildDigest({
      composite: {
        market_temperature: 33,
        survival: {
          current_regime: "bear", current_duration_days: 280,
          current_duration_pct_rank: 65, median_past_days: 150,
        },
      },
      history: null, factors: null, generatedAt: null,
    });
    expect(out).toContain("当前熊市 280d");
    expect(out).toContain("历史分位 65%");
    expect(out).toContain("中位数 150d");
  });

  it("skips survival when error present", () => {
    const out = buildDigest({
      composite: {
        market_temperature: 33,
        survival: { error: "insufficient history" },
      },
      history: null, factors: null, generatedAt: null,
    });
    expect(out).not.toContain("持续期");
  });

  it("renders alerts sorted critical → warning → info", () => {
    const out = buildDigest({
      composite: {
        market_temperature: 33,
        alerts: [
          { level: "info", title: "中性区间", summary: "X" },
          { level: "critical", title: "顶部预警", summary: "Y" },
          { level: "warning", title: "信用乐观", summary: "Z" },
        ],
      },
      history: null, factors: null, generatedAt: null,
    });
    expect(out).toContain("活跃告警 (3):");
    const idxCrit = out.indexOf("严重");
    const idxWarn = out.indexOf("警示");
    const idxInfo = out.indexOf("提示");
    expect(idxCrit).toBeLessThan(idxWarn);
    expect(idxWarn).toBeLessThan(idxInfo);
  });

  it("renders top movers when factors provided", () => {
    const factors = [
      { factor_id: "BULL_A", direction: "higher_bullish", latest: { percentile: 90 } },
      { factor_id: "BEAR_A", direction: "higher_bullish", latest: { percentile: 5 } },
      { factor_id: "BULL_B", direction: "higher_bullish", latest: { percentile: 85 } },
    ];
    const out = buildDigest({
      composite: { market_temperature: 33 },
      history: null, factors, generatedAt: null,
    });
    expect(out).toContain("拉动牛势：BULL_A +40 · BULL_B +35");
    expect(out).toContain("拉动熊势：BEAR_A -45");
  });

  it("includes snapshot generation date + staleness", () => {
    const out = buildDigest({
      composite: { market_temperature: 33 },
      history: null, factors: null,
      generatedAt: "2026-05-09T10:00:00+00:00",
    });
    expect(out).toContain("数据：snapshot 2026-05-09");
    expect(out).toContain("2 天前");
  });

  it("handles fully empty composite gracefully", () => {
    const out = buildDigest({
      composite: {}, history: null, factors: null, generatedAt: null,
    });
    expect(out).toContain("2026-05-11 宏观快照");
    // 没崩 / 不抛
  });
});
