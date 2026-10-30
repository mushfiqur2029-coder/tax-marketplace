"use server";

// Phase I accountant-side P&L review surface. Three concerns:
//
//   editAccountantIncomeLineAction / editAccountantExpenseLineAction
//     Overwrite one row's amount, stamp edited_by + edited_at, re-run
//     the engine so the panel can show live totals under the table.
//     Returns the fresh snapshot so the caller doesn't need a second
//     round-trip.
//
//   confirmPlAction
//     Lock the figures: set pl_confirmed_at + pl_confirmed_by, run the
//     engine once more, and persist the result on pch_cases.engine_
//     snapshot / engine_snapshot_at. This is the moment the "P&L
//     confirmed" chip flips green and the Final Documents panel below
//     unlocks.
//
//   reopenPlAction
//     Clear pl_confirmed_at + pl_confirmed_by so the panel re-enables
//     editing. Does not clear engine_snapshot; the figures stay valid
//     until the next edit, same tradeoff the client's own
//     Submit-for-review flow makes.
//
// Everything routes through requireAccountantPchCase so a client or an
// unassigned accountant can't call these from a stale tab.

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireRole, assertNotSuspended } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAll, type TaxEngineOutput } from "@/lib/tax-engine";
import { hydrateInputsFromDb } from "@/lib/pch/engine-snapshot";
import {
  getExpenseSlotByLabel,
  getIncomeSlotByLabel,
} from "@/lib/pch/intake-slots";

type ActionOk = { ok: true };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;
type ActionResultWith<T> = (ActionOk & T) | ActionErr;

async function requireAccountantPchCase(caseId: string) {
  const me = await requireRole("accountant");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cases")
    .select("id, client_id, accountant_id, status, tier")
    .eq("id", caseId)
    .single();
  if (error || !data) throw new Error("Case not found.");
  if (data.accountant_id !== me.id) {
    throw new Error("This case is assigned to a different accountant.");
  }
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  assertNotSuspended(me.status, "work on this case");
  return { me, admin, caseRow: data };
}

async function assertPlEditable(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
): Promise<ActionErr | null> {
  // Once the P&L is confirmed the panel locks; the only way back in is
  // reopenPlAction. The guard mirrors that visually, so a stale tab or
  // a race between two accountants can't sneak an edit through.
  const { data, error } = await admin
    .from("pch_cases")
    .select("pl_confirmed_at")
    .eq("case_id", caseId)
    .single();
  if (error) return { ok: false, error: error.message };
  if (data?.pl_confirmed_at) {
    return {
      ok: false,
      error: "P&L is confirmed. Re-open it before editing lines.",
    };
  }
  return null;
}

async function runEngine(
  caseId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<TaxEngineOutput> {
  const inputs = await hydrateInputsFromDb(caseId, admin);
  return computeAll(inputs);
}

export async function editAccountantIncomeLineAction(
  caseId: string,
  lineId: string,
  grossTakingsPence: number,
): Promise<ActionResultWith<{ snapshot: TaxEngineOutput }>> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const value = Math.max(0, Math.round(grossTakingsPence));
    const upd = await admin
      .from("pch_income_lines")
      .update({
        gross_takings_pence: value,
        edited_by: me.id,
        edited_at: new Date().toISOString(),
      })
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, snapshot };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function editAccountantExpenseLineAction(
  caseId: string,
  lineId: string,
  amountPaidPence: number,
): Promise<ActionResultWith<{ snapshot: TaxEngineOutput }>> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const value = Math.max(0, Math.round(amountPaidPence));
    const upd = await admin
      .from("pch_expense_lines")
      .update({
        amount_paid_pence: value,
        edited_by: me.id,
        edited_at: new Date().toISOString(),
      })
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, snapshot };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function confirmPlAction(
  caseId: string,
): Promise<ActionResultWith<{ snapshot: TaxEngineOutput; confirmedAt: string }>> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);

    const snapshot = await runEngine(caseId, admin);
    const now = new Date().toISOString();
    const upd = await admin
      .from("pch_cases")
      .update({
        pl_confirmed_at: now,
        pl_confirmed_by: me.id,
        engine_snapshot: snapshot,
        engine_snapshot_at: now,
      })
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };

    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, snapshot, confirmedAt: now };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Confirm failed." };
  }
}

