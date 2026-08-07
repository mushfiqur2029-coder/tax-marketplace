import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/marketing/placeholder-page";

export const metadata: Metadata = {
  title: "Tax calculators. Sterling Ledger",
  description:
    "Free UK tax calculators: Income Tax, salary after tax, Capital Gains, and employed vs self-employed comparison.",
};

export default function Page() {
  return (
    <PlaceholderPage
      eyebrow="Calculators"
      heading="Free UK tax calculators."
      description="Income Tax, salary after tax, Capital Gains, and an employed-vs-self-employed comparison. each a simple interactive tool, no login required. Coming soon."
    />
  );
}
