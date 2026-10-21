"use client";

// Phase 6 Slice 6: accountant-side P&L view with the "Confirm auto
// bookkeeping" gate.
//
// Two modes keyed off pch_cases.bookkeeping_confirmed_at:
//
//   Review mode (not yet confirmed):
//     Read-only snapshot of the AI-built ledger with running totals,
//     each line marked with its source ("From bank") and a single big
//     "Confirm auto bookkeeping" button at the bottom. Signals that
//     everything beyond the confirm is the accountant's responsibility.
//
//   Edit mode (confirmed):
//     The same grid, now with per-line inline edit (amount + label for
//     expenses; amount + source for income). Each row shows a diff pill
//     when the current value differs from ai_proposed_json so the
//     accountant can see at a glance what has been touched vs what the
//     AI first proposed. "Revert bookkeeping confirmation" exits back
//     to review mode (useful if the accountant wants the client to
//     reclassify something via the Slice 3 clarify chat).

import { useState, useTransition } from "react";
import {
  confirmBookkeepingAction,
  revertBookkeepingAction,
  editIncomeLineAction,
  editExpenseLineAction,
} from "@/app/accountant/pch/actions";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

export type IncomeLineRow = {
  id: string;
  source: string;
  gross_takings_pence: number;
  platform_fee_pence: number;
  on_trip_miles: number;
  dead_miles: number;
  line_type: "Fares" | "Other" | "VAT";
  ai_proposed_json: {
    source?: string;
    gross_takings_pence?: number;
    platform_fee_pence?: number;
  } | null;
  edited_by: string | null;
  edited_at: string | null;
};

export type ExpenseLineRow = {
  id: string;
  label: string;
  amount_paid_pence: number;
  category: string;
  sa103s_box: number;
  // Evidence method code (bank statement, receipt, estimate code, etc.).
  // Required for the advance-to-approval readiness gate; surfaced inline
  // on each row with a quick-pick so the accountant can set it in a
  // single click rather than opening the full edit panel.
  evidence: string | null;
  ai_proposed_json: {
    label?: string;
    amount_paid_pence?: number;
  } | null;
  edited_by: string | null;
  edited_at: string | null;
};

// Common evidence method codes. The free-form field (via the full edit
// panel) still accepts anything, but 95% of lines fall into one of
// these buckets, so the inline quick-pick covers the common path.
const EVIDENCE_QUICK_PICKS = ["Bank statement", "Receipt", "Invoice", "Estimate E2"] as const;

type Props = {
  caseId: string;
  incomeLines: IncomeLineRow[];
  expenseLines: ExpenseLineRow[];
  confirmedAt: string | null;
  confirmedByLabel: string | null;
};

