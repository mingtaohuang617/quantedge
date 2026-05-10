import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  daysSince,
  factorLagThreshold,
  snapshotStaleness,
  wowDelta,
  directionalScore,
  bullishContribution,
  TEMP_LABEL,
} from "./shared.js";

// ─── daysSince ──────────────────────────────────────────────
describe("daysSince", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns null for null/empty", () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince("")).toBeNull();
    expect(daysSince(undefined)).toBeNull();
  });
  it("returns null for invalid date string", () => {
    expect(daysSince("not-a-date")).toBeNull();
  });
  it("computes days for past dates", () => {
    expect(daysSince("2026-05-09T12:00:00Z")).toBe(1);
    expect(daysSince("2026-05-03T12:00:00Z")).toBe(7);
    expect(daysSince("2026-05-10T12:00:00Z")).toBe(0);
  });
});

// ─── factorLagThreshold ─────────────────────────────────────
describe("factorLagThreshold", () => {
  it("returns known thresholds per freq", () => {
    expect(factorLagThreshold("daily")).toBe(7);
    expect(factorLagThreshold("weekly")).toBe(14);
    expect(factorLagThreshold("monthly")).toBe(45);
  });
  it("falls back to 14 for unknown freq", () => {
    expect(factorLagThreshold("hourly")).toBe(14);
    expect(factorLagThreshold(undefined)).toBe(14);
  });
});

// ─── snapshotStaleness ──────────────────────────────────────
describe("snapshotStaleness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns 'unknown' for null", () => {
    const r = snapshotStaleness(null);
    expect(r.tier).toBe("unknown");
    expect(r.days).toBeNull();
  });
  it("returns 'fresh' for ≤1 day", () => {
    const r = snapshotStaleness("2026-05-09T12:00:00Z");
    expect(r.tier).toBe("fresh");
    expect(r.days).toBe(1);
  });
  it("returns 'recent' for 2-3 days", () => {
    expect(snapshotStaleness("2026-05-08T12:00:00Z").tier).toBe("recent");
    expect(snapshotStaleness("2026-05-07T12:00:00Z").tier).toBe("recent");
  });
  it("returns 'stale' for 4-7 days", () => {
    expect(snapshotStaleness("2026-05-06T12:00:00Z").tier).toBe("stale");
    expect(snapshotStaleness("2026-05-03T12:00:00Z").tier).toBe("stale");
  });
  it("returns 'very_stale' for >7 days", () => {
    expect(snapshotStaleness("2026-05-02T12:00:00Z").tier).toBe("very_stale");
    expect(snapshotStaleness("2026-04-01T12:00:00Z").tier).toBe("very_stale");
  });
});

// ─── wowDelta ───────────────────────────────────────────────
describe("wowDelta", () => {
  const baseHistory = {
    dates: ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06"],
    market_temperature: [50, 51, 52, 51, 50, 53],
    by_category: {
      valuation: [10, 11, 12, 12, 11, 13],
      liquidity: [20, 22, 25, 24, 23, 30],
    },
  };

  it("returns null on null/empty history", () => {
    expect(wowDelta(null, "temp")).toBeNull();
    expect(wowDelta({}, "temp")).toBeNull();
    expect(wowDelta({ dates: [] }, "temp")).toBeNull();
  });
  it("returns null when history shorter than lookback+1", () => {
    expect(wowDelta({ dates: ["a", "b"], market_temperature: [1, 2] }, "temp", 5)).toBeNull();
  });
  it("computes delta for temp", () => {
    expect(wowDelta(baseHistory, "temp", 5)).toBeCloseTo(3); // 53 - 50
  });
  it("computes delta for category", () => {
    expect(wowDelta(baseHistory, "valuation", 5)).toBeCloseTo(3); // 13 - 10
    expect(wowDelta(baseHistory, "liquidity", 5)).toBeCloseTo(10); // 30 - 20
  });
  it("returns null when key missing", () => {
    expect(wowDelta(baseHistory, "nonexistent", 5)).toBeNull();
  });
  it("rounds to 1 decimal", () => {
    const h = { dates: ["a", "b", "c", "d", "e", "f"], market_temperature: [10.05, 10, 10, 10, 10, 12.13] };
    expect(wowDelta(h, "temp", 5)).toBe(2.1); // 12.13 - 10.05 = 2.08, rounded to 2.1
  });
});

// ─── directionalScore + bullishContribution ────────────────
describe("directionalScore", () => {
  it("returns null when percentile is missing", () => {
    expect(directionalScore({ direction: "higher_bullish", latest: {} })).toBeNull();
    expect(directionalScore({ direction: "higher_bullish" })).toBeNull();
  });
  it("returns pct directly for higher_bullish", () => {
    expect(directionalScore({ direction: "higher_bullish", latest: { percentile: 75 } })).toBe(75);
    expect(directionalScore({ direction: "higher_bullish", latest: { percentile: 10 } })).toBe(10);
  });
  it("returns 100-pct for lower_bullish (non-contrarian)", () => {
    expect(directionalScore({
      direction: "lower_bullish", contrarian_at_extremes: false,
      latest: { percentile: 20 },
    })).toBe(80);
    expect(directionalScore({
      direction: "lower_bullish", contrarian_at_extremes: false,
      latest: { percentile: 90 },
    })).toBe(10);
  });
  it("returns triangular score for contrarian (peak at 50)", () => {
    const f = (pct) => ({
      direction: "lower_bullish", contrarian_at_extremes: true,
      latest: { percentile: pct },
    });
    expect(directionalScore(f(50))).toBe(100); // 50 - |0| = 50, *2 = 100
    expect(directionalScore(f(0))).toBe(0);    // 50 - 50 = 0
    expect(directionalScore(f(100))).toBe(0);
    expect(directionalScore(f(25))).toBe(50);  // 50 - 25 = 25, *2 = 50
    expect(directionalScore(f(75))).toBe(50);
  });
  it("returns null for neutral / unknown direction", () => {
    expect(directionalScore({ direction: "neutral", latest: { percentile: 50 } })).toBeNull();
    expect(directionalScore({ direction: undefined, latest: { percentile: 50 } })).toBeNull();
  });
});

describe("bullishContribution", () => {
  it("returns score - 50", () => {
    expect(bullishContribution({ direction: "higher_bullish", latest: { percentile: 75 } })).toBe(25);
    expect(bullishContribution({ direction: "higher_bullish", latest: { percentile: 30 } })).toBe(-20);
  });
  it("returns null when score is null", () => {
    expect(bullishContribution({ direction: "neutral", latest: { percentile: 50 } })).toBeNull();
  });
});

// ─── TEMP_LABEL ─────────────────────────────────────────────
describe("TEMP_LABEL", () => {
  it("returns '—' for null", () => {
    expect(TEMP_LABEL(null)).toBe("—");
  });
  it("returns 极熊 for very low", () => {
    expect(TEMP_LABEL(0)).toBe("极熊");
    expect(TEMP_LABEL(14)).toBe("极熊");
  });
  it("returns 极牛 for very high", () => {
    expect(TEMP_LABEL(85)).toBe("极牛");
    expect(TEMP_LABEL(100)).toBe("极牛");
  });
  it("crosses thresholds correctly", () => {
    expect(TEMP_LABEL(15)).toBe("偏熊");
    expect(TEMP_LABEL(35)).toBe("中性偏熊");
    expect(TEMP_LABEL(50)).toBe("中性偏牛");
    expect(TEMP_LABEL(65)).toBe("偏牛");
  });
});
