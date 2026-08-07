import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { landlordsPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "Landlord tax returns. Sterling Ledger",
  description:
    "Rental income, mortgage interest, and allowable expenses handled by qualified UK accountants. From £99.",
};

export default function Page() {
  return <ServicePage data={landlordsPage} />;
}
