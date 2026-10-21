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

import { useState, useTransition } from "react";
import { VehicleInterviewPanel } from "./vehicle-interview-panel";
import { AiInterviewPanel } from "@/components/case/ai-interview-panel";
import { isCaEligibleStatus } from "@/lib/pch/ai-interview-slots";
import {
  markNoVehicleAction,
  markNoVehicleDisposalAction,
  startPchDisposalInterviewAction,
  advancePchDisposalInterviewAction,
  commitPchDisposalInterviewAction,
} from "@/app/client/pch/vehicle-interview-actions";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

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
  // Phase 7 Slice 7.6c: disposal fields drive the sub-panel's captured
  // vs prompt state. Null disposal_date + disposal_proceeds_pence means
  // "no disposal captured"; disposed=true gates the captured summary.
  disposed: boolean;
  disposal_proceeds_pence: number | null;
  disposal_date: string | null;
};

type Props = {
  caseId: string;
  vehicle: VehicleSummary | null;
  editable?: boolean;
};

const EMPTY_VEHICLE: VehicleSummary = {
  status: null,
  fuel: null,
  make_model: null,
  registration: null,
  co2_gpkm: null,
  purchase_date: null,
  purchase_price_pence: null,
  new_or_used: null,
  business_pct_override: null,
  disposed: false,
  disposal_proceeds_pence: null,
  disposal_date: null,
};

export function VehicleSection({ caseId, vehicle: initialVehicle, editable = true }: Props) {
  // Task #14: no reload. markNoVehicleAction and markNoVehicleDisposalAction
  // both write a fixed, known set of fields (see vehicle-interview-actions.ts),
  // so on success we apply that same patch to our own local copy instead of
  // waiting on a server round-trip.
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [open, setOpen] = useState(false);
  const [skipping, startSkip] = useTransition();
  const [skipErr, setSkipErr] = useState<string | null>(null);
  const rows = buildRows(vehicle);
  const captured = rows.some((r) => r.value && r.value.trim().length > 0);
  // markLocalMutation() fires before the request goes out: see the
  // matching comment in extraction-review.tsx's run() for why marking
  // only on success can lose the race against this write's own
  // realtime push on pch_vehicle, a watched table.
  const skipCard = () => startSkip(async () => {
    setSkipErr(null);
    markLocalMutation();
    const r = await markNoVehicleAction(caseId);
    if (!r.ok) {
      setSkipErr(r.error);
      return;
    }
    setVehicle((prev) => ({
      ...(prev ?? EMPTY_VEHICLE),
      status: "No vehicle",
      disposed: false,
      disposal_proceeds_pence: null,
      disposal_date: null,
    }));
  });

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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
            >
              {captured ? "Update my vehicle" : "Let's walk through your vehicle"}
            </button>
            {/* Card-level "no vehicle" shortcut: identical server-side
                effect to answering 'No vehicle' in the full chat. Hidden
                once anything is captured, since the user is clearly past
                the "do I have a vehicle" question at that point. */}
            {!captured ? (
              <button
                type="button"
                onClick={skipCard}
                disabled={skipping}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {skipping ? "Saving..." : "I have no vehicle, skip this"}
              </button>
            ) : null}
            {skipErr ? <span className="text-xs text-rose-700">{skipErr}</span> : null}
          </div>
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

      {isCaEligibleStatus(vehicle?.status) ? (
        <DisposalSubpanel
          caseId={caseId}
          disposed={vehicle?.disposed ?? false}
          proceedsPence={vehicle?.disposal_proceeds_pence ?? null}
          date={vehicle?.disposal_date ?? null}
          canEdit={editable}
          onMarkedNotDisposed={() =>
            setVehicle((prev) => ({
              ...(prev ?? EMPTY_VEHICLE),
              disposed: false,
              disposal_proceeds_pence: null,
              disposal_date: null,
            }))
          }
        />
      ) : null}
    </div>
  );
}

// Phase 7 Slice 7.6c: disposal sub-panel. Gated upstream on CA-eligible
// status (Owned outright / HP / PCP / Loan). Two paths: a one-tap
// "No, I kept the car" button that resolves item 16 in a single click,
// and a "Yes, walk me through disposal" opener that launches the
// VEHICLE_CA_EXT chat. Captured state (disposed=true) replaces both
// with a summary + Update button.
function DisposalSubpanel({
  caseId, disposed, proceedsPence, date, canEdit, onMarkedNotDisposed,
}: {
  caseId: string;
  disposed: boolean;
  proceedsPence: number | null;
  date: string | null;
  canEdit: boolean;
  onMarkedNotDisposed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const markNo = () => start(async () => {
    setErr(null);
    markLocalMutation();
    const r = await markNoVehicleDisposalAction(caseId);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onMarkedNotDisposed();
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Did you sell or part-exchange your car this year?
      </h4>
      {disposed ? (
        <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-0.5">
          <div className="font-semibold mb-0.5">Disposal recorded</div>
          <div>Proceeds: <strong>{proceedsPence != null ? formatPence(proceedsPence) : "Not confirmed"}</strong></div>
          <div>Date: <strong>{date ?? "Not confirmed"}</strong></div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          Sold it, part-exchanged against a new car, scrapped it, or an
          insurance write-off? HMRC calls that a disposal and it changes
          your capital allowances for the year.
        </p>
      )}
      {canEdit ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {disposed ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
            >
              Update my disposal
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={markNo}
                disabled={busy}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy ? "Saving..." : "No, I kept the car"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
              >
                Yes, walk me through it
              </button>
            </>
          )}
        </div>
      ) : null}
      {err ? <div className="mt-2 text-xs text-rose-700">{err}</div> : null}
      {open ? (
        <div className="mt-3">
          <AiInterviewPanel
            caseId={caseId}
            onClose={() => setOpen(false)}
            flowLabel="Vehicle disposal"
            flowSubtitle="Sold, part-exchanged, scrapped, or written off"
            finishedMessage="Thanks, saving the disposal details now."
            commitButtonLabel="Save my disposal"
            commitPendingLabel="Saving..."
            start={startPchDisposalInterviewAction}
            advance={advancePchDisposalInterviewAction}
            commit={commitPchDisposalInterviewAction}
          />
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
