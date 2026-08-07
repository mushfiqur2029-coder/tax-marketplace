import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { taxAdvicePage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "1-to-1 tax advice. Sterling Ledger",
  description:
    "Book a 30-minute call with a qualified UK accountant. Written summary afterwards. From £129.",
};

export default function Page() {
  return <ServicePage data={taxAdvicePage} />;
}
