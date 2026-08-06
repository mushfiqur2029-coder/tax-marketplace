import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { highEarnersPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "High earner tax filing — Sterling Ledger",
  description:
    "Multiple income sources, tapered allowances, and higher-rate thresholds handled by accountants who do this every day.",
};

export default function Page() {
  return <ServicePage data={highEarnersPage} />;
}
