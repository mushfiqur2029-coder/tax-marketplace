"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxEngineOutput } from "@/lib/tax-engine";
import {
  savePchClientTabAction,
  savePchIncomeLinesAction,
  savePchExpenseLinesAction,
  savePchVehicleAction,
  setPchDocStatusAction,
  uploadPchDocumentAction,
  runEngineAndSnapshotAction,
  recordClientApprovalAction,
} from "@/app/client/pch/actions";

// Compact one-page workspace for the automated PCH flow. Sections:
//   1. Documents (24 slots)
//   2. Tab 1 Client details
//   3. Tab 2 Income lines
//   4. Tab 3 Expense lines
//   5. Tab 4 Vehicle
//   6. Draft output (engine)
//   7. Approval (typed name + timestamp)
//
// Phase 2a: functional-first. Styling is minimal Tailwind. Dynamic rows
// managed as local state; bulk-replace on save so there is no row-level
// CRUD complexity.

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
  engineSnapshot: TaxEngineOutput | null;
  engineSnapshotAt: string | null;
  approvalAt: string | null;
  approvalName: string | null;
}) {
  const h2 = "text-lg font-bold mt-10 mb-3 border-b border-slate-200 pb-2";
  const card = "rounded-lg border border-slate-200 bg-white p-4";
  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Uber / PHV automated return</h1>
        <p className="text-sm text-slate-600 mt-1">
          Case {props.caseId.slice(0, 8)} — status <strong>{props.caseStatus}</strong>
        </p>
      </div>

      <h2 className={h2}>1. Documents</h2>
      <DocSection
        caseId={props.caseId}
        slots={props.docSlots}
        status={props.docStatus}
        uploaded={props.uploadedDocs}
      />

      <h2 className={h2}>2. Your details and other income</h2>
      <div className={card}>
        <ClientTabForm caseId={props.caseId} initial={props.head ?? {}} />
      </div>

      <h2 className={h2}>3. Income from driving</h2>
      <div className={card}>
        <IncomeSection caseId={props.caseId} initial={props.incomeLines} />
      </div>

      <h2 className={h2}>4. Business expenses</h2>
      <div className={card}>
        <ExpenseSection caseId={props.caseId} initial={props.expenseLines} />
      </div>

      <h2 className={h2}>5. Your car, mileage and phone use</h2>
      <div className={card}>
        <VehicleForm caseId={props.caseId} initial={props.vehicle ?? {}} />
      </div>

      <h2 className={h2}>6. Draft figures</h2>
      <DraftSection
        caseId={props.caseId}
        snapshot={props.engineSnapshot}
        snapshotAt={props.engineSnapshotAt}
      />

      <h2 className={h2}>7. Approval</h2>
      <ApprovalSection
        caseId={props.caseId}
        snapshotAt={props.engineSnapshotAt}
        approvalAt={props.approvalAt}
        approvalName={props.approvalName}
      />
    </main>
  );
}

// -------------------- Documents --------------------

function DocSection({
  caseId, slots, status, uploaded,
}: {
  caseId: string; slots: Slot[]; status: DocStatus[]; uploaded: UploadedDoc[];
}) {
  const router = useRouter();
  const statusByCode = new Map(status.map((s) => [s.slot_code, s]));
  const uploadedByKey = new Map<string, UploadedDoc[]>();
  for (const d of uploaded) {
    const key = d.requirement_key ?? "";
    if (!uploadedByKey.has(key)) uploadedByKey.set(key, []);
    uploadedByKey.get(key)!.push(d);
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
  caseId, slot, status, uploaded, onChanged,
}: {
  caseId: string; slot: Slot; status: DocStatus | undefined;
  uploaded: UploadedDoc[]; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputId = `up-${slot.code}`;
  const isRequired = /^Required/i.test(slot.required_rule);
  const effectiveStatus =
    status?.status ?? (uploaded.length ? "Uploaded" : "Awaiting");
  const onPick = async (file: File) => {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await uploadPchDocumentAction(caseId, slot.code, fd);
    setBusy(false);
    if (!r.ok) setErr(r.error);
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
            : "text-amber-700"
          }>
            {effectiveStatus}
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
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
          className="hidden"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
        />
        <label htmlFor={inputId}
          className={"inline-block cursor-pointer rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 " + (busy ? "opacity-50" : "")}>
          {busy ? "Uploading..." : "Upload"}
        </label>
        {!isRequired && effectiveStatus !== "Not applicable" && (
          <button type="button" onClick={markNA} disabled={busy}
            className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
            Mark not applicable
          </button>
        )}
        {err && <span className="text-red-600">{err}</span>}
      </div>
    </div>
  );
}

