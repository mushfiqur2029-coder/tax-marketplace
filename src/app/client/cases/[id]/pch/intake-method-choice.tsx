"use client";

// Phase A of the PCH intake redesign. Shown once, in the main
// intake-flow branch, between Section1Identity and Section2Income,
// ONLY when pch_cases.intake_method is still null for this case.
// Once the client picks, setIntakeMethodAction writes the column
// and the parent's useLiveRow on pch_cases flips intake_method
// which unmounts this component and renders the normal flow.
//
// Phase A ships two cards: "Upload your documents" (Option 1) and
// "Enter it yourself" (Option 2). Option 2 writes 'manual' and
// drops the client straight into today's fixed-slot grid. Option 1
// is a real, polished tile but marked "Coming soon" and
// non-interactive - the AI extraction pipeline is Phase B and
// isn't live yet. Server-side setIntakeMethodAction also refuses
// 'auto_upload' as belt-and-braces.
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

  const pickManual = () =>
    start(async () => {
      setErr(null);
      setPicking("manual");
      // Same mark-around-the-write pattern the submit button uses: the
      // live-row subscription on this page watches pch_cases, so a
      // self-mutation window keeps the realtime echo from double-
      // firing an unwanted RealtimeRefresh for the client's own
      // choice. The parent's useLiveRow will re-render without this
      // component mounted once the UPDATE lands.
      markLocalMutation();
      const r = await setIntakeMethodAction(caseId, "manual");
      markLocalMutation();
      if (!r.ok) {
        setPicking(null);
        setErr(r.error);
        return;
      }
    });

  const manualSaving = pending && picking === "manual";

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-bold">How would you like to enter your income and expenses?</h2>
      <p className="mb-4 text-sm text-slate-600">
        Pick one. You can only choose once per return, so take a moment
        to decide which feels right for you.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Option 1: Upload - Phase A ships this as a well-designed
            tile that is deliberately disabled with a "Coming soon"
            pill so what's being built next is visible rather than
            hidden. The AI extraction pipeline lands in Phase B. */}
        <div
          aria-disabled="true"
          className="relative flex min-h-[220px] cursor-not-allowed select-none flex-col rounded-xl border border-slate-200 bg-white p-5 opacity-60 sm:p-6"
        >
          <div className="absolute right-4 top-4">
            <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              Coming soon
            </span>
          </div>
          <UploadCloudIcon />
          <h3 className="mt-4 text-base font-bold text-ink">
            Upload your documents
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Upload your bank statements, receipts and invoices. We read
            them and sort everything into the right categories for you
            to check.
          </p>
        </div>

        {/* Option 2: Manual - fully wired. Whole card is the tap
            target. Loading state covers the brief gap between the
            action succeeding and the parent's useLiveRow echoing the
            new intake_method value through. */}
        <button
          type="button"
          onClick={pickManual}
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
