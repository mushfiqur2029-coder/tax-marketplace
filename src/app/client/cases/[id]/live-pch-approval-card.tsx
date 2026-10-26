"use client";

// Phase I.7 live wrapper around PchApprovalReviewCard. Subscribes to
// pch_cases for the four doc-path columns + docs_sent_for_approval_
// at, so a regenerate on the accountant side (or a late SA302/SA100
// upload after the client already opened their approval page) shows
// up without a reload. Status flips are handled elsewhere: the
// Approve action does window.location.reload() on success, so the
// whole page re-renders at the new 'filed' state - same existing
// convention the limited-company ApproveAndFileButton already uses.

import { useMemo } from "react";
import { useLiveRow } from "@/lib/realtime-live-merge";
import { PchApprovalReviewCard } from "./pch-approval-review-card";
import type { ActionResult } from "@/lib/action-result";

type Docs = {
  saForwardingPdfPath: string | null;
  pchAccountsPdfPath: string | null;
  sa302UploadPath: string | null;
  sa100UploadPath: string | null;
};

export function LivePchApprovalCard({
  caseId,
  initialDocs,
  initialSentAt,
  getDocUrl,
  approve,
}: {
  caseId: string;
  initialDocs: Docs;
  initialSentAt: string | null;
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
  approve: (
    signatureName: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  type LiveHead = Docs & { sentAt: string | null };
  const initial: LiveHead = useMemo(
    () => ({ ...initialDocs, sentAt: initialSentAt }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const live = useLiveRow<LiveHead>(initial, {
    table: "pch_cases",
    filter: `case_id=eq.${caseId}`,
    channel: `pch-client-approval-${caseId}`,
    map: (row, prev) => ({
      saForwardingPdfPath: pick(row.sa_forwarding_pdf_path, prev.saForwardingPdfPath),
      pchAccountsPdfPath: pick(row.pch_accounts_pdf_path, prev.pchAccountsPdfPath),
      sa302UploadPath: pick(row.sa302_upload_path, prev.sa302UploadPath),
      sa100UploadPath: pick(row.sa100_upload_path, prev.sa100UploadPath),
      sentAt: pick(row.docs_sent_for_approval_at, prev.sentAt),
    }),
  });

  return (
    <PchApprovalReviewCard
      docs={{
        saForwardingPdfPath: live.saForwardingPdfPath,
        pchAccountsPdfPath: live.pchAccountsPdfPath,
        sa302UploadPath: live.sa302UploadPath,
        sa100UploadPath: live.sa100UploadPath,
      }}
      sentAt={live.sentAt}
      getDocUrl={getDocUrl}
      approve={approve}
    />
  );
}

function pick<T>(incoming: unknown, prev: T): T {
  if (incoming === undefined) return prev;
  return incoming as T;
}
