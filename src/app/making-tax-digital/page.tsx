import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { mtdPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "Making Tax Digital. Sterling Ledger",
  description:
    "Quarterly digital filing for landlords and the self-employed. Get set up with a qualified UK accountant before it's mandatory.",
};

export default function Page() {
  return <ServicePage data={mtdPage} />;
}
