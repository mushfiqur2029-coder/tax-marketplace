"use client";

// Phase 6 Slice 4: replaces the long manual Tab 4 vehicle form with a
// read-mostly summary + conversational "walk me through this" button.
//
// Shape mirrors Slice 1's identity section:
//   - Compact summary of what's already captured (status, make/model,
//     purchase price, business-use %, etc.).
//   - "Walk me through my vehicle" button that opens the chat.
//   - When nothing is captured, the button copy becomes "Let's walk
//     through your vehicle" so the client has a clear next step.
//
// The chat itself is the VEHICLE_CA flow in ai-interview.ts; the AI's
// opener (set by the start action) already explains capital allowances
// in plain English before asking the first question.

import { useState } from "react";
import { VehicleInterviewPanel } from "./vehicle-interview-panel";

export type VehicleSummary = {
  status: string | null;
  fuel: string | null;
  make_model: string | null;
  registration: string | null;
  co2_gpkm: number | null;
  purchase_date: string | null;
  purchase_price_pence: number | null;
  new_or_used: string | null;
  business_pct_override: number | null;
};

type Props = {
  caseId: string;
  vehicle: VehicleSummary | null;
  editable?: boolean;
};

export function VehicleSection({ caseId, vehicle, editable = true }: Props) {
  const [open, setOpen] = useState(false);
  const rows = buildRows(vehicle);
  const captured = rows.some((r) => r.value && r.value.trim().length > 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            Vehicle and capital allowances
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            {captured
              ? "Already captured. Open the chat if anything needs to change."
              : "A short conversation covers everything we need. The AI will explain capital allowances first; it only asks the questions that apply."}
          </p>
        </div>
        {editable ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
          >
            {captured ? "Update my vehicle" : "Let's walk through your vehicle"}
          </button>
        ) : null}
      </header>

      {editable && open ? (
        <VehicleInterviewPanel
          caseId={caseId}
          onClose={() => setOpen(false)}
        />
      ) : null}

      {captured ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            From the chat
          </h4>
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li
                key={r.label}
                className="rounded border border-slate-100 bg-slate-50/60 p-2 text-xs"
              >
                <div className="font-medium text-slate-700">{r.label}</div>
                <div className="mt-1 text-sm text-slate-900">
                  {r.value && r.value.trim().length > 0 ? r.value : "Not captured yet"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type Row = { label: string; value: string | null };

function buildRows(v: VehicleSummary | null): Row[] {
  if (!v) {
    return [
      { label: "Vehicle status", value: null },
      { label: "Make and model", value: null },
      { label: "Registration", value: null },
      { label: "Purchase price", value: null },
      { label: "Business use percentage", value: null },
    ];
  }
  const rows: Row[] = [
    { label: "Vehicle status", value: v.status },
    { label: "Make and model", value: v.make_model },
    { label: "Registration", value: v.registration },
    { label: "Fuel type", value: v.fuel },
  ];
  if (v.status && v.status !== "Leased" && v.status !== "Rented" && v.status !== "No vehicle") {
    rows.push(
      { label: "Purchase date", value: formatDate(v.purchase_date) },
      { label: "Purchase price", value: formatPence(v.purchase_price_pence) },
      { label: "New or used", value: v.new_or_used },
      { label: "CO2 (g/km)", value: v.co2_gpkm != null ? String(v.co2_gpkm) : null },
    );
  }
  rows.push({
    label: "Business use percentage",
    value: v.business_pct_override != null ? v.business_pct_override + "%" : null,
  });
  return rows;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function formatPence(pence: number | null): string | null {
  if (pence == null) return null;
  return "£" + (pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
