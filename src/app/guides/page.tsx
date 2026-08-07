import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/marketing/placeholder-page";

export const metadata: Metadata = {
  title: "Guides. Sterling Ledger",
  description:
    "Plain-English guides to UK Self Assessment, VAT, and everything else clients ask us about.",
};

export default function Page() {
  return (
    <PlaceholderPage
      eyebrow="Guides"
      heading="Plain-English tax guides."
      description="A searchable library of guides for landlords, the self-employed, VAT-registered businesses, and anyone dealing with HMRC. Coming soon. in the meantime, book a consultation and get answers directly."
    />
  );
}