// -------------------- Tab 1 Client --------------------

function ClientTabForm({ caseId, initial }: { caseId: string; initial: Head }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState<Head>(initial);
  const field = (k: string) => (state[k] ?? "") as string | number;
  const num = (k: string) => Number(state[k] ?? 0);
  const set = (k: string, v: string | number | boolean | null) =>
    setState((s) => ({ ...s, [k]: v }));
  const save = () => start(async () => {
    const r = await savePchClientTabAction(caseId, {
      cl_name: String(state.cl_name ?? ""),
      cl_utr: String(state.cl_utr ?? ""),
      cl_nino: String(state.cl_nino ?? ""),
      cl_dob: state.cl_dob ? String(state.cl_dob) : null,
      cl_address: String(state.cl_address ?? ""),
      cl_postcode: String(state.cl_postcode ?? ""),
      cl_phone: String(state.cl_phone ?? ""),
      cl_email: String(state.cl_email ?? ""),
      cl_licensing_authority: String(state.cl_licensing_authority ?? ""),
      cl_platforms: String(state.cl_platforms ?? ""),
      cl_start_date: state.cl_start_date ? String(state.cl_start_date) : null,
      cl_stop_date: state.cl_stop_date ? String(state.cl_stop_date) : null,
      employment_income_pence: Math.round(Number(state.employment_income_pound ?? 0) * 100),
      paye_pence: Math.round(Number(state.paye_pound ?? 0) * 100),
      rental_profit_pence: Math.round(Number(state.rental_profit_pound ?? 0) * 100),
      bank_interest_pence: Math.round(Number(state.bank_interest_pound ?? 0) * 100),
      marriage_allowance_status: (state.marriage_allowance_status ?? "None") as "None" | "Transferring" | "Receiving",
      personal_pension_net_pence: Math.round(Number(state.personal_pension_net_pound ?? 0) * 100),
      gift_aid_net_pence: Math.round(Number(state.gift_aid_net_pound ?? 0) * 100),
      student_loan_plan: String(state.student_loan_plan ?? ""),
      poa1_due_pence: Math.round(Number(state.poa1_due_pound ?? 0) * 100),
      poa2_due_pence: Math.round(Number(state.poa2_due_pound ?? 0) * 100),
      poa1_paid_pence: Math.round(Number(state.poa1_paid_pound ?? 0) * 100),
      poa2_paid_pence: Math.round(Number(state.poa2_paid_pound ?? 0) * 100),
      gross_rent_received_pence: Math.round(Number(state.gross_rent_received_pound ?? 0) * 100),
      last_year_qi_pence: Math.round(Number(state.last_year_qi_pound ?? 0) * 100),
      vat_registered: Boolean(state.vat_registered),
    });
    setMsg(r.ok ? "Saved" : r.error);
  });
  // Prime "pound" display fields from pence columns if present.
  const px = (penceKey: string, poundKey: string) =>
    state[poundKey] !== undefined ? Number(state[poundKey])
      : state[penceKey] !== undefined ? Number(state[penceKey]) / 100
      : 0;
  const input = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";
  const label = "text-xs font-semibold text-slate-600";
  const grid = "grid grid-cols-1 sm:grid-cols-2 gap-3";
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold">About you</h3>
      <div className={grid}>
        <label className="block"><span className={label}>Full name</span>
          <input className={input} value={String(field("cl_name"))}
            onChange={(e) => set("cl_name", e.target.value)} /></label>
        <label className="block"><span className={label}>UTR</span>
          <input className={input} value={String(field("cl_utr"))}
            onChange={(e) => set("cl_utr", e.target.value)} /></label>
        <label className="block"><span className={label}>NI number</span>
          <input className={input} value={String(field("cl_nino"))}
            onChange={(e) => set("cl_nino", e.target.value)} /></label>
        <label className="block"><span className={label}>Date of birth</span>
          <input type="date" className={input} value={String(field("cl_dob"))}
            onChange={(e) => set("cl_dob", e.target.value)} /></label>
        <label className="block sm:col-span-2"><span className={label}>Address</span>
          <input className={input} value={String(field("cl_address"))}
            onChange={(e) => set("cl_address", e.target.value)} /></label>
        <label className="block"><span className={label}>Postcode</span>
          <input className={input} value={String(field("cl_postcode"))}
            onChange={(e) => set("cl_postcode", e.target.value)} /></label>
        <label className="block"><span className={label}>Mobile</span>
          <input className={input} value={String(field("cl_phone"))}
            onChange={(e) => set("cl_phone", e.target.value)} /></label>
      </div>

      <h3 className="text-sm font-bold mt-4">Your driving work</h3>
      <div className={grid}>
        <label className="block"><span className={label}>Licensing authority (TfL / council)</span>
          <input className={input} value={String(field("cl_licensing_authority"))}
            onChange={(e) => set("cl_licensing_authority", e.target.value)} /></label>
        <label className="block"><span className={label}>Platforms you drove for</span>
          <input className={input} value={String(field("cl_platforms"))}
            onChange={(e) => set("cl_platforms", e.target.value)} /></label>
        <label className="block"><span className={label}>Started driving (if after 6 Apr 2025)</span>
          <input type="date" className={input} value={String(field("cl_start_date"))}
            onChange={(e) => set("cl_start_date", e.target.value)} /></label>
        <label className="block"><span className={label}>Stopped (if before 5 Apr 2026)</span>
          <input type="date" className={input} value={String(field("cl_stop_date"))}
            onChange={(e) => set("cl_stop_date", e.target.value)} /></label>
      </div>

      <h3 className="text-sm font-bold mt-4">Other income (6 Apr 2025 to 5 Apr 2026)</h3>
      <div className={grid}>
        {[
          ["Employment pay (P60/P45 gross) £", "employment_income_pence", "employment_income_pound"],
          ["Tax taken off that pay £", "paye_pence", "paye_pound"],
          ["Rental profit (after expenses) £", "rental_profit_pence", "rental_profit_pound"],
          ["Bank/savings interest £", "bank_interest_pence", "bank_interest_pound"],
        ].map(([label_, pence, pound]) => (
          <label key={pound} className="block"><span className={label}>{label_}</span>
            <input type="number" step="0.01" className={input} value={String(px(pence, pound))}
              onChange={(e) => set(pound, e.target.value)} /></label>
        ))}
      </div>

      <h3 className="text-sm font-bold mt-4">Allowances and reliefs</h3>
      <div className={grid}>
        <label className="block"><span className={label}>Marriage Allowance</span>
          <select className={input} value={String(field("marriage_allowance_status") || "None")}
            onChange={(e) => set("marriage_allowance_status", e.target.value)}>
            <option>None</option><option>Transferring</option><option>Receiving</option>
          </select></label>
        <label className="block"><span className={label}>Personal pension paid (net) £</span>
          <input type="number" step="0.01" className={input} value={String(px("personal_pension_net_pence", "personal_pension_net_pound"))}
            onChange={(e) => set("personal_pension_net_pound", e.target.value)} /></label>
        <label className="block"><span className={label}>Gift Aid paid £</span>
          <input type="number" step="0.01" className={input} value={String(px("gift_aid_net_pence", "gift_aid_net_pound"))}
            onChange={(e) => set("gift_aid_net_pound", e.target.value)} /></label>
        <label className="block"><span className={label}>Student loan plan</span>
          <input className={input} value={String(field("student_loan_plan"))}
            onChange={(e) => set("student_loan_plan", e.target.value)} /></label>
      </div>

      <h3 className="text-sm font-bold mt-4">Payments on account for 2025/26</h3>
      <div className={grid}>
        {[
          ["1st POA due 31 Jan 2026 £", "poa1_due_pence", "poa1_due_pound"],
          ["2nd POA due 31 Jul 2026 £", "poa2_due_pence", "poa2_due_pound"],
          ["1st POA actually paid £", "poa1_paid_pence", "poa1_paid_pound"],
          ["2nd POA actually paid £", "poa2_paid_pence", "poa2_paid_pound"],
        ].map(([label_, pence, pound]) => (
          <label key={pound} className="block"><span className={label}>{label_}</span>
            <input type="number" step="0.01" className={input} value={String(px(pence, pound))}
              onChange={(e) => set(pound, e.target.value)} /></label>
        ))}
      </div>

      <h3 className="text-sm font-bold mt-4">MTD and VAT</h3>
      <div className={grid}>
        <label className="block"><span className={label}>Gross rent received £</span>
          <input type="number" step="0.01" className={input} value={String(px("gross_rent_received_pence", "gross_rent_received_pound"))}
            onChange={(e) => set("gross_rent_received_pound", e.target.value)} /></label>
        <label className="block"><span className={label}>Last year qualifying income £</span>
          <input type="number" step="0.01" className={input} value={String(px("last_year_qi_pence", "last_year_qi_pound"))}
            onChange={(e) => set("last_year_qi_pound", e.target.value)} /></label>
        <label className="block"><span className={label}>VAT registered?</span>
          <select className={input} value={state.vat_registered ? "Yes" : "No"}
            onChange={(e) => set("vat_registered", e.target.value === "Yes")}>
            <option>No</option><option>Yes</option>
          </select></label>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={save} disabled={pending}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Saving..." : "Save details"}
        </button>
        {msg && <span className={msg === "Saved" ? "text-emerald-700 text-xs" : "text-red-600 text-xs"}>{msg}</span>}
      </div>
    </div>
  );
}

