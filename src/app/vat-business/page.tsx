import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { vatBusinessPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "VAT returns & registration. Sterling Ledger",
  description:
    "Quarterly VAT returns filed, registration handled, and the right VAT scheme picked for your business.",
};

export default function Page() {
  return <ServicePage data={vatBusinessPage} />;
}
