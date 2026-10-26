"use client";

// Phase I.6: the two tail-end panels on the accountant workspace.
//
//   AwaitingClientApprovalPanel  (shown when caseStatus = client_approval)
//     Passive display confirming the four-doc pack is out with the
//     client. Shows "Sent for client approval <date>." + a small
//     expectation-set paragraph. No action for the accountant; the
//     next thing is the client clicking Approve on their side, which
//     the live-row subscription in Phase I.7 will reflect by swapping
//     this panel for ReadyToFilePanel without a page reload.
//
//   ReadyToFilePanel             (shown when caseStatus = filed OR complete)
//     Confirms the client approved + shows their typed signature +
//     date. One action: "Mark filed and complete" which transitions
//     filed -> complete via the existing updateCaseStatusAction
//     (which also enforces the no-unpaid-add-ons gate). On complete
//     the button is replaced by a done pill.
//
// Both panels push the matching chip state via setStepDone on the
// AccountantProgress context so an in-page status flip doesn't need
// a full page reload to re-colour the chips.

import { useEffect, useState, useTransition } from "react";
import { useAccountantProgress } from "./accountant-progress-context";

type UpdateStatus = (
  caseId: string,
  next: "complete",
) => Promise<{ ok: true } | { ok: false; error: string }>;

export function AwaitingClientApprovalPanel({
  sentAt,
}: {
  sentAt: string | null;
}) {
  // Belt-and-braces: a case can reach client_approval via the
  // orchestrator even if docs_sent_for_approval_at didn't land (e.g.
  // a legacy row that pre-dates Phase I's send gate). We fall back to
  // "recently" rather than render an empty "Sent on" caption.
  const sentLabel = sentAt
    ? new Date(sentAt).toLocaleString("en-GB")
    : null;
  return (
    <section
      id="pch-acc-approval"
      className="mb-6 scroll-mt-24 rounded-xl border border-sky-200 bg-sky-50 p-4 sm:p-5"
    >
      <header className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Awaiting client approval
          </h2>
          {sentLabel ? (
            <p className="mt-1 text-xs text-slate-600">
              Sent for client approval {sentLabel}.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-600">
              Sent for client approval.
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
          Waiting on client
        </span>
      </header>
      <p className="text-sm text-slate-700">
        The client has the four-document pack on their workspace. They
        open each document, type their full name as a signature, and
        click Approve. This panel will swap to "Ready to file"
        automatically the moment they do, with the signed name and
        timestamp.
      </p>
    </section>
  );
}

export function ReadyToFilePanel({
  caseId,
  caseStatus,
  clientApprovedAt,
  clientApprovedSignatureName,
  updateCaseStatus,
}: {
  caseId: string;
  caseStatus: "filed" | "complete";
  clientApprovedAt: string | null;
  clientApprovedSignatureName: string | null;
  updateCaseStatus: UpdateStatus;
}) {
  const [status, setStatus] = useState<"filed" | "complete">(caseStatus);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const { setStepDone } = useAccountantProgress();

  // Keep the "Filed" chip (and the "Client approved" chip, which the
  // live-row subscription in I.7 will also push) in sync whenever the
  // local status flips. Deliberately NOT in the transition's success
  // branch below so a server-rendered 'complete' case on first paint
  // also gets its chip set.
  useEffect(() => {
    setStepDone("clientApproved", true);
    setStepDone("filed", status === "complete" || status === "filed");
    // ESLint: setStepDone from the context is stable, see
    // accountant-progress-context.tsx (useCallback with empty deps
    // via useState setter identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const markComplete = () =>
    start(async () => {
      setErr(null);
      const r = await updateCaseStatus(caseId, "complete");
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setStatus("complete");
    });

  const approvedLabel = clientApprovedAt
    ? new Date(clientApprovedAt).toLocaleString("en-GB")
    : null;

  return (
    <section
      id="pch-acc-file"
      className="mb-6 scroll-mt-24 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5"
    >
      <header className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {status === "complete" ? "Case complete" : "Ready to file with HMRC"}
          </h2>
          {clientApprovedSignatureName && approvedLabel ? (
            <p className="mt-1 text-xs text-slate-700">
              Approved by {clientApprovedSignatureName} on {approvedLabel}.
            </p>
          ) : clientApprovedSignatureName ? (
            <p className="mt-1 text-xs text-slate-700">
              Approved by {clientApprovedSignatureName}.
            </p>
          ) : approvedLabel ? (
            <p className="mt-1 text-xs text-slate-700">
              Approved {approvedLabel}.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-700">Client approved.</p>
          )}
        </div>
        <span
          className={
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold "
            + (status === "complete"
              ? "border-emerald-300 bg-emerald-100 text-emerald-900"
              : "border-emerald-200 bg-white text-emerald-800")
          }
        >
          {status === "complete" ? "✓ Complete" : "Client approved"}
        </span>
      </header>

      {status === "complete" ? (
        <p className="text-sm text-slate-700">
          Filed with HMRC and marked complete. No further action
          needed. The case is now closed on both sides.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-700">
            File the return with HMRC through your usual channel, then
            click below to close the case. Any unpaid add-ons on this
            case must settle first.
          </p>
          <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={markComplete}
              disabled={pending}
              className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Marking." : "Mark filed and complete"}
            </button>
            {err ? <p className="text-xs text-rose-700">{err}</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
