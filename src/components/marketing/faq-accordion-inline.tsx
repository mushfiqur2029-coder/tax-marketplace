"use client";

import { useState } from "react";

export type Faq = { q: string; a: string };

type Props = {
  faqs?: Faq[];
  eyebrow?: string;
  heading?: string;
};

const DEFAULT_FAQS: Faq[] = [
  {
    q: "What if my accountant needs more information?",
    a: "They'll message you directly through the platform. You'll get a notification, and can reply with whatever's needed, with no email back and forth.",
  },
  {
    q: "Do I need to approve the return before it's filed?",
    a: "Yes. Your accountant prepares a draft, you review it, and nothing gets sent to HMRC until you've approved it.",
  },
  {
    q: "Is this for VAT too, or just personal tax?",
    a: "Both. Individuals, sole traders, landlords, and VAT-registered businesses can all get matched with an accountant who specialises in their situation.",
  },
  {
    q: "What does the accuracy guarantee cover?",
    a: "If a mistake on our side leads to a penalty, we cover it. It doesn't cover penalties caused by incomplete or incorrect information you provided.",
  },
  {
    q: "Can I switch plans later?",
    a: "Yes, you can upgrade at any point if your return turns out to need more support than you first thought.",
  },
];

export function FaqAccordion({
  faqs = DEFAULT_FAQS,
  eyebrow = "Good to know",
  heading = "Questions people ask before starting",
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <span className="eyebrow">{eyebrow}</span>
          <h2>{heading}</h2>
        </div>
        <div className="faq-list">
          {faqs.map((f, i) => {
            const open = i === openIndex;
            return (
              <div
                key={f.q}
                className={"faq-item" + (open ? " open" : "")}
              >
                <button
                  type="button"
                  className="faq-q"
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? null : i)}
                >
                  {f.q}
                  <span className="plus" aria-hidden="true" />
                </button>
                <div
                  className="faq-a"
                  style={open ? { maxHeight: 400 } : undefined}
                >
                  <p>{f.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
