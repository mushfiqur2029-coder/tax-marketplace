import { describe, it, expect } from "vitest";
import { effectiveFeePence } from "../case/pricing";
import type { PlanTier } from "../plans";

// Regression test for the "Accountancy Fees prefill understates by the
// urgency surcharge" bug. The actual computation lives in two call
// sites (ensureAccountancyFeesRow in src/lib/pch/accountancy-fees.ts
// and the client PCH page.tsx caseFeePence) which both do:
//
//   effectiveFeePence(caseRow, tier) + (caseRow.urgent_fee_pence ?? 0)
//
// effectiveFeePence deliberately returns only the base plan fee so the
// Stripe checkout and webhook paths can reason about the two amounts
// separately. The deductible accountancy figure the client claims on
// their SA103S has to be the TOTAL they paid us, so the sum is formed
// at the two consumer sites. If anyone collapses the "+ urgent_fee"
// part out of either site in a future refactor, this test catches it
// in the shape of the formula.

const uberPhvAutomatedTier: PlanTier = {
  id: "uber_phv_automated",
  group: "personal",
  title: "Uber/PHV Automated",
  tagline: "",
  priceGbp: 89,
};

function accountancyPrefillPence(
  caseRow: { custom_fee_pence: number | null; tier: string; urgent_fee_pence: number | null },
  tier: PlanTier | null,
): number {
  return effectiveFeePence(caseRow, tier) + (caseRow.urgent_fee_pence ?? 0);
}

describe("accountancy fees prefill (base + urgent surcharge)", () => {
  it("non-urgent uber_phv_automated: base plan fee only, unchanged behaviour", () => {
    expect(
      accountancyPrefillPence(
        { custom_fee_pence: null, tier: "uber_phv_automated", urgent_fee_pence: 0 },
        uberPhvAutomatedTier,
      ),
    ).toBe(8900);
  });

  it("non-urgent with null urgent_fee_pence: base plan fee only (regression on `?? 0`)", () => {
    expect(
      accountancyPrefillPence(
        { custom_fee_pence: null, tier: "uber_phv_automated", urgent_fee_pence: null },
        uberPhvAutomatedTier,
      ),
    ).toBe(8900);
  });

  it("urgent uber_phv_automated: base plan fee PLUS urgency surcharge", () => {
    // The exact live bug: three real cases had urgent_fee_pence=10000
    // (£100) and the persisted Accountancy Fees row was stuck at £89
    // instead of £189. This asserts the fix.
    expect(
      accountancyPrefillPence(
        { custom_fee_pence: null, tier: "uber_phv_automated", urgent_fee_pence: 10000 },
        uberPhvAutomatedTier,
      ),
    ).toBe(18900);
  });

  it("tier on sale: sale price + urgency surcharge", () => {
    const saleTier: PlanTier = { ...uberPhvAutomatedTier, salePriceGbp: 69 };
    expect(
      accountancyPrefillPence(
        { custom_fee_pence: null, tier: "uber_phv_automated", urgent_fee_pence: 10000 },
        saleTier,
      ),
    ).toBe(6900 + 10000);
  });

  it("bespoke custom_fee_pence wins over tier price, urgency still added", () => {
    expect(
      accountancyPrefillPence(
        { custom_fee_pence: 25000, tier: "uber_phv_automated", urgent_fee_pence: 10000 },
        uberPhvAutomatedTier,
      ),
    ).toBe(25000 + 10000);
  });
});
