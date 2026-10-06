// NOTE: as of migration 0057, the display + price fields on these
// tiers are editable by admin via the public.service_catalog table
// (admin UI at /admin/service-catalog). Runtime reads of a tier
// should go through `getTier(id)` from `@/lib/service-catalog`, NOT
// through this file's static PLAN_TIERS — reading from here means
// admin edits don't propagate.
//
// This file remains the source of truth for:
//   - the TierId union (adding a new tier is a code change)
//   - the business-logic flags (requires_enquiry, admin_create_only)
//   - the static fallback shape used when the DB is unseeded or the
//     fetch fails
// so the type system still enforces the known tier set.

export type TierId =
  // Personal — new 9-up flat-fee catalogue (migration 0045). Each tier
  // targets a specific client situation; picking the tier IS the
  // service choice, there is no additional segment step.
  | "uber_driver"
  | "cis_subcontractor"
  | "sole_trader"
  | "landlord_small"
  | "non_resident_landlord"
  | "gig_worker"
  | "freelancer_consultant"
  | "landlord_multi"
  | "complex_international"
  // Personal — retired tiers. Enum values stay in Postgres; the wizard
  // filters them out and the server guard in createCaseAction rejects
  // them. Kept in the union so legacy references still typecheck.
  | "basic"
  | "standard"
  | "premium"
  // Limited-company self-serve flat-fee services. Current pricing:
  //   dormant      £150
  //   non_vat_reg  £700
  //   vat_reg      £1000 (turnover under £200k)
  | "dormant"
  | "non_vat_reg"
  | "vat_reg"
  // Limited company — bespoke enquiry tier. Does NOT map to a cases.tier
  // enum value; picking it diverts to the enquiry form. The server guard
  // in createCaseAction refuses to insert this id into cases.tier.
  | "vat_plus_accounts_200k"
  // Admin-created bespoke engagement. After the scoping call for a
  // vat_plus_accounts_200k enquiry, admin creates a case with this
  // tier id + a custom fee stored on cases.custom_fee_pence. Client
  // self-serve wizard filters this out (adminCreateOnly: true below)
  // and createCaseAction refuses it.
  | "vat_plus_accounts_bespoke";

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
  // When set, the tier card renders this string in place of the "£N"
  // amount. Used for bespoke-priced tiers where the fee depends on a
  // scoping call.
  priceDisplay?: string;
  // Diverts the LC picker to the enquiry form instead of case
  // creation. The server also refuses to open a case on a tier
  // marked this way — single source of truth is checked twice.
  requiresEnquiry?: boolean;
  // Hides the tier from the client-facing wizard. Used for admin-
  // created bespoke engagements where the client is never choosing
  // this tier themselves — admin creates it on their behalf after
  // a scoping call. createCaseAction also refuses to insert tiers
  // flagged this way.
  adminCreateOnly?: boolean;
  // Only populated by the DB-reading path (getAllTiers with
  // includeInactive: true). getAllTiers hides inactive rows by
  // default, so general consumers never see this field flip to
  // false. The admin service-catalog UI reads it to drive the
  // activate / deactivate toggle.
  active?: boolean;
};

