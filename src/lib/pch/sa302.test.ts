import { describe, it, expect } from "vitest";
import { computeSa302ValidationState, SA302_COMPARE_FIELDS, type Sa302Comparison } from "./sa302";
import type { TaxEngineOutput } from "@/lib/tax-engine";

// Build a stub snapshot where every readable path returns a fixed
// number. Only the paths SA302_COMPARE_FIELDS reads are important;
// everything else can stay zero.
function stubSnapshot(engineValue: number): TaxEngineOutput {
  const sa103s: Record<string, number> = {};
  for (const f of SA302_COMPARE_FIELDS) {
    if (f.group === "SA103S boxes") sa103s[f.key] = engineValue;
  }
  return {
    pl: { turnover: 0, expensesTotal: 0, netProfit: 0, capitalAllowances: 0, taxableProfit: 0 } as unknown as TaxEngineOutput["pl"],
    tax: {
      selfEmploymentProfit: engineValue,
      incomeTax: engineValue,
      class4: engineValue,
      balancingPayment: engineValue,
      poaForNextYear: engineValue,
    } as unknown as TaxEngineOutput["tax"],
    sa103s: sa103s as unknown as TaxEngineOutput["sa103s"],
  } as unknown as TaxEngineOutput;
}

describe("computeSa302ValidationState", () => {
  it("not green when snapshot missing", () => {
    const s = computeSa302ValidationState(null, { recorded_at: "x" });
    expect(s.allGreen).toBe(false);
    expect(s.filled).toBe(0);
    expect(s.total).toBe(SA302_COMPARE_FIELDS.length);
  });

  it("not green when comparison missing", () => {
    const s = computeSa302ValidationState(stubSnapshot(100), null);
    expect(s.allGreen).toBe(false);
  });

  it("not green when any field is missing", () => {
    const comp: Sa302Comparison = {};
    for (const f of SA302_COMPARE_FIELDS.slice(0, -1)) comp[f.key] = 100;
    const s = computeSa302ValidationState(stubSnapshot(100), comp);
    expect(s.allGreen).toBe(false);
    expect(s.filled).toBe(SA302_COMPARE_FIELDS.length - 1);
    expect(s.mismatchCount).toBe(0);
  });

  it("not green when a filled field is outside tolerance", () => {
    const comp: Sa302Comparison = { recorded_at: "2026-10-18T00:00:00Z" };
    for (const f of SA302_COMPARE_FIELDS) comp[f.key] = 100;
    comp["box9_turnover"] = 150; // 50 off, wholePound tolerance is 1
    const s = computeSa302ValidationState(stubSnapshot(100), comp);
    expect(s.allGreen).toBe(false);
    expect(s.mismatchCount).toBe(1);
  });

  it("green when every field is filled and within tolerance", () => {
    const comp: Sa302Comparison = { recorded_at: "2026-10-18T00:00:00Z" };
    for (const f of SA302_COMPARE_FIELDS) comp[f.key] = 100;
    const s = computeSa302ValidationState(stubSnapshot(100), comp);
    expect(s.allGreen).toBe(true);
    expect(s.filled).toBe(SA302_COMPARE_FIELDS.length);
    expect(s.mismatchCount).toBe(0);
    expect(s.recordedAt).toBe("2026-10-18T00:00:00Z");
  });

  it("green when whole-pound rounding is within ±£1", () => {
    const comp: Sa302Comparison = {};
    for (const f of SA302_COMPARE_FIELDS) comp[f.key] = f.scope === "wholePound" ? 100 : 100;
    // Nudge one whole-pound box by 0.5 (within tolerance of 1)
    comp["box9_turnover"] = 100.5;
    const s = computeSa302ValidationState(stubSnapshot(100), comp);
    expect(s.allGreen).toBe(true);
  });
});
