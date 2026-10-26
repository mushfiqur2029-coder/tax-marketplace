"use client";

// Live-synced status + client-approval card for the admin PCH inspect
// page. The surrounding page.tsx is a plain server component with no
// subscription of its own, so without this bridge the status chip and
// the approval box stay frozen on their server-rendered values until
// a manual reload - even though the client has just approved and the
// accountant's panel has already flipped to "Ready to file".
//
// Subscribes to cases.status (for the StatusPill) and the Phase I
// approval columns on pch_cases (client_approval_at / name / ip /
// version for the old figures-approval disclosure, and client_approved
// _at / signature_name for the real "approved and filed" step the
// client goes through via approvePchFinalDocsAction).

import { useLiveRow } from "@/lib/realtime-live-merge";
import { StatusPill } from "@/components/case/status-pill";

export type PchAdminLiveHead = {
  client_approval_at: string | null;
  client_approval_name: string | null;
  client_approval_ip: string | null;
  client_approval_version: number | null;
  client_approved_at: string | null;
  client_approved_signature_name: string | null;
};

export function PchAdminLiveStatus(props: {
  caseId: string;
  initialStatus: string;
  initialHead: PchAdminLiveHead;
}) {
  const status = useLiveRow<string>(props.initialStatus, {
    table: "cases",
    filter: `id=eq.${props.caseId}`,
    channel: `pch-admin-status-${props.caseId}`,
    map: (row, prev) => {
      const s = row.status;
      return typeof s === "string" && s.length > 0 ? s : prev;
    },
  });
  const head = useLiveRow<PchAdminLiveHead>(props.initialHead, {
    table: "pch_cases",
    filter: `case_id=eq.${props.caseId}`,
    channel: `pch-admin-head-${props.caseId}`,
    map: (row, prev) => ({
      client_approval_at: pick(row.client_approval_at, prev.client_approval_at),
      client_approval_name: pick(row.client_approval_name, prev.client_approval_name),
      client_approval_ip: pick(row.client_approval_ip, prev.client_approval_ip),
      client_approval_version: pick(
        row.client_approval_version,
        prev.client_approval_version,
      ),
      client_approved_at: pick(row.client_approved_at, prev.client_approved_at),
      client_approved_signature_name: pick(
        row.client_approved_signature_name,
        prev.client_approved_signature_name,
      ),
    }),
  });

  return (
    <>
      <StatusPill status={status} />
      {head.client_approved_at ? (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <div className="font-medium text-emerald-800">
            ✓ Approved and filed, {head.client_approved_signature_name}
          </div>
          <div className="mt-1 text-xs text-emerald-700">
            {new Date(head.client_approved_at).toLocaleString()}
          </div>
        </div>
      ) : head.client_approval_at ? (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <div className="font-medium text-emerald-800">
            ✓ Figures approved by {head.client_approval_name}
          </div>
          <div className="mt-1 text-xs text-emerald-700">
            {new Date(head.client_approval_at).toLocaleString()}
            {head.client_approval_ip ? <> &middot; from {head.client_approval_ip}</> : null}
            {head.client_approval_version != null ? (
              <> &middot; against snapshot v{head.client_approval_version}</>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Not approved yet.
        </p>
      )}
    </>
  );
}

// Shared null-safe merge for payload fields. Mirrors the pick helper
// in pch-accountant-view.tsx: an incoming undefined means "no update
// for this column"; an explicit null means "set to null".
function pick<T>(incoming: unknown, prev: T): T {
  if (incoming === undefined) return prev;
  return incoming as T;
}
