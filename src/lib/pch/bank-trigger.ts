import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseBankStatement, type BankInput } from "./bank-parse";
import { categorizeBankTransactions, type CategorizableInput } from "./bank-categorize";
import { aggregateBankLedger, type AggregateResult } from "./bank-aggregate";

// Phase 6 Slice 2: upload-time orchestration for PCH-14 bank statement
// uploads. Called from the client upload action via next/after so the
// upload response is not blocked on the parse + categorise + aggregate
// pipeline (which can take 10 to 60 seconds).
//
// Steps:
//   1. Pull the uploaded file bytes from storage.
//   2. Parse into raw rows (PDF / CSV / XLSX; see bank-parse.ts).
//   3. Insert the raw rows into pch_bank_transactions.
//   4. Categorise each row via Claude (bank-categorize.ts).
//   5. Update each row with its chosen category / confidence / note.
//   6. Aggregate the categorised rows into pch_income_lines +
//      pch_expense_lines (bank-aggregate.ts).
//
// Deliberately crash-safe-ish: each step is tried in order and the
// failure point is logged; partially-processed rows stay in
// pch_bank_transactions (uncategorised, visible to the client in the
// Slice 3 ledger UI, where they can clarify in chat).

export type BankIngestOutcome =
  | {
      ok: true;
      documentId: string;
      parsed: number;
      categorized: number;
      aggregate: AggregateResult;
    }
  | { ok: false; documentId: string; stage: BankIngestStage; error: string };

export type BankIngestStage =
  | "fetch_file"
  | "parse"
  | "insert_raw"
  | "categorize"
  | "update_categories"
  | "aggregate";

const CASE_DOCUMENTS_BUCKET = "case-documents";

export async function ingestBankStatement(opts: {
  caseId: string;
  documentId: string;
}): Promise<BankIngestOutcome> {
  const admin = createAdminClient();

  // 1. File bytes.
  let bankInput: BankInput;
  try {
    const { data: doc } = await admin
      .from("case_documents")
      .select("file_url, file_name")
      .eq("id", opts.documentId)
      .single();
    if (!doc) throw new Error("case_documents row not found.");
    const { data: blob, error: dlErr } = await admin.storage
      .from(CASE_DOCUMENTS_BUCKET)
      .download(doc.file_url);
    if (dlErr || !blob) {
      throw new Error("Storage download failed: " + (dlErr?.message ?? "no blob"));
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bankInput = {
      bytes,
      mimeType: blob.type,
      fileName: doc.file_name as string,
    };
  } catch (e) {
    return failed(opts.documentId, "fetch_file", e);
  }

  // 2. Parse.
  let parsed;
  try {
    parsed = await parseBankStatement(bankInput);
  } catch (e) {
    return failed(opts.documentId, "parse", e);
  }
  if (parsed.transactions.length === 0) {
    return {
      ok: false,
      documentId: opts.documentId,
      stage: "parse",
      error: "No transactions could be parsed. " + parsed.note,
    };
  }

  // 3. Insert raw rows (idempotent per source_document_id: wipe prior
  // rows from the same upload so a re-upload replaces cleanly).
  let insertedIds: string[];
  try {
    await admin
      .from("pch_bank_transactions")
      .delete()
      .eq("source_document_id", opts.documentId);
    const payload = parsed.transactions.map((t) => ({
      case_id: opts.caseId,
      source_document_id: opts.documentId,
      txn_date: t.txnDate,
      description: t.description,
      amount_pence: t.amountPence,
      balance_pence: t.balancePence,
      raw_json: {
        parseNote: parsed.note,
        warnings: parsed.warnings,
      },
    }));
    const { data: inserted, error } = await admin
      .from("pch_bank_transactions")
      .insert(payload)
      .select("id, description, txn_date, amount_pence");
    if (error) throw new Error(error.message);
    insertedIds = (inserted ?? []).map((r) => r.id as string);
    if (insertedIds.length !== parsed.transactions.length) {
      throw new Error(
        "Insert row count mismatch: inserted="
        + insertedIds.length + " parsed=" + parsed.transactions.length,
      );
    }
  } catch (e) {
    return failed(opts.documentId, "insert_raw", e);
  }

  // 4. Categorise.
  let categorizations;
  try {
    const batch: CategorizableInput[] = parsed.transactions.map((t, i) => ({
      id: insertedIds[i],
      txnDate: t.txnDate,
      description: t.description,
      amountPence: t.amountPence,
    }));
    categorizations = await categorizeBankTransactions(batch);
  } catch (e) {
    return failed(opts.documentId, "categorize", e);
  }

  // 5. Write categories back onto each row. One update per row keeps
  // the logic simple; batching would require Postgres unnest-with-case
  // which is overkill at the 100-row scale we expect.
  try {
    for (const c of categorizations) {
      const { error } = await admin
        .from("pch_bank_transactions")
        .update({
          category: c.categoryKey,
          category_confidence: c.confidence,
          category_note: c.note,
        })
        .eq("id", c.id);
      if (error) throw new Error("Update row " + c.id + " failed: " + error.message);
    }
  } catch (e) {
    return failed(opts.documentId, "update_categories", e);
  }

  // 6. Aggregate.
  let aggregate: AggregateResult;
  try {
    aggregate = await aggregateBankLedger(opts.caseId);
  } catch (e) {
    return failed(opts.documentId, "aggregate", e);
  }

  return {
    ok: true,
    documentId: opts.documentId,
    parsed: parsed.transactions.length,
    categorized: categorizations.length,
    aggregate,
  };
}

function failed(
  documentId: string,
  stage: BankIngestStage,
  err: unknown,
): BankIngestOutcome {
  const error = err instanceof Error ? err.message : String(err);
  console.error("[bank-ingest]", stage, documentId, error);
  return { ok: false, documentId, stage, error };
}
