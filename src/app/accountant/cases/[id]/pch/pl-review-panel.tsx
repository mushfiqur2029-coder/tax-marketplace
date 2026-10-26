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
  privateUsePence,
  initialPlConfirmedAt,
  initialPlConfirmedByLabel,
}: {
  caseId: string;
  initialIncome: PlIncomeLine[];
  initialExpenses: PlExpenseLine[];
  initialSnapshot: TaxEngineOutput | null;
  privateUsePence: number;
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
          rows={dedupeByLabel(
            income.map((l) => ({
              id: l.id,
              label: l.source,
              pence: l.gross_takings_pence,
            })),
          )}
          editable={editable}
          onSave={saveIncome}
        />
        <LineTable
          title="Expenses"
          emptyText="Client hasn't entered any expense lines yet."
          rows={dedupeByLabel(
            expenses.map((l) => ({
              id: l.id,
              label: l.label,
              pence: l.amount_paid_pence,
            })),
          )}
          editable={editable}
          onSave={saveExpense}
        />
      </div>

      <PlSummaryTable
        income={income}
        expenses={expenses}
        privateUsePence={privateUsePence}
      />

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

type DedupedRow = {
  id: string;
  label: string;
  pence: number;
  isDupe: boolean;
  orphanIds: string[];
};

// Belt-and-braces for the row-creation race fixed in section-2/section-3:
// if the DB has multiple rows for the same label (both tables are
// fixed-slot lists post-Phase J, so this is always a bug state), group
// them for display with the summed amount + a small warning badge.
// Edits write to the first row's id; the orphan rows get cleaned up
// by scripts/pch-duplicate-rows-sweep.mjs.
function dedupeByLabel(
  rows: Array<{ id: string; label: string; pence: number }>,
): DedupedRow[] {
  const groups = new Map<string, Array<{ id: string; pence: number }>>();
  const order: string[] = [];
  for (const r of rows) {
    const key = (r.label ?? "").trim();
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push({ id: r.id, pence: r.pence });
  }
  return order.map((label) => {
    const list = groups.get(label)!;
    const pence = list.reduce((s, r) => s + (r.pence ?? 0), 0);
    return {
      id: list[0].id,
      label,
      pence,
      isDupe: list.length > 1,
      orphanIds: list.slice(1).map((r) => r.id),
    };
  });
}

function LineTable({
  title, emptyText, rows, editable, onSave,
}: {
  title: string;
  emptyText: string;
  rows: DedupedRow[];
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
  row: DedupedRow;
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
      {row.isDupe ? (
        <span
          className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
          title={`Duplicate rows detected in DB (${row.orphanIds.length + 1} rows for this label); amounts summed. Run scripts/pch-duplicate-rows-sweep.mjs to clean up.`}
        >
          ⚠ merged
        </span>
      ) : null}
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

// -------------------------------------------------------------------
// Phase M+1: combined "P&L Summary" view. Single 4-column table
// (Label / Expenses £ / Income £ / %), one row per fixed income or
// expense slot in the spec-defined order, with Totals + Private use
// + Net Profit rows at the bottom. Read-only; recomputes live from
// the same income / expenses state the editable tables above write
// to, so edits reflect instantly in the summary.
//
// A couple of label merges per spec:
//   "Road Tax and MOT" sums the "Road Tax" + "MOT" slots.
//   "Parking, Congestion, ULEZ & Gatwick Drop-off charge" reads from
//     the Phase J "Parking, Congestion & ULEZ" slot (same source
//     amount, longer display label matching the attached sample).
//
// Private use pulls from pch_vehicle.private_use_amount_pence passed
// in by page.tsx; threaded as a prop so no extra fetch. If the vehicle
// row doesn't exist for a case, the prop is 0 and the Less: Private
// use row renders as -£0.00 (or we could suppress it; chose to show
// it so the layout matches the spec sample consistently).
// -------------------------------------------------------------------

const SUMMARY_INCOME_LABELS = [
  "Uber",
  "Bolt",
  "Free Now",
  "Cash receipt",
  "Others income",
] as const;

// Phase M+2 reorder: row order matches section-3-expenses.tsx's
// FIXED_SLOTS exactly, and MOT + Road Tax are two separate rows (no
// "Road Tax and MOT" merge). Keeps the summary and the client intake
// in step so a side-by-side comparison matches 1:1. Labels mirror
// the client's slot labels so there's no mental translation when
// the accountant jumps between the P&L edit grid above and the
// summary below.
const SUMMARY_EXPENSE_LABELS: readonly string[] = [
  "Fuel",
  "Insurance",
  "Cleaning",
  "Repairs & Maintenance",
  "Licence Fees",
  "Pension",
  "MOT",
  "Road Tax",
  "Mobile",
  "Accountancy Fees",
  "Parking, Congestion & ULEZ",
  "Cash expense",
  "Other expense",
];

function sumByLabel(
  rows: Array<{ label: string; pence: number }>,
  label: string,
): number {
  const wanted = label.trim().toLowerCase();
  return rows.reduce(
    (s, r) => ((r.label ?? "").trim().toLowerCase() === wanted ? s + (r.pence ?? 0) : s),
    0,
  );
}

function PlSummaryTable({
  income, expenses, privateUsePence,
}: {
  income: PlIncomeLine[];
  expenses: PlExpenseLine[];
  privateUsePence: number;
}) {
  const incomeRows = income.map((l) => ({
    label: l.source,
    pence: l.gross_takings_pence,
  }));
  const expenseRows = expenses.map((l) => ({
    label: l.label,
    pence: l.amount_paid_pence,
  }));

  const incomePerLabel = SUMMARY_INCOME_LABELS.map((label) => ({
    label,
    pence: sumByLabel(incomeRows, label),
  }));
  const totalIncome = incomePerLabel.reduce((s, r) => s + r.pence, 0);

  const expensePerRow = SUMMARY_EXPENSE_LABELS.map((label) => ({
    display: label,
    pence: sumByLabel(expenseRows, label),
  }));
  const totalExpenses = expensePerRow.reduce((s, r) => s + r.pence, 0);

  const netProfit = totalIncome - totalExpenses - privateUsePence;
  const expensesPctOfIncome = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;

  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">P&amp;L Summary</h3>
      <p className="mb-2 text-xs text-slate-600">
        Final presentation of the figures above. Updates live as you
        edit any amount. Not editable, read-only.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-700">
                Line item
              </th>
              <th className="border border-slate-200 px-2 py-1.5 text-right font-semibold text-slate-700 w-28">
                Expenses £
              </th>
              <th className="border border-slate-200 px-2 py-1.5 text-right font-semibold text-slate-700 w-28">
                Income £
              </th>
              <th className="border border-slate-200 px-2 py-1.5 text-right font-semibold text-slate-700 w-20">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            <SummarySectionHeader label="Income" />
            {incomePerLabel.map((r, i) => (
              <SummaryRow
                key={r.label}
                label={r.label}
                incomePence={r.pence}
                pct={totalIncome > 0 ? (r.pence / totalIncome) * 100 : 0}
                shaded={i % 2 === 1}
              />
            ))}
            <tr className="bg-yellow-50 font-bold">
              <td className="border border-slate-200 px-2 py-1.5">
                Total income:
              </td>
              <td className="border border-slate-200 px-2 py-1.5"></td>
              <td className="border border-slate-200 px-2 py-1.5 text-right font-variant-numeric: tabular-nums">
                {formatMoney2dp(totalIncome)}
              </td>
              <td className="border border-slate-200 px-2 py-1.5"></td>
            </tr>
            <SummarySectionHeader label="Less: Expenses" />
            {expensePerRow.map((r, i) => (
              <SummaryRow
                key={r.display}
                label={r.display}
                expensePence={r.pence}
                pct={totalIncome > 0 ? (r.pence / totalIncome) * 100 : 0}
                shaded={i % 2 === 1}
              />
            ))}
            <tr className="bg-yellow-50 font-bold">
              <td className="border border-slate-200 px-2 py-1.5">Total</td>
              <td className="border border-slate-200 px-2 py-1.5 text-right">
                {formatMoney2dp(totalExpenses)}
              </td>
              <td className="border border-slate-200 px-2 py-1.5"></td>
              <td className="border border-slate-200 px-2 py-1.5 text-right">
                {formatPct(expensesPctOfIncome)}
              </td>
            </tr>
            <tr className="bg-yellow-50/60">
              <td className="border border-slate-200 px-2 py-1.5">
                Less: Private use
              </td>
              <td className="border border-slate-200 px-2 py-1.5"></td>
              <td className="border border-slate-200 px-2 py-1.5 text-right text-rose-700">
                {privateUsePence > 0
                  ? "-" + formatMoney2dp(privateUsePence)
                  : formatMoney2dp(0)}
              </td>
              <td className="border border-slate-200 px-2 py-1.5"></td>
            </tr>
            <tr className="bg-yellow-100 font-bold">
              <td className="border border-slate-200 px-2 py-1.5">
                Net Profit
              </td>
              <td className="border border-slate-200 px-2 py-1.5"></td>
              <td className="border border-slate-200 px-2 py-1.5 text-right underline underline-offset-4">
                {formatMoney2dp(netProfit)}
              </td>
              <td className="border border-slate-200 px-2 py-1.5"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummarySectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-yellow-50/60 font-semibold">
      <td className="border border-slate-200 px-2 py-1.5" colSpan={4}>
        {label}
      </td>
    </tr>
  );
}

function SummaryRow({
  label, expensePence, incomePence, pct, shaded,
}: {
  label: string;
  expensePence?: number;
  incomePence?: number;
  pct: number;
  shaded: boolean;
}) {
  const cellBg = shaded ? "bg-yellow-50/40" : "";
  return (
    <tr className={cellBg}>
      <td className="border border-slate-200 px-2 py-1.5 text-slate-800">
        {label}
      </td>
      <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">
        {typeof expensePence === "number" ? formatMoney2dp(expensePence) : ""}
      </td>
      <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">
        {typeof incomePence === "number" ? formatMoney2dp(incomePence) : ""}
      </td>
      <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums text-slate-600">
        {pct > 0 ? formatPct(pct) : ""}
      </td>
    </tr>
  );
}

function formatMoney2dp(pence: number): string {
  const pounds = (pence ?? 0) / 100;
  return pounds.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(pct: number): string {
  return pct.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + "%";
}
