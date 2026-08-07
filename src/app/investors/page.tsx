import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { investorsPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "Capital Gains Tax filing. Sterling Ledger",
  description:
    "Shares, crypto, property, or a business sale: a qualified UK accountant works out the CGT and files it for you.",
};

export default function Page() {
  return <ServicePage data={investorsPage} />;
}
