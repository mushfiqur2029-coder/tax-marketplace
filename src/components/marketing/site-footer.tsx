import Link from "next/link";
import { SLLink } from "@/components/sl-button";
import { Reveal } from "./reveal";

export function SiteFooter() {
  return (
    <footer className="pb-12 pt-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="foot-cta">
          <span className="eyebrow">Ready when you are</span>
          <h2>Get your tax off your plate.</h2>
          <p>
            Start your return in a couple of minutes. The accountant part
            happens without you.
          </p>
          <SLLink href="/register" variant="primary">
            Start your return
          </SLLink>
        </Reveal>

        <div className="foot-grid">
          <div className="foot-brand">
            <div className="foot-logo">
              <b>Sterling Ledger</b>
            </div>
            <p>Tax and VAT, sorted by a real accountant.</p>
          </div>
          <div className="foot-cols">
            <div className="foot-col">
              <h4>Product</h4>
              <Link href="/#how">How it works</Link>
              <Link href="/#pricing">Pricing</Link>
              <Link href="/#faq">FAQ</Link>
            </div>
            <div className="foot-col">
              <h4>Company</h4>
              <Link href="/#accountants">For accountants</Link>
              <Link href="/about">About</Link>
              <Link href="/guides">Guides</Link>
            </div>
            <div className="foot-col">
              <h4>Legal</h4>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
            </div>
          </div>
        </div>

        <div className="foot-bottom">
          <span>© 2026 Sterling Ledger. All rights reserved.</span>
          <span>
            Sterling Ledger is a trading name. Returns are prepared by
            independent, qualified accountants.
          </span>
        </div>
      </div>
    </footer>
  );
}
