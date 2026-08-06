import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { expatsPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "Expat tax filing — Sterling Ledger",
  description:
    "Residency rules, foreign income, and split-year treatment sorted by qualified UK accountants.",
};

export default function Page() {
  return <ServicePage data={expatsPage} />;
}
