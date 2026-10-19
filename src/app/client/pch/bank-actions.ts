"use server";

// Phase 6 Slice 3: server actions backing the ledger + clarify chat.
//
// Three jobs, each tightly scoped:
//
//   nextBankClarifyTargetAction, DB-only: finds the top-priority
//      transaction that still needs the client's input. Priority order:
//        1. category IS NULL (parser or AI couldn't tag it)
//        2. category = 'uncategorized' (AI explicitly deferred)
//        3. category_confidence = 'low' (AI guessed; worth checking)
//      Within each tier, oldest txn_date first so the client works
//      through the statement chronologically.
//
//   recordBankClarifyAnswerAction, AI call: re-categorises a single
//      transaction using the user's free-text answer, then rewrites
//      pch_bank_transactions.category + re-aggregates pch_income_lines
//      / pch_expense_lines so the ledger view refreshes correctly.
//
//   setBankTransactionCategoryAction, DB-only: direct category edit
//      from the ledger table UI. Same aggregation refresh.
//
// Edit lock: all three refuse once the case has left 'submitted'.
// Mirrors the lock pattern already used by other client actions.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { categorizeBankTransactions } from "@/lib/pch/bank-categorize";
import { aggregateBankLedger } from "@/lib/pch/bank-aggregate";
import { isValidCategoryKey, categoryByKey } from "@/lib/pch/bank-categories";

type ActionOk<T = Record<never, never>> = { ok: true } & T;
type ActionErr = { ok: false; error: string };
type ActionResult<T = Record<never, never>> = ActionOk<T> | ActionErr;

async function requireClientPchCase(caseId: string) {
  const me = await requireRole("client");
  const admin = createAdminClient();
  const { data } = await admin
    .from("cases")
    .select("id, client_id, status, tier")
    .eq("id", caseId)
    .single();
  if (!data) throw new Error("Case not found.");
  if (data.client_id !== me.id) throw new Error("Not your case.");
  if (data.tier !== "uber_phv_automated") {
    throw new Error("Not a PCH automated case.");
  }
  return { me, caseRow: data, admin };
}

function assertEditable(status: string): ActionErr | null {
  if (status === "submitted") return null;
  return {
    ok: false,
    error:
      "Your return is already with your accountant. Message them if something needs to change.",
  };
}

// -------------------------------------------------------------------
// (1) Pick the next transaction that needs the client's input.
// -------------------------------------------------------------------
export type ClarifyTarget = {
  id: string;
  txnDate: string | null;
  description: string;
  amountPence: number;
  currentCategory: string | null;
  currentConfidence: "high" | "medium" | "low" | "missing" | null;
  currentNote: string | null;
};

export async function nextBankClarifyTargetAction(
  caseId: string,
): Promise<ActionResult<{ target: ClarifyTarget | null }>> {
  try {
    const { admin } = await requireClientPchCase(caseId);
    // Priority 1: category IS NULL (parser produced the row, categoriser
    // never got to it or crashed mid-batch).
    const nullRow = await admin
      .from("pch_bank_transactions")
      .select("id, txn_date, description, amount_pence, category, category_confidence, category_note")
      .eq("case_id", caseId)
      .is("category", null)
      .order("txn_date", { ascending: true, nullsFirst: true })
      .limit(1);
    if (nullRow.data && nullRow.data.length > 0) {
      return { ok: true, target: toTarget(nullRow.data[0]) };
    }
    // Priority 2: AI explicitly deferred ('uncategorized').
    const uncatRow = await admin
      .from("pch_bank_transactions")
      .select("id, txn_date, description, amount_pence, category, category_confidence, category_note")
      .eq("case_id", caseId)
      .eq("category", "uncategorized")
      .order("txn_date", { ascending: true, nullsFirst: true })
      .limit(1);
    if (uncatRow.data && uncatRow.data.length > 0) {
      return { ok: true, target: toTarget(uncatRow.data[0]) };
    }
    // Priority 3: low confidence.
    const lowRow = await admin
      .from("pch_bank_transactions")
      .select("id, txn_date, description, amount_pence, category, category_confidence, category_note")
      .eq("case_id", caseId)
      .eq("category_confidence", "low")
      .order("txn_date", { ascending: true, nullsFirst: true })
      .limit(1);
    if (lowRow.data && lowRow.data.length > 0) {
      return { ok: true, target: toTarget(lowRow.data[0]) };
    }
    return { ok: true, target: null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to pick the next transaction.",
    };
  }
}

