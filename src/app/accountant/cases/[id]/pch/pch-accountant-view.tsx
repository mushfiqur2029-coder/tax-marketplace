"use client";

// Orchestrator for the PCH accountant workspace. Phase I rebuild
// landing in slices:
//
//   I.1  demolition pass (previous commit).
//   I.2  (this file right now) progress-bar wiring: AccountantProgress
//        Provider + AccountantProgressBar + six placeholder section
//        anchors (one per chip) so chip clicks already scroll to the
//        matching band. Panels themselves still land in I.3 to I.6.
//
// Panels due in later slices and the chip each one belongs to:
//
//   PlReviewPanel                 -> "P&L confirmed"       (I.3)
//   FinalDocumentsPanel generate  -> "Documents generated" (I.4a + I.4b)
//                        upload   -> "SA302 + SA100 uploaded" (I.4c)
//                        send     -> "Sent for client confirmation" (I.4d)
//   AwaitingClientApprovalPanel   -> "Client approved"     (I.6 + I.7)
//   ReadyToFilePanel              -> "Filed"               (I.6 + I.7)

import { IdentityPanel, type IdentityPanelProps } from "./identity-panel";
import { DocumentsPanel, type DocumentRow, type SlotMeta } from "./documents-panel";
import type { ActionResult } from "@/lib/action-result";
import {
  deriveAccountantStepCompletion,
  type AccountantProgressInputs,
} from "./accountant-progress";
import { AccountantProgressProvider } from "./accountant-progress-context";
import { AccountantProgressBar } from "./accountant-progress-bar";

export function PchAccountantView(props: {
  caseId: string;
  caseStatus: string;
  identity: IdentityPanelProps;
  documents: DocumentRow[];
  documentSlotMeta: SlotMeta[];
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
  progress: AccountantProgressInputs;
  messagesPanel: React.ReactNode;
}) {
  const initialCompletion = deriveAccountantStepCompletion(props.progress);
  return (
    <AccountantProgressProvider initial={initialCompletion}>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Uber / private-hire drivers return</h1>
          <p className="mt-1 text-sm text-slate-600">
            Case {props.caseId.slice(0, 8)}. Status <strong>{props.caseStatus}</strong>.
          </p>
        </div>

        <IdentityPanel {...props.identity} />

        <DocumentsPanel
          caseId={props.caseId}
          docs={props.documents}
          slotMeta={props.documentSlotMeta}
          signUrl={props.signDocUrl}
        />

        <AccountantProgressBar />

        <PlaceholderBand id="pch-acc-pl" title="P&L review" slice="I.3" />
        <PlaceholderBand id="pch-acc-docs-generate" title="Generate final documents" slice="I.4a + I.4b" />
        <PlaceholderBand id="pch-acc-docs-upload" title="Upload SA302 + SA100" slice="I.4c" />
        <PlaceholderBand id="pch-acc-send" title="Send for client confirmation" slice="I.4d" />
        <PlaceholderBand id="pch-acc-approval" title="Awaiting client approval" slice="I.6" />
        <PlaceholderBand id="pch-acc-file" title="Ready to file" slice="I.6" />

        <div className="mt-10">{props.messagesPanel}</div>
      </main>
    </AccountantProgressProvider>
  );
}

function PlaceholderBand({
  id, title, slice,
}: {
  id: string;
  title: string;
  slice: string;
}) {
  return (
    <section
      id={id}
      className="mb-4 scroll-mt-24 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Lands in Phase {slice}
        </span>
      </div>
    </section>
  );
}
