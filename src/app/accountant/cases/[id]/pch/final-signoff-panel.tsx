"use client";

// Phase 6 Slice 7: accountant-side final sign-off controls.
//
// Appears below the P&L edit grid on the accountant workspace. Three
// states, driven by two timestamps on pch_cases (final_pack_sent_at
// and final_pack_confirmed_at):
//
//   Not yet sent: show "Send final pack to client" (requires that the
//     client has already approved the figures via client_approval_at).
//
//   Sent, awaiting client confirm: show the sent-at timestamp + a
//     "Clear and re-send" button in case the accountant realised the
//     pack needs regenerating.
//
//   Confirmed: show the client's confirmation + a "Mark filed with
//     HMRC" button. The actual HMRC submission is manual off-platform;
//     this button just flips cases.status to 'filed'.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendFinalPackAction,
  clearFinalPackAction,
  markFiledWithHmrcAction,
} from "@/app/accountant/pch/actions";
import { updateCaseStatusAction } from "@/app/accountant/actions";

type Props = {
  caseId: string;
  clientApprovalAt: string | null;
  clientApprovalName: string | null;
  finalPackSentAt: string | null;
  finalPackConfirmedAt: string | null;
  finalPackConfirmedName: string | null;
  caseStatus: string;
};

export function FinalSignoffPanel({
  caseId,
  clientApprovalAt,
  clientApprovalName,
  finalPackSentAt,
  finalPackConfirmedAt,
  finalPackConfirmedName,
  caseStatus,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Action failed.");
      else router.refresh();
    });

  if (caseStatus === "complete") {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <h2 className="text-sm font-bold text-emerald-900">Case complete</h2>
        <p className="mt-1 text-xs text-emerald-900">
          Case closed and commission settled. Nothing more to do here.
        </p>
      </section>
    );
  }

  if (caseStatus === "filed") {
    // Status is 'filed' but not yet 'complete'. The non-PCH case page
    // has the same transition in its generic status widget; PCH never
    // had a UI to flip filed->complete, so until this button landed a
    // PCH case stayed at 'filed' forever. The generic action lives in
    // @/app/accountant/actions and is already safe for PCH (the only
    // PCH-specific guard inside it blocks filed->complete's sibling
    // path to client_approval, not this one).
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <h2 className="text-sm font-bold text-emerald-900">Filed with HMRC</h2>
        <p className="mt-1 text-xs text-emerald-900">
          Case is <strong>filed</strong>. Mark it complete once you've confirmed the HMRC submission is settled; that posts the 50% commission to your wallet and closes the case out.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => run(() => updateCaseStatusAction(caseId, "complete"))}
            disabled={pending}
            className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Marking..." : "Mark complete"}
          </button>
          {err ? <span className="text-xs text-rose-700">{err}</span> : null}
        </div>
      </section>
    );
  }

  // Guard: the client must approve the figures first.
  if (!clientApprovalAt) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Final sign-off</h2>
        <p className="mt-1 text-xs text-slate-600">
          Waiting on the client to approve the figures first. Use the "Advance to client approval" button in the readiness band above to prompt them.
        </p>
      </section>
    );
  }

  if (!finalPackSentAt) {
    return (
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <h2 className="text-sm font-bold text-slate-900">Final sign-off</h2>
        <p className="mt-1 text-xs text-slate-700">
          Figures approved {new Date(clientApprovalAt).toLocaleString("en-GB")} by {clientApprovalName ?? "the client"}. Now send the final accounts pack so the client can confirm it before you file with HMRC.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => run(() => sendFinalPackAction(caseId))}
            disabled={pending}
            className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Sending..." : "Send final pack to client"}
          </button>
          {err ? <span className="text-xs text-rose-700">{err}</span> : null}
        </div>
      </section>
    );
  }

  if (!finalPackConfirmedAt) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-bold text-amber-900">Awaiting client confirmation</h2>
        <p className="mt-1 text-xs text-amber-900">
          Final pack sent {new Date(finalPackSentAt).toLocaleString("en-GB")}. The client has a review-and-confirm card on their workspace; once they confirm, the "Mark filed with HMRC" button appears here.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => run(() => clearFinalPackAction(caseId))}
            disabled={pending}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {pending ? "Clearing..." : "Clear and re-send"}
          </button>
          {err ? <span className="text-xs text-rose-700">{err}</span> : null}
        </div>
      </section>
    );
  }

  // Confirmed, ready to file.
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <h2 className="text-sm font-bold text-emerald-900">Ready to file with HMRC</h2>
      <p className="mt-1 text-xs text-emerald-900">
        Final pack confirmed by <strong>{finalPackConfirmedName}</strong> on {new Date(finalPackConfirmedAt).toLocaleString("en-GB")}. Submit to HMRC off-platform, then click the button below to flip the case to <code>filed</code>.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => run(() => markFiledWithHmrcAction(caseId))}
          disabled={pending}
          className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Marking..." : "Mark filed with HMRC"}
        </button>
        {err ? <span className="text-xs text-rose-700">{err}</span> : null}
      </div>
    </section>
  );
}
