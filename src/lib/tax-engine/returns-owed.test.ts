import { describe, it, expect } from "vitest";
import {
  computeReturnsOwed,
  dateToTaxYear,
  taxYearBounds,
} from "./returns-owed";

describe("dateToTaxYear", () => {
  it("maps dates on/after 6 April to the new tax year", () => {
    expect(dateToTaxYear(new Date("2025-04-06T00:00:00Z"))).toBe("2025/26");
    expect(dateToTaxYear(new Date("2025-11-15T12:34:00Z"))).toBe("2025/26");
    expect(dateToTaxYear(new Date("2026-04-05T23:59:59Z"))).toBe("2025/26");
  });
  it("maps dates before 6 April to the prior tax year", () => {
    expect(dateToTaxYear(new Date("2026-01-15T00:00:00Z"))).toBe("2025/26");
    expect(dateToTaxYear(new Date("2025-04-05T23:59:59Z"))).toBe("2024/25");
  });
});

describe("taxYearBounds", () => {
  it("returns 6 Apr start and 5 Apr end at UTC", () => {
    const { yearStart, yearEnd } = taxYearBounds("2024/25");
    expect(yearStart.toISOString()).toBe("2024-04-06T00:00:00.000Z");
    expect(yearEnd.toISOString()).toBe("2025-04-05T00:00:00.000Z");
  });
});

describe("computeReturnsOwed", () => {
  it("flags the user story: started driving Nov 2024, nothing filed, now Oct 2026", () => {
    const r = computeReturnsOwed({
      tradingStartDate: new Date("2024-11-01T00:00:00Z"),
      alreadyFiledYears: [],
      asOf: new Date("2026-10-17T00:00:00Z"),
    });
    // Both 2024/25 and 2025/26 have ended by Oct 2026, nothing filed
    const years = r.years.map((y) => y.taxYear);
    expect(years).toEqual(["2024/25", "2025/26"]);
    // 2024/25 registration deadline was 5 Oct 2025, long past
    expect(r.years[0].registrationDeadlinePassed).toBe(true);
    // 2024/25 filing deadline was 31 Jan 2026, overdue
    expect(r.years[0].filingOverdue).toBe(true);
    // 2025/26 filing deadline is 31 Jan 2027. NOT overdue on 17 Oct 2026
    expect(r.years[1].filingOverdue).toBe(false);
    expect(r.anyOverdue).toBe(true);
    expect(r.anyRegistrationDeadlineMissed).toBe(true);
    expect(r.oldestOutstandingYear).toBe("2024/25");
  });
  it("excludes already-filed years", () => {
    const r = computeReturnsOwed({
      tradingStartDate: new Date("2024-11-01T00:00:00Z"),
      alreadyFiledYears: ["2024/25"],
      asOf: new Date("2026-10-17T00:00:00Z"),
    });
    expect(r.years.map((y) => y.taxYear)).toEqual(["2025/26"]);
    expect(r.anyOverdue).toBe(false);
    expect(r.anyRegistrationDeadlineMissed).toBe(false);
  });
  it("does not include a tax year that is still in progress", () => {
    const r = computeReturnsOwed({
      tradingStartDate: new Date("2024-11-01T00:00:00Z"),
      alreadyFiledYears: ["2024/25"],
      asOf: new Date("2025-10-01T00:00:00Z"), // 2025/26 still running
    });
    expect(r.years.map((y) => y.taxYear)).toEqual([]);
  });
  it("respects a trading stop date", () => {
    const r = computeReturnsOwed({
      tradingStartDate: new Date("2023-06-01T00:00:00Z"),
      tradingEndDate: new Date("2024-03-01T00:00:00Z"), // stopped in 2023/24
      alreadyFiledYears: [],
      asOf: new Date("2026-10-17T00:00:00Z"),
    });
    expect(r.years.map((y) => y.taxYear)).toEqual(["2023/24"]);
  });
});
