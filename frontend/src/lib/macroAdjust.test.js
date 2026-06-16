import { describe, it, expect } from "vitest";
import { macroDelta, macroAdjustedScore, macroAdjustExplain } from "./macroAdjust.js";

// helper: build a minimal stock with dual-track scores
const stk = (quality, timing, score = 50) => ({
  score,
  qualityScore: quality,
  timingScore: timing,
});

describe("macroDelta", () => {
  it("returns null when temp missing", () => {
    expect(macroDelta(stk(50, 50), null)).toBeNull();
    expect(macroDelta(stk(50, 50), undefined)).toBeNull();
  });

  it("returns null when dual-track scores missing", () => {
    expect(macroDelta({ score: 50 }, 70)).toBeNull();
    expect(macroDelta({ score: 50, qualityScore: 50 }, 70)).toBeNull();
    expect(macroDelta({ score: 50, timingScore: 50 }, 70)).toBeNull();
  });

  it("returns null for ETF (macro rotation is stocks-only)", () => {
    expect(macroDelta({ isETF: true, score: 50, qualityScore: 60, timingScore: 40 }, 70)).toBeNull();
  });

  it("returns 0 at neutral temp (50)", () => {
    expect(macroDelta(stk(30, 80), 50)).toBe(0);
    expect(macroDelta(stk(80, 30), 50)).toBe(0);
  });

  it("returns 0 for balanced stock (timing == quality)", () => {
    expect(macroDelta(stk(60, 60), 80)).toBe(0);
    expect(macroDelta(stk(40, 40), 20)).toBe(0);
  });

  it("bull market + timing(momentum) stock → positive adjustment", () => {
    // temp=80 (norm=+0.6), timing=80, quality=30 (lean=+0.5) → 0.6*0.5*10 = 3
    expect(macroDelta(stk(30, 80), 80)).toBe(3);
  });

  it("bull market + quality(value) stock → negative adjustment", () => {
    // temp=80, timing=30, quality=80 → 0.6 * -0.5 * 10 = -3
    expect(macroDelta(stk(80, 30), 80)).toBe(-3);
  });

  it("bear market + quality(value) stock → positive adjustment (defensive)", () => {
    // temp=20 (norm=-0.6), timing=30, quality=80 → -0.6 * -0.5 * 10 = 3
    expect(macroDelta(stk(80, 30), 20)).toBe(3);
  });

  it("bear market + timing(momentum) stock → negative adjustment", () => {
    // temp=20, timing=80, quality=30 → -0.6 * 0.5 * 10 = -3
    expect(macroDelta(stk(30, 80), 20)).toBe(-3);
  });

  it("caps at ±10 (extreme inputs)", () => {
    // temp=100 (norm=+1), timing=100, quality=0 (lean=+1) → 1*1*10 = 10
    expect(macroDelta(stk(0, 100), 100)).toBe(10);
    expect(macroDelta(stk(100, 0), 0)).toBe(10);
    expect(macroDelta(stk(100, 0), 100)).toBe(-10);
    expect(macroDelta(stk(0, 100), 0)).toBe(-10);
  });
});

describe("macroAdjustedScore", () => {
  it("returns null if base score missing", () => {
    expect(macroAdjustedScore({ qualityScore: 50, timingScore: 50 }, 70)).toBeNull();
  });

  it("returns base score when delta is null (ETF / missing subs)", () => {
    expect(macroAdjustedScore({ score: 60 }, 70)).toBe(60);
    expect(macroAdjustedScore({ isETF: true, score: 60, qualityScore: 70, timingScore: 40 }, 70)).toBe(60);
  });

  it("applies delta correctly", () => {
    // base=70, bull + timing → +3 → 73
    expect(macroAdjustedScore(stk(30, 80, 70), 80)).toBe(73);
  });

  it("rounds to 1 decimal", () => {
    // temp=75 (norm=+0.5), timing=70, quality=30 (lean=+0.4) → 0.5*0.4*10 = 2.0
    expect(macroAdjustedScore(stk(30, 70, 65.5), 75)).toBe(67.5);
  });
});

describe("macroAdjustExplain", () => {
  it("returns null for non-applicable cases", () => {
    expect(macroAdjustExplain(stk(50, 50), 70)).toBeNull();  // delta 0
    expect(macroAdjustExplain({ score: 50 }, 70)).toBeNull();  // no subs
  });

  it("returns null when |delta| < 0.5", () => {
    // temp=52, lean small → delta very small
    expect(macroAdjustExplain(stk(55, 60), 52)).toBeNull();
  });

  it("explains bull + momentum (positive)", () => {
    expect(macroAdjustExplain(stk(30, 80), 80)).toBe("牛市中动量风格当下加分");
  });

  it("explains bear + value (positive)", () => {
    expect(macroAdjustExplain(stk(80, 30), 20)).toBe("熊市中价值风格当下加分");
  });

  it("explains bull + value (negative)", () => {
    expect(macroAdjustExplain(stk(80, 30), 80)).toBe("牛市中价值风格当下不利");
  });

  it("explains bear + momentum (negative)", () => {
    expect(macroAdjustExplain(stk(30, 80), 20)).toBe("熊市中动量风格当下不利");
  });
});
