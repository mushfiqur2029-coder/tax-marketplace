import type { Metadata } from "next";
import { ServicePage } from "@/components/marketing/service-page";
import { firstTimeFilersPage } from "@/lib/service-content";

export const metadata: Metadata = {
  title: "First tax return. Sterling Ledger",
  description:
    "New to Self Assessment? Answer a few questions and a qualified UK accountant files it for you. From £99.",
};

export default function Page() {
  return <ServicePage data={firstTimeFilersPage} />;
}
