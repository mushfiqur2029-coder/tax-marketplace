"use client";

// Orchestrator for the PCH accountant workspace. Phase I rebuild
// landed in slices:
//
//   I.1  demolition pass
//   I.2  progress-bar wiring (AccountantProgressProvider +
//        AccountantProgressBar + anchors)
//   I.3  PlReviewPanel + pl-actions.ts
//   I.4a SA Forwarding Letter PDF generator
//   I.4b PCH Accounts PDF generator
//   I.4c SA302 / SA100 manual uploads
//   I.4d sendForClientConfirmationAction + four-doc gate
//   I.5  client-side PchApprovalReviewCard + approvePchFinalDocsAction
//   I.6  AwaitingClientApprovalPanel + ReadyToFilePanel
//   I.7  (here) live sync: useLiveRow on cases.status and the Phase I
//        pch_cases columns, pushed into the AccountantProgress context
//        via a bridge component so chip state + status-gated panels
//        swap without a reload the moment the client approves.

import { useEffect, useMemo } from "react";
import { useLiveRow } from "@/lib/realtime-live-merge";
import { IdentityPanel, type IdentityPanelProps } from "./identity-panel";
import { DocumentsPanel, type DocumentRow, type SlotMeta } from "./documents-panel";
import type { ActionResult } from "@/lib/action-result";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  deriveAccountantStepCompletion,
  type AccountantProgressInputs,
  type AccountantStepCompletion,
} from "./accountant-progress";
import {
  AccountantProgressProvider,
  useAccountantProgress,
} from "./accountant-progress-context";
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

// Shape of the live state the orchestrator keeps in sync with
// pch_cases. Mirrors AccountantProgressInputs + the two signature
// fields the ReadyToFilePanel displays.
type LiveHead = AccountantProgressInputs & {
  clientApprovedAt: string | null;
  clientApprovedSignatureName: string | null;
};

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
  // Live-tracked cases.status. On a cases UPDATE for this id the status
  // string swaps and the status-gated AwaitingClientApprovalPanel /
  // ReadyToFilePanel re-render without a page reload. recentLocal
  // Mutation() inside useLiveRow filters the accountant's own writes
  // so clicking "Mark filed and complete" doesn't fight the panel's
  // local state.
  const liveStatus = useLiveRow<string>(props.caseStatus, {
    table: "cases",
    filter: `id=eq.${props.caseId}`,
    channel: `pch-acc-status-${props.caseId}`,
    map: (row, prev) => {
      const s = row.status;
      return typeof s === "string" && s.length > 0 ? s : prev;
    },
  });

  // Live-tracked pch_cases row. We only pull the Phase I columns + the
  // two client-approval fields; the P&L review panel owns its own
  // engine_snapshot state via pl-actions.ts, so no need to subscribe
  // to that here.
  const initialHead: LiveHead = useMemo(
    () => ({
      ...props.progress,
      clientApprovedAt: props.clientApprovedAt,
      clientApprovedSignatureName: props.clientApprovedSignatureName,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const liveHead = useLiveRow<LiveHead>(initialHead, {
    table: "pch_cases",
    filter: `case_id=eq.${props.caseId}`,
    channel: `pch-acc-head-${props.caseId}`,
    map: (row, prev) => ({
      caseStatus: liveStatus,
      plConfirmedAt: pick(row.pl_confirmed_at, prev.plConfirmedAt),
      saForwardingPdfPath:
        pick(row.sa_forwarding_pdf_path, prev.saForwardingPdfPath),
      pchAccountsPdfPath:
        pick(row.pch_accounts_pdf_path, prev.pchAccountsPdfPath),
      sa302UploadPath: pick(row.sa302_upload_path, prev.sa302UploadPath),
      sa100UploadPath: pick(row.sa100_upload_path, prev.sa100UploadPath),
      docsSentForApprovalAt:
        pick(row.docs_sent_for_approval_at, prev.docsSentForApprovalAt),
      clientApprovedAt: pick(row.client_approved_at, prev.clientApprovedAt),
      clientApprovedSignatureName: pick(
        row.client_approved_signature_name,
        prev.clientApprovedSignatureName,
      ),
    }),
  });

  // Live completion derivation. useMemo so the LiveSyncBridge below
  // only pushes a context update when a value actually changed.
  const liveCompletion = useMemo(
    () =>
      deriveAccountantStepCompletion({
        ...liveHead,
        caseStatus: liveStatus,
      }),
    [liveHead, liveStatus],
  );
  const initialCompletion = useMemo(
    () => deriveAccountantStepCompletion(props.progress),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <AccountantProgressProvider initial={initialCompletion}>
      <LiveSyncBridge completion={liveCompletion} />
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Uber / private-hire drivers return</h1>
          <p className="mt-1 text-sm text-slate-600">
            Case {props.caseId.slice(0, 8)}. Status <strong>{liveStatus}</strong>.
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
          plConfirmed={!!liveHead.plConfirmedAt}
          initialSaForwardingPdfPath={liveHead.saForwardingPdfPath}
          initialPchAccountsPdfPath={liveHead.pchAccountsPdfPath}
          initialSa302UploadPath={liveHead.sa302UploadPath}
          initialSa100UploadPath={liveHead.sa100UploadPath}
          initialDocsSentForApprovalAt={liveHead.docsSentForApprovalAt}
          signUrl={props.signDocUrl}
        />

        {liveStatus === "client_approval" ? (
          <AwaitingClientApprovalPanel
            sentAt={liveHead.docsSentForApprovalAt}
          />
        ) : null}

        {liveStatus === "filed" || liveStatus === "complete" ? (
          <ReadyToFilePanel
            caseId={props.caseId}
            caseStatus={liveStatus === "complete" ? "complete" : "filed"}
            clientApprovedAt={liveHead.clientApprovedAt}
            clientApprovedSignatureName={liveHead.clientApprovedSignatureName}
            updateCaseStatus={props.updateCaseStatus}
          />
        ) : null}

        <div className="mt-10">{props.messagesPanel}</div>
      </main>
    </AccountantProgressProvider>
  );
}

// Lives inside AccountantProgressProvider; re-pushes the live-derived
// completion vector into the context whenever cases.status or the
// Phase I pch_cases columns move. Without this bridge the provider
// would keep whatever it was seeded with on mount and the chips
// would never flip green mid-session.
function LiveSyncBridge({
  completion,
}: {
  completion: AccountantStepCompletion;
}) {
  const { setCompletion } = useAccountantProgress();
  useEffect(() => {
    setCompletion(completion);
  }, [completion, setCompletion]);
  return null;
}

// Shared null-safe merge for payload fields. Mirrors section-1-
// identity.tsx's pick helper: a server-pushed value with undefined
// means "no update for this column"; an explicit null means "set to
// null". Keeps the live-row map concise.
function pick<T>(incoming: unknown, prev: T): T {
  if (incoming === undefined) return prev;
  return incoming as T;
}
