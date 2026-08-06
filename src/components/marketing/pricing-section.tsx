"use client";

import Link from "next/link";
import { useState } from "react";

type Tier = {
  title: string;
  sub: string;
  price: string;
  per?: string;
  items: string[];
};

const DATA: Record<"personal" | "business", Tier[]> = {
  personal: [
    {
      title: "Basic",
      sub: "Filed, simply",
      price: "£99",
      items: [
        "Accountant prepares and files",
        "Accuracy guarantee",
        "Secure document upload",
        "Status tracking",
      ],
    },
    {
      title: "Standard",
      sub: "Filed and optimised",
      price: "£149",
      items: [
        "Everything in Basic",
        "Deduction and expense review",
        "HMRC letter support",
        "Direct chat with your accountant",
      ],
    },
    {
      title: "Premium",
      sub: "Year-round partner",
      price: "£349",
      items: [
        "Everything in Standard",
        "Ongoing access to your accountant",
        "HMRC agent representation",
        "Annual tax planning review",
      ],
    },
  ],
  business: [
    {
      title: "VAT Basic",
      sub: "One quarter, filed",
      price: "£129",
      items: [
        "Accountant prepares and files VAT",
        "Accuracy guarantee",
        "Secure document upload",
        "Status tracking",
      ],
    },
    {
      title: "VAT Standard",
      sub: "Quarterly, on autopilot",
      price: "£99",
      per: "/quarter",
      items: [
        "Filed every quarter automatically",
        "Scheme review (flat rate vs standard)",
        "HMRC letter support",
        "Direct chat with your accountant",
      ],
    },
    {
      title: "VAT + Accounts",
      sub: "Full business partner",
      price: "£449",
      items: [
        "Everything in VAT Standard",
        "Year-end accounts included",
        "Corporation tax return",
        "Dedicated accountant",
      ],
    },
  ],
};

export function PricingSection() {
  const [mode, setMode] = useState<"personal" | "business">("personal");
  const tiers = DATA[mode];

  return (
    <section id="pricing" className="py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="section-head center">
          <span className="eyebrow">Pricing</span>
          <h2>One flat fee. No surprises after.</h2>
          <p>
            Every plan includes a qualified accountant and our accuracy
            guarantee.
          </p>
        </div>

        <div className="pricing-toggle">
          <button
            type="button"
            onClick={() => setMode("personal")}
            className={"pt-btn" + (mode === "personal" ? " active" : "")}
          >
            Personal
          </button>
          <button
            type="button"
            aria-label="Toggle pricing mode"
            onClick={() =>
              setMode((m) => (m === "personal" ? "business" : "personal"))
            }
            className={"pt-switch" + (mode === "business" ? " on" : "")}
          >
            <span className="pt-knob" />
          </button>
          <button
            type="button"
            onClick={() => setMode("business")}
            className={"pt-btn" + (mode === "business" ? " active" : "")}
          >
            Business / VAT
          </button>
        </div>

        <div className="pricing-grid">
          {tiers.map((t, i) => (
            <div
              key={t.title}
              className={"price-card" + (i === 1 ? " featured" : "")}
            >
              {i === 1 ? <span className="price-badge">Most chosen</span> : null}
              <h3>{t.title}</h3>
              <p className="tier-sub">{t.sub}</p>
              <div className="price">
                {t.price}
                {t.per ? <small> {t.per}</small> : null}
              </div>
              <ul>
                {t.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <Link
                href="/register"
                className={
                  "btn-sl btn-sl-block " +
                  (i === 1 ? "btn-sl-primary" : "btn-sl-outline")
                }
              >
                Choose {t.title}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