// -------------------- Tab 2 Income --------------------

const EMPTY_INCOME: IncomeRow = {
  source: "", gross_takings_pence: 0, platform_fee_pence: 0,
  on_trip_miles: 0, dead_miles: 0, line_type: "Fares",
};

function IncomeSection({ caseId, initial }: { caseId: string; initial: IncomeRow[] }) {
  const [rows, setRows] = useState<IncomeRow[]>(
    initial.length ? initial : [{ ...EMPTY_INCOME, source: "Uber — rides" }]
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<IncomeRow>) =>
    setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const add = () => setRows((rs) => [...rs, { ...EMPTY_INCOME }]);
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const save = () => start(async () => {
    const payload = rows.map((r) => ({
      ...r,
      gross_takings_pence: Math.round(Number(r.gross_takings_pence) * (r.gross_takings_pence > 1000 ? 1 : 100)) || 0,
      // User enters pounds in the field; multiply by 100.
    }));
    // Simpler: enforce the editing contract explicitly as pounds in UI,
    // convert here. Redo payload from scratch using separate pound view.
    const final = rows.map((r) => ({
      source: r.source,
      gross_takings_pence: Math.round(Number(r.gross_takings_pence) * 100),
      platform_fee_pence: Math.round(Number(r.platform_fee_pence) * 100),
      on_trip_miles: Number(r.on_trip_miles) | 0,
      dead_miles: Number(r.dead_miles) | 0,
      evidence: r.evidence ?? undefined,
      notes: r.notes ?? undefined,
      line_type: r.line_type,
    }));
    void payload;
    const r = await savePchIncomeLinesAction(caseId, final);
    setMsg(r.ok ? "Saved" : r.error);
  });
  const inp = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-600">
            <th className="pb-1">Source</th>
            <th className="pb-1 w-24">Gross £</th>
            <th className="pb-1 w-24">Fee £</th>
            <th className="pb-1 w-20">On-trip mi</th>
            <th className="pb-1 w-20">Dead mi</th>
            <th className="pb-1 w-24">Type</th>
            <th className="pb-1 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><input className={inp} value={r.source} onChange={(e) => upd(i, { source: e.target.value })} /></td>
              <td className="py-1 pr-2"><input type="number" step="0.01" className={inp} value={r.gross_takings_pence}
                onChange={(e) => upd(i, { gross_takings_pence: Number(e.target.value) })} /></td>
              <td className="py-1 pr-2"><input type="number" step="0.01" className={inp} value={r.platform_fee_pence}
                onChange={(e) => upd(i, { platform_fee_pence: Number(e.target.value) })} /></td>
              <td className="py-1 pr-2"><input type="number" className={inp} value={r.on_trip_miles}
                onChange={(e) => upd(i, { on_trip_miles: Number(e.target.value) })} /></td>
              <td className="py-1 pr-2"><input type="number" className={inp} value={r.dead_miles}
                onChange={(e) => upd(i, { dead_miles: Number(e.target.value) })} /></td>
              <td className="py-1 pr-2"><select className={inp} value={r.line_type} onChange={(e) => upd(i, { line_type: e.target.value as "Fares" | "Other" | "VAT" })}>
                <option>Fares</option><option>Other</option><option>VAT</option></select></td>
              <td className="py-1"><button type="button" onClick={() => del(i)} className="text-slate-500 hover:text-red-600">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <button type="button" onClick={add} className="text-sm text-slate-700 underline">+ Add row</button>
        <button type="button" onClick={save} disabled={pending}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Saving..." : "Save income"}
        </button>
        {msg && <span className={msg === "Saved" ? "text-emerald-700 text-xs" : "text-red-600 text-xs"}>{msg}</span>}
      </div>
      <p className="text-xs text-slate-500">Enter amounts in pounds. Gross = before platform commission.</p>
    </div>
  );
}

