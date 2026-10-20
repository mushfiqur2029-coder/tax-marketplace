"use client";

import { useState, useTransition } from "react";
import { spawnPriorYearCasesAction } from "@/app/client/pch/prior-year-actions";

export type PriorYearOption = {
  taxYear: string;              // "2024/25"
  filingDeadline: string;       // ISO date; "overdue since" or "due by" line
  overdue: boolean;
  supported: boolean;           // We have a rate pack for this year
  alreadySpawned: boolean;      // Already elected on this parent, don't re-create
};

// Shown above the intake sections. Only renders when there's at least
// one prior tax year the client could add. Each selected year spawns a
// standalone draft case (own payment, own intake, own filing). Years
// without a rate pack surface as "contact support" instead of a tick.

export function PriorYearPrompt({
  parentCaseId,
  years,
  editable,
}: {
  parentCaseId: string;
  years: PriorYearOption[];
  editable: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [spawned, setSpawned] = useState<number | null>(null);

  const anyActionable = years.some((y) => y.supported && !y.alreadySpawned);
  if (years.length === 0) return null;

  const toggle = (ty: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(ty)) next.delete(ty);
      else next.add(ty);
      return next;
    });
  };

  const submit = () => {
    const selected = Array.from(picked);
    if (selected.length === 0) return;
    start(async () => {
      setErr(null); setSpawned(null);
      const r = await spawnPriorYearCasesAction(parentCaseId, selected);
      if (!r.ok) { setErr(r.error); return; }
      setSpawned(r.spawnedCaseIds.length);
      setPicked(new Set());
      window.location.reload();
    });
  };

  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-amber-900">
            Older tax years that may still be outstanding
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            We checked HMRC&apos;s tax-year calendar against the trading dates on your intake. Tick any
            year you&apos;d also like us to prepare. Each year is a separate return with its own fee and
            its own pipeline. Pay the current-year invoice now, then handle the extra years from your
            dashboard when you&apos;re ready.
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {years.map((y) => (
          <li key={y.taxYear} className="rounded border border-amber-200 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-slate-800">Tax year {y.taxYear}</div>
                <div className="mt-0.5 text-xs text-slate-600">
                  Filing deadline {new Date(y.filingDeadline).toLocaleDateString("en-GB")}.{" "}
                  {y.overdue
                    ? <span className="font-semibold text-rose-700">Overdue, HMRC may already be charging penalties.</span>
                    : <span className="text-slate-600">Not yet overdue.</span>}
                </div>
                {!y.supported ? (
                  <div className="mt-1 text-xs text-slate-500">
                    We don&apos;t have an automated rate pack for this year yet. Reply to your welcome
                    email and support will set up a bespoke case.
                  </div>
                ) : y.alreadySpawned ? (
                  <div className="mt-1 text-xs text-emerald-700">
                    &#x2713; Already added to your dashboard as a draft return.
                  </div>
                ) : null}
              </div>
              <div className="shrink-0">
                {y.supported && !y.alreadySpawned && editable ? (
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={picked.has(y.taxYear)}
                      onChange={() => toggle(y.taxYear)}
                      disabled={pending}
                    />
                    Add this year
                  </label>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {anyActionable && editable ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending || picked.size === 0}
            className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending
              ? "Adding..."
              : `Add ${picked.size} year${picked.size === 1 ? "" : "s"} to my dashboard`}
          </button>
          {spawned != null ? (
            <span className="text-xs text-emerald-700">
              {spawned} draft {spawned === 1 ? "case" : "cases"} created, see your dashboard.
            </span>
          ) : null}
          {err ? <span className="text-xs text-rose-700">{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
