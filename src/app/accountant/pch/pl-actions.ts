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
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAll, type TaxEngineOutput } from "@/lib/tax-engine";
import { hydrateInputsFromDb } from "@/lib/pch/engine-snapshot";

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
