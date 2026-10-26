"use client";

// Phase I.3 accountant-side P&L review. Two editable tables (Income,
// Expenses) backed by pch_income_lines / pch_expense_lines, autosave
// on blur via editAccountantIncomeLineAction / editAccountantExpense
// LineAction, and a live totals strip underneath that re-runs the
// engine on each save. The accountant locks the figures with
// "Confirm P&L"; after that the inputs disable, the chip flips green,
// and a "Re-open for editing" button is the only way back.
//
// Live totals are read straight off the TaxEngineOutput each save
// returns, never hand-calculated here. On first paint the server
// renders the existing engine_snapshot; after that the client's local
// state tracks whatever the latest edit returned.

import { useState, useTransition } from "react";
import {
  confirmPlAction,
  editAccountantExpenseLineAction,
  editAccountantIncomeLineAction,
  reopenPlAction,
} from "@/app/accountant/pch/pl-actions";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import { useAccountantProgress } from "./accountant-progress-context";

export type PlIncomeLine = {
  id: string;
  source: string;
  gross_takings_pence: number;
};

export type PlExpenseLine = {
  id: string;
  label: string;
  amount_paid_pence: number;
};

export function PlReviewPanel({
  caseId,
  initialIncome,
  initialExpenses,
  initialSnapshot,
  initialPlConfirmedAt,
  initialPlConfirmedByLabel,
}: {
  caseId: string;
  initialIncome: PlIncomeLine[];
  initialExpenses: PlExpenseLine[];
  initialSnapshot: TaxEngineOutput | null;
  initialPlConfirmedAt: string | null;
  initialPlConfirmedByLabel: string | null;
}) {
  const [income, setIncome] = useState<PlIncomeLine[]>(initialIncome);
  const [expenses, setExpenses] = useState<PlExpenseLine[]>(initialExpenses);
  const [snapshot, setSnapshot] = useState<TaxEngineOutput | null>(initialSnapshot);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(initialPlConfirmedAt);
  const [confirmedByLabel, setConfirmedByLabel] = useState<string | null>(
    initialPlConfirmedByLabel,
  );
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const { setStepDone } = useAccountantProgress();

  const confirmed = !!confirmedAt;
  const editable = !confirmed;

  const saveIncome = async (lineId: string, nextPence: number) => {
    const prev = income;
    setIncome((xs) =>
      xs.map((l) => (l.id === lineId ? { ...l, gross_takings_pence: nextPence } : l)),
    );
    const r = await editAccountantIncomeLineAction(caseId, lineId, nextPence);
    if (!r.ok) {
      setIncome(prev);
      setErr(r.error);
      return;
    }
    setSnapshot(r.snapshot);
    setErr(null);
  };

  const saveExpense = async (lineId: string, nextPence: number) => {
    const prev = expenses;
    setExpenses((xs) =>
      xs.map((l) => (l.id === lineId ? { ...l, amount_paid_pence: nextPence } : l)),
    );
    const r = await editAccountantExpenseLineAction(caseId, lineId, nextPence);
    if (!r.ok) {
      setExpenses(prev);
      setErr(r.error);
      return;
    }
    setSnapshot(r.snapshot);
    setErr(null);
  };

  const confirm = () =>
    start(async () => {
      setErr(null);
      const r = await confirmPlAction(caseId);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setSnapshot(r.snapshot);
      setConfirmedAt(r.confirmedAt);
      setConfirmedByLabel("you (just now)");
      setStepDone("plConfirmed", true);
    });

  const reopen = () =>
    start(async () => {
      setErr(null);
      const r = await reopenPlAction(caseId);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setConfirmedAt(null);
      setConfirmedByLabel(null);
      setStepDone("plConfirmed", false);
    });

  return (
    <section
      id="pch-acc-pl"
      className="mb-6 scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">P&amp;L review</h2>
          <p className="mt-1 text-xs text-slate-600">
            Figures the client typed in. Edit any amount and the totals
            below re-run instantly. Lock them with Confirm P&amp;L when
            they look right.
          </p>
        </div>
        {confirmed ? (
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            ✓ Confirmed
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Needs confirmation
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LineTable
          title="Income"
          emptyText="Client hasn't entered any income lines yet."
          rows={income.map((l) => ({
            id: l.id,
            label: l.source,
            pence: l.gross_takings_pence,
          }))}
          editable={editable}
          onSave={saveIncome}
        />
        <LineTable
          title="Expenses"
          emptyText="Client hasn't entered any expense lines yet."
          rows={expenses.map((l) => ({
            id: l.id,
            label: l.label,
            pence: l.amount_paid_pence,
          }))}
          editable={editable}
          onSave={saveExpense}
        />
      </div>

      <TotalsStrip snapshot={snapshot} />

      {err ? (
        <p className="mt-3 text-xs text-rose-700">{err}</p>
      ) : null}

      <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        {confirmed ? (
          <>
            <p className="text-xs text-slate-600">
              Confirmed{" "}
              {confirmedAt
                ? new Date(confirmedAt).toLocaleString("en-GB")
                : null}
              {confirmedByLabel ? ` by ${confirmedByLabel}` : null}.
            </p>
            <button
              type="button"
              onClick={reopen}
              disabled={pending}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
            >
              {pending ? "Re-opening." : "Re-open for editing"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Confirming." : "Confirm P&L"}
          </button>
        )}
      </div>
    </section>
  );
}

function LineTable({
  title, emptyText, rows, editable, onSave,
}: {
  title: string;
  emptyText: string;
  rows: Array<{ id: string; label: string; pence: number }>;
  editable: boolean;
  onSave: (lineId: string, nextPence: number) => Promise<void>;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <LineRow key={r.id} row={r} editable={editable} onSave={onSave} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LineRow({
  row, editable, onSave,
}: {
  row: { id: string; label: string; pence: number };
  editable: boolean;
  onSave: (lineId: string, nextPence: number) => Promise<void>;
}) {
  const [value, setValue] = useState<string>(penceToStr(row.pence));
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  const commit = async () => {
    if (!editable) return;
    const next = strToPence(value);
    if (next === row.pence) return;
    setSaving(true);
    setSavedTick(false);
    try {
      await onSave(row.id, next);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="flex-1 truncate text-sm text-slate-800" title={row.label}>
        {row.label}
      </span>
      <span className="text-sm text-slate-500">£</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        disabled={!editable || saving}
        className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm text-slate-900 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      />
      <span className="w-12 shrink-0 text-right text-[11px]">
        {saving ? (
          <span className="text-slate-500">Saving.</span>
        ) : savedTick ? (
          <span className="font-medium text-emerald-700">Saved</span>
        ) : null}
      </span>
    </li>
  );
}

function TotalsStrip({ snapshot }: { snapshot: TaxEngineOutput | null }) {
  if (!snapshot) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        Totals will appear here once an engine snapshot is available.
      </p>
    );
  }
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
      <Stat label="Turnover" value={snapshot.pl.turnover} />
      <Stat label="Total expenses" value={snapshot.pl.expensesTotal} />
      <Stat label="Capital allowances" value={snapshot.pl.capitalAllowances} />
      <Stat label="Net profit" value={snapshot.pl.netProfit} emphasised />
      <Stat label="Taxable profit" value={snapshot.pl.taxableProfit} />
      <Stat label="Taxable income (after PA)" value={snapshot.tax.taxableIncome} emphasised />
    </div>
  );
}

function Stat({
  label, value, emphasised,
}: {
  label: string;
  value: number;
  emphasised?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={
          "mt-0.5 text-sm "
          + (emphasised ? "font-bold text-ink" : "font-medium text-slate-800")
        }
      >
        {formatMoney(value)}
      </div>
    </div>
  );
}

function formatMoney(n: number): string {
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function penceToStr(pence: number): string {
  if (!Number.isFinite(pence) || pence === 0) return "";
  return (pence / 100).toFixed(2);
}

function strToPence(raw: string): number {
  const trimmed = raw.replace(/,/g, "").trim();
  if (trimmed.length === 0) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}
