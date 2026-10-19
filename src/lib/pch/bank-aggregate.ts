import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  categoryByKey,
  expenseRowBox,
  expenseRowCarCost,
  expenseRowCategory,
  expenseRowLabel,
  incomeRowSource,
  type ExpenseRowKey,
  type IncomeRowKey,
} from "./bank-categories";

// Phase 6 Slice 2: aggregate categorised pch_bank_transactions rows
// into the pch_income_lines + pch_expense_lines tables the tax engine
// reads. Idempotent: re-running after a client re-categorisation (or
// after the accountant edits a few rows) wipes and rewrites the "Bank"
// origin rows but leaves manually-added rows (if any) alone.
//
// Marker: a row originating from this aggregator carries a stable
// "Bank: <category label>" prefix on pch_income_lines.source and
// pch_expense_lines.label. Those prefixes identify what to delete on
// re-aggregate; nothing else should write rows with that prefix.

const BANK_SOURCE_PREFIX = "Bank: ";

type IncomeAccum = Map<IncomeRowKey, { pence: number; miles: number }>;
type ExpenseAccum = Map<ExpenseRowKey, number>;

type TransactionRow = {
  category: string | null;
  amount_pence: number | null;
};

export type AggregateResult = {
  incomeRowsWritten: number;
  expenseRowsWritten: number;
  excludedCount: number;
  uncategorisedCount: number;
  totalTransactions: number;
};

export async function aggregateBankLedger(
  caseId: string,
): Promise<AggregateResult> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("pch_bank_transactions")
    .select("category, amount_pence")
    .eq("case_id", caseId);
  if (error) throw new Error("Aggregate read failed: " + error.message);

  const totals = classify((rows ?? []) as TransactionRow[]);

  // Replace the bank-origin rows on both tables. We delete by the
  // marker prefix so manually-entered income/expense rows (if any) stay.
  await deletePrefixed(admin, "pch_income_lines", caseId, "source");
  await deletePrefixed(admin, "pch_expense_lines", caseId, "label");

  let incomeRowsWritten = 0;
  let expenseRowsWritten = 0;

  const incomeInserts = [...totals.income.entries()].map(([rowKey, agg], i) => {
    const row = {
      case_id: caseId,
      source: BANK_SOURCE_PREFIX + incomeRowSource(rowKey),
      line_type: "Fares" as const,
      sort_order: i,
      gross_takings_pence: agg.pence,
      platform_fee_pence: 0,
      on_trip_miles: agg.miles,
      dead_miles: 0,
    };
    // Phase 6 Slice 6: snapshot the AI's proposed row so the P&L edit
    // grid can diff accountant edits against the AI baseline.
    return {
      ...row,
      ai_proposed_json: {
        source: row.source,
        gross_takings_pence: row.gross_takings_pence,
        platform_fee_pence: row.platform_fee_pence,
        on_trip_miles: row.on_trip_miles,
        dead_miles: row.dead_miles,
      },
    };
  });
  if (incomeInserts.length > 0) {
    const { error: incErr } = await admin
      .from("pch_income_lines")
      .insert(incomeInserts);
    if (incErr) throw new Error("Income insert failed: " + incErr.message);
    incomeRowsWritten = incomeInserts.length;
  }

  const expenseInserts = [...totals.expense.entries()].map(([rowKey, pence], i) => {
    const row = {
      case_id: caseId,
      label: BANK_SOURCE_PREFIX + expenseRowLabel(rowKey),
      amount_paid_pence: pence,
      car_cost: expenseRowCarCost(rowKey),
      category: expenseRowCategory(rowKey),
      sa103s_box: expenseRowBox(rowKey),
      sort_order: i,
    };
    return {
      ...row,
      ai_proposed_json: {
        label: row.label,
        amount_paid_pence: row.amount_paid_pence,
        category: row.category,
        sa103s_box: row.sa103s_box,
      },
    };
  });
  if (expenseInserts.length > 0) {
    const { error: expErr } = await admin
      .from("pch_expense_lines")
      .insert(expenseInserts);
    if (expErr) throw new Error("Expense insert failed: " + expErr.message);
    expenseRowsWritten = expenseInserts.length;
  }

  return {
    incomeRowsWritten,
    expenseRowsWritten,
    excludedCount: totals.excludedCount,
    uncategorisedCount: totals.uncategorisedCount,
    totalTransactions: rows?.length ?? 0,
  };
}

function classify(rows: TransactionRow[]): {
  income: IncomeAccum;
  expense: ExpenseAccum;
  excludedCount: number;
  uncategorisedCount: number;
} {
  const income: IncomeAccum = new Map();
  const expense: ExpenseAccum = new Map();
  let excludedCount = 0;
  let uncategorisedCount = 0;
  for (const r of rows) {
    const amount = Number(r.amount_pence ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const def = categoryByKey(r.category ?? undefined);
    if (!def) {
      uncategorisedCount += 1;
      continue;
    }
    if (def.direction === "income") {
      // Income transactions are credits (positive amount). Defensive:
      // if the AI tagged a debit as income, treat its absolute value.
      const pence = Math.abs(amount);
      const current = income.get(def.rowKey) ?? { pence: 0, miles: 0 };
      current.pence += pence;
      income.set(def.rowKey, current);
    } else if (def.direction === "expense") {
      // Expenses are debits (negative amount). Store as absolute pence
      // so pch_expense_lines.amount_paid_pence stays positive, which
      // is what the engine + exports already assume.
      const pence = Math.abs(amount);
      const current = expense.get(def.rowKey) ?? 0;
      expense.set(def.rowKey, current + pence);
    } else {
      excludedCount += 1;
    }
  }
  return { income, expense, excludedCount, uncategorisedCount };
}

async function deletePrefixed(
  admin: ReturnType<typeof createAdminClient>,
  table: "pch_income_lines" | "pch_expense_lines",
  caseId: string,
  column: "source" | "label",
): Promise<void> {
  const { error } = await admin
    .from(table)
    .delete()
    .eq("case_id", caseId)
    .like(column, BANK_SOURCE_PREFIX + "%");
  if (error) throw new Error(`Delete prior bank rows (${table}): ${error.message}`);
}