export async function reopenPlAction(caseId: string): Promise<ActionResult> {
  try {
    const { admin } = await requireAccountantPchCase(caseId);
    const upd = await admin
      .from("pch_cases")
      .update({ pl_confirmed_at: null, pl_confirmed_by: null })
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reopen failed." };
  }
}

// -------------------------------------------------------------------
// Phase M+3: accountant-side add/delete for extra P&L rows beyond the
// fixed slot list. The client intake is deliberately fixed-slot (Phase
// J removed freeform add on the client side on purpose); this is an
// accountant-only escape hatch for an adjustment or a line the client
// mentioned over email but had no box for.
//
// Same guards as the edit actions:
//   - requireAccountantPchCase (role + case ownership + tier)
//   - assertPlEditable (locked once pl_confirmed_at is set)
//
// Add actions return BOTH the new line (so the client can append to
// local state) AND the fresh engine snapshot (so the totals strip +
// summary panel re-render without a second round-trip).
// -------------------------------------------------------------------

const EXPENSE_DEFAULT_CATEGORY = "Other expenses";
const EXPENSE_DEFAULT_SA103S_BOX = 19;
const EXPENSE_DEFAULT_CAR_COST = "No";

async function nextSortOrder(
  admin: ReturnType<typeof createAdminClient>,
  table: "pch_income_lines" | "pch_expense_lines",
  caseId: string,
): Promise<number> {
  const { data } = await admin
    .from(table)
    .select("sort_order")
    .eq("case_id", caseId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.sort_order as number | undefined) ?? -1) + 1;
}

function cleanLabel(label: string): string | null {
  const trimmed = (label ?? "").trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 200) return trimmed.slice(0, 200);
  return trimmed;
}

export async function addAccountantIncomeLineAction(
  caseId: string,
  label: string,
  grossTakingsPence: number,
): Promise<
  ActionResultWith<{
    snapshot: TaxEngineOutput;
    line: {
      id: string;
      source: string;
      gross_takings_pence: number;
    };
  }>
> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const cleanedLabel = cleanLabel(label);
    if (!cleanedLabel) return { ok: false, error: "Enter a label for this row." };
    const pence = Math.max(0, Math.round(grossTakingsPence));

    const sortOrder = await nextSortOrder(admin, "pch_income_lines", caseId);
    const now = new Date().toISOString();
    const ins = await admin
      .from("pch_income_lines")
      .insert({
        case_id: caseId,
        source: cleanedLabel,
        gross_takings_pence: pence,
        platform_fee_pence: 0,
        on_trip_miles: 0,
        dead_miles: 0,
        // "Other" (not "Fares") so the engine routes this into
        // pl.rows.otherTrading rather than fares; a free-text accountant
        // adjustment isn't a platform fare line.
        line_type: "Other",
        edited_by: me.id,
        edited_at: now,
        sort_order: sortOrder,
      })
      .select("id, source, gross_takings_pence")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return {
      ok: true,
      snapshot,
      line: {
        id: ins.data.id as string,
        source: ins.data.source as string,
        gross_takings_pence: Number(ins.data.gross_takings_pence ?? 0),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Add failed." };
  }
}

export async function addAccountantExpenseLineAction(
  caseId: string,
  label: string,
  amountPaidPence: number,
): Promise<
  ActionResultWith<{
    snapshot: TaxEngineOutput;
    line: {
      id: string;
      label: string;
      amount_paid_pence: number;
    };
  }>
> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const cleanedLabel = cleanLabel(label);
    if (!cleanedLabel) return { ok: false, error: "Enter a label for this row." };
    const pence = Math.max(0, Math.round(amountPaidPence));

    const sortOrder = await nextSortOrder(admin, "pch_expense_lines", caseId);
    const now = new Date().toISOString();
    const ins = await admin
      .from("pch_expense_lines")
      .insert({
        case_id: caseId,
        label: cleanedLabel,
        amount_paid_pence: pence,
        // "Other expense" slot defaults from section-3-expenses.tsx's
        // FIXED_SLOTS: closest existing bucket for an uncategorised line.
        category: EXPENSE_DEFAULT_CATEGORY,
        sa103s_box: EXPENSE_DEFAULT_SA103S_BOX,
        car_cost: EXPENSE_DEFAULT_CAR_COST,
        edited_by: me.id,
        edited_at: now,
        sort_order: sortOrder,
      })
      .select("id, label, amount_paid_pence")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return {
      ok: true,
      snapshot,
      line: {
        id: ins.data.id as string,
        label: ins.data.label as string,
        amount_paid_pence: Number(ins.data.amount_paid_pence ?? 0),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Add failed." };
  }
}

