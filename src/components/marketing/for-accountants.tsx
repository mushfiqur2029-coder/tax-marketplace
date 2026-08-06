import Link from "next/link";
import { Reveal } from "./reveal";

export function ForAccountants() {
  return (
    <section id="accountants" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="strip">
          <div>
            <span className="eyebrow" style={{ color: "#7FD9F0" }}>
              For accountants
            </span>
            <h2 className="mt-3">Take on clients. Not admin.</h2>
            <p>
              We handle marketing, payment, and client support. You focus on the
              return, invoice monthly, and get paid within days.
            </p>
          </div>
          <Link href="/register" className="btn-sl btn-sl-mint">
            Apply to join
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
