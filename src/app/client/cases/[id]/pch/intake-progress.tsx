"use client";

// Overall "N of 6 sections complete" indicator rendered above
// Section 1. Reflects the server-rendered state at page load; each
// section lives behind its own debounced-save hook, so progress ticks
// up on refresh / navigation rather than key by key. Good enough for
// a nudge above the fold without lifting every section's state up to
// the workspace.
//
// Six blocks counted (General Uploads is optional, never blocks):
//   1. Identity (Section 1)
//   2. Income (Section 2)
//   3. Expenses (Section 3)
//   4. Vehicle (Section 3 subsection)
//   5. Sections 4-14 + other_employment (all 12 explicitly answered)
//   6. Last year SA (Section 15)

import type { Section1InitialHead } from "./section-1-identity";
import type { IncomeLine } from "./section-2-income";
import type { ExpenseLine } from "./section-3-expenses";
import type { VehicleInitial } from "./section-3-vehicle";
import type { DeclarationsInitial } from "./section-4-14-declarations";
import type { Section15Initial } from "./section-15-last-year-sa";
import { REQUIRED_DECLARATION_KEYS } from "@/lib/pch/validation";

type LicenceDoc = { photo_id_side: "front" | "back" | null };

export function IntakeProgress({
  section1,
  licenceDocs,
  incomeLines,
  expenseLines,
  vehicle,
  declarations,
  section15,
}: {
  section1: Section1InitialHead;
  licenceDocs: readonly LicenceDoc[];
  incomeLines: readonly IncomeLine[];
  expenseLines: readonly ExpenseLine[];
  vehicle: VehicleInitial;
  declarations: DeclarationsInitial;
  section15: Section15Initial;
}) {
  const labels: Array<{ label: string; done: boolean }> = [
    { label: "Identity", done: isIdentityComplete(section1, licenceDocs) },
    { label: "Income", done: isIncomeComplete(incomeLines) },
    { label: "Expenses", done: isExpensesComplete(expenseLines) },
    { label: "Vehicle", done: isVehicleComplete(vehicle) },
    { label: "Declarations", done: areDeclarationsComplete(declarations) },
    { label: "Last year SA", done: isSection15Complete(section15) },
  ];
  const done = labels.filter((x) => x.done).length;
  const total = labels.length;
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold uppercase tracking-widest text-slate-500"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Your progress
          </div>
          <div className="mt-0.5 text-sm font-bold text-ink">
            {done} of {total} sections complete
          </div>
        </div>
        <div className="w-full max-w-xs">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-2 rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {labels.map((x) => (
          <span
            key={x.label}
            className={
              "rounded-full border px-2 py-0.5 text-[11px] font-medium "
              + (x.done
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-slate-50 text-slate-600")
            }
          >
            {x.done ? "✓ " : ""}{x.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function nonEmpty(v: string | null | undefined): boolean {
  return !!(v && v.trim().length > 0);
}

function isIdentityComplete(h: Section1InitialHead, docs: readonly LicenceDoc[]): boolean {
  const base =
    nonEmpty(h.cl_name)
    && nonEmpty(h.cl_dob)
    && nonEmpty(h.cl_address)
    && nonEmpty(h.cl_postcode)
    && nonEmpty(h.cl_phone)
    && nonEmpty(h.cl_email)
    && nonEmpty(h.cl_utr)
    && nonEmpty(h.cl_nino);
  const hasFront = docs.some((d) => d.photo_id_side === "front");
  const hasBack = docs.some((d) => d.photo_id_side === "back");
  return base && hasFront && hasBack;
}

function isIncomeComplete(lines: readonly IncomeLine[]): boolean {
  return lines.some((l) => (l.gross_takings_pence ?? 0) > 0);
}

function isExpensesComplete(lines: readonly ExpenseLine[]): boolean {
  return lines.some((l) => (l.amount_paid_pence ?? 0) > 0);
}

function isVehicleComplete(v: VehicleInitial): boolean {
  const status = (v.status ?? "").trim();
  if (!status) return false;
  if (status === "No vehicle") return true;
  const basics =
    nonEmpty(v.fuel)
    && nonEmpty(v.previous_method)
    && v.bought_this_year !== null
    && (v.odo_start ?? 0) > 0
    && (v.odo_end ?? 0) > 0;
  if (!basics) return false;
  if (v.bought_this_year === true) {
    const bought =
      (v.purchase_price_pence ?? 0) > 0
      && nonEmpty(v.registration)
      && nonEmpty(v.make_model)
      && (v.new_or_used === "New" || v.new_or_used === "Used");
    if (!bought) return false;
  }
  if (v.previous_method === "Actual costs (capital allowances claimed)") {
    if ((v.wdv_brought_forward_pence ?? 0) <= 0) return false;
  }
  if (v.private_use_declared === null) return false;
  if (v.private_use_declared === true && (v.private_use_amount_pence ?? 0) <= 0) {
    return false;
  }
  return true;
}

function areDeclarationsComplete(d: DeclarationsInitial): boolean {
  return REQUIRED_DECLARATION_KEYS.every((k) => {
    const v = d.statuses[k as keyof typeof d.statuses];
    return v === "applicable" || v === "not_applicable";
  });
}

function isSection15Complete(s: Section15Initial): boolean {
  return (
    s.last_year_sa_status === "yes"
    || s.last_year_sa_status === "no"
    || s.last_year_sa_status === "not_applicable"
  );
}
