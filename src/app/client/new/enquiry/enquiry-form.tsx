"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SLButton, SLLink } from "@/components/sl-button";
import {
  CompanyLookup,
  type CompanyPick,
} from "@/components/case/company-lookup";
import type { ActionResult } from "@/lib/action-result";
import type { ServiceEnquiryInput } from "@/app/client/enquiry-actions";

type Props = {
  serviceKey: string;
  serviceTitle: string;
  // Pre-fills from the client's profile. The enquirer may be a
  // different person inside the company than the one who set the
  // account up, so they're editable.
  defaultContactName: string;
  defaultContactEmail: string;
  defaultContactPhone: string;
  submit: (
    input: ServiceEnquiryInput,
  ) => Promise<ActionResult<{ id: string }>>;
};

export function EnquiryForm({
  serviceKey,
  serviceTitle,
  defaultContactName,
  defaultContactEmail,
  defaultContactPhone,
  submit,
}: Props) {
  const [company, setCompany] = useState<CompanyPick | null>(null);
  const [contactName, setContactName] = useState(defaultContactName);
  const [contactEmail, setContactEmail] = useState(defaultContactEmail);
  const [contactPhone, setContactPhone] = useState(defaultContactPhone);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit =
    !!company &&
    !!contactName.trim() &&
    !!contactEmail.trim() &&
    !!contactPhone.trim();

  const onPick = async (pick: CompanyPick) => {
    setCompany(pick);
  };
  const onClear = async () => {
    setCompany(null);
  };

  const onSubmit = () => {
    setError(null);
    if (!company) {
      setError("Pick your company (or enter it manually) first.");
      return;
    }
    start(async () => {
      const res = await submit({
        serviceKey,
        companyName: company.company_name,
        companyNumber: company.company_number,
        companyStatus: company.company_status,
        contactName,
        contactEmail,
        contactPhone,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
    });
  };

  if (done) {
    return (
      <section className="card-sl p-6 sm:p-8">
        <div
          className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl text-white"
          style={{ background: "linear-gradient(135deg, var(--navy), var(--sky))" }}
          aria-hidden="true"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2
          className="text-xl font-semibold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Thanks — we&rsquo;ll be in touch shortly.
        </h2>
        <p className="mt-2 text-sm text-slate">
          We&rsquo;ve logged your enquiry for{" "}
          <strong className="text-ink">{serviceTitle}</strong>. Someone from
          Sterling Ledger will email <strong>{contactEmail}</strong> within
          one business day to arrange a time for the scoping call.
        </p>
        <p className="mt-4 text-xs text-slate">
          Nothing is charged yet — the fee is confirmed on the call.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <SLLink
            href="/client"
            variant="primary"
            className="w-full sm:w-auto"
          >
            Back to dashboard
          </SLLink>
          <SLLink href="/client/new" variant="ghost" className="w-full sm:w-auto">
            Start another return
          </SLLink>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card-sl p-6 sm:p-8">
        <h2
          className="text-lg font-semibold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Your company
        </h2>
        <p className="mt-1 text-sm text-slate">
          Search Companies House, or enter it manually if your company is
          brand-new and not yet showing.
        </p>
        <div className="mt-4">
          <CompanyLookup
            initial={company}
            onPick={onPick}
            onClear={onClear}
            busy={pending}
          />
        </div>
      </section>

      <section className="card-sl p-6 sm:p-8">
        <h2
          className="text-lg font-semibold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Contact details
        </h2>
        <p className="mt-1 text-sm text-slate">
          We&rsquo;ll use these to arrange the scoping call. Pre-filled from
          your account — edit if someone else inside the company should be
          the point of contact.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Contact name"
            value={contactName}
            onChange={setContactName}
            autoComplete="name"
          />
          <Field
            label="Email"
            type="email"
            value={contactEmail}
            onChange={setContactEmail}
            autoComplete="email"
          />
          <Field
            label="Phone"
            type="tel"
            value={contactPhone}
            onChange={setContactPhone}
            autoComplete="tel"
          />
        </div>
      </section>

      <section className="card-sl p-6 sm:p-8">
        <h2
          className="text-lg font-semibold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Schedule a call
        </h2>
        <p className="mt-2 text-sm text-slate">
          After you submit, we&rsquo;ll email you within one business day to
          book a time that suits you.
        </p>
        <p className="mt-2 text-xs text-slate">
          Direct booking is coming soon as a shared feature across every
          service — the real calendar integration lands in a later update.
        </p>
      </section>

      {error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <SLButton
          type="button"
          variant="primary"
          className="w-full sm:w-auto"
          onClick={onSubmit}
          disabled={pending || !canSubmit}
        >
          {pending ? "Sending…" : "Submit enquiry"}
        </SLButton>
        <Link
          href="/client/new"
          className="text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          ← Back to service picker
        </Link>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span
        className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="input-sl"
      />
    </label>
  );
}
