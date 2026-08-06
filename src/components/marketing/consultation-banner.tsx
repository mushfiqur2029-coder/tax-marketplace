import Link from "next/link";
import { Reveal } from "./reveal";

export function ConsultationBanner() {
  return (
    <section id="consult" className="py-8 sm:py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="consult-band">
          <div>
            <span
              className="eyebrow"
              style={{ color: "#7FD9F0" }}
            >
              Prefer to just ask?
            </span>
            <h2 className="mt-3">Book a 1-to-1 with an accountant.</h2>
            <p>
              Not sure which service you need, or want tax planning advice
              rather than a filing? Book a paid one-off consultation, by video
              or phone, with a qualified accountant before committing to
              anything.
            </p>
          </div>
          <Link href="/tax-advice" className="btn-sl btn-sl-mint">
            Book a consultation
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
