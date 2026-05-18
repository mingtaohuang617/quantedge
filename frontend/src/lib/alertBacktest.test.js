import { describe, it, expect } from "vitest";
import { backtestAlerts, evaluateDay, RULE_META } from "./alertBacktest.js";

describe("evaluateDay", () => {
  it("returns empty when temp missing", () => {
    expect(evaluateDay({ temp: null })).toEqual([]);
    expect(evaluateDay({ temp: undefined })).toEqual([]);
  });

  it("fires temp_low at ≤20", () => {
    expect(evaluateDay({ temp: 15 })).toContain("rule_temp_low");
    expect(evaluateDay({ temp: 20 })).toContain("rule_temp_low");
    expect(evaluateDay({ temp: 21 })).not.toContain("rule_temp_low");
  });

  it("fires temp_high at ≥80", () => {
    expect(evaluateDay({ temp: 85 })).toContain("rule_temp_high");
    expect(evaluateDay({ temp: 80 })).toContain("rule_temp_high");
    expect(evaluateDay({ temp: 79 })).not.toContain("rule_temp_high");
  });

  it("fires top_breadth_div on temp ≥ 55 + breadth ≤ 40", () => {
    expect(evaluateDay({ temp: 60, breadth: 30 })).toContain("rule_top_breadth_div");
    expect(evaluateDay({ temp: 50, breadth: 30 })).not.toContain("rule_top_breadth_div");
    expect(evaluateDay({ temp: 60, breadth: 50 })).not.toContain("rule_top_breadth_div");
    expect(evaluateDay({ temp: 60, breadth: null })).not.toContain("rule_top_breadth_div");
  });

  it("fires neutral in 35-65 open interval", () => {
    expect(evaluateDay({ temp: 50 })).toContain("rule_neutral");
    expect(evaluateDay({ temp: 36 })).toContain("rule_neutral");
    expect(evaluateDay({ temp: 64 })).toContain("rule_neutral");
    expect(evaluateDay({ temp: 35 })).not.toContain("rule_neutral");
    expect(evaluateDay({ temp: 65 })).not.toContain("rule_neutral");
  });

  it("fires val_extreme_approx when valuation ≤ 20", () => {
    expect(evaluateDay({ temp: 50, valuation: 15 })).toContain("rule_val_extreme_approx");
    expect(evaluateDay({ temp: 50, valuation: 25 })).not.toContain("rule_val_extreme_approx");
    expect(evaluateDay({ temp: 50, valuation: null })).not.toContain("rule_val_extreme_approx");
  });

  it("can fire multiple rules same day", () => {
    const ids = evaluateDay({ temp: 85, breadth: 30 });
    expect(ids).toContain("rule_temp_high");
    expect(ids).toContain("rule_top_breadth_div");
  });
});

describe("backtestAlerts", () => {
  it("returns null on empty history", () => {
    expect(backtestAlerts(null)).toBeNull();
    expect(backtestAlerts({})).toBeNull();
    expect(backtestAlerts({ dates: [] })).toBeNull();
  });

  it("returns null when benchmark length mismatch", () => {
    const h = {
      dates: ["a", "b", "c"],
      market_temperature: [10, 20, 30],
      benchmark: { values: [100, 110] },  // shorter
    };
    expect(backtestAlerts(h)).toBeNull();
  });

  it("counts triggers and reports first/last dates", () => {
    // 4 days, temp_low fires day 0 (10) and day 3 (15)
    const h = {
      dates: ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04"],
      market_temperature: [10, 30, 50, 15],
      benchmark: { values: [100, 102, 105, 108] },
    };
    const r = backtestAlerts(h, [1]);  // 1d horizon
    // dedup with gap=5: day 0 + day 3 (gap=3) → only day 0 keeps
    expect(r.rules.rule_temp_low.count).toBe(1);
    expect(r.rules.rule_temp_low.first).toBe("2020-01-01");
  });

  it("dedups closely spaced triggers (gap < 5 days)", () => {
    const h = {
      dates: Array.from({ length: 20 }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`),
      market_temperature: Array(20).fill(15),  // temp_low all 20 days
      benchmark: { values: Array(20).fill(100) },
    };
    const r = backtestAlerts(h, [1]);
    // With gap=5: idx 0, 5, 10, 15 → 4 dedup, but raw count = 20
    expect(r.rules.rule_temp_low.count).toBe(4);
    expect(r.rules.rule_temp_low.countRaw).toBe(20);
  });

  it("computes forward returns + win rate", () => {
    const h = {
      dates: ["2020-01-01", "2020-01-02", "2020-01-03"],
      market_temperature: [10, 50, 90],
      benchmark: { values: [100, 110, 132] },  // +10%, +20%
    };
    const r = backtestAlerts(h, [1]);
    // rule_temp_low day 0 → 1d fwd = 110/100-1 = +10%
    expect(r.rules.rule_temp_low.forward[1].mean).toBe(10);
    expect(r.rules.rule_temp_low.forward[1].n).toBe(1);
    expect(r.rules.rule_temp_low.forward[1].winRate).toBe(1.0);

    // rule_temp_high day 2 → 1d fwd: idx 2+1=3 doesn't exist → no return → null forward
    expect(r.rules.rule_temp_high.forward[1]).toBeNull();
  });

  it("includes period + horizons in output", () => {
    const h = {
      dates: ["2020-01-01", "2020-01-02"],
      market_temperature: [50, 50],
      benchmark: { values: [100, 101] },
    };
    const r = backtestAlerts(h);
    expect(r.period.start).toBe("2020-01-01");
    expect(r.period.end).toBe("2020-01-02");
    expect(r.period.days).toBe(2);
    expect(r.horizons).toEqual([21, 63, 252]);
  });

  it("median + mean differ on skewed distribution", () => {
    // 6 triggers (dedup gap=5 → idx 0, 5, 10, 15, 20, 25)
    // 5 small returns + 1 huge → median << mean
    const dates = Array.from({ length: 30 }, (_, i) => `2020-${String(Math.floor(i / 10) + 1).padStart(2, '0')}-${String(i % 10 + 1).padStart(2, '0')}`);
    const temp = Array(30).fill(10);  // all fire temp_low
    const bench = Array(30).fill(100);
    bench[1] = 101; bench[6] = 101; bench[11] = 101; bench[16] = 101;
    bench[21] = 150;  // huge jump
    bench[26] = 101;
    const r = backtestAlerts({
      dates, market_temperature: temp,
      benchmark: { values: bench },
    }, [1]);
    expect(r.rules.rule_temp_low.count).toBe(6);
    expect(r.rules.rule_temp_low.forward[1].n).toBe(6);
    // (1 + 1 + 1 + 1 + 50 + 1) / 6 = 55/6 ≈ 9.17
    expect(r.rules.rule_temp_low.forward[1].mean).toBeCloseTo(9.17, 1);
    expect(r.rules.rule_temp_low.forward[1].median).toBe(1);
  });
});

describe("RULE_META", () => {
  it("has metadata for all 5 backtested rules", () => {
    expect(Object.keys(RULE_META).sort()).toEqual([
      "rule_neutral",
      "rule_temp_high",
      "rule_temp_low",
      "rule_top_breadth_div",
      "rule_val_extreme_approx",
    ]);
  });

  it("each rule has label + kind + desc", () => {
    for (const meta of Object.values(RULE_META)) {
      expect(meta).toHaveProperty("label");
      expect(meta).toHaveProperty("kind");
      expect(meta).toHaveProperty("desc");
    }
  });
});
