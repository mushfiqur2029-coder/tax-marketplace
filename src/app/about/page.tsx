import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/marketing/placeholder-page";

export const metadata: Metadata = {
  title: "About. Sterling Ledger",
  description:
    "Sterling Ledger connects UK clients with vetted, qualified accountants. ACCA, CIMA, and CTA only.",
};

export default function Page() {
  return (
    <PlaceholderPage
      eyebrow="About"
      heading="Tax and VAT, sorted by a real accountant."
      description="Sterling Ledger is a UK marketplace connecting clients with vetted, qualified accountants. ACCA, CIMA, and CTA only. Full story coming soon."
    />
  );
}