// -------------------- Tab 3 Expenses --------------------

const CATEGORIES = [
  "Vehicle running costs",
  "Vehicle hire, lease & finance",
  "Congestion, ULEZ, tolls & parking",
  "Licences & compliance",
  "Phone & technology",
  "Platform & card fees",
  "Finance & bank charges",
  "Accountancy & insurance",
  "Other expenses",
  "VAT paid (Flat Rate Scheme)",
] as const;

function ExpenseSection({ caseId, initial }: { caseId: string; initial: ExpenseRow[] }) {
  const [rows, setRows] = useState<ExpenseRow[]>(
    initial.length ? initial : [{
      label: "Fuel", amount_paid_pence: 0, car_cost: "Yes",
      category: "Vehicle running costs", sa103s_box: 12,
    }]
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<ExpenseRow>) =>
    setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const add = () => setRows((rs) => [...rs, {
    label: "", amount_paid_pence: 0, car_cost: "No",
    category: "Other expenses", sa103s_box: 19,
  }]);
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const save = () => start(async () => {
    const final = rows.map((r) => ({
      label: r.label,
      amount_paid_pence: Math.round(Number(r.amount_paid_pence) * 100),
      evidence: r.evidence ?? undefined,
      car_cost: r.car_cost,
      category: r.category as (typeof CATEGORIES)[number],
      sa103s_box: Number(r.sa103s_box) as 12 | 14 | 16 | 17 | 18 | 19,
    }));
    const r = await savePchExpenseLinesAction(caseId, final);
    setMsg(r.ok ? "Saved" : r.error);
  });
  const inp = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-600">
            <th className="pb-1">Expense</th>
            <th className="pb-1 w-24">Paid £</th>
            <th className="pb-1 w-28">Car cost?</th>
            <th className="pb-1">Category</th>
            <th className="pb-1 w-20">Box</th>
            <th className="pb-1 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2"><input className={inp} value={r.label} onChange={(e) => upd(i, { label: e.target.value })} /></td>
              <td className="py-1 pr-2"><input type="number" step="0.01" className={inp} value={r.amount_paid_pence}
                onChange={(e) => upd(i, { amount_paid_pence: Number(e.target.value) })} /></td>
              <td className="py-1 pr-2"><select className={inp} value={r.car_cost} onChange={(e) => upd(i, { car_cost: e.target.value as "Yes" | "No" | "Phone" })}>
                <option>Yes</option><option>No</option><option>Phone</option></select></td>
              <td className="py-1 pr-2"><select className={inp} value={r.category} onChange={(e) => upd(i, { category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
              <td className="py-1 pr-2"><select className={inp} value={r.sa103s_box} onChange={(e) => upd(i, { sa103s_box: Number(e.target.value) as 12 | 14 | 16 | 17 | 18 | 19 })}>
                {[12, 14, 16, 17, 18, 19].map((b) => <option key={b} value={b}>{b}</option>)}</select></td>
              <td className="py-1"><button type="button" onClick={() => del(i)} className="text-slate-500 hover:text-red-600">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <button type="button" onClick={add} className="text-sm text-slate-700 underline">+ Add row</button>
        <button type="button" onClick={save} disabled={pending}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Saving..." : "Save expenses"}
        </button>
        {msg && <span className={msg === "Saved" ? "text-emerald-700 text-xs" : "text-red-600 text-xs"}>{msg}</span>}
      </div>
    </div>
  );
}

// -------------------- Tab 4 Vehicle --------------------

function VehicleForm({ caseId, initial }: { caseId: string; initial: Vehicle }) {
  const [state, setState] = useState<Vehicle>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: string | number | boolean | null) =>
    setState((s) => ({ ...s, [k]: v }));
  const val = (k: string) => (state[k] ?? "") as string | number;
  const save = () => start(async () => {
    const r = await savePchVehicleAction(caseId, {
      status: state.status ?? "Owned outright",
      fuel: state.fuel ?? "Petrol",
      make_model: state.make_model ?? null,
      registration: state.registration ?? null,
      co2_gpkm: state.co2_gpkm ? Number(state.co2_gpkm) : null,
      bought_this_year: Boolean(state.bought_this_year),
      purchase_date: state.purchase_date ?? null,
      purchase_price_pence: state.purchase_price_pound
        ? Math.round(Number(state.purchase_price_pound) * 100) : null,
      new_or_used: state.new_or_used ?? null,
      disposed: Boolean(state.disposed),
      disposal_proceeds_pence: state.disposal_proceeds_pound
        ? Math.round(Number(state.disposal_proceeds_pound) * 100) : null,
      odo_start: state.odo_start ? Number(state.odo_start) : null,
      odo_end: state.odo_end ? Number(state.odo_end) : null,
      other_business_miles: Number(state.other_business_miles ?? 0),
      phone_business_pct: state.phone_business_pct_pct
        ? Number(state.phone_business_pct_pct) / 100 : 0.8,
      wdv_brought_forward_pence: state.wdv_brought_forward_pound
        ? Math.round(Number(state.wdv_brought_forward_pound) * 100) : 0,
      previous_method: state.previous_method ?? "First year",
      business_pct_override: state.business_pct_override_pct
        ? Number(state.business_pct_override_pct) / 100 : null,
      method_choice: state.method_choice ?? null,
    });
    setMsg(r.ok ? "Saved" : r.error);
  });
  const inp = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm";
  const lb = "text-xs font-semibold text-slate-600";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label><span className={lb}>How do you have the car?</span>
          <select className={inp} value={String(val("status") || "Owned outright")}
            onChange={(e) => set("status", e.target.value)}>
            <option>Owned outright</option>
            <option>Bought on HP / loan</option>
            <option>Rented weekly (PCO hire)</option>
            <option>Leased</option>
          </select></label>
        <label><span className={lb}>Fuel type</span>
          <select className={inp} value={String(val("fuel") || "Petrol")}
            onChange={(e) => set("fuel", e.target.value)}>
            <option>Petrol</option><option>Diesel</option>
            <option>Hybrid</option><option>Electric</option>
          </select></label>
        <label><span className={lb}>Make and model</span>
          <input className={inp} value={String(val("make_model"))} onChange={(e) => set("make_model", e.target.value)} /></label>
        <label><span className={lb}>Registration</span>
          <input className={inp} value={String(val("registration"))} onChange={(e) => set("registration", e.target.value)} /></label>
        <label><span className={lb}>CO2 (g/km, from V5C)</span>
          <input type="number" className={inp} value={String(val("co2_gpkm"))} onChange={(e) => set("co2_gpkm", e.target.value)} /></label>
        <label><span className={lb}>Odometer 6 Apr</span>
          <input type="number" className={inp} value={String(val("odo_start"))} onChange={(e) => set("odo_start", e.target.value)} /></label>
        <label><span className={lb}>Odometer 5 Apr next</span>
          <input type="number" className={inp} value={String(val("odo_end"))} onChange={(e) => set("odo_end", e.target.value)} /></label>
        <label><span className={lb}>Other business miles</span>
          <input type="number" className={inp} value={String(val("other_business_miles"))} onChange={(e) => set("other_business_miles", e.target.value)} /></label>
        <label><span className={lb}>Phone business use %</span>
          <input type="number" min="0" max="100" className={inp}
            value={String(state.phone_business_pct_pct ?? Math.round(Number(state.phone_business_pct ?? 0.8) * 100))}
            onChange={(e) => set("phone_business_pct_pct", Number(e.target.value))} /></label>
        <label><span className={lb}>Bought in this tax year?</span>
          <select className={inp} value={state.bought_this_year ? "Yes" : "No"}
            onChange={(e) => set("bought_this_year", e.target.value === "Yes")}>
            <option>No</option><option>Yes</option>
          </select></label>
        <label><span className={lb}>Purchase price £</span>
          <input type="number" step="0.01" className={inp}
            value={String(state.purchase_price_pound ?? (state.purchase_price_pence ? Number(state.purchase_price_pence) / 100 : 0))}
            onChange={(e) => set("purchase_price_pound", Number(e.target.value))} /></label>
        <label><span className={lb}>New or used when bought?</span>
          <select className={inp} value={String(val("new_or_used") || "Used")}
            onChange={(e) => set("new_or_used", e.target.value)}>
            <option>New</option><option>Used</option>
          </select></label>
        <label><span className={lb}>Method for 2025/26 (blank = recommended)</span>
          <select className={inp} value={String(val("method_choice") || "")}
            onChange={(e) => set("method_choice", e.target.value || null)}>
            <option value="">(recommended)</option>
            <option>Simplified mileage</option>
            <option>Actual costs</option>
          </select></label>
        <label><span className={lb}>WDV brought forward £ (accountant)</span>
          <input type="number" step="0.01" className={inp}
            value={String(state.wdv_brought_forward_pound ?? (state.wdv_brought_forward_pence ? Number(state.wdv_brought_forward_pence) / 100 : 0))}
            onChange={(e) => set("wdv_brought_forward_pound", Number(e.target.value))} /></label>
        <label><span className={lb}>Previous method</span>
          <select className={inp} value={String(val("previous_method") || "First year")}
            onChange={(e) => set("previous_method", e.target.value)}>
            <option>First year</option>
            <option>Simplified mileage</option>
            <option>Actual costs (capital allowances claimed)</option>
          </select></label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Saving..." : "Save vehicle"}
        </button>
        {msg && <span className={msg === "Saved" ? "text-emerald-700 text-xs" : "text-red-600 text-xs"}>{msg}</span>}
      </div>
    </div>
  );
}

