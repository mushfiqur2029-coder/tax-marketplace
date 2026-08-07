import type { SegmentId } from "./segments";

export type TierId =
  // Personal
  | "basic"
  | "standard"
  | "premium"
  // Limited-company / VAT
  | "vat_basic"
  | "vat_standard"
  | "vat_accounts"
  | "dormant"
  | "non_vat_reg"
  | "vat_reg";

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

  // ---------- Limited company / VAT ----------
  {
    id: "vat_basic",
    group: "company",
    title: "VAT Basic",
    tagline: "One quarter, filed.",
    priceGbp: 129,
    priceGbpSubtitle: "one-off",
    features: [
      "Accountant prepares and files VAT",
      "Accuracy guarantee",
      "Secure document upload",
      "Status tracking",
    ],
  },
  {
    id: "vat_standard",
    group: "company",
    title: "VAT Standard",
    tagline: "Quarterly, on autopilot.",
    priceGbp: 99,
    pricePer: "/quarter",
    featured: true,
    features: [
      "Filed every quarter automatically",
      "Scheme review (flat rate vs standard)",
      "HMRC letter support",
      "Direct chat with your accountant",
    ],
  },
  {
    id: "vat_accounts",
    group: "company",
    title: "VAT + Accounts",
    tagline: "Full business partner.",
    priceGbp: 449,
    priceGbpSubtitle: "one-off",
    features: [
      "Everything in VAT Standard",
      "Year-end accounts included",
      "Corporation tax return",
      "Dedicated accountant",
      "Annual turnover below £200k",
    ],
  },
  {
    id: "dormant",
    group: "company",
    title: "Dormant",
    tagline: "For inactive companies.",
    priceGbp: 89,
    priceSuffix: "+VAT",
    description:
      "For companies that are inactive and have no business activity.",
  },
  {
    id: "non_vat_reg",
    group: "company",
    title: "Non-VAT registered",
    tagline: "Company-level filings.",
    priceGbp: 329,
    priceSuffix: "+VAT",
    description:
      "For all non-VAT registered companies, including non-trading companies.",
  },
  {
    id: "vat_reg",
    group: "company",
    title: "VAT-registered",
    tagline: "Company-level filings.",
    priceGbp: 419,
    priceSuffix: "+VAT",
    description:
      "For VAT registered companies with an annual turnover below £200k.",
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