export function PlEditGrid({
  caseId,
  incomeLines,
  expenseLines,
  confirmedAt,
  confirmedByLabel,
}: Props) {
  // Confirm / revert write to pch_cases, which this page's
  // RealtimeRefresh watches. Without a markLocalMutation() call,
  // RealtimeRefresh treats the viewer's own click as "someone else
  // just changed this" and fires its full-page reload on top of the
  // router.refresh() this component used to do, which caused the
  // same visible flicker reported for SA302. Switch to local state
  // for the mode flip (we know what we just wrote); mark the window
  // so RealtimeRefresh stays quiet. Same pattern as Identity's
  // savedHead (task #14).
  const [confirmedAtLocal, setConfirmedAtLocal] = useState<string | null>(confirmedAt);
  const [confirmedByLocal, setConfirmedByLocal] = useState<string | null>(confirmedByLabel);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const confirmed = confirmedAtLocal != null;
  const totalIncome = incomeLines.reduce((s, l) => s + l.gross_takings_pence - l.platform_fee_pence, 0);
  const totalExpenses = expenseLines.reduce((s, l) => s + l.amount_paid_pence, 0);
  const net = totalIncome - totalExpenses;

  const confirm = () => start(async () => {
    setErr(null);
    // Fire before the request goes out; see Sa302Reconciliation.save
    // for the race rationale.
    markLocalMutation();
    const r = await confirmBookkeepingAction(caseId);
    markLocalMutation();
    if (!r.ok) { setErr(r.error); return; }
    // We know the server stamped bookkeeping_confirmed_at = now; use
    // that locally. confirmedByLocal we don't have a server-provided
    // display name for the current accountant from here, so leave as
    // "you" fallback by setting null (header renders without a "by")
    // until the next full page load pulls the authoritative label.
    setConfirmedAtLocal(new Date().toISOString());
  });

  const revert = () => start(async () => {
    setErr(null);
    markLocalMutation();
    const r = await revertBookkeepingAction(caseId);
    markLocalMutation();
    if (!r.ok) { setErr(r.error); return; }
    setConfirmedAtLocal(null);
    setConfirmedByLocal(null);
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">
            {confirmed ? "P&L edit grid" : "AI-built bookkeeping, review mode"}
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            {confirmed
              ? "Edit any line below; the AI's original figure stays visible in the diff pill."
              : "Review the AI's grouping before you commit. Message the client via the chat below if anything needs clarifying before you confirm."}
          </p>
          {confirmed && confirmedAtLocal ? (
            <p className="mt-1 text-[11px] text-emerald-700">
              Confirmed {new Date(confirmedAtLocal).toLocaleString("en-GB")}
              {confirmedByLocal ? " by " + confirmedByLocal : ""}.
            </p>
          ) : null}
        </div>
        {!confirmed ? (
          <button
            type="button"
            onClick={confirm}
            disabled={pending || (incomeLines.length === 0 && expenseLines.length === 0)}
            className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Confirming..." : "Confirm auto bookkeeping"}
          </button>
        ) : (
          <button
            type="button"
            onClick={revert}
            disabled={pending}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {pending ? "Reverting..." : "Revert confirmation"}
          </button>
        )}
      </header>

      {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TotalPill label="Income (net of fees)" pence={totalIncome} tone="emerald" />
        <TotalPill label="Expenses" pence={totalExpenses} tone="slate" />
        <TotalPill
          label="Net"
          pence={net}
          tone={net >= 0 ? "emerald" : "rose"}
        />
      </div>

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Income
      </h3>
      {incomeLines.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No income lines yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {incomeLines.map((l) => (
            <IncomeRow
              key={l.id}
              caseId={caseId}
              line={l}
              editable={confirmed}
            />
          ))}
        </ul>
      )}

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Expenses
      </h3>
      {expenseLines.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No expense lines yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {expenseLines.map((l) => (
            <ExpenseRow
              key={l.id}
              caseId={caseId}
              line={l}
              editable={confirmed}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TotalPill({
  label,
  pence,
  tone,
}: {
  label: string;
  pence: number;
  tone: "emerald" | "slate" | "rose";
}) {
  const toneClass =
    tone === "emerald" ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : tone === "rose" ? "border-rose-300 bg-rose-50 text-rose-900"
      : "border-slate-300 bg-slate-50 text-slate-900";
  return (
    <div className={"rounded border px-3 py-2 " + toneClass}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold">{formatPence(pence)}</div>
    </div>
  );
}

function IncomeRow({
  caseId,
  line,
  editable,
}: {
  caseId: string;
  line: IncomeLineRow;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Local baseline of what's been saved. Starts from the server prop,
  // then flips to whatever this component just wrote. We stop relying
  // on router.refresh() to tell us what to show, same reason as the
  // SA302 panel + PlEditGrid header above: the write targets
  // pch_income_lines (watched by RealtimeRefresh) and without a
  // markLocalMutation call the viewer's own save gets treated as
  // someone else's change.
  const [savedSource, setSavedSource] = useState(line.source);
  const [savedGrossPence, setSavedGrossPence] = useState(line.gross_takings_pence);
  const [savedFeePence, setSavedFeePence] = useState(line.platform_fee_pence);
  const [savedEditedAt, setSavedEditedAt] = useState<string | null>(line.edited_at);
  // Edit-form draft state, seeded from the saved baseline so cancel
  // discards back to the last-saved view.
  const [source, setSource] = useState(line.source);
  const [grossPounds, setGrossPounds] = useState((line.gross_takings_pence / 100).toFixed(2));
  const [feePounds, setFeePounds] = useState((line.platform_fee_pence / 100).toFixed(2));

  const aiGross = line.ai_proposed_json?.gross_takings_pence ?? null;
  const aiFee = line.ai_proposed_json?.platform_fee_pence ?? null;
  const grossDiff = aiGross != null && aiGross !== savedGrossPence;
  const feeDiff = aiFee != null && aiFee !== savedFeePence;

  const save = () => start(async () => {
    setErr(null);
    const nextGross = Math.round(Number(grossPounds) * 100);
    const nextFee = Math.round(Number(feePounds) * 100);
    markLocalMutation();
    const r = await editIncomeLineAction(caseId, line.id, {
      source,
      gross_takings_pence: nextGross,
      platform_fee_pence: nextFee,
    });
    markLocalMutation();
    if (!r.ok) { setErr(r.error); return; }
    // Local update instead of router.refresh(). We know the exact
    // values the server accepted, no need to re-fetch.
    setSavedSource(source);
    setSavedGrossPence(nextGross);
    setSavedFeePence(nextFee);
    setSavedEditedAt(new Date().toISOString());
    setEditing(false);
  });

  return (
    <li className="rounded border border-slate-200 bg-slate-50/60 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-900">{savedSource}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Gross <strong>{formatPence(savedGrossPence)}</strong>
            {grossDiff ? <DiffPill ai={aiGross!} /> : null}
            {" "}&middot;{" "}
            Fees <strong>{formatPence(savedFeePence)}</strong>
            {feeDiff ? <DiffPill ai={aiFee!} /> : null}
          </div>
          {savedEditedAt ? (
            <div className="mt-0.5 text-[10px] text-slate-500">
              Edited {new Date(savedEditedAt).toLocaleString("en-GB")}
            </div>
          ) : null}
        </div>
        {editable && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100"
          >
            Edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-700">Source</span>
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-700">Gross (£)</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={grossPounds}
              onChange={(e) => setGrossPounds(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-700">Platform fees (£)</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={feePounds}
              onChange={(e) => setFeePounds(e.target.value)}
              disabled={pending}
            />
          </label>
          <div className="sm:col-span-3 flex items-center justify-between gap-2">
            {err ? <span className="text-rose-700">{err}</span> : <span />}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded bg-slate-900 px-2 py-1 font-medium text-white disabled:opacity-50"
              >
                {pending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ExpenseRow({
  caseId,
  line,
  editable,
}: {
  caseId: string;
  line: ExpenseLineRow;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Local saved baseline, same reasoning as IncomeRow above: pch_
  // expense_lines is on the RealtimeRefresh watch list, so we need
  // the markLocalMutation + local-state-update pattern to avoid the
  // viewer's own save firing the "new updates" reload.
  const [savedLabel, setSavedLabel] = useState(line.label);
  const [savedAmountPence, setSavedAmountPence] = useState(line.amount_paid_pence);
  const [savedEvidence, setSavedEvidence] = useState<string | null>(line.evidence);
  const [savedEditedAt, setSavedEditedAt] = useState<string | null>(line.edited_at);
  const [label, setLabel] = useState(line.label);
  const [amountPounds, setAmountPounds] = useState((line.amount_paid_pence / 100).toFixed(2));

  const aiAmount = line.ai_proposed_json?.amount_paid_pence ?? null;
  const amountDiff = aiAmount != null && aiAmount !== savedAmountPence;
  const missingEvidence = !savedEvidence || savedEvidence.trim().length === 0;

  const save = () => start(async () => {
    setErr(null);
    const nextAmount = Math.round(Number(amountPounds) * 100);
    markLocalMutation();
    const r = await editExpenseLineAction(caseId, line.id, {
      label,
      amount_paid_pence: nextAmount,
    });
    markLocalMutation();
    if (!r.ok) { setErr(r.error); return; }
    setSavedLabel(label);
    setSavedAmountPence(nextAmount);
    setSavedEditedAt(new Date().toISOString());
    setEditing(false);
  });

  const quickPickEvidence = (method: string) => start(async () => {
    setErr(null);
    markLocalMutation();
    const r = await editExpenseLineAction(caseId, line.id, { evidence: method });
    markLocalMutation();
    if (!r.ok) { setErr(r.error); return; }
    setSavedEvidence(method);
    setSavedEditedAt(new Date().toISOString());
  });

  return (
    <li className={
      "rounded border p-3 text-xs "
      + (missingEvidence && editable
        ? "border-amber-300 bg-amber-50/50"
        : "border-slate-200 bg-slate-50/60")
    }>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-900">{savedLabel}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {line.category} &middot; SA103S box {line.sa103s_box}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Amount <strong>{formatPence(savedAmountPence)}</strong>
            {amountDiff ? <DiffPill ai={aiAmount!} /> : null}
          </div>
          <div className="mt-0.5 text-[11px]">
            Evidence{" "}
            {missingEvidence ? (
              <span className="font-medium text-amber-800">
                Missing, this blocks Advance to client approval
              </span>
            ) : (
              <strong className="text-slate-700">{savedEvidence}</strong>
            )}
          </div>
          {savedEditedAt ? (
            <div className="mt-0.5 text-[10px] text-slate-500">
              Edited {new Date(savedEditedAt).toLocaleString("en-GB")}
            </div>
          ) : null}
        </div>
        {editable && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100"
          >
            Edit
          </button>
        ) : null}
      </div>
      {editable && missingEvidence && !editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
            Mark as:
          </span>
          {EVIDENCE_QUICK_PICKS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => quickPickEvidence(m)}
              disabled={pending}
              className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {m}
            </button>
          ))}
        </div>
      ) : null}
      {editing ? (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-700">Label</span>
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-700">Amount (£)</span>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={amountPounds}
              onChange={(e) => setAmountPounds(e.target.value)}
              disabled={pending}
            />
          </label>
          <div className="sm:col-span-2 flex items-center justify-between gap-2">
            {err ? <span className="text-rose-700">{err}</span> : <span />}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded bg-slate-900 px-2 py-1 font-medium text-white disabled:opacity-50"
              >
                {pending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function DiffPill({ ai }: { ai: number }) {
  return (
    <span className="ml-1 inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
      AI: {formatPence(ai)}
    </span>
  );
}

function formatPence(pence: number): string {
  return "£" + (pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
