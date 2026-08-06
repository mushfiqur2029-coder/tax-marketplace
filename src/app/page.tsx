import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SiteHeader } from "@/components/marketing/site-header";
import { Hero } from "@/components/marketing/hero";
import { LogoStrip } from "@/components/marketing/logo-strip";
import { AudienceTabs } from "@/components/marketing/audience-tabs";
import { ConsultationBanner } from "@/components/marketing/consultation-banner";
import { StatsBand } from "@/components/marketing/stats-band";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { AppShowcase } from "@/components/marketing/app-showcase";
import { PricingSection } from "@/components/marketing/pricing-section";
import { ForAccountants } from "@/components/marketing/for-accountants";
import { FaqAccordion } from "@/components/marketing/faq-accordion-inline";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MobileCta } from "@/components/marketing/mobile-cta";

export default async function Home() {
  const me = await getCurrentUser();
  if (me) redirect(`/${me.role}`);

  return (
    <div className="relative min-h-full flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <LogoStrip />
        <AudienceTabs />
        <ConsultationBanner />
        <StatsBand />
        <HowItWorks />
        <AppShowcase />
        <PricingSection />
        <ForAccountants />
        <FaqAccordion />
        <SiteFooter />
      </main>
      <MobileCta />
    </div>
  );
}
