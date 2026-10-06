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
import {
  BookingPicker,
  type BookingResult,
} from "@/components/booking/booking-picker";

type Props = {
  serviceKey: string;
  serviceTitle: string;
  // Pre-fills from the client's profile. The enquirer may be a
  // different person inside the company than the one who set the
  // account up, so they're editable.
  defaultContactName: string;
  defaultContactEmail: string;
  defaultContactPhone: string;
  // Whether the in-app booking picker is wired up on this env (true
  // when the Google Calendar service account creds are configured).
  // When false, the thank-you screen falls back to the "we'll email
  // you" line so the enquiry still looks handled.
  bookingEnabled: boolean;
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
  bookingEnabled,
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
      <ConfirmationCard
        serviceTitle={serviceTitle}
        contactName={contactName}
        contactEmail={contactEmail}
        contactPhone={contactPhone}
        companyName={company?.company_name ?? ""}
        companyNumber={company?.company_number ?? ""}
        bookingEnabled={bookingEnabled}
      />
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
          your account. Edit if someone else inside the company should be
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
          After you submit, you&rsquo;ll be able to pick a 15-minute slot
          with us right here — no leaving this page. You&rsquo;ll get a
          video call link and a calendar invite as soon as you book.
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

function ConfirmationCard({
  serviceTitle,
  contactName,
  contactEmail,
  contactPhone,
  companyName,
  companyNumber,
  bookingEnabled,
}: {
  serviceTitle: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  companyName: string;
  companyNumber: string;
  bookingEnabled: boolean;
}) {
  const [booked, setBooked] = useState<BookingResult | null>(null);

  // Description sent to Google — this is what the calendar event
  // itself shows. Keep it tight; the client already sees a nicer
  // version on-screen.
  const description = [
    `Scoping call for: ${serviceTitle}`,
    "",
    `Client: ${contactName}`,
    `Email: ${contactEmail}`,
    `Phone: ${contactPhone}`,
    `Company: ${companyName} (${companyNumber})`,
  ].join("\n");

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

      {booked ? (
        <>
          <h2
            className="text-xl font-semibold text-ink"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            You&rsquo;re booked in.
          </h2>
          <p className="mt-2 text-sm text-slate">
            Your scoping call for{" "}
            <strong className="text-ink">{serviceTitle}</strong> is confirmed
            for <strong className="text-ink">{booked.humanLabel}</strong>.
            We&rsquo;ll also send a confirmation email to{" "}
            <strong>{contactEmail}</strong> shortly.
          </p>
          {booked.meetLink ? (
            <div className="mt-4 rounded-lg border border-line bg-cloud/60 p-4">
              <div
                className="text-[11px] font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Your call link
              </div>
              <a
                href={booked.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block break-all text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
              >
                {booked.meetLink}
              </a>
              <p className="mt-2 text-xs text-slate">
                Save this link — it&rsquo;s what you&rsquo;ll use to join the
                call at the booked time.
              </p>
            </div>
          ) : null}
          <p className="mt-4 text-xs text-slate">
            Nothing is charged yet. The fee is confirmed on the call.
          </p>
        </>
      ) : (
        <>
          <h2
            className="text-xl font-semibold text-ink"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Thanks. Your enquiry is in.
          </h2>
          <p className="mt-2 text-sm text-slate">
            We&rsquo;ve logged your enquiry for{" "}
            <strong className="text-ink">{serviceTitle}</strong>.{" "}
            {bookingEnabled ? (
              <>
                Pick a 15-minute slot below — you&rsquo;ll see your video
                call link right away and we&rsquo;ll follow up by email at{" "}
                <strong>{contactEmail}</strong>.
              </>
            ) : (
              <>
                Someone from Sterling Ledger will email{" "}
                <strong>{contactEmail}</strong> within one business day to
                arrange a time for the scoping call.
              </>
            )}
          </p>
          {bookingEnabled ? (
            <p className="mt-2 text-sm text-slate">
              Prefer not to book right now? That&rsquo;s fine. Someone from
              Sterling Ledger will email you within one business day either
              way.
            </p>
          ) : null}
          <p className="mt-4 text-xs text-slate">
            Nothing is charged yet. The fee is confirmed on the call.
          </p>
          {bookingEnabled ? (
            <div className="mt-6">
              <BookingPicker
                summary={`Sterling Ledger scoping call · ${serviceTitle}`}
                description={description}
                attendeeEmail={contactEmail}
                attendeeName={contactName}
                serviceLabel={serviceTitle}
                onBooked={setBooked}
              />
            </div>
          ) : null}
        </>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <SLLink href="/client" variant="primary" className="w-full sm:w-auto">
          Back to dashboard
        </SLLink>
        <SLLink href="/client/new" variant="ghost" className="w-full sm:w-auto">
          Start another return
        </SLLink>
      </div>
    </section>
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
