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
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  deriveAccountantStepCompletion,
  type AccountantProgressInputs,
} from "./accountant-progress";
import { AccountantProgressProvider } from "./accountant-progress-context";
import { AccountantProgressBar } from "./accountant-progress-bar";
import {
  PlReviewPanel,
  type PlExpenseLine,
  type PlIncomeLine,
} from "./pl-review-panel";
import { FinalDocumentsPanel } from "./final-documents-panel";
import {
  AwaitingClientApprovalPanel,
  ReadyToFilePanel,
} from "./approval-and-file-panels";

export function PchAccountantView(props: {
  caseId: string;
  caseStatus: string;
  identity: IdentityPanelProps;
  documents: DocumentRow[];
  documentSlotMeta: SlotMeta[];
  signDocUrl: (path: string) => Promise<ActionResult<string>>;
  progress: AccountantProgressInputs;
  plIncomeLines: PlIncomeLine[];
  plExpenseLines: PlExpenseLine[];
  plSnapshot: TaxEngineOutput | null;
  plConfirmedAt: string | null;
  plConfirmedByLabel: string | null;
  clientApprovedAt: string | null;
  clientApprovedSignatureName: string | null;
  updateCaseStatus: (
    caseId: string,
    next: "complete",
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
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

        <PlReviewPanel
          caseId={props.caseId}
          initialIncome={props.plIncomeLines}
          initialExpenses={props.plExpenseLines}
          initialSnapshot={props.plSnapshot}
          initialPlConfirmedAt={props.plConfirmedAt}
          initialPlConfirmedByLabel={props.plConfirmedByLabel}
        />

        <FinalDocumentsPanel
          caseId={props.caseId}
          plConfirmed={!!props.plConfirmedAt}
          initialSaForwardingPdfPath={props.progress.saForwardingPdfPath}
          initialPchAccountsPdfPath={props.progress.pchAccountsPdfPath}
          initialSa302UploadPath={props.progress.sa302UploadPath}
          initialSa100UploadPath={props.progress.sa100UploadPath}
          initialDocsSentForApprovalAt={props.progress.docsSentForApprovalAt}
          signUrl={props.signDocUrl}
        />

        {props.caseStatus === "client_approval" ? (
          <AwaitingClientApprovalPanel
            sentAt={props.progress.docsSentForApprovalAt}
          />
        ) : null}

        {props.caseStatus === "filed" || props.caseStatus === "complete" ? (
          <ReadyToFilePanel
            caseId={props.caseId}
            caseStatus={props.caseStatus}
            clientApprovedAt={props.clientApprovedAt}
            clientApprovedSignatureName={props.clientApprovedSignatureName}
            updateCaseStatus={props.updateCaseStatus}
          />
        ) : null}

        <div className="mt-10">{props.messagesPanel}</div>
      </main>
    </AccountantProgressProvider>
  );
}
