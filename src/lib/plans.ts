export type TierId = "basic" | "standard" | "premium";

export type PlanTier = {
  id: TierId;
  title: string;
  tagline: string;
  priceGbp: number; // in whole pounds
  priceGbpSubtitle: string;
  featured?: boolean;
  features: string[];
};

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "basic",
    title: "Basic",
    tagline: "Filed, simply",
    priceGbp: 99,
    priceGbpSubtitle: "£99 one-off",
    features: [
      "Accountant prepares and files",
      "Accuracy guarantee",
      "Secure document upload",
      "Status tracking",
    ],
  },
  {
    id: "standard",
    title: "Standard",
    tagline: "Filed and optimised",
    priceGbp: 149,
    priceGbpSubtitle: "£149 one-off",
    featured: true,
    features: [
      "Everything in Basic",
      "Deduction and expense review",
      "HMRC letter support",
      "Direct chat with your accountant",
    ],
  },
  {
    id: "premium",
    title: "Premium",
    tagline: "Year-round partner",
    priceGbp: 349,
    priceGbpSubtitle: "£349 one-off",
    features: [
      "Everything in Standard",
      "Ongoing access to your accountant",
      "HMRC agent representation",
      "Annual tax planning review",
    ],
  },
];

export function getTier(id: string | null | undefined): PlanTier | null {
  if (!id) return null;
  return PLAN_TIERS.find((t) => t.id === id) ?? null;
}
