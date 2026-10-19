"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  setPchDocStatusAction,
  uploadPchDocumentAction,
  submitForReviewAction,
  recordClientApprovalAction,
} from "@/app/client/pch/actions";
import { startAddonCheckoutAction } from "@/app/client/actions";
import { AddonPayBanner } from "../addon-pay-banner";
import { FinalPackReview } from "./final-pack-review";
import { IdentitySection, type IdentityHead } from "./identity-section";
import { LedgerSection } from "./ledger-section";
import type { BankTransactionView } from "./bank-ledger-table";
import { VehicleSection, type VehicleSummary } from "./vehicle-section";
import {
  ExtractionReview,
  type ExtractionReviewPayload,
} from "./extraction-review";
import { AccountantHelpPrompt } from "./accountant-help-prompt";
import { canRequestAlternative } from "@/lib/pch/ai-interview-slots";
import {
  PriorYearPrompt,
  type PriorYearOption,
} from "./prior-year-prompt";
import { ExtractionSummaryPanel } from "./extraction-summary";
import { canRunDraft } from "@/lib/pch/validation";

// Status-aware workspace for the automated PCH flow.
//
//   submitted     -> editable intake (sections 1-5) + "Submit for
//                    accountant review" button at the bottom.
//   in_review /   -> intake visible read-only, with a "Your accountant
//     prepared       is reviewing" panel. No figures.
//   client_approval -> figures + Approve button. First time the client
//                    sees any number.
//   filed /       -> final figures + confirmation banner.
//     complete
//
// All mutating actions re-check status server-side; the UI changes
// here are UX-first, not the security boundary.

type Slot = {
  code: string; section: string; display_name: string;
  why_we_need_it: string | null; accepted_formats: string; required_rule: string;
  sort_order: number;
};
type DocStatus = { case_id: string; slot_code: string; status: string; note: string | null };
type UploadedDoc = { id: string; file_name: string; uploaded_at: string; requirement_key: string | null };
type IncomeRow = {
  id?: string; source: string; gross_takings_pence: number; platform_fee_pence: number;
  on_trip_miles: number; dead_miles: number; evidence?: string | null; notes?: string | null;
  line_type: "Fares" | "Other" | "VAT";
};
type ExpenseRow = {
  id?: string; label: string; amount_paid_pence: number; evidence?: string | null;
  car_cost: "Yes" | "No" | "Phone";
  category: string; sa103s_box: number;
};
type Head = Record<string, string | number | boolean | null>;
type Vehicle = Record<string, string | number | boolean | null>;

