import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { selfEmployedPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "Self-employed tax returns. Sterling Ledger",
  description:
    "Sole traders, freelancers, and contractors: qualified UK accountants prepare and file your Self Assessment from £99.",
};

export default function Page() {
  return <ServicePage data={selfEmployedPage} />;
}
