"use client";

// Slice 6: Tab 1 as a derived profile summary, not a raw form.
//
// For each pch_cases head field the client used to type into a grid,
// render a read-only card showing:
//   - the current value (or "Not captured yet")
//   - a provenance badge: profile / document / AI conversation / manual
//
// Changes land through two paths:
//   1. "Walk me through my profile", opens the shared InterviewPanel
//      pointed at the PROFILE flow (ai-interview.ts). The AI asks
//      only about the fields currently missing + any that the client
//      asks to correct in-conversation. Finalized values commit to
//      pch_cases via commitPchProfileInterviewAction.
//   2. Document extraction, PCH-16/17/18/19/20/21 apply maps already
//      target pch_cases columns; the existing extraction-review UI
//      drives those writes.
//
// Deliberately no inline text inputs: the client never faces a form
// grid again (scope item 4, "no manual path").

import { useMemo, useState } from "react";
import { ProfileInterviewPanel } from "./profile-interview-panel";

export type ProfileHead = {
  cl_name: string | null;
  cl_email: string | null;
  cl_phone: string | null;
  cl_address: string | null;
  cl_postcode: string | null;
  cl_dob: string | null;
  cl_utr: string | null;
  cl_nino: string | null;
  cl_licensing_authority: string | null;
  cl_platforms: string | null;
  cl_start_date: string | null;
  cl_stop_date: string | null;
  employment_income_pence: number | null;
  paye_pence: number | null;
  rental_profit_pence: number | null;
  bank_interest_pence: number | null;
  marriage_allowance_status: string | null;
  personal_pension_net_pence: number | null;
  gift_aid_net_pence: number | null;
  student_loan_plan: string | null;
  poa1_due_pence: number | null;
  poa2_due_pence: number | null;
  poa1_paid_pence: number | null;
  poa2_paid_pence: number | null;
  vat_registered: boolean | null;
};

type Source = "profile" | "document" | "interview" | "missing";

type Row = {
  label: string;
  value: string | null;
  source: Source;
  hint?: string;
};

type Section = {
  title: string;
  rows: Row[];
};

