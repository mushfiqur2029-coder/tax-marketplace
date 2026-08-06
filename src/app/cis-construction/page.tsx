import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { cisConstructionPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "CIS tax refunds — Sterling Ledger",
  description:
    "Construction Industry Scheme deductions reviewed and refund claimed by qualified UK accountants.",
};

export default function Page() {
  return <ServicePage data={cisConstructionPage} />;
}
