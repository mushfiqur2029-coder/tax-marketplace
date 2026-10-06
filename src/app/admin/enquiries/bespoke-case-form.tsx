"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Accountant = { id: string; name: string | null; email: string };

type Props = {
  enquiryId: string;
  accountants: Accountant[];
  createCase: (
    enquiryId: string,
    feeGbp: number,
    accountantId: string,
    note: string | null,
  ) => Promise<ActionResult<{ caseId: string }>>;
};

// Admin-side form on the enquiry card. Captures a whole-£ fee + an
// accountant + an optional note, then calls
// createBespokeCaseFromEnquiryAction. Fee is whole £ only per the
// product constraint; the server stores it as pence.
export function BespokeCaseForm({ enquiryId, accountants, createCase }: Props) {
  const [fee, setFee] = useState<string>("");
  const [accountantId, setAccountantId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ caseId: string } | null>(null);
  const [pending, start] = useTransition();

  if (accountants.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-line bg-cloud/40 p-4 text-sm text-slate">
        No approved accountants yet — approve one before quoting bespoke cases.
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="mt-4 rounded-xl border p-4 text-sm"
        style={{
          borderColor: "rgba(19, 217, 160, 0.4)",
          background: "rgba(19, 217, 160, 0.08)",
        }}
      >
        <div className="font-semibold text-ink">
          Case created and sent to the client.
        </div>
        <div className="mt-1 text-slate">
          The client sees the quote in their bell and lands on the engagement
          letter from the dashboard.
        </div>
        <Link
          href={`/admin/cases/${success.caseId}`}
          className="mt-2 inline-block text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          Open case
        </Link>
      </div>
    );
  }

  const feeNum = Number(fee);
  const canSubmit =
    accountantId !== "" &&
    Number.isInteger(feeNum) &&
    feeNum > 0 &&
    !pending;

  const onSubmit = () => {
    setError(null);
    start(async () => {
      const res = await createCase(
        enquiryId,
        feeNum,
        accountantId,
        note.trim() || null,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess({ caseId: res.data.caseId });
    });
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-paper p-4">
      <div
        className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Create case from this enquiry
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <label className="block">
          <span
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Fee (whole £)
          </span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="e.g. 1500"
            className="input-sl"
          />
        </label>
        <label className="block">
          <span
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Accountant
          </span>
          <select
            value={accountantId}
            onChange={(e) => setAccountantId(e.target.value)}
            className="input-sl"
          >
            <option value="">Pick an accountant.</option>
            {accountants.map((a) => (
              <option key={a.id} value={a.id}>
                {(a.name?.trim() || a.email) + ` <${a.email}>`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-3 block">
        <span
          className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Note for client (optional)
        </span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Appears in the client's notification."
          className="input-sl"
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <SLButton
          type="button"
          variant="primary"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="w-full sm:w-auto"
        >
          {pending ? "Creating…" : "Create case"}
        </SLButton>
        <span className="text-xs text-slate">
          Enquiry auto-closes. Fee can&rsquo;t be edited after creation — cancel
          and re-create if the number is wrong.
        </span>
      </div>
    </div>
  );
}

// Compact row shown instead of the form when a case has already been
// created from this enquiry.
export function BespokeCaseExistingLink({
  caseId,
  feePence,
}: {
  caseId: string;
  feePence: number;
}) {
  return (
    <div
      className="mt-4 rounded-xl border p-4 text-sm"
      style={{
        borderColor: "rgba(25,156,217,0.4)",
        background: "rgba(25,156,217,0.04)",
      }}
    >
      <div className="font-semibold text-ink">
        Case already created for £{(feePence / 100).toLocaleString("en-GB")}.
      </div>
      <Link
        href={`/admin/cases/${caseId}`}
        className="mt-1 inline-block text-xs font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
      >
        Open case
      </Link>
    </div>
  );
}
