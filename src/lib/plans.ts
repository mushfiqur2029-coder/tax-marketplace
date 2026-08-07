export type TierId = "basic" | "standard" | "premium";

export type PlanTier = {
  id: TierId;
  title: string;
  tagline: string;              // sub-heading under title
  priceGbp: number;             // current price
  originalGbp: number;          // struck-through original
  saveGbp: number;              // computed for display
  priceGbpSubtitle: string;     // small footer under the price
  featured?: boolean;
  heroLine: string;             // one-liner between price and bullets
  features: string[];           // bullet list
  footerLine: string;           // italic line at the bottom of the card
};

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "basic",
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
];

export function getTier(id: string | null | undefined): PlanTier | null {
  if (!id) return null;
  return PLAN_TIERS.find((t) => t.id === id) ?? null;
}