type Row = {
  id: string;
  txn_date: string | null;
  description: string;
  amount_pence: number;
  category: string | null;
  category_confidence: string | null;
  category_note: string | null;
};

function toTarget(r: Row): ClarifyTarget {
  const conf = r.category_confidence;
  return {
    id: r.id,
    txnDate: r.txn_date,
    description: r.description,
    amountPence: r.amount_pence,
    currentCategory: r.category,
    currentConfidence:
      conf === "high" || conf === "medium" || conf === "low" || conf === "missing"
        ? conf
        : null,
    currentNote: r.category_note,
  };
}

// -------------------------------------------------------------------
// (2) The client answered a clarify prompt. Re-categorise the single
//     transaction with the extra context, then re-aggregate so the
//     ledger view is up to date.
// -------------------------------------------------------------------
export async function recordBankClarifyAnswerAction(
  caseId: string,
  transactionId: string,
  answer: string,
): Promise<ActionResult<{ newCategory: string; newConfidence: string }>> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    const trimmedAnswer = (answer ?? "").trim();
    if (trimmedAnswer.length === 0) {
      return { ok: false, error: "Write a short answer first." };
    }
    // Fetch the row to re-send to the AI with the extra context.
    const { data: txn } = await admin
      .from("pch_bank_transactions")
      .select("id, txn_date, description, amount_pence")
      .eq("id", transactionId)
      .eq("case_id", caseId)
      .single();
    if (!txn) return { ok: false, error: "Transaction not found." };

    const re = await categorizeBankTransactions([
      {
        id: txn.id,
        txnDate: txn.txn_date,
        description: `${txn.description}\n\n[Client clarification: ${trimmedAnswer}]`,
        amountPence: txn.amount_pence,
      },
    ]);
    const picked = re[0];
    if (!picked) {
      return {
        ok: false,
        error: "The AI didn't return a category. Try describing the transaction more plainly.",
      };
    }

    const { error: upErr } = await admin
      .from("pch_bank_transactions")
      .update({
        category: picked.categoryKey,
        category_confidence: picked.confidence,
        category_note: picked.note + " [after client clarification]",
        category_edited_by: me.id,
        category_edited_at: new Date().toISOString(),
      })
      .eq("id", transactionId);
    if (upErr) return { ok: false, error: upErr.message };

    await aggregateBankLedger(caseId);
    revalidatePath(`/client/cases/${caseId}/pch`);
    return {
      ok: true,
      newCategory: picked.categoryKey,
      newConfidence: picked.confidence,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not record your answer.",
    };
  }
}

// -------------------------------------------------------------------
// (3) Direct category edit from the ledger table (no AI).
// -------------------------------------------------------------------
export async function setBankTransactionCategoryAction(
  caseId: string,
  transactionId: string,
  categoryKey: string,
): Promise<ActionResult> {
  try {
    const { me, caseRow, admin } = await requireClientPchCase(caseId);
    const lock = assertEditable(caseRow.status);
    if (lock) return lock;
    if (!isValidCategoryKey(categoryKey)) {
      return { ok: false, error: "Unknown category." };
    }
    const def = categoryByKey(categoryKey);
    if (!def) return { ok: false, error: "Unknown category." };
    const { error } = await admin
      .from("pch_bank_transactions")
      .update({
        category: categoryKey,
        category_confidence: "high",
        category_note: "Set by client via ledger edit.",
        category_edited_by: me.id,
        category_edited_at: new Date().toISOString(),
      })
      .eq("id", transactionId)
      .eq("case_id", caseId);
    if (error) return { ok: false, error: error.message };
    await aggregateBankLedger(caseId);
    revalidatePath(`/client/cases/${caseId}/pch`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update category.",
    };
  }
}
