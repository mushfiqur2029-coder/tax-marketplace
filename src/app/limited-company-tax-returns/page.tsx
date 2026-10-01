import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { limitedCompanyPage } from "@/lib/service-content";
import { CompanyServicesPricing } from "@/components/marketing/company-services-pricing";

export const metadata: Metadata = {
  title: "Limited company tax returns. Sterling Ledger",
  description:
    "Flat-fee annual accounts, corporation tax and VAT filing for UK limited companies, prepared and filed by qualified accountants.",
};

export default function Page() {
  return (
    <ServicePage
      data={{
        ...limitedCompanyPage,
        extraAfterPricing: <CompanyServicesPricing />,
      }}
    />
  );
}
