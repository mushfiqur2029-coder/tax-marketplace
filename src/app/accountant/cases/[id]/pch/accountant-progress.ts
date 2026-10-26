// Phase I accountant workspace progress: six steps that mirror the
// client intake's completion-check pattern (see
// src/app/client/cases/[id]/pch/intake-completion.ts) but with the
// state anchored to server-rendered pch_cases columns + cases.status
// rather than form inputs. Each step is "done" when its underlying
// column(s) are populated:
//
//   plConfirmed    -> pch_cases.pl_confirmed_at IS NOT NULL
//   docsGenerated  -> sa_forwarding_pdf_path AND pch_accounts_pdf_path
//                     are both non-null
//   docsUploaded   -> sa302_upload_path AND sa100_upload_path are both
//                     non-null
//   sentForApproval -> docs_sent_for_approval_at IS NOT NULL (also
//                     implied by cases.status reaching client_approval)
//   clientApproved -> client_approved_at IS NOT NULL (also implied by
//                     cases.status reaching filed / complete)
//   filed          -> cases.status === 'filed' || 'complete'
//
// The derivation lives here (deriveAccountantStepCompletion below) so
// the server page, the live-row context, and any test can all go
// through the same source of truth. Chip labels and DOM anchor ids
// match the Phase I orchestrator panels.

export const ACCOUNTANT_STEP_KEYS = [
  "plConfirmed",
  "docsGenerated",
  "docsUploaded",
  "sentForApproval",
  "clientApproved",
  "filed",
] as const;
export type AccountantStepKey = (typeof ACCOUNTANT_STEP_KEYS)[number];

export const ACCOUNTANT_STEP_LABELS: Record<AccountantStepKey, string> = {
  plConfirmed: "P&L confirmed",
  docsGenerated: "Documents generated",
  docsUploaded: "SA302 + SA100 uploaded",
  sentForApproval: "Sent for client confirmation",
  clientApproved: "Client approved",
  filed: "Filed",
};

export const ACCOUNTANT_STEP_ANCHOR_IDS: Record<AccountantStepKey, string> = {
  plConfirmed: "pch-acc-pl",
  docsGenerated: "pch-acc-docs-generate",
  docsUploaded: "pch-acc-docs-upload",
  sentForApproval: "pch-acc-send",
  clientApproved: "pch-acc-approval",
  filed: "pch-acc-file",
};

export type AccountantStepCompletion = Record<AccountantStepKey, boolean>;

// Shape of the server-rendered state the completion derivation reads
// from. Narrow and explicit so the orchestrator can thread exactly
// these fields without pulling the whole pch_cases row through the
// client bundle.
export type AccountantProgressInputs = {
  caseStatus: string;
  plConfirmedAt: string | null;
  saForwardingPdfPath: string | null;
  pchAccountsPdfPath: string | null;
  sa302UploadPath: string | null;
  sa100UploadPath: string | null;
  docsSentForApprovalAt: string | null;
  clientApprovedAt: string | null;
};

export function deriveAccountantStepCompletion(
  s: AccountantProgressInputs,
): AccountantStepCompletion {
  const filed = s.caseStatus === "filed" || s.caseStatus === "complete";
  const clientApproved = !!s.clientApprovedAt || filed;
  const sentForApproval =
    !!s.docsSentForApprovalAt
    || s.caseStatus === "client_approval"
    || clientApproved;
  return {
    plConfirmed: !!s.plConfirmedAt,
    docsGenerated: !!s.saForwardingPdfPath && !!s.pchAccountsPdfPath,
    docsUploaded: !!s.sa302UploadPath && !!s.sa100UploadPath,
    sentForApproval,
    clientApproved,
    filed,
  };
}

export function emptyAccountantCompletion(): AccountantStepCompletion {
  return {
    plConfirmed: false,
    docsGenerated: false,
    docsUploaded: false,
    sentForApproval: false,
    clientApproved: false,
    filed: false,
  };
}
