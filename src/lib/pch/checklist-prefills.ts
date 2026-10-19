// Phase 7 Slice 7.4: server-side entry point for the 33-point checklist
// pre-fill engine. Called on each accountant workspace page load; the
// output is passed through to CheckRow so items classified as kind:auto
// render with their AI-derived verdict + evidence string + a one-click
// Confirm button.
//
// Slice 7.4 ships the stub (returns an empty Map). Slice 7.5 fills in
// the per-item derivation logic cluster by cluster. The UI already
// renders kind-aware shells so an empty map is a safe no-op: auto rows
// fall through to a "AI could not derive this, review manually"
// fallback and the accountant uses the normal Done/N/A/Reset path.

import type { createAdminClient } from "@/lib/supabase/admin";

export type ChecklistPrefillVerdict = "pass" | "warn" | "nothing_to_show";

export type ChecklistPrefill = {
  item: number;
  verdict: ChecklistPrefillVerdict;
  // One-line human string that renders as "AI answered: X" on the row
  // and gets copied into pch_check_status.note when the accountant
  // hits Confirm (so the audit log carries what the AI said at the
  // time, not just the status change).
  evidence: string;
  derivedAt: string; // ISO
};

export async function deriveChecklistPrefills(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<Map<number, ChecklistPrefill>> {
  // Slice 7.5 fills this with per-item derivation. The 20 auto items
  // (per CHECKLIST_CLASSIFICATION in checklist-classification.ts) each
  // read from one or two shared data sources: pch_cases head columns,
  // pch_income_lines / pch_expense_lines, pch_bank_transactions,
  // pch_vehicle, prior-year engine_snapshot, current engine_snapshot,
  // or sa302_comparison. The derivation code should be pure (no DB
  // writes); the Confirm button is what commits status + note.
  // Params referenced here to keep the signature stable across slices;
  // 7.5 wires them to the per-cluster derivation helpers.
  void caseId;
  void admin;
  return new Map();
}
