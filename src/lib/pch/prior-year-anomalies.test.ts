import { describe, it, expect } from "vitest";
import { computePriorYearAnomalies } from "./prior-year-anomalies";
import type { TaxEngineOutput } from "@/lib/tax-engine";

function stub(pl: Partial<TaxEngineOutput["pl"]>): TaxEngineOutput {
  return {
    pl: { turnover: 0, expensesTotal: 0, netProfit: 0, capitalAllowances: 0, taxableProfit: 0, ...pl },
    tax: {} as unknown as TaxEngineOutput["tax"],
    sa103s: {} as unknown as TaxEngineOutput["sa103s"],
  } as unknown as TaxEngineOutput;
}

describe("computePriorYearAnomalies", () => {
  it("empty when both snapshots missing", () => {
    expect(computePriorYearAnomalies(null, null)).toEqual([]);
    expect(computePriorYearAnomalies(stub({ turnover: 10000 }), null)).toEqual([]);
  });

  it("flags severe on sign flip even for small amounts", () => {
    const r = computePriorYearAnomalies(
      stub({ netProfit: 200 }),
      stub({ netProfit: -200 }),
    );
    const flip = r.find((a) => a.key === "netProfit");
    expect(flip?.severity).toBe("severe");
    expect(flip?.note).toMatch(/loss to profit/);
  });

  it("ignores money movements below the £1,000 floor", () => {
    const r = computePriorYearAnomalies(
      stub({ turnover: 10900 }),
      stub({ turnover: 10000 }),
    );
    expect(r).toHaveLength(0);
  });

  it("flags notable on 25-50% money moves above the floor", () => {
    const r = computePriorYearAnomalies(
      stub({ turnover: 20000 }),
      stub({ turnover: 15000 }),
    );
    const t = r.find((a) => a.key === "turnover");
    expect(t?.severity).toBe("notable");
    expect(t?.pctChange).toBeCloseTo(0.333, 2);
  });

  it("flags severe on >=50% money moves", () => {
    const r = computePriorYearAnomalies(
      stub({ turnover: 50000, netProfit: 30000 }),
      stub({ turnover: 20000, netProfit: 10000 }),
    );
    const t = r.find((a) => a.key === "turnover");
    expect(t?.severity).toBe("severe");
    // Both should surface
    expect(r.length).toBeGreaterThanOrEqual(2);
    // Severe before notable
    expect(r[0].severity).toBe("severe");
  });

  it("mileage: ignores below floor + flags above threshold", () => {
    const nope = computePriorYearAnomalies(
      stub({}), stub({}),
      { current: 12500, prior: 12000 }, // only +4% + 500 miles
    );
    expect(nope).toHaveLength(0);

    const flag = computePriorYearAnomalies(
      stub({}), stub({}),
      { current: 20000, prior: 10000 }, // +100%, +10,000 miles
    );
    const m = flag.find((a) => a.key === "businessMiles");
    expect(m?.severity).toBe("severe");
    expect(m?.note).toMatch(/Business miles/);
  });
});
