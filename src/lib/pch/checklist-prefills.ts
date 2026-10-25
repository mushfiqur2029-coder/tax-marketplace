// Shim retained after the client intake rebuild (migration 0113)
// stripped the AI interview + bank-parse pipelines that used to
// populate 20 of the 33 accountant checklist items.
//
// The accountant workspace still mounts its checklist with pre-fill
// support (`checkPrefills` prop on PchAccountantView, consumed by the
// per-row Confirm button to copy the AI's verdict into
// pch_check_status.note). This stub keeps the exported type and the
// derive signature intact so the accountant page compiles and renders
// with every item as "unfilled" (same manual Done/N/A buttons the 13
// non-auto items always had).
//
// Replacing this will be the accountant-portal side's call: either
// re-derive items from the typed intake data (head columns + income
// lines + expense lines + vehicle + gift-aid entries), or drop the
// auto-pre-fill feature altogether now that the client is the source
// of truth for every figure.

import type { createAdminClient } from "@/lib/supabase/admin";
import type { Anomaly } from "@/lib/pch/prior-year-anomalies";

export type ChecklistPrefillVerdict = "pass" | "warn" | "nothing_to_show";

export type ChecklistPrefill = {
  item: number;
  verdict: ChecklistPrefillVerdict;
  evidence: string;
  derivedAt: string;
};

export type ChecklistDerivationContext = {
  anomalies?: Anomaly[];
};

export async function deriveChecklistPrefills(
  _caseId: string,
  _admin: ReturnType<typeof createAdminClient>,
  _context?: ChecklistDerivationContext,
): Promise<Map<number, ChecklistPrefill>> {
  void _caseId; void _admin; void _context;
  return new Map();
}
