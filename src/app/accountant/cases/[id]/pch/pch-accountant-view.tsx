"use client";

// Orchestrator for the PCH accountant workspace. Phase I rebuild is
// landing in slices:
//
//   Sub-phase 1 (this file right now): demolition + stub. The old
//     view (33-check panel, override surface, SA302 comparison,
//     bookkeeping confirm, final-pack panel, prior-year anomalies,
//     addon widget, export routes) is gone. This file mounts the two
//     surviving panels (IdentityPanel, DocumentsPanel) and the case
//     chat beneath a placeholder band so page.tsx has something to
//     render while the new 4-document flow is wired up.
//
// Later Phase I slices will add: progress bar, PlReviewPanel,
// FinalDocumentsPanel, AwaitingClientApprovalPanel, ReadyToFilePanel,
// and the live-sync wiring for status flips. See Phase I spec.

import { IdentityPanel, type IdentityPanelProps } from "./identity-panel";
import { DocumentsPanel, type DocumentRow, type SlotMeta } from "./documents-panel";
import type { ActionResult } from "@/lib/action-result";

export function PchAccountantView(props: {
  caseId: string;
  caseStatus: string;
  identity: IdentityPanelProps;
  documents: DocumentRow[];
  documentSlotMeta: SlotMeta[];
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
  messagesPanel: React.ReactNode;
}) {
  return (
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

      <section className="mb-6 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">
          Phase I rebuild in progress
        </h2>
        <p className="mt-1 text-xs text-amber-900">
          The 4-document send/approve/file flow lands in the next slice:
          P&amp;L review, final-documents generation + SA302 / SA100
          upload, client-approval wait, and mark-filed. For now, use the
          case chat below to co-ordinate with the client.
        </p>
      </section>

      <div className="mt-10">{props.messagesPanel}</div>
    </main>
  );
}
