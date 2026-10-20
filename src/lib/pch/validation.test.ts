import { describe, it, expect } from "vitest";
import {
  validateUtr,
  validateNino,
  validatePostcode,
  validateBusinessPct,
  validateCo2,
  validateDateNotInFuture,
  validateStartStop,
  validateMilesConsistency,
  canRunDraft,
  canRequestFiling,
  warnBoxMismatch,
} from "./validation";

describe("field validators", () => {
  it("UTR must be 10 digits", () => {
    expect(validateUtr("")).toBeNull();          // blank passes (required-ness elsewhere)
    expect(validateUtr("1234567890")).toBeNull();
    expect(validateUtr("123456789")).not.toBeNull();  // 9 digits
    expect(validateUtr("12345678901")).not.toBeNull(); // 11 digits
    expect(validateUtr("1234 567 890")).not.toBeNull(); // spaces not stripped
  });
  it("NINO regex matches the real format", () => {
    expect(validateNino("")).toBeNull();
    expect(validateNino("AB 123456 C")).toBeNull(); // spaces OK
    expect(validateNino("JA123456C")).toBeNull();
    expect(validateNino("ZZ999999Z")).not.toBeNull();  // Z suffix invalid
    expect(validateNino("DA123456A")).not.toBeNull();  // D prefix invalid
    expect(validateNino("12AB345678")).not.toBeNull();
  });
  it("UK postcode", () => {
    expect(validatePostcode("")).toBeNull();
    expect(validatePostcode("N1 1AA")).toBeNull();
    expect(validatePostcode("N11AA")).toBeNull();
    expect(validatePostcode("SW1A 1AA")).toBeNull();
    expect(validatePostcode("E1 5BS")).toBeNull();
    expect(validatePostcode("INVALID")).not.toBeNull();
    expect(validatePostcode("12345")).not.toBeNull();
  });
  it("business pct is 0..1 (fraction, not percent)", () => {
    expect(validateBusinessPct(null)).toBeNull();
    expect(validateBusinessPct(0.75)).toBeNull();
    expect(validateBusinessPct(1)).toBeNull();
    expect(validateBusinessPct(1.5)).not.toBeNull();
    expect(validateBusinessPct(-0.1)).not.toBeNull();
  });
  it("CO2 bounded", () => {
    expect(validateCo2(120)).toBeNull();
    expect(validateCo2(-1)).not.toBeNull();
    expect(validateCo2(600)).not.toBeNull();
  });
  it("date-not-in-future", () => {
    expect(validateDateNotInFuture(null)).toBeNull();
    expect(validateDateNotInFuture("1990-01-01")).toBeNull();
    const future = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    expect(validateDateNotInFuture(future)).not.toBeNull();
  });
  it("start/stop ordering", () => {
    expect(validateStartStop("2024-06-01", "2025-01-31")).toBeNull();
    expect(validateStartStop("2025-01-31", "2024-06-01")).not.toBeNull();
    expect(validateStartStop(null, "2024-06-01")).toBeNull(); // only enforced when both set
  });
  it("miles consistency", () => {
    expect(validateMilesConsistency(10000, 50000, 20000, 10000, 0)).toBeNull();
    expect(validateMilesConsistency(10000, 20000, 25000, 5000, 0)).not.toBeNull();
    expect(validateMilesConsistency(null, 50000, 25000, 5000, 0)).toBeNull(); // one missing
  });
});

describe("canRunDraft", () => {
  it("blocks when no income line has gross > 0", () => {
    const r = canRunDraft([{ grossTakings: 0, type: "Fares" }], null);
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toMatch(/no income|bank statement/i);
  });
  it("ok with one positive income + CA-eligible status + method chosen", () => {
    const r = canRunDraft(
      [{ grossTakings: 10000, type: "Fares" }],
      { status: "Owned outright", method_choice: "Actual costs" } as never,
    );
    expect(r.ok).toBe(true);
  });
  it("blocks when CA-eligible vehicle has no mileage, method or override", () => {
    const r = canRunDraft(
      [{ grossTakings: 10000, type: "Fares" }],
      { status: "Owned outright", method_choice: "" } as never,
    );
    expect(r.ok).toBe(false);
    expect(r.blockers.join()).toMatch(/business-use|odometer/i);
  });
  it("does NOT block when status is 'No vehicle'", () => {
    const r = canRunDraft(
      [{ grossTakings: 10000, type: "Fares" }],
      { status: "No vehicle" } as never,
    );
    expect(r.ok).toBe(true);
  });
  it("does NOT block when status is 'Leased' or 'Rented'", () => {
    for (const status of ["Leased", "Rented"]) {
      const r = canRunDraft(
        [{ grossTakings: 10000, type: "Fares" }],
        { status } as never,
      );
      expect(r.ok).toBe(true);
    }
  });
  it("does NOT block when status is missing (fresh case, no vehicle row)", () => {
    const r = canRunDraft(
      [{ grossTakings: 10000, type: "Fares" }],
      { status: null } as never,
    );
    expect(r.ok).toBe(true);
  });
  it("does NOT block when vehicle itself is null", () => {
    const r = canRunDraft([{ grossTakings: 10000, type: "Fares" }], null);
    expect(r.ok).toBe(true);
  });
});

describe("canRequestFiling", () => {
  it("blocks when any positive-amount expense lacks evidence", () => {
    const r = canRequestFiling([
      { amountPaid: 100, evidence: "Receipt" },
      { amountPaid: 50, evidence: "" },
    ]);
    expect(r.ok).toBe(false);
  });
  it("ignores zero-amount lines (they're placeholder rows)", () => {
    const r = canRequestFiling([
      { amountPaid: 100, evidence: "Receipt" },
      { amountPaid: 0, evidence: "" },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("warnBoxMismatch", () => {
  it("flags mismatch", () => {
    expect(warnBoxMismatch("Phone & technology", 12))?.toMatch(/box 18/);
  });
  it("quiet on match", () => {
    expect(warnBoxMismatch("Phone & technology", 18)).toBeNull();
  });
});