export function ProfilePanel({
  caseId,
  head,
  editable = true,
}: {
  caseId: string;
  head: ProfileHead;
  editable?: boolean;
}) {
  const [interviewOpen, setInterviewOpen] = useState(false);

  const sections = useMemo(() => buildSections(head), [head]);
  const totals = useMemo(() => countFilled(sections), [sections]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Your profile</h3>
          <p className="mt-1 text-xs text-slate-600">
            {totals.captured} of {totals.total} profile fields captured.
            {totals.missing > 0
              ? ` ${totals.missing} to go, we'll walk you through them.`
              : " Everything looks captured. Open the chat if you need to correct anything."}
          </p>
        </div>
        {editable ? (
          <button
            type="button"
            onClick={() => setInterviewOpen(true)}
            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
          >
            {totals.missing > 0 ? "Walk me through what's missing" : "Correct my profile"}
          </button>
        ) : null}
      </header>

      {editable && interviewOpen ? (
        <ProfileInterviewPanel
          caseId={caseId}
          onClose={() => setInterviewOpen(false)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sections.map((section) => (
          <SectionCard key={section.title} section={section} />
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// Section + row building. One section per logical group so the summary
// grid stays scannable on a phone (grid-cols-1 at narrow widths).
// -------------------------------------------------------------------

const SOURCE_LABEL: Record<Source, string> = {
  profile: "From your profile",
  document: "Extracted from your document",
  interview: "Confirmed through AI conversation",
  missing: "Not captured yet",
};

const SOURCE_CLASS: Record<Source, string> = {
  profile: "bg-slate-100 text-slate-700 border-slate-300",
  document: "bg-emerald-100 text-emerald-800 border-emerald-300",
  interview: "bg-indigo-100 text-indigo-800 border-indigo-300",
  missing: "bg-amber-100 text-amber-800 border-amber-300",
};

function SectionCard({ section }: { section: Section }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {section.title}
      </h4>
      <ul className="space-y-2">
        {section.rows.map((row) => (
          <li
            key={row.label}
            className="rounded border border-slate-100 bg-slate-50/60 p-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-slate-700">{row.label}</span>
              <span
                className={
                  "inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium " +
                  SOURCE_CLASS[row.source]
                }
              >
                {SOURCE_LABEL[row.source]}
              </span>
            </div>
            <div className="mt-1 text-sm text-slate-900">
              {row.value && row.value.length > 0 ? row.value : "Not captured yet"}
            </div>
            {row.hint ? (
              <div className="mt-0.5 text-[11px] italic text-slate-500">{row.hint}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function buildSections(h: ProfileHead): Section[] {
  const fmtPence = (p: number | null): string | null =>
    p == null ? null : p === 0 ? "£0.00" : "£" + (Math.round(p) / 100).toFixed(2);
  const fmtDate = (d: string | null): string | null => {
    if (!d) return null;
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return d;
    return parsed.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
  };
  const yn = (v: boolean | null): string | null =>
    v == null ? null : v ? "Yes" : "No";

  // Provenance rules of thumb:
  //   - name / email / phone / address / postcode come from registration
  //     (client_profiles) via syncPchProfileFromUserAction, source=profile
  //   - DOB / UTR / NINO / licensing authority / reliefs come from the
  //     PROFILE interview, source=interview when present
  //   - employment / PAYE / interest / student loan plan land via
  //     PCH-16/17/18/19 extractions, source=document when present
  //   - POA figures land via PCH-20/21 extractions, source=document
  //   - platform / start / stop dates land via PCH-01/02/03 (interview
  //     or document); we tag as "document" when we can't tell apart
  //     because the final value lives on pch_cases either way
  const sourceFor = (v: string | number | boolean | null, s: Source): Source =>
    v == null || v === "" ? "missing" : s;

  return [
    {
      title: "About you",
      rows: [
        { label: "Full name", value: h.cl_name, source: sourceFor(h.cl_name, "profile") },
        { label: "Email", value: h.cl_email, source: sourceFor(h.cl_email, "profile") },
        { label: "Mobile", value: h.cl_phone, source: sourceFor(h.cl_phone, "profile") },
        { label: "Address", value: h.cl_address, source: sourceFor(h.cl_address, "profile") },
        { label: "Postcode", value: h.cl_postcode, source: sourceFor(h.cl_postcode, "profile") },
        { label: "Date of birth", value: fmtDate(h.cl_dob), source: sourceFor(h.cl_dob, "interview") },
        { label: "UTR", value: h.cl_utr, source: sourceFor(h.cl_utr, "interview") },
        { label: "NI number", value: h.cl_nino, source: sourceFor(h.cl_nino, "interview") },
      ],
    },
    {
      title: "Your driving work",
      rows: [
        {
          label: "Licensing authority",
          value: h.cl_licensing_authority,
          source: sourceFor(h.cl_licensing_authority, "interview"),
        },
        {
          label: "Platforms",
          value: h.cl_platforms,
          source: sourceFor(h.cl_platforms, "document"),
          hint: h.cl_platforms ? undefined : "Pulled from PCH-01/02 when you confirm an extraction.",
        },
        {
          label: "Started driving",
          value: fmtDate(h.cl_start_date),
          source: sourceFor(h.cl_start_date, "document"),
          hint: h.cl_start_date ? undefined : "Pulled from PCH-01's period start.",
        },
        {
          label: "Stopped driving",
          value: fmtDate(h.cl_stop_date),
          source: sourceFor(h.cl_stop_date, "document"),
          hint: h.cl_stop_date ? undefined : "Only if you stopped before 5 April 2026.",
        },
      ],
    },
    {
      title: "Other income",
      rows: [
        {
          label: "Employment pay (gross)",
          value: fmtPence(h.employment_income_pence),
          source: sourceFor(h.employment_income_pence, "document"),
          hint: h.employment_income_pence ? undefined : "Pulled from PCH-16 (P60) or PCH-17 (P45).",
        },
        {
          label: "Tax deducted (PAYE)",
          value: fmtPence(h.paye_pence),
          source: sourceFor(h.paye_pence, "document"),
          hint: h.paye_pence ? undefined : "Pulled from PCH-16 (P60) or PCH-17 (P45).",
        },
        {
          label: "Rental profit (after expenses)",
          value: fmtPence(h.rental_profit_pence),
          source: sourceFor(h.rental_profit_pence, "missing"),
          hint: h.rental_profit_pence ? undefined : "Your accountant will capture this if you have rental income.",
        },
        {
          label: "Bank / savings interest",
          value: fmtPence(h.bank_interest_pence),
          source: sourceFor(h.bank_interest_pence, "document"),
          hint: h.bank_interest_pence ? undefined : "Pulled from PCH-18 interest certificate when uploaded.",
        },
      ],
    },
    {
      title: "Allowances and reliefs",
      rows: [
        {
          label: "Marriage Allowance",
          value: h.marriage_allowance_status,
          source: sourceFor(h.marriage_allowance_status, "interview"),
        },
        {
          label: "Personal pension paid (net)",
          value: fmtPence(h.personal_pension_net_pence),
          source: sourceFor(h.personal_pension_net_pence, "interview"),
        },
        {
          label: "Gift Aid paid (net)",
          value: fmtPence(h.gift_aid_net_pence),
          source: sourceFor(h.gift_aid_net_pence, "interview"),
        },
        {
          label: "Student loan plan",
          value: h.student_loan_plan,
          source: sourceFor(h.student_loan_plan, "document"),
          hint: h.student_loan_plan ? undefined : "Pulled from PCH-19 (SLC statement).",
        },
      ],
    },
    {
      title: "Payments on account for 2025/26",
      rows: [
        {
          label: "1st POA due 31 Jan 2026",
          value: fmtPence(h.poa1_due_pence),
          source: sourceFor(h.poa1_due_pence, "document"),
          hint: h.poa1_due_pence ? undefined : "Pulled from PCH-20 (prior-year SA302).",
        },
        {
          label: "2nd POA due 31 Jul 2026",
          value: fmtPence(h.poa2_due_pence),
          source: sourceFor(h.poa2_due_pence, "document"),
          hint: h.poa2_due_pence ? undefined : "Pulled from PCH-20 (prior-year SA302).",
        },
        {
          label: "1st POA actually paid",
          value: fmtPence(h.poa1_paid_pence),
          source: sourceFor(h.poa1_paid_pence, "document"),
          hint: h.poa1_paid_pence ? undefined : "Pulled from PCH-21 (HMRC payment proof).",
        },
        {
          label: "2nd POA actually paid",
          value: fmtPence(h.poa2_paid_pence),
          source: sourceFor(h.poa2_paid_pence, "document"),
          hint: h.poa2_paid_pence ? undefined : "Pulled from PCH-21 (HMRC payment proof).",
        },
      ],
    },
    {
      title: "VAT",
      rows: [
        {
          label: "VAT registered?",
          value: yn(h.vat_registered),
          source: sourceFor(yn(h.vat_registered), "document"),
          hint: h.vat_registered == null ? "Pulled from PCH-15 (Uber VAT statement) if uploaded." : undefined,
        },
      ],
    },
  ];
}

function countFilled(sections: Section[]): {
  captured: number;
  total: number;
  missing: number;
} {
  let total = 0;
  let captured = 0;
  for (const s of sections) {
    for (const r of s.rows) {
      total += 1;
      if (r.source !== "missing") captured += 1;
    }
  }
  return { captured, total, missing: total - captured };
}

