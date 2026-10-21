"use client";

// Phase 6 Slice 3: workspace section between the Documents section and
// Tab 1 Identity. Shows the AI-built bookkeeping ledger with a chat
// panel at top that walks the client through anything the categoriser
// wasn't sure about.
//
// Two subcomponents (both client-only):
//   - BankClarifyChat: picks the next uncategorised / low-confidence
//     transaction, asks the client to describe it, re-runs the AI
//     classifier.
//   - BankLedgerTable: grouped view of every transaction, totals, and
//     inline category edits.
//
// Task #14: this section is the shared source of truth for the
// transaction list so a clarify-chat answer and a ledger-table edit
// both update the same local state, no reload, no stale data between
// the two sibling panels.
//
// Renders nothing when the client hasn't uploaded a bank statement
// yet; the Documents section's bank slot has the upload prompt.

import { useState } from "react";
import { BankClarifyChat } from "./bank-clarify-chat";
import {
  BankLedgerTable,
  type BankTransactionView,
} from "./bank-ledger-table";

type Props = {
  caseId: string;
  transactions: BankTransactionView[];
  editable?: boolean;
};

function countPending(transactions: BankTransactionView[]): number {
  let n = 0;
  for (const t of transactions) {
    if (t.category == null) { n += 1; continue; }
    if (t.category === "uncategorized") { n += 1; continue; }
    if (t.categoryConfidence === "low") { n += 1; continue; }
  }
  return n;
}

const CONFIDENCE_VALUES = ["high", "medium", "low", "missing"] as const;
function coerceConfidence(v: string): BankTransactionView["categoryConfidence"] {
  return (CONFIDENCE_VALUES as readonly string[]).includes(v)
    ? (v as BankTransactionView["categoryConfidence"])
    : "high";
}

export function LedgerSection({ caseId, transactions: initialTransactions, editable = true }: Props) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const setCategory = (
    txnId: string,
    category: string,
    categoryConfidence: BankTransactionView["categoryConfidence"] | string = "high",
  ) => {
    const confidence = coerceConfidence(String(categoryConfidence));
    setTransactions((prev) =>
      prev.map((t) => (t.id === txnId ? { ...t, category, categoryConfidence: confidence } : t)),
    );
  };
  if (transactions.length === 0) return null;
  const pending = countPending(transactions);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Your bookkeeping</h3>
            {/* Red while something still needs the client's input, green
                the instant nothing does, so the status reads at a glance
                without needing to parse the sentence below. */}
            {pending > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                {pending} to review
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                All done
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {transactions.length} transaction{transactions.length === 1 ? "" : "s"} read from your bank statement{transactions.length === 1 ? "" : "s"}.
            {pending > 0
              ? ` ${pending} still need${pending === 1 ? "s" : ""} your input.`
              : " Nothing left to clarify."}
          </p>
        </div>
      </header>
      {editable ? (
        <BankClarifyChat
          caseId={caseId}
          initialPendingCount={pending}
          onAnswered={(txnId, category, confidence) => setCategory(txnId, category, confidence)}
        />
      ) : null}
      <BankLedgerTable
        caseId={caseId}
        transactions={transactions}
        editable={editable}
        onCategoryChanged={setCategory}
      />
    </div>
  );
}
