import type { SegmentId } from "./segments";

export type TierId =
  // Personal
  | "basic"
  | "standard"
  | "premium"
  // Limited company (three flat-fee services, £400 each, temporary pricing)
  | "dormant"
  | "non_vat_reg"
  | "vat_reg";

// Legacy limited-company tier IDs that are no longer sold. Kept as Postgres
// enum values (vat_basic / vat_standard / vat_accounts) because dropping an
// enum value is painful and we have no cases on them. They are intentionally
// absent from PLAN_TIERS below so the wizard and marketing site can't show
// them.

export type PlanGroup = "personal" | "company";

export type PlanTier = {
  id: TierId;
  group: PlanGroup;
  title: string;
  tagline: string;              // sub-heading under title
  priceGbp: number;             // current price (used for Stripe amount)
  originalGbp?: number;         // struck-through original price (personal only)
  saveGbp?: number;             // shown next to price (personal only)
  priceGbpSubtitle?: string;    // small footer under the price
  priceSuffix?: string;         // e.g. "+VAT"
  pricePer?: string;            // e.g. "/quarter"
  featured?: boolean;
  heroLine?: string;            // one-liner between price and bullets
  features?: string[];          // bullet list (may be absent for description-only tiers)
  description?: string;         // used when features is absent
  footerLine?: string;          // italic line at the bottom of the card
};

export const PLAN_TIERS: PlanTier[] = [
  // ---------- Personal ----------
  {
    id: "basic",
    group: "personal",
    title: "Prepared & Filed Accurately",
    tagline: "Expert sign off, so you know it's right.",
    priceGbp: 99,
    originalGbp: 169,
    saveGbp: 70,
    priceGbpSubtitle: "one-off",
    heroLine: "Expert sign off, so you know it's right.",
    features: [
      "Accountant prepares & files your Self Assessment",
      "Accuracy Guarantee",
      "Message your accountant during filing",
    ],
    footerLine: "If your situation is straightforward, this is enough.",
  },
  {
    id: "standard",
    group: "personal",
    title: "Filed, Optimised & Protected",
    tagline: "We find what you're owed, and protect you if HMRC asks questions.",
    priceGbp: 149,
    originalGbp: 249,
    saveGbp: 100,
    priceGbpSubtitle: "one-off",
    featured: true,
    heroLine:
      "We find what you're owed, and protect you if HMRC asks questions.",
    features: [
      "Everything in Prepared & Filed Accurately",
      "Deduction & relief optimisation + strategic tax planning call",
      "Full HMRC protection (audit + letter support)",
    ],
    footerLine:
      "Most filers choose this, if you'd rather not leave money on the table.",
  },
  {
    id: "premium",
    group: "personal",
    title: "Filed + a Year-Round Tax Partner",
    tagline:
      "An accountant on retainer, helping you stay on top of your tax position all year.",
    priceGbp: 349,
    originalGbp: 499,
    saveGbp: 150,
    priceGbpSubtitle: "one-off",
    heroLine:
      "An accountant on retainer, helping you stay on top of your tax position all year.",
    features: [
      "Everything in Filed, Optimised & Protected",
      "Year-round access to your accountant",
      "Annual tax efficiency review",
      "HMRC agent representation",
    ],
    footerLine:
      "If your situation is more complex, or you want year-round accountant support.",
  },

  // ---------- Limited company (3 flat-fee services, £400 each) ----------
  //
  // The three "services" from the Limited Company flow map 1:1 to a tier
  // here. Picking the service IS picking the tier; there's no additional
  // plan-tier step for the company path. Prices are temporary — the user
  // will adjust them later once real-world data informs each one.
  {
    id: "dormant",
    group: "company",
    title: "Dormant company",
    tagline: "For companies with no trading activity in the period.",
    priceGbp: 400,
    priceGbpSubtitle: "one-off",
    features: [
      "Dormant annual accounts prepared and filed",
      "CT600 nil return to HMRC",
      "Companies House submission",
      "Flat fee, no surprises",
    ],
    description:
      "For companies that are inactive and have no business activity in the period.",
  },
  {
    id: "non_vat_reg",
    group: "company",
    title: "Non-VAT registered company",
    tagline: "Full year-end accounts and corporation tax, done.",
    priceGbp: 400,
    priceGbpSubtitle: "one-off",
    // All three limited-company services are the same £400 price, so no
    // "Most chosen" badge on any of them — would just be arbitrary. The
    // badge stays on the Personal path where tiers have genuinely
    // different prices and a real recommendation.
    features: [
      "Annual accounts prepared and filed at Companies House",
      "Corporation tax return (CT600) filed with HMRC",
      "Bookkeeping from your bank statements",
      "Flat fee, no surprises",
    ],
    description:
      "For trading companies that are not VAT registered. Includes bookkeeping, year-end accounts, and corporation tax.",
  },
  {
    id: "vat_reg",
    group: "company",
    title: "VAT-registered company",
    tagline: "Year-end accounts, corporation tax, and ongoing VAT returns.",
    priceGbp: 400,
    priceGbpSubtitle: "one-off",
    features: [
      "Everything in Non-VAT registered",
      "VAT return filing for every period",
      "Monthly, quarterly or annual VAT cycles supported",
      "Flat fee, no surprises",
    ],
    description:
      "For VAT registered trading companies. Covers year-end accounts, corporation tax, and each VAT return in the engagement period.",
  },
];

export function getTier(id: string | null | undefined): PlanTier | null {
  if (!id) return null;
  return PLAN_TIERS.find((t) => t.id === id) ?? null;
}

export const PERSONAL_TIERS: PlanTier[] = PLAN_TIERS.filter(
  (t) => t.group === "personal",
);
export const COMPANY_TIERS: PlanTier[] = PLAN_TIERS.filter(
  (t) => t.group === "company",
);

export function tiersForSegment(segmentId: SegmentId | null | undefined): PlanTier[] {
  if (segmentId === "limited_company_vat") return COMPANY_TIERS;
  return PERSONAL_TIERS;
}
