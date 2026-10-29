"use client";

// Phase A UI, Phase B wiring. Shown once, in the main intake-flow
// branch, between Section1Identity and Section2Income, ONLY when
// pch_cases.intake_method is still null for this case. Once the
// client picks, setIntakeMethodAction writes the column and the
// parent's useLiveRow on pch_cases flips intake_method which
// unmounts this component and renders the real intake flow for the
// chosen method.
//
// Both cards are now fully wired: Option 1 writes 'auto_upload' and
// drops the client into Phase B's BulkDocumentUpload + review flow;
// Option 2 writes 'manual' and drops them into today's fixed-slot
// grid. The server action setIntakeMethodAction accepts either value
// as a one-way choice (refuses only if intake_method is already
// set).
//
// Mobile-first: single column by default (grid-cols-1), two columns
// at md:+. Whole card is the tap target, not a small button inside
// it. Visual language matches the rest of the client workspace
// (rounded-xl, border-slate-200, bg-white) so this doesn't look
// like a bolted-on page.

import { useState, useTransition } from "react";
import { setIntakeMethodAction } from "@/app/client/pch/actions";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

export function IntakeMethodChoice({ caseId }: { caseId: string }) {
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState<"manual" | "auto_upload" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = (method: "manual" | "auto_upload") =>
    start(async () => {
      setErr(null);
      setPicking(method);
      // Same mark-around-the-write pattern the submit button uses: the
      // live-row subscription on this page watches pch_cases, so a
      // self-mutation window keeps the realtime echo from double-
      // firing an unwanted RealtimeRefresh for the client's own
      // choice. The parent's useLiveRow will re-render without this
      // component mounted once the UPDATE lands.
      markLocalMutation();
      const r = await setIntakeMethodAction(caseId, method);
      markLocalMutation();
      if (!r.ok) {
        setPicking(null);
        setErr(r.error);
        return;
      }
    });

  const manualSaving = pending && picking === "manual";
  const autoSaving = pending && picking === "auto_upload";

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-bold">How would you like to enter your income and expenses?</h2>
      <p className="mb-4 text-sm text-slate-600">
        Pick one. You can only choose once per return, so take a moment
        to decide which feels right for you.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Option 1: Upload documents - Phase B flow. Picking this
            drops the client into BulkDocumentUpload + the fixed grids
            with extra-rows review. */}
        <button
          type="button"
          onClick={() => pick("auto_upload")}
          disabled={pending}
          aria-busy={autoSaving}
          className="group relative flex min-h-[220px] cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-sky hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky/40 disabled:cursor-wait sm:p-6"
        >
          <UploadCloudIcon />
          <h3 className="mt-4 text-base font-bold text-ink">
            Upload your documents
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Upload your bank statements, receipts and invoices. We read
            them and sort everything into the right categories for you
            to check.
          </p>
          <div className="mt-auto flex items-center gap-2 pt-4 text-sm font-semibold text-sky">
            {autoSaving ? (
              <>
                <Spinner />
                Setting up.
              </>
            ) : (
              <>
                <span>Start uploading</span>
                <ArrowRightIcon />
              </>
            )}
          </div>
        </button>

        {/* Option 2: Manual. Loading state covers the brief gap
            between the action succeeding and the parent's useLiveRow
            echoing the new intake_method value through. */}
        <button
          type="button"
          onClick={() => pick("manual")}
          disabled={pending}
          aria-busy={manualSaving}
          className="group relative flex min-h-[220px] cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-sky hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky/40 disabled:cursor-wait sm:p-6"
        >
          <DocumentPencilIcon />
          <h3 className="mt-4 text-base font-bold text-ink">
            Enter it yourself
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Type in your income and expenses yourself, one line at a time.
          </p>
          <div className="mt-auto flex items-center gap-2 pt-4 text-sm font-semibold text-sky">
            {manualSaving ? (
              <>
                <Spinner />
                Setting up.
              </>
            ) : (
              <>
                <span>Start typing them in</span>
                <ArrowRightIcon />
              </>
            )}
          </div>
        </button>
      </div>

      {err ? (
        <p className="mt-3 text-sm text-rose-700" role="alert">
          {err}
        </p>
      ) : null}
    </section>
  );
}

function UploadCloudIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-slate-700"
    >
      <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.98 7 7 0 1 0-13.66 1.98" />
      <path d="M9 15l3-3 3 3" />
      <path d="M12 12v9" />
    </svg>
  );
}

function DocumentPencilIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-sky"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M11 13l3 3" />
      <path d="M11 13l-2 5 5-2 4.5-4.5a1.414 1.414 0 1 0-2-2z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