// ---------- Personal (9 flat-fee services) ----------
//
// Shared feature line that every personal tier includes verbatim.
const PERSONAL_BASE_FEATURE = "Prepared and filed Self Assessment, signed off by a qualified accountant";
const PERSONAL_FOOTER = "Flat fee, no surprises.";

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "uber_driver",
    group: "personal",
    title: "Uber / private-hire drivers",
    tagline: "For Uber, Bolt, Addison Lee, and other private-hire drivers.",
    priceGbp: 199,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Mileage and allowable vehicle costs reviewed with you",
      "Platform fees, insurance, licensing claimed where allowable",
      "Accuracy guarantee + accountant message during filing",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "cis_subcontractor",
    group: "personal",
    title: "CIS subcontractors",
    tagline: "Reconcile your deductions and claim what HMRC owes you.",
    priceGbp: 299,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "CIS deductions reconciled and refund position calculated",
      "Vehicle, tools, and materials claimed where allowable",
      "Full HMRC letter + enquiry support",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "sole_trader",
    group: "personal",
    title: "Sole trader / self-employed",
    tagline: "Sole traders and freelancers. All your allowable expenses captured.",
    priceGbp: 199,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Trading income and allowable expenses captured in full",
      "Cash-basis treatment where it suits your situation",
      "Accuracy guarantee + accountant message during filing",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "landlord_small",
    group: "personal",
    title: "Landlord (1-2 properties)",
    tagline: "Rental income and allowable expenses, for one or two let properties.",
    priceGbp: 250,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Rental income and allowable expenses captured per property",
      "Mortgage interest treated under the current rules",
      "Repair vs improvement advice where it matters",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "non_resident_landlord",
    group: "personal",
    title: "Non-resident landlord",
    tagline: "Living abroad with UK property. NRLS treatment under current rules.",
    priceGbp: 399,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Non-Resident Landlord Scheme (NRLS) treatment included",
      "Rental income, mortgage interest, and expenses captured",
      "Guidance on withholding tax and gross-payment status",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "gig_worker",
    group: "personal",
    title: "Delivery / gig workers",
    tagline: "Deliveroo, Uber Eats, Amazon Flex, Just Eat. Gig income done right.",
    priceGbp: 199,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Platform earnings and allowable expenses captured",
      "Mileage and vehicle costs reviewed with you",
      "Accuracy guarantee + accountant message during filing",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "freelancer_consultant",
    group: "personal",
    title: "Freelancer / consultant",
    tagline: "Freelance work, side projects, and consulting income in one return.",
    priceGbp: 199,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Freelance income and expenses captured in full",
      "Dividends, interest, and other side income included",
      "Accuracy guarantee + accountant message during filing",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "landlord_multi",
    group: "personal",
    title: "Landlord (multiple properties)",
    tagline: "Portfolio landlords. Property-by-property and overall position.",
    priceGbp: 599,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Multi-property rental income and expenses captured",
      "Mortgage interest treated under the current rules",
      "Property-by-property profit/loss and tax position",
    ],
    footerLine: PERSONAL_FOOTER,
  },
  {
    id: "complex_international",
    group: "personal",
    title: "Complex foreign / international",
    tagline: "Foreign income, multiple residencies, or treaty positions.",
    priceGbp: 1000,
    priceGbpSubtitle: "one-off",
    features: [
      PERSONAL_BASE_FEATURE,
      "Foreign income, remittance basis, and residency reviewed",
      "Double taxation relief considered where applicable",
      "Guidance on treaty positions and HMRC disclosures",
    ],
    footerLine: PERSONAL_FOOTER,
  },

  // ---------- Limited company (3 self-serve flat-fee services + bespoke) ----------
  //
  // Picking the service IS picking the tier; there's no additional
  // plan-tier step for the company path. The 4th tier
  // (vat_plus_accounts_200k) is the bespoke "over £200k turnover"
  // enquiry flow — defined below but not sold as a flat fee.
  //
  // Wallet credit splits each fee 50/50 with the assigned accountant on
  // case complete (migration 0045 trigger).
  {
    id: "dormant",
    group: "company",
    title: "Dormant company",
    tagline: "For companies with no trading activity in the period.",
    priceGbp: 150,
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
    priceGbp: 700,
    priceGbpSubtitle: "one-off",
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
    tagline:
      "Year-end accounts, corporation tax, and ongoing VAT returns. For annual turnover under £200k.",
    priceGbp: 1000,
    priceGbpSubtitle: "one-off",
    features: [
      "Everything in Non-VAT registered",
      "VAT return filing for every period",
      "Monthly, quarterly or annual VAT cycles supported",
      "Flat fee, no surprises",
    ],
    description:
      "For VAT registered trading companies with annual turnover under £200k. Covers year-end accounts, corporation tax, and each VAT return in the engagement period.",
  },
  {
    // Bespoke tier for larger VAT-registered companies. Does NOT share
    // the flat-fee flow — picking it diverts to /client/new/enquiry so
    // we can scope + price on a call. No engagement letter, no
    // checkout, no onboarding checklist attach to this tier.
    id: "vat_plus_accounts_200k",
    group: "company",
    title: "VAT Registered + Accounts (over £200k turnover)",
    tagline:
      "Larger-company engagement. We scope and price around your business.",
    priceGbp: 0,
    priceDisplay: "Bespoke",
    requiresEnquiry: true,
    features: [
      "Full year-end accounts + corporation tax",
      "VAT return filing for every period",
      "Scoping call to confirm fit + bespoke flat fee",
    ],
    description:
      "For VAT-registered companies with annual turnover over £200k. We quote per engagement after a short call.",
  },
  {
    // Admin-created bespoke engagement — never appears in the client
    // wizard (adminCreateOnly), never has a flat fee (priceGbp: 0
    // placeholder; cases.custom_fee_pence drives every display and
    // the Stripe amount). Reuses the vat_reg onboarding checklist via
    // the aliasTier helper in checklist.ts.
    id: "vat_plus_accounts_bespoke",
    group: "company",
    title: "VAT Registered + Accounts (bespoke)",
    tagline:
      "Bespoke engagement priced on a scoping call. Full accounts, CT, and every VAT return.",
    priceGbp: 0,
    adminCreateOnly: true,
  },
];

// Static fallback lookup. Prefer `getTier` from `@/lib/service-catalog`
// in server code — it reads from the DB (with this list as fallback)
// so admin edits propagate. This function is used only by the fallback
// path and by non-server contexts where sync access is unavoidable.
export function getTierStatic(id: string | null | undefined): PlanTier | null {
  if (!id) return null;
  return PLAN_TIERS.find((t) => t.id === id) ?? null;
}

// Retired personal tiers. The old wizard offered these on top of a
// segment; neither is sold anymore. Kept here so legacy references
// still resolve to *something* if an admin opens an archived case.
export const RETIRED_PERSONAL_TIER_IDS = ["basic", "standard", "premium"] as const;
