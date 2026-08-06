import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { ltdDirectorsPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "Company director Self Assessment — Sterling Ledger",
  description:
    "Directors' personal Self Assessment handled alongside the company's own returns by one accountant.",
};

export default function Page() {
  return <ServicePage data={ltdDirectorsPage} />;
}
