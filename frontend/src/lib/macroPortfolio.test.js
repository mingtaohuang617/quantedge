import { describe, it, expect } from "vitest";
import { portfolioMacroSensitivity, sensitivityLabel } from "./macroPortfolio.js";

// helpers
const entry = (ticker, shares, currentPrice, name = ticker) => ({
  ticker, shares, currentPrice, name,
});
const stk = (ticker, fundamental, technical, score = 50) => ({
  ticker, score, subScores: { fundamental, technical, growth: 50 },
});

describe("portfolioMacroSensitivity", () => {
  it("returns null when temp missing", () => {
    expect(portfolioMacroSensitivity([entry("A", 10, 100)], [stk("A", 50, 50)], null)).toBeNull();
  });

  it("returns null on empty entries", () => {
    expect(portfolioMacroSensitivity([], [stk("A", 50, 50)], 60)).toBeNull();
    expect(portfolioMacroSensitivity(null, [], 60)).toBeNull();
  });

  it("ignores entries with no shares", () => {
    const entries = [
      { ticker: "A", shares: 0, currentPrice: 100 },
      { ticker: "B", shares: 10, currentPrice: 50 },
    ];
    const r = portfolioMacroSensitivity(entries, [stk("A", 50, 50), stk("B", 30, 80)], 80);
    expect(r.holdingCount).toBe(1);
  });

  it("computes weighted delta when all holdings have sub-scores", () => {
    // temp=80 (norm=+0.6)
    // A: shares 10, price 100 = $1000, fund=30/tech=80 (lean=+0.5) → Δ=+3 → weighted: 1000*3
    // B: shares 5, price 200 = $1000, fund=80/tech=30 (lean=-0.5) → Δ=-3 → weighted: 1000*-3
    // sum delta value = 1000*3 + 1000*(-3) = 0
    // portfolioDelta = 0 / 2000 = 0
    const entries = [entry("A", 10, 100), entry("B", 5, 200)];
    const stocks = [stk("A", 30, 80), stk("B", 80, 30)];
    const r = portfolioMacroSensitivity(entries, stocks, 80);
    expect(r.portfolioDelta).toBe(0);
    expect(r.coverage).toBe(1);
    expect(r.holdingCount).toBe(2);
  });

  it("computes flipped Δ via mirror around 50", () => {
    // bull (temp=80) momentum stock → +Δ
    // flipped to bear (temp=20) → that same stock now -Δ
    const entries = [entry("A", 10, 100)];  // $1000
    const stocks = [stk("A", 30, 80)];  // momentum
    const r = portfolioMacroSensitivity(entries, stocks, 80);
    expect(r.portfolioDelta).toBeCloseTo(3);
    expect(r.portfolioDeltaFlipped).toBeCloseTo(-3);
    expect(r.sensitivity).toBeCloseTo(6);
    expect(r.flippedTemp).toBe(20);
  });

  it("excludes ETFs from delta but keeps in totalValue (coverage drops)", () => {
    const entries = [
      entry("STK", 10, 100),  // $1000
      entry("ETF", 10, 100),  // $1000
    ];
    const stocks = [
      stk("STK", 30, 80),     // has subScores
      { ticker: "ETF", score: 60 },  // no subScores
    ];
    const r = portfolioMacroSensitivity(entries, stocks, 80);
    // weightedDelta uses only STK ($1000 × +3) / $1000 = +3
    expect(r.portfolioDelta).toBeCloseTo(3);
    expect(r.coverage).toBeCloseTo(0.5);
    expect(r.holdingCount).toBe(2);
  });

  it("returns null portfolioDelta when no holdings have subScores", () => {
    const entries = [entry("ETF1", 10, 100), entry("ETF2", 5, 200)];
    const stocks = [{ ticker: "ETF1" }, { ticker: "ETF2" }];
    const r = portfolioMacroSensitivity(entries, stocks, 80);
    expect(r.portfolioDelta).toBeNull();
    expect(r.coverage).toBe(0);
  });

  it("ranks contributors by |contribution| desc", () => {
    // A: $1000, Δ=+3 → contribution = 1000/3000 * 3 = +1.0
    // B: $2000, Δ=-3 → contribution = 2000/3000 * -3 = -2.0  ← largest |c|
    // C: $0 (no shares) — skipped
    const entries = [entry("A", 10, 100), entry("B", 10, 200), { ticker: "C", shares: 0, currentPrice: 50 }];
    const stocks = [stk("A", 30, 80), stk("B", 80, 30)];
    const r = portfolioMacroSensitivity(entries, stocks, 80);
    expect(r.contributors.length).toBe(2);
    expect(r.contributors[0].ticker).toBe("B");
    expect(r.contributors[1].ticker).toBe("A");
  });

  it("uses anchorPrice fallback when currentPrice missing", () => {
    const entries = [{ ticker: "A", shares: 10, anchorPrice: 100 }];
    const stocks = [stk("A", 30, 80)];
    const r = portfolioMacroSensitivity(entries, stocks, 80);
    expect(r.portfolioDelta).toBeCloseTo(3);  // uses anchor 100 * 10 shares
  });

  it("skips entries with zero price", () => {
    const entries = [
      { ticker: "A", shares: 10, currentPrice: 0, anchorPrice: 0 },
      entry("B", 10, 100),
    ];
    const stocks = [stk("A", 30, 80), stk("B", 30, 80)];
    const r = portfolioMacroSensitivity(entries, stocks, 80);
    expect(r.holdingCount).toBe(1);  // only B counts
  });
});

describe("sensitivityLabel", () => {
  it("returns null on null input", () => {
    expect(sensitivityLabel(null)).toBeNull();
  });
  it("classifies into 3 bands", () => {
    expect(sensitivityLabel(0)).toBe("组合对 regime 切换不敏感");
    expect(sensitivityLabel(1.9)).toBe("组合对 regime 切换不敏感");
    expect(sensitivityLabel(2)).toBe("组合对 regime 切换中等敏感");
    expect(sensitivityLabel(4.9)).toBe("组合对 regime 切换中等敏感");
    expect(sensitivityLabel(5)).toBe("组合对 regime 切换高度敏感");
    expect(sensitivityLabel(10)).toBe("组合对 regime 切换高度敏感");
  });
});