export function PchClientWorkspace(props: {
  caseId: string;
  caseStatus: string;
  head: Head | null;
  incomeLines: IncomeRow[];
  expenseLines: ExpenseRow[];
  vehicle: Vehicle | null;
  docSlots: Slot[];
  docStatus: DocStatus[];
  uploadedDocs: UploadedDoc[];
  extractions: ExtractionReviewPayload[];
  priorYearOptions: PriorYearOption[];
  bankTransactions: BankTransactionView[];
  pendingAddons: Array<{ id: string; description: string; amount_pence: number }>;
  finalPackSentAt: string | null;
  finalPackConfirmedAt: string | null;
  finalPackConfirmedName: string | null;
  messagesPanel: React.ReactNode;
  engineSnapshot: TaxEngineOutput | null;
  engineSnapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  const h2 = "text-lg font-bold mt-10 mb-3 border-b border-slate-200 pb-2";
  const card = "rounded-lg border border-slate-200 bg-white p-4";
  const status = props.caseStatus;
  const editable = status === "submitted";
  const withAccountant = status === "in_review" || status === "prepared";
  const awaitingApproval = status === "client_approval";
  const filed = status === "filed" || status === "complete";

  // Readiness check uses the last-saved income + vehicle state (what
  // the engine would read on Submit for review). Live edits in the
  // forms do not flip the readiness state until the user hits Save in
  // each tab.
  const readiness = useMemo(() => canRunDraft(
    props.incomeLines.map((l) => ({
      grossTakings: (l.gross_takings_pence ?? 0) / 100,
      type: l.line_type,
    })),
    props.vehicle ? {
      odo_start: Number(props.vehicle.odo_start ?? 0) || null,
      odo_end: Number(props.vehicle.odo_end ?? 0) || null,
      method_choice: (props.vehicle.method_choice ?? null) as string | null,
      business_pct_override: Number(props.vehicle.business_pct_override ?? 0) || null,
    } : null,
  ), [props.incomeLines, props.vehicle]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Uber / private-hire drivers return</h1>
        <p className="text-sm text-slate-600 mt-1">
          Case {props.caseId.slice(0, 8)}. Status <strong>{status}</strong>.
        </p>
      </div>

      {awaitingApproval && props.engineSnapshot && !props.approvalAt ? (
        <ApprovalView
          caseId={props.caseId}
          snapshot={props.engineSnapshot}
          snapshotAt={props.engineSnapshotAt}
          approvalAt={props.approvalAt}
          approvalName={props.approvalName}
        />
      ) : awaitingApproval && props.finalPackSentAt ? (
        <FinalPackReview
          caseId={props.caseId}
          sentAt={props.finalPackSentAt}
          confirmedAt={props.finalPackConfirmedAt}
          confirmedName={props.finalPackConfirmedName}
          prefillName={(props.head?.cl_name as string | undefined) ?? props.approvalName ?? ""}
        />
      ) : awaitingApproval && props.approvalAt ? (
        <section className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div
            className="text-[11px] font-semibold uppercase tracking-widest text-slate-700"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Awaiting final pack from your accountant
          </div>
          <h2 className="mt-1 text-base font-semibold text-ink">
            Figures approved on {new Date(props.approvalAt).toLocaleString("en-GB")}
          </h2>
          <p className="mt-1 text-xs text-slate-700">
            Your accountant is preparing the final accounts pack. You&apos;ll be prompted to review and confirm it here once it&apos;s ready.
          </p>
        </section>
      ) : filed && props.engineSnapshot ? (
        <FiledView
          snapshot={props.engineSnapshot}
          approvalAt={props.approvalAt}
          approvalName={props.approvalName}
        />
      ) : (
        <>
          {withAccountant ? (
            <WithAccountantBanner />
          ) : null}

          {props.pendingAddons.length > 0
            ? props.pendingAddons.map((a) => (
                <AddonPayBanner
                  key={a.id}
                  addonId={a.id}
                  amountPence={a.amount_pence}
                  description={a.description}
                  startCheckout={startAddonCheckoutAction}
                />
              ))
            : null}

          {props.priorYearOptions.length > 0 ? (
            <PriorYearPrompt
              parentCaseId={props.caseId}
              years={props.priorYearOptions}
              editable={editable}
            />
          ) : null}

          <ExtractionSummaryPanel extractions={props.extractions} />

          <fieldset disabled={!editable} className={editable ? "" : "opacity-80"}>
            <h2 className={h2}>1. Documents</h2>
            <DocSection
              caseId={props.caseId}
              slots={props.docSlots}
              status={props.docStatus}
              uploaded={props.uploadedDocs}
              extractions={props.extractions}
              editable={editable}
            />

            <h2 className={h2}>2. Your identity</h2>
            <div className={card}>
              <IdentitySection
                caseId={props.caseId}
                head={headToIdentity(props.head ?? {})}
                editable={editable}
              />
            </div>

            {props.bankTransactions.length > 0 ? (
              <>
                <h2 className={h2}>3. Your bookkeeping (from your bank)</h2>
                <div className={card}>
                  <LedgerSection
                    caseId={props.caseId}
                    transactions={props.bankTransactions}
                    editable={editable}
                  />
                </div>
              </>
            ) : null}

            <h2 className={h2}>4. Vehicle and capital allowances</h2>
            <div className={card}>
              <VehicleSection
                caseId={props.caseId}
                vehicle={vehicleToSummary(props.vehicle)}
                editable={editable}
              />
            </div>
          </fieldset>

          {editable ? (
            <SubmitForReviewSection caseId={props.caseId} readiness={readiness} />
          ) : null}
        </>
      )}

      <div className="mt-10">{props.messagesPanel}</div>
    </main>
  );
}

// Banner shown while the accountant is working. Replaces the figures
// view the client used to see so there's no risk of them acting on
// a draft number before the accountant has validated it.
function WithAccountantBanner() {
  return (
    <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 p-4">
      <p className="text-sm font-semibold text-sky-900">
        Your return is with your accountant.
      </p>
      <p className="mt-1 text-xs text-sky-800">
        They are reviewing what you sent and preparing your figures. You will
        get a notification when they are ready for your approval. Your intake
        below is read-only while they work.
      </p>
    </div>
  );
}

// First time the client sees any number: the accountant has advanced
// the case to client_approval. One click signs off and files.
function ApprovalView(props: {
  caseId: string;
  snapshot: TaxEngineOutput;
  snapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Your figures are ready for your approval.
        </p>
        <p className="mt-1 text-xs text-emerald-800">
          Your accountant has prepared the Self Assessment numbers below.
          Review them, then approve to file. Message your accountant first if
          anything looks wrong.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <SnapshotTable s={props.snapshot} />
      </div>
      <ApprovalSection
        caseId={props.caseId}
        snapshotAt={props.snapshotAt}
        approvalAt={props.approvalAt}
        approvalName={props.approvalName}
      />
    </div>
  );
}

// Terminal view once the client has signed off.
function FiledView(props: {
  snapshot: TaxEngineOutput;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">
          Approved and filed.
        </p>
        {props.approvalAt && props.approvalName ? (
          <p className="mt-1 text-xs text-emerald-800">
            Approved by {props.approvalName} on{" "}
            {new Date(props.approvalAt).toLocaleString()}.
          </p>
        ) : null}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <SnapshotTable s={props.snapshot} />
      </div>
    </div>
  );
}

// Replaces the old "Run draft" button. One click runs the engine
// server-side, auto-assigns an accountant, and advances the case.
function SubmitForReviewSection({
  caseId, readiness,
}: {
  caseId: string;
  readiness: { ok: boolean; blockers: string[] };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const submit = () => start(async () => {
    const r = await submitForReviewAction(caseId);
    if (!r.ok) setErr(r.error);
    else { setErr(null); router.refresh(); }
  });
  return (
    <div className="mt-10 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold mb-1">Ready to send to your accountant?</h2>
      <p className="text-sm text-slate-600 mb-3">
        Once you submit, your accountant takes over and prepares your figures.
        You will get a notification when they are ready for your approval. You
        will not be able to edit the intake while they work, so make sure
        everything above is complete and correct.
      </p>
      {!readiness.ok ? (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold mb-1">A few things first:</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs">
            {readiness.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !readiness.ok}
          className="rounded bg-slate-900 px-4 py-2 text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? "Submitting..." : "Submit for accountant review"}
        </button>
        {err ? <span className="text-xs text-red-600">{err}</span> : null}
      </div>
    </div>
  );
}

// -------------------- Documents --------------------

function DocSection({
  caseId, slots, status, uploaded, extractions, editable = true,
}: {
  caseId: string; slots: Slot[]; status: DocStatus[]; uploaded: UploadedDoc[];
  extractions: ExtractionReviewPayload[];
  editable?: boolean;
}) {
  const router = useRouter();
  const statusByCode = new Map(status.map((s) => [s.slot_code, s]));
  const uploadedByKey = new Map<string, UploadedDoc[]>();
  for (const d of uploaded) {
    const key = d.requirement_key ?? "";
    if (!uploadedByKey.has(key)) uploadedByKey.set(key, []);
    uploadedByKey.get(key)!.push(d);
  }
  const extractionsBySlot = new Map<string, ExtractionReviewPayload[]>();
  for (const e of extractions) {
    const list = extractionsBySlot.get(e.slotCode) ?? [];
    list.push(e);
    extractionsBySlot.set(e.slotCode, list);
  }
  const sections = Array.from(new Set(slots.map((s) => s.section)));
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section}>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600 mb-2">{section}</h3>
          <div className="space-y-2">
            {slots.filter((s) => s.section === section).map((s) => (
              <DocRow
                key={s.code}
                caseId={caseId}
                slot={s}
                status={statusByCode.get(s.code)}
                uploaded={uploadedByKey.get(s.code) ?? []}
                extractions={extractionsBySlot.get(s.code) ?? []}
                canEdit={editable}
                onChanged={() => router.refresh()}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DocRow({
  caseId, slot, status, uploaded, extractions, canEdit, onChanged,
}: {
  caseId: string; slot: Slot; status: DocStatus | undefined;
  uploaded: UploadedDoc[]; extractions: ExtractionReviewPayload[];
  canEdit: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const inputId = `up-${slot.code}`;
  const isRequired = /^Required/i.test(slot.required_rule);
  const effectiveStatus =
    status?.status ?? (uploaded.length ? "Uploaded" : "Awaiting");
  // Phase 6 Slice 7: the per-slot AI-interview path (PCH-01/02/03) is
  // gone; the only non-upload option left is the accountant-help
  // request. Shown on non-mandatory slots once no help request is
  // already in flight.
  const helpAvailable =
    canEdit
    && canRequestAlternative(slot.code)
    && effectiveStatus !== "Awaiting accountant";
  const onPick = async (file: File) => {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    // Any network / body-size / server error has to clear the busy
    // state and surface a message; otherwise the Upload label is stuck
    // at "Uploading..." forever and the client has no idea what happened.
    try {
      const r = await uploadPchDocumentAction(caseId, slot.code, fd);
      if (!r.ok) setErr(r.error);
    } catch (e) {
      setErr(
        e instanceof Error
          ? "Upload failed: " + e.message
          : "Upload failed. Try again, and if it keeps failing, re-save the file smaller.",
      );
    } finally {
      setBusy(false);
    }
    onChanged();
  };
  const markNA = async () => {
    setBusy(true); setErr(null);
    const r = await setPchDocStatusAction(caseId, slot.code, "Not applicable");
    setBusy(false);
    if (!r.ok) setErr(r.error);
    onChanged();
  };
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">
            <span className="font-mono text-xs text-slate-500 mr-2">{slot.code}</span>
            {slot.display_name}
            {isRequired && <span className="ml-2 text-xs text-red-600">(required)</span>}
            {!isRequired && <span className="ml-2 text-xs text-slate-500">({slot.required_rule})</span>}
          </div>
          {slot.why_we_need_it && (
            <div className="text-xs text-slate-500 mt-1">{slot.why_we_need_it}</div>
          )}
          <div className="text-xs text-slate-400 mt-1">Accepts: {slot.accepted_formats}</div>
        </div>
        <div className="text-right text-xs">
          <span className={
            effectiveStatus === "Uploaded" ? "font-semibold text-emerald-700"
            : effectiveStatus === "Not applicable" ? "text-slate-500"
            : effectiveStatus === "Awaiting accountant" ? "font-semibold text-indigo-700"
            : "text-amber-700"
          }>
            {effectiveStatus === "Awaiting accountant" ? "Awaiting your accountant" : effectiveStatus}
          </span>
        </div>
      </div>
      {uploaded.length > 0 && (
        <ul className="mt-2 text-xs text-slate-600 space-y-1">
          {uploaded.map((u) => (
            <li key={u.id}>• {u.file_name} ({new Date(u.uploaded_at).toLocaleDateString()})</li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <input
          id={inputId}
          type="file"
          accept={
            slot.code === "PCH-14"
              ? ".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              : ".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*"
          }
          className="hidden"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
        />
        <label htmlFor={inputId}
          className={"inline-block cursor-pointer rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 " + (busy ? "opacity-50" : "")}>
          {busy ? "Uploading..." : "Upload"}
        </label>
        {helpAvailable && !helpOpen && (
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            disabled={busy}
            className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          >
            I don&apos;t have this document
          </button>
        )}
        {!isRequired && effectiveStatus !== "Not applicable" && (
          <button type="button" onClick={markNA} disabled={busy}
            className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
            Mark not applicable
          </button>
        )}
        {err && <span className="text-red-600">{err}</span>}
      </div>
      {helpAvailable && helpOpen ? (
        <AccountantHelpPrompt
          caseId={caseId}
          slotCode={slot.code}
          slotLabel={slot.display_name}
          onClose={() => {
            setHelpOpen(false);
            onChanged();
          }}
        />
      ) : null}
      {extractions.length > 0 ? (
        <div className="space-y-2">
          {extractions.map((ext) => (
            <ExtractionReview key={ext.id} ext={ext} canEdit={canEdit} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// -------------------- Tab 1 Identity (Phase 6 Slice 1) ---------------
// Narrows the loose head bag into the typed shape IdentitySection
// consumes. Only the six fields the section actually renders.

function headToIdentity(h: Head): IdentityHead {
  const str = (k: string): string | null => {
    const v = h[k];
    return typeof v === "string" ? v : v == null ? null : String(v);
  };
  return {
    cl_name: str("cl_name"),
    cl_dob: str("cl_dob"),
    cl_address: str("cl_address"),
    cl_postcode: str("cl_postcode"),
    cl_utr: str("cl_utr"),
    cl_nino: str("cl_nino"),
  };
}

function vehicleToSummary(v: Vehicle | null): VehicleSummary | null {
  if (!v) return null;
  const str = (k: string): string | null => {
    const x = v[k];
    return typeof x === "string" ? x : x == null ? null : String(x);
  };
  const num = (k: string): number | null => {
    const x = v[k];
    if (x == null) return null;
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? n : null;
  };
  return {
    status: str("status"),
    fuel: str("fuel"),
    make_model: str("make_model"),
    registration: str("registration"),
    co2_gpkm: num("co2_gpkm"),
    purchase_date: str("purchase_date"),
    purchase_price_pence: num("purchase_price_pence"),
    new_or_used: str("new_or_used"),
    business_pct_override: num("business_pct_override"),
  };
}


function SnapshotTable({ s }: { s: TaxEngineOutput }) {
  const money = (n: number) =>
    "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (label: string, v: string | number) => (
    <tr><td className="py-1 pr-4 text-slate-600">{label}</td>
      <td className="py-1 font-medium text-right">{typeof v === "number" ? money(v) : v}</td></tr>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h4 className="text-sm font-bold mb-2">Profit &amp; Loss</h4>
        <table className="w-full text-sm">
          <tbody>
            {row("Turnover", s.pl.turnover)}
            {row("Total expenses", s.pl.expensesTotal)}
            {row("Net profit", s.pl.netProfit)}
            {row("Capital allowances", s.pl.capitalAllowances)}
            {row("Taxable profit", s.pl.taxableProfit)}
          </tbody>
        </table>
      </div>
      <div>
        <h4 className="text-sm font-bold mb-2">Tax &amp; NIC</h4>
        <table className="w-full text-sm">
          <tbody>
            {row("Income tax", s.tax.incomeTax)}
            {row("Class 4 NIC", s.tax.class4)}
            {row("Total due", s.tax.totalTaxAndNic)}
            {row("Balancing payment (31 Jan)", s.tax.balancingPayment)}
            {row("POA each (next year)", s.tax.poaForNextYear)}
            {row("MTD status", s.mtd.status)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Final sign-off control. Only rendered when the parent has confirmed
// status is client_approval and a snapshot exists; both guards also
// enforced server-side by recordClientApprovalAction.
function ApprovalSection({
  caseId, snapshotAt, approvalAt, approvalName,
}: {
  caseId: string; snapshotAt: string | null;
  approvalAt: string | null; approvalName: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  void snapshotAt;

  if (approvalAt && approvalName) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm">
          <strong>Approved and filed</strong> by {approvalName} on{" "}
          {new Date(approvalAt).toLocaleString()}.
        </p>
      </div>
    );
  }
  const submit = () => start(async () => {
    const r = await recordClientApprovalAction(caseId, name);
    if (!r.ok) setErr(r.error);
    else { setErr(null); router.refresh(); }
  });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-sm text-slate-700">
        By typing your name below I approve the attached Profit and Loss Account for the year
        ended 5 April 2026 and authorise my accountant to file the Self Assessment on this
        basis.
      </p>
      <div className="flex items-center gap-3">
        <input
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Type your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" onClick={submit} disabled={pending || name.trim().length < 2}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Filing..." : "Approve and file"}
        </button>
      </div>
      {err && <p className="text-red-600 text-xs">{err}</p>}
    </div>
  );
}
