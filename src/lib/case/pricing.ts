import type { PlanTier } from "@/lib/plans";

// Single-source TOTAL price lookup. Precedence:
//   1. row.custom_fee_pence  — set only on admin-created bespoke cases;
//      wins unconditionally so bespoke pricing is never silently
//      overridden by a tier-level sale.
//   2. tier.salePriceGbp     — when non-null, this is the "was £X now £Y"
//      promotional price. Flows into every checkout surface (deposit,
//      full-fee, balance) because they all route through this function
//      via `upfrontChargePence` / `balanceChargePence`.
//   3. tier.priceGbp         — the regular catalogue price, fallback.
//
// Returns an integer number of pence. For bespoke two-stage engagements
// this is still the TOTAL (deposit + balance); use `upfrontChargePence`
// or `balanceChargePence` to split.
//
// NOTE on timing: flat-fee (non-bespoke) cases do NOT snapshot the
// price at creation; they read the tier live at each surface (letter
// render, checkout, admin display). That means admin flipping a sale
// on/off between engagement signing and checkout will show different
// amounts on the letter vs the Stripe page — pre-existing behaviour
// also true for any priceGbp edit. Bespoke cases are immune via
// custom_fee_pence snapshotting at creation. Already-paid cases are
// also immune since Stripe has already captured the exact amount.
export function effectiveFeePence(row: {
  custom_fee_pence: number | null;
  tier?: string;
}, tier: PlanTier | null): number {
  if (row.custom_fee_pence != null && row.custom_fee_pence > 0) {
    return row.custom_fee_pence;
  }
  if (tier?.salePriceGbp != null && tier.salePriceGbp > 0) {
    return tier.salePriceGbp * 100;
  }
  return (tier?.priceGbp ?? 0) * 100;
}

// Amount to charge NOW on the engagement-letter -> checkout step.
// For a bespoke two-stage engagement this is deposit_pence; for
// every other case (flat-fee personal, flat-fee company, dormant,
// urgent-fee uplift, legacy bespoke single-fee) it's the full
// effective fee, same as today.
export function upfrontChargePence(
  row: {
    custom_fee_pence: number | null;
    deposit_pence: number | null;
    tier?: string;
  },
  tier: PlanTier | null,
): number {
  if (row.deposit_pence != null && row.deposit_pence > 0) {
    return row.deposit_pence;
  }
  return effectiveFeePence(row, tier);
}

// Amount still owed after the deposit. 0 for every non-bespoke case
// and for legacy bespoke rows that never had a balance stored. Used
// by the balance-checkout flow and the "balance due" UI banners.
export function balanceChargePence(row: {
  balance_pence: number | null;
}): number {
  if (row.balance_pence != null && row.balance_pence > 0) {
    return row.balance_pence;
  }
  return 0;
}

// Pretty display helper. Returns "£1,250" style (no decimals when the
// fee is a whole £ amount; otherwise "£1,249.99"). Bespoke fees are
// stored as pence so sub-£ precision is possible but the admin UI
// restricts entry to whole-£.
export function formatFeeGbp(pence: number): string {
  const whole = Math.floor(pence / 100);
  const remainder = pence % 100;
  const formatted = whole.toLocaleString("en-GB");
  if (remainder === 0) return `£${formatted}`;
  return `£${formatted}.${remainder.toString().padStart(2, "0")}`;
}
