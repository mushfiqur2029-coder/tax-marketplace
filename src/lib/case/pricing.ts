import type { PlanTier } from "@/lib/plans";

// Single-source price lookup. Prefers the per-case custom_fee_pence
// override (set only on admin-created bespoke cases) over the tier
// catalogue's flat priceGbp.
//
// Returns an integer number of pence. Pass through to Stripe
// (unit_amount) or divide by 100 for display.
export function effectiveFeePence(row: {
  custom_fee_pence: number | null;
  tier?: string;
}, tier: PlanTier | null): number {
  if (row.custom_fee_pence != null && row.custom_fee_pence > 0) {
    return row.custom_fee_pence;
  }
  return (tier?.priceGbp ?? 0) * 100;
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