// -------------------- 6. Draft output --------------------

function DraftSection({
  caseId, snapshot, snapshotAt,
}: {
  caseId: string; snapshot: TaxEngineOutput | null; snapshotAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = () => start(async () => {
    const r = await runEngineAndSnapshotAction(caseId);
    if (!r.ok) setErr(r.error);
    else setErr(null);
    router.refresh();
  });
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={run} disabled={pending}
          className="rounded bg-slate-900 px-4 py-1.5 text-white text-sm disabled:opacity-50">
          {pending ? "Running..." : snapshot ? "Re-run draft" : "Run draft"}
        </button>
        {snapshotAt && (
          <span className="text-xs text-slate-500">
            Last run: {new Date(snapshotAt).toLocaleString()}
          </span>
        )}
        {err && <span className="text-red-600 text-xs">{err}</span>}
      </div>
      {snapshot && <SnapshotTable s={snapshot} />}
    </div>
  );
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

// -------------------- 7. Approval --------------------

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

  if (approvalAt && approvalName) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <p className="text-sm">
          <strong>Approved</strong> by {approvalName} on {new Date(approvalAt).toLocaleString()}.
        </p>
        <p className="text-xs text-slate-600 mt-1">
          Your accountant will now complete their 33-point review and request filing.
        </p>
      </div>
    );
  }
  if (!snapshotAt) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Run the draft first, then come back here to approve.
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
        ended 5 April 2026. These have been prepared from information I supplied.
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
          {pending ? "Submitting..." : "Approve"}
        </button>
      </div>
      {err && <p className="text-red-600 text-xs">{err}</p>}
    </div>
  );
}