export async function deleteAccountantLineAction(
  caseId: string,
  table: "income" | "expense",
  lineId: string,
): Promise<ActionResultWith<{ snapshot: TaxEngineOutput }>> {
  try {
    const { admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const tableName = table === "income" ? "pch_income_lines" : "pch_expense_lines";
    const del = await admin
      .from(tableName)
      .delete()
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (del.error) return { ok: false, error: del.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, snapshot };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

// Plain evidence upload for an accountant-added row. Routes through
// the existing single-evidence-column pattern on pch_income_lines /
// pch_expense_lines (both tables have an evidence column that holds
// one storage path). No OCR auto-read: the accountant typed the
// amount, we trust it, and the file is just a reference the client
// / audit trail can open later.
export async function uploadAccountantLineEvidenceAction(
  caseId: string,
  table: "income" | "expense",
  lineId: string,
  formData: FormData,
): Promise<ActionResultWith<{ path: string }>> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Pick a file first." };
    }
    const MAX = 25 * 1024 * 1024;
    if (file.size > MAX) return { ok: false, error: "File is over 25 MB." };

    const typeLower = (file.type || "").toLowerCase();
    const nameLower = file.name.toLowerCase();
    const isPdf = typeLower === "application/pdf" || nameLower.endsWith(".pdf");
    const isJpeg = typeLower === "image/jpeg" || /\.jpe?g$/.test(nameLower);
    const isPng = typeLower === "image/png" || /\.png$/.test(nameLower);
    const isWebp = typeLower === "image/webp" || /\.webp$/.test(nameLower);
    if (!isPdf && !isJpeg && !isPng && !isWebp) {
      return { ok: false, error: "Upload a PDF, JPG, PNG or WebP." };
    }

    const tableName = table === "income" ? "pch_income_lines" : "pch_expense_lines";
    const requirementKey =
      table === "income"
        ? `pl-accountant-income-${lineId}`
        : `pl-accountant-expense-${lineId}`;

    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${caseId}/pl-accountant/${requirementKey}-${randomUUID()}-${safe}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await admin.storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, error: "Upload failed: " + up.error.message };

    const docIns = await admin.from("case_documents").insert({
      case_id: caseId,
      uploaded_by: me.id,
      file_name: file.name,
      file_url: path,
      requirement_key: requirementKey,
    });
    if (docIns.error) return { ok: false, error: docIns.error.message };

    // Stamp the storage path on the line row's evidence column so the
    // accountant can jump straight from the P&L edit grid to the file.
    const upd = await admin
      .from(tableName)
      .update({ evidence: path })
      .eq("id", lineId)
      .eq("case_id", caseId);
    if (upd.error) return { ok: false, error: upd.error.message };

    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

// -------------------------------------------------------------------
// Fixed-slot row creation. The P&L review grid synthesises placeholder
// rows (id=null) for any FIXED_SLOTS label that doesn't yet have a
// pch_income_lines / pch_expense_lines row - typically because the
// client left the field blank or at £0 during intake. When the
// accountant types a non-zero amount into one of those placeholders,
// the UI calls one of these actions (not add{Income,Expense}LineAction
// which classifies as freeform "Other").
//
// Critical: classification params for an expense row come from the
// slot definition in @/lib/pch/intake-slots. Mis-defaulting any of
// category / sa103s_box / car_cost would misclassify the expense
// into the wrong SA103S box and corrupt the category rollup used in
// the PCH Accounts PDF and the tax engine.
// -------------------------------------------------------------------

export async function createAccountantFixedIncomeLineAction(
  caseId: string,
  slotLabel: string,
  grossTakingsPence: number,
): Promise<
  ActionResultWith<{
    snapshot: TaxEngineOutput;
    line: { id: string; source: string; gross_takings_pence: number };
  }>
> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const slot = getIncomeSlotByLabel(slotLabel);
    if (!slot) {
      return { ok: false, error: `Unknown income slot: ${slotLabel}` };
    }
    const pence = Math.max(0, Math.round(grossTakingsPence));
    const sortOrder = await nextSortOrder(admin, "pch_income_lines", caseId);
    const now = new Date().toISOString();
    const ins = await admin
      .from("pch_income_lines")
      .insert({
        case_id: caseId,
        source: slot.label,
        gross_takings_pence: pence,
        platform_fee_pence: 0,
        on_trip_miles: 0,
        dead_miles: 0,
        // "Fares" matches what the client-side upsertPchIncomeLine
        // Action uses for all five fixed slots, so a row the
        // accountant creates in a placeholder is indistinguishable
        // from a row the client would have created themselves.
        line_type: "Fares",
        edited_by: me.id,
        edited_at: now,
        sort_order: sortOrder,
      })
      .select("id, source, gross_takings_pence")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return {
      ok: true,
      snapshot,
      line: {
        id: ins.data.id as string,
        source: ins.data.source as string,
        gross_takings_pence: Number(ins.data.gross_takings_pence ?? 0),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed." };
  }
}

export async function createAccountantFixedExpenseLineAction(
  caseId: string,
  slotLabel: string,
  amountPaidPence: number,
): Promise<
  ActionResultWith<{
    snapshot: TaxEngineOutput;
    line: { id: string; label: string; amount_paid_pence: number };
  }>
> {
  try {
    const { me, admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const slot = getExpenseSlotByLabel(slotLabel);
    if (!slot) {
      return { ok: false, error: `Unknown expense slot: ${slotLabel}` };
    }
    const pence = Math.max(0, Math.round(amountPaidPence));
    const sortOrder = await nextSortOrder(admin, "pch_expense_lines", caseId);
    const now = new Date().toISOString();
    const ins = await admin
      .from("pch_expense_lines")
      .insert({
        case_id: caseId,
        label: slot.label,
        amount_paid_pence: pence,
        // Per-slot classification from EXPENSE_FIXED_SLOTS. See the
        // header comment on this block: these three fields are the
        // whole point of having a slot-specific action instead of
        // reusing addAccountantExpenseLineAction.
        category: slot.category,
        sa103s_box: slot.sa103s_box,
        car_cost: slot.car_cost,
        edited_by: me.id,
        edited_at: now,
        sort_order: sortOrder,
      })
      .select("id, label, amount_paid_pence")
      .single();
    if (ins.error) return { ok: false, error: ins.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return {
      ok: true,
      snapshot,
      line: {
        id: ins.data.id as string,
        label: ins.data.label as string,
        amount_paid_pence: Number(ins.data.amount_paid_pence ?? 0),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed." };
  }
}

// -------------------------------------------------------------------
// Private use (pch_vehicle.private_use_amount_pence). Phase M+5
// wiring: this figure now feeds taxable profit via buildPL (and
// through to computeTax, the SA302, and the PCH Accounts PDF), so
// an edit must re-run the engine so the stored snapshot and the
// Summary row re-render in step.
//
// Shape mirrors the edit actions above: same guard, same lock.
// Returns the fresh TaxEngineOutput so the caller doesn't need a
// second round-trip.
// -------------------------------------------------------------------

export async function editAccountantPrivateUseAction(
  caseId: string,
  amountPence: number,
): Promise<
  ActionResultWith<{ snapshot: TaxEngineOutput; amountPence: number }>
> {
  try {
    const { admin } = await requireAccountantPchCase(caseId);
    const locked = await assertPlEditable(admin, caseId);
    if (locked) return locked;

    const value = Math.max(0, Math.round(amountPence));
    // Upsert because pch_vehicle may not have a row yet (client never
    // filled the vehicle section); upsertPchVehicleFieldAction on the
    // client side uses the same pattern.
    const upsert = await admin
      .from("pch_vehicle")
      .upsert(
        {
          case_id: caseId,
          private_use_amount_pence: value,
          // Keep the derived boolean flag in step; the client's own
          // savePchVehicleFieldAction does this too.
          private_use_declared: value > 0,
        },
        { onConflict: "case_id" },
      );
    if (upsert.error) return { ok: false, error: upsert.error.message };

    const snapshot = await runEngine(caseId, admin);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, snapshot, amountPence: value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
