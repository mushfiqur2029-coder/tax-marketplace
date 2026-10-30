"use server";

// Client-side actions for the AI-extraction review workflow.
//
// Each uploaded PCH doc gets a pch_doc_extractions row (populated by
// slice D). The client reviews each extracted field and marks it
// 'accepted', 'edited' (with an override value), or 'rejected'. The
// mapping registry in extraction-apply.ts turns accepted + edited
// fields into writes against the intake tables.
//
// Each click of Confirm/Edit auto-applies: it patches the field state
// then re-runs the apply pass, so the identity + intake tables stay in
// lockstep with what the client just confirmed. Rejected fields are
// left as a signal that the doc should be re-uploaded or the value
// entered manually; nothing is written for them.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SLOT_APPLY_MAPS,
  coerceValueForTarget,
  type ApplyTarget,
} from "@/lib/pch/extraction-apply";

type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;

type FieldState = {
  status: "proposed" | "accepted" | "edited" | "rejected";
  overrideValue?: string | number | null;
  actedAt?: string;
  actedBy?: string;
};
type FieldStates = Record<string, FieldState>;

async function requireClientForExtraction(extractionId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const { data: ext } = await admin
    .from("pch_doc_extractions")
    .select("id, case_id, slot_code, fields, field_states")
    .eq("id", extractionId)
    .single();
  if (!ext) throw new Error("Extraction not found.");
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, status, tier")
    .eq("id", ext.case_id)
    .single();
  if (!caseRow || caseRow.client_id !== me.id) throw new Error("Not your case.");
  if (caseRow.tier !== "uber_phv_automated") throw new Error("Not a PCH case.");
  // Primary lock: migration 0119's intake_submitted_at flag, same gate
  // requirePchIntakeEditable (intake-actions.ts) uses for every other
  // intake-mutating action. cases.status alone isn't enough here - it
  // stays 'submitted' for the whole filling period, so a client who has
  // clicked "Submit for review" (locking intake_submitted_at) but whose
  // case an accountant hasn't claimed yet would otherwise still pass
  // the status-only check below and be able to mutate pch_cases/
  // pch_vehicle/income/expense lines through this review workflow after
  // the accountant's snapshot is supposed to be stable.
  const { data: pchHead } = await admin
    .from("pch_cases")
    .select("intake_submitted_at")
    .eq("case_id", ext.case_id)
    .maybeSingle();
  if (pchHead?.intake_submitted_at) {
    throw new Error(
      "Your return is submitted and locked. Message your accountant if something needs to change.",
    );
  }
  // Match the same edit lock as the main intake actions: stays open
  // through submitted / in_review / prepared so the client can keep
  // confirming or correcting extracted fields even after an accountant
  // has taken the case, locked only from client_approval onward.
  if (
    caseRow.status !== "submitted" &&
    caseRow.status !== "in_review" &&
    caseRow.status !== "prepared"
  ) {
    throw new Error("This return has already moved to the approval stage. Message your accountant if something needs to change.");
  }
  return { me, ext, caseRow };
}

