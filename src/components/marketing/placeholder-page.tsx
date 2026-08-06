import Link from "next/link";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { MobileCta } from "@/components/marketing/mobile-cta";
import { BlobField } from "@/components/blob-field";
import { SLLink } from "@/components/sl-button";

type Props = {
  eyebrow: string;
  heading: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
};

export function PlaceholderPage({
  eyebrow,
  heading,
  description,
  ctaLabel = "Book a consultation",
  ctaHref = "/tax-advice",
}: Props) {
  return (
    <div className="relative min-h-full flex flex-col">
      <SiteHeader />
      <main className="relative flex-1 overflow-hidden">
        <BlobField />
        <div className="relative z-10 mx-auto max-w-3xl px-4 py-24 sm:px-6 sm:py-32 text-center">
          <span className="eyebrow">{eyebrow}</span>
          <h1
            className="mt-5 text-4xl leading-tight sm:text-5xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {heading}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-slate sm:text-lg">
            {description}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <SLLink href={ctaHref} variant="primary">
              {ctaLabel}
            </SLLink>
            <Link
              href="/"
              className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
            >
              Back to homepage
            </Link>
          </div>
          <p
            className="mt-10 text-[11px] uppercase tracking-widest text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Coming soon
          </p>
        </div>
      </main>
      <SiteFooter />
      <MobileCta />
    </div>
  );
}
