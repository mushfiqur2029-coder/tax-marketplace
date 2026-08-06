import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { limitedCompanyPage } from "@/lib/service-content";
import { SubscriptionSection } from "@/components/marketing/subscription-section";

export const metadata: Metadata = {
  title: "Limited company tax returns — Sterling Ledger",
  description:
    "Corporation tax returns filed by qualified UK accountants. Ongoing subscription for bookkeeping and payroll available.",
};

export default function Page() {
  return (
    <ServicePage
      data={{
        ...limitedCompanyPage,
        extraAfterWho: <SubscriptionSection />,
      }}
    />
  );
}