async function patchFieldState(
  extractionId: string,
  fieldKey: string,
  patch: Partial<FieldState>,
): Promise<ActionResult> {
  const { me, ext } = await requireClientForExtraction(extractionId);
  const admin = createAdminClient();
  const states = (ext.field_states ?? {}) as FieldStates;
  states[fieldKey] = {
    ...(states[fieldKey] ?? { status: "proposed" }),
    ...patch,
    actedAt: new Date().toISOString(),
    actedBy: me.id,
  };
  const { error } = await admin
    .from("pch_doc_extractions")
    .update({ field_states: states })
    .eq("id", extractionId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/cases/${ext.case_id}/pch`);
  return { ok: true };
}

export async function acceptPchExtractionFieldAction(
  extractionId: string,
  fieldKey: string,
): Promise<ActionResult> {
  const r = await patchFieldState(extractionId, fieldKey, { status: "accepted", overrideValue: undefined });
  if (!r.ok) return r;
  // Auto-apply so the identity/intake tables reflect the confirmed
  // value immediately. The apply pass is idempotent (patch head, upsert
  // vehicle, delete+insert income/expense by source/label) so re-running
  // it on each confirm is safe.
  return applyPchExtractionAction(extractionId);
}

export async function editPchExtractionFieldAction(
  extractionId: string,
  fieldKey: string,
  newValue: string | number | null,
): Promise<ActionResult> {
  const r = await patchFieldState(extractionId, fieldKey, { status: "edited", overrideValue: newValue });
  if (!r.ok) return r;
  return applyPchExtractionAction(extractionId);
}

export async function rejectPchExtractionFieldAction(
  extractionId: string,
  fieldKey: string,
): Promise<ActionResult> {
  return patchFieldState(extractionId, fieldKey, { status: "rejected", overrideValue: undefined });
}

// Apply every 'accepted' + 'edited' field to the correct intake row.
// Rejected fields are deliberately skipped so the client has to type
// them manually (or re-upload the doc). Fields the mapping marks as
// 'none' (sanity checks, informational data) are never written.
export async function applyPchExtractionAction(
  extractionId: string,
): Promise<ActionResult> {
  const { ext, caseRow } = await requireClientForExtraction(extractionId);
  const applyMap = SLOT_APPLY_MAPS[ext.slot_code];
  if (!applyMap) {
    return { ok: false, error: "No apply mapping for slot " + ext.slot_code };
  }
  const admin = createAdminClient();
  const fields = (ext.fields ?? {}) as Record<string, { value: unknown; confidence: string; note: string } | undefined>;
  const states = (ext.field_states ?? {}) as FieldStates;

  // Group writes by target table + row so we can issue one upsert per
  // destination instead of a round-trip per field.
  const headPatch: Record<string, unknown> = {};
  const vehiclePatch: Record<string, unknown> = {};
  const incomeRows = new Map<string, { source: string; patch: Record<string, unknown> }>();
  const expenseRows = new Map<string, { label: string; patch: Record<string, unknown> }>();

  for (const [fieldKey, target] of Object.entries(applyMap.targets)) {
    const state = states[fieldKey];
    if (!state || (state.status !== "accepted" && state.status !== "edited")) continue;
    if (target.table === "none") continue;
    const raw = state.status === "edited" ? state.overrideValue : fields[fieldKey]?.value;
    const value = coerceValueForTarget(raw, (target as { transform?: "pounds_to_pence" | "integer" | "yes_no_boolean" }).transform);
    if (value === null) continue;
    writeToTarget(target, fieldKey, value, { headPatch, vehiclePatch, incomeRows, expenseRows });
  }

  // Issue the writes.
  if (Object.keys(headPatch).length > 0) {
    const { error } = await admin.from("pch_cases").update(headPatch).eq("case_id", caseRow.id);
    if (error) return { ok: false, error: "pch_cases: " + error.message };
  }
  if (Object.keys(vehiclePatch).length > 0) {
    const { error } = await admin
      .from("pch_vehicle")
      .upsert({ case_id: caseRow.id, ...vehiclePatch }, { onConflict: "case_id" });
    if (error) return { ok: false, error: "pch_vehicle: " + error.message };
  }
  for (const [rowKey, { source, patch }] of incomeRows) {
    // Replace-by-source: delete existing rows with the same source
    // (e.g. "Uber" from a prior extraction) then insert the fresh one.
    // Keeps the pch_income_lines list idempotent per re-upload.
    await admin.from("pch_income_lines")
      .delete()
      .eq("case_id", caseRow.id)
      .eq("source", source);
    const { error } = await admin.from("pch_income_lines").insert({
      case_id: caseRow.id,
      source,
      line_type: "Fares",
      sort_order: 0,
      gross_takings_pence: 0,
      platform_fee_pence: 0,
      on_trip_miles: 0,
      dead_miles: 0,
      ...patch,
    });
    if (error) return { ok: false, error: "pch_income_lines[" + rowKey + "]: " + error.message };
  }
  for (const [rowKey, { label, patch }] of expenseRows) {
    await admin.from("pch_expense_lines")
      .delete()
      .eq("case_id", caseRow.id)
      .eq("label", label);
    const { error } = await admin.from("pch_expense_lines").insert({
      case_id: caseRow.id,
      label,
      category: defaultCategoryForExpenseRow(rowKey),
      car_cost: defaultCarCostForExpenseRow(rowKey),
      sa103s_box: defaultBoxForExpenseRow(rowKey),
      amount_paid_pence: 0,
      sort_order: 0,
      ...patch,
    });
    if (error) return { ok: false, error: "pch_expense_lines[" + rowKey + "]: " + error.message };
  }

  revalidatePath(`/client/cases/${caseRow.id}/pch`);
  return { ok: true };
}

type WriteGroups = {
  headPatch: Record<string, unknown>;
  vehiclePatch: Record<string, unknown>;
  incomeRows: Map<string, { source: string; patch: Record<string, unknown> }>;
  expenseRows: Map<string, { label: string; patch: Record<string, unknown> }>;
};

function writeToTarget(
  target: ApplyTarget,
  fieldKey: string,
  value: unknown,
  groups: WriteGroups,
): void {
  switch (target.table) {
    case "pch_cases":
      groups.headPatch[target.column] = value;
      return;
    case "pch_vehicle":
      groups.vehiclePatch[target.column] = value;
      return;
    case "pch_income_lines": {
      const key = target.row;
      const current = groups.incomeRows.get(key) ?? {
        source: defaultSourceForIncomeRow(key),
        patch: {},
      };
      // If the extracted field maps to the row's `source` column,
      // honour the extracted value (e.g. "Uber" vs "Bolt") so the
      // delete-by-source replace key is consistent with what gets
      // inserted.
      if (target.column === "source") current.source = String(value);
      else current.patch[target.column] = value;
      groups.incomeRows.set(key, current);
      return;
    }
    case "pch_expense_lines": {
      const key = target.row;
      const current = groups.expenseRows.get(key) ?? {
        label: defaultLabelForExpenseRow(key),
        patch: {},
      };
      current.patch[target.column] = value;
      groups.expenseRows.set(key, current);
      return;
    }
    case "none":
      return;
    default:
      void fieldKey;
      return;
  }
}

function defaultSourceForIncomeRow(key: string): string {
  switch (key) {
    case "primary_platform": return "Primary platform";
    case "weekly": return "Weekly statements";
    case "cash": return "Cash + account work";
    default: return key;
  }
}
function defaultLabelForExpenseRow(key: string): string {
  switch (key) {
    case "insurance": return "Insurance";
    case "finance_interest": return "Finance interest";
    case "rental": return "PCO rental";
    case "fuel": return "Fuel";
    case "repairs": return "Repairs and servicing";
    case "tolls_parking": return "Congestion, ULEZ and parking";
    case "licence": return "Licence fees";
    case "phone": return "Mobile phone";
    default: return key;
  }
}
function defaultCategoryForExpenseRow(key: string): string {
  switch (key) {
    case "insurance": return "Accountancy & insurance";
    case "finance_interest": return "Finance & bank charges";
    case "rental": return "Vehicle hire, lease & finance";
    case "fuel": return "Vehicle running costs";
    case "repairs": return "Vehicle running costs";
    case "tolls_parking": return "Congestion, ULEZ, tolls & parking";
    case "licence": return "Licences & compliance";
    case "phone": return "Phone & technology";
    default: return "Other expenses";
  }
}
function defaultCarCostForExpenseRow(key: string): "Yes" | "No" | "Phone" {
  switch (key) {
    case "fuel":
    case "repairs":
    case "tolls_parking":
    case "rental":
    case "insurance":
    case "finance_interest":
      return "Yes";
    case "phone":
      return "Phone";
    default:
      return "No";
  }
}
function defaultBoxForExpenseRow(key: string): 12 | 14 | 16 | 17 | 18 | 19 {
  switch (key) {
    case "fuel":
    case "repairs":
    case "tolls_parking":
    case "rental":
      return 12;
    case "insurance":
      return 14;
    case "finance_interest":
      return 17;
    case "phone":
      return 18;
    case "licence":
    default:
      return 19;
  }
}
