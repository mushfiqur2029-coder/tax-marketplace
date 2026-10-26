"use client";

// Phase M+4: small banner-style card on the accountant workspace that
// surfaces the intake lock state and offers a one-click re-open when
// the client needs to fix a field the accountant can't edit from this
// side (identity, declaration, vehicle, Section 15).
//
// Deliberately silent before the client submits (no banner). After
// submit shows an amber card with the submit timestamp + a re-open
// button. Once the case moves past client_approval the re-open path
// is hidden (the server action refuses too) because re-opening would
// invalidate signed-off figures.

import { useState, useTransition } from "react";
import { reopenClientIntakeAction } from "@/app/accountant/pch/intake-lock-actions";

export function IntakeLockPanel({
  caseId,
  intakeSubmittedAt,
  caseStatus,
}: {
  caseId: string;
  intakeSubmittedAt: string | null;
  caseStatus: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!intakeSubmittedAt) return null;
  if (
    caseStatus === "client_approval"
    || caseStatus === "filed"
    || caseStatus === "complete"
  ) {
    return null;
  }

  const reopen = () =>
    start(async () => {
      setErr(null);
      const r = await reopenClientIntakeAction(caseId);
      if (!r.ok) setErr(r.error);
    });

  return (
    <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
      <h2 className="text-base font-semibold text-slate-900">
        Client intake is locked
      </h2>
      <p className="mt-1 text-xs text-slate-700">
        Submitted {new Date(intakeSubmittedAt).toLocaleString("en-GB")}.
        You can edit P&amp;L amounts yourself below. If the client needs
        to correct something you can't change from here (identity, a
        declaration, vehicle, Section 15), re-open the intake so they
        can fix it and re-submit.
      </p>
      <button
        type="button"
        onClick={reopen}
        disabled={pending}
        className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-400 disabled:opacity-50"
      >
        {pending ? "Re-opening..." : "Re-open client intake"}
      </button>
      {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
    </section>
  );
}
