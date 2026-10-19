"use client";

// Phase 6 Slice 5: accountant-side "add charge for extra work" widget
// mounted on the PCH workspace.
//
// Two paths exposed:
//
//   Routine extra (£50, auto-approved): a single click posts the
//      'extra_work_small' preset via requestPresetAddonAction, which
//      inserts at status='pending_payment' straight away (the client
//      sees the pay banner on their next render; AddonPayBanner on
//      the PCH client workspace).
//
//   Custom amount (admin review): standard requestCustomAddonAction
//      path. Takes a short description + GBP amount, admin sees the
//      request in /admin/addon-requests and approves/rejects.
//
// Visible after the client has paid (case.status !== 'draft'), hidden
// once the case completes.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestPresetAddonAction,
  requestCustomAddonAction,
} from "@/app/accountant/actions";

export type AddonRow = {
  id: string;
  description: string;
  amount_pence: number;
  status: "pending_admin" | "pending_payment" | "paid" | "rejected";
  created_at: string;
};

type Props = {
  caseId: string;
  addons: AddonRow[];
};

const SMALL_PRESET_KEY = "extra_work_small";
const SMALL_PRESET_AMOUNT_PENCE = 5000;

export function AddonRequestWidget({ caseId, addons }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "custom">("idle");
  const [customDescription, setCustomDescription] = useState("");
  const [customAmountGbp, setCustomAmountGbp] = useState("");

  const requestSmall = () => start(async () => {
    setErr(null);
    const r = await requestPresetAddonAction(caseId, SMALL_PRESET_KEY);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    router.refresh();
  });

  const requestCustom = () => start(async () => {
    setErr(null);
    const amountPence = Math.round(Number(customAmountGbp) * 100);
    if (!Number.isFinite(amountPence) || amountPence <= 0) {
      setErr("Enter a positive amount.");
      return;
    }
    const description = customDescription.trim();
    if (description.length < 3) {
      setErr("Describe the extra work in at least a short sentence.");
      return;
    }
    const r = await requestCustomAddonAction({ caseId, description, amountPence });
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setMode("idle");
    setCustomDescription("");
    setCustomAmountGbp("");
    router.refresh();
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Add charge for extra work</h2>
        <span className="text-xs text-slate-500">
          Routine extras auto-approve. Larger amounts need admin sign-off.
        </span>
      </header>

      {addons.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {addons.map((a) => (
            <li key={a.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-slate-900">
                  £{(a.amount_pence / 100).toFixed(2)} <span className="text-slate-500">·</span> {a.description}
                </span>
                <StatusPill status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={requestSmall}
          disabled={pending || mode !== "idle"}
          className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          title={`£${(SMALL_PRESET_AMOUNT_PENCE / 100).toFixed(0)} fixed, admin review skipped`}
        >
          {pending && mode === "idle"
            ? "Adding..."
            : `Add routine extra (£${(SMALL_PRESET_AMOUNT_PENCE / 100).toFixed(0)})`}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "custom" ? "idle" : "custom")}
          disabled={pending}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {mode === "custom" ? "Cancel custom" : "Request custom amount"}
        </button>
      </div>

      {mode === "custom" ? (
        <div className="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
          <label className="block text-xs">
            <span className="font-semibold text-slate-700">What is the extra work?</span>
            <input
              type="text"
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="e.g. recalculating the P&L after client found a missing bank account"
              disabled={pending}
            />
          </label>
          <label className="block text-xs">
            <span className="font-semibold text-slate-700">Amount (£)</span>
            <input
              type="number"
              step="1"
              min="1"
              className="mt-1 w-40 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              value={customAmountGbp}
              onChange={(e) => setCustomAmountGbp(e.target.value)}
              placeholder="150"
              disabled={pending}
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={requestCustom}
              disabled={pending}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send to admin for review"}
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <p className="mt-2 text-xs text-rose-700">{err}</p>
      ) : null}
    </section>
  );
}

function StatusPill({ status }: { status: AddonRow["status"] }) {
  const map: Record<AddonRow["status"], { label: string; className: string }> = {
    pending_admin: { label: "Awaiting admin", className: "bg-amber-100 text-amber-800 border-amber-300" },
    pending_payment: { label: "Awaiting client payment", className: "bg-sky-100 text-sky-800 border-sky-300" },
    paid: { label: "Paid", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    rejected: { label: "Rejected", className: "bg-slate-200 text-slate-700 border-slate-300" },
  };
  const chip = map[status];
  return (
    <span className={"inline-block rounded border px-2 py-0.5 text-[10px] font-medium " + chip.className}>
      {chip.label}
    </span>
  );
}
