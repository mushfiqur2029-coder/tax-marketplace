"use client";

// Section 3: Expenses.
//
// Fixed slot list per spec: Insurance, Cleaning, Road Tax and MOT,
// Road Tax, Mobile, Fuel, Parking, Airport drop-off (multi-select),
// Repairs & Maintenance, Cash expenses, Accountancy Fees (prefilled
// from the case's fee), Pension, Licence Fees. Each slot = one
// pch_expense_lines row keyed on label; a 0 amount is allowed and the
// row isn't created until the client types something or uploads a
// doc. Airport multi expands to one row per selected airport, each
// labelled "Airport: <name>" and classified as parking.
//
// Vehicle subsection sits at the bottom of this section (manual
// form, not AI chat); it writes to pch_vehicle which engine-snapshot
// .ts reads for capital allowances.

import { useEffect, useRef, useState } from "react";
import {
  deletePchExpenseLineAction,
  extractExpenseAmountFromUploadAction,
  upsertPchExpenseLineAction,
} from "@/app/client/pch/intake-actions";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import {
  Section3Vehicle,
  type PersonalAllowanceInitial,
  type VehicleInitial,
} from "./section-3-vehicle";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { isExpensesComplete } from "./intake-completion";
import { useFileDrop } from "./upload-dropzone";

export type ExpenseLine = {
  id: string;
  label: string;
  amount_paid_pence: number;
  category: string;
  sa103s_box: number;
  car_cost: "Yes" | "No" | "Phone";
};

type ExpenseSlot = {
  label: string;
  category: string;
  sa103s_box: 12 | 14 | 16 | 17 | 18 | 19;
  car_cost: "Yes" | "No" | "Phone";
  helpText?: string;
};

// Phase F: Road Tax and MOT / Road Tax collapsed into a single "MOT"
// row per spec.
const FIXED_SLOTS: ExpenseSlot[] = [
  { label: "Insurance", category: "Accountancy & insurance", sa103s_box: 14, car_cost: "Yes" },
  { label: "Cleaning", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "MOT", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Mobile", category: "Phone & technology", sa103s_box: 18, car_cost: "Phone", helpText: "Phone bills for the year." },
  { label: "Fuel", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Parking", category: "Congestion, ULEZ, tolls & parking", sa103s_box: 12, car_cost: "Yes", helpText: "Congestion, ULEZ, parking fees. Not fines." },
  { label: "Repairs & Maintenance", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Cash expenses", category: "Other expenses", sa103s_box: 19, car_cost: "No" },
  { label: "Accountancy Fees", category: "Accountancy & insurance", sa103s_box: 14, car_cost: "No", helpText: "Prefilled with what you paid Sterling Ledger for this return. Edit if you paid other fees too." },
  { label: "Pension", category: "Other expenses", sa103s_box: 19, car_cost: "No" },
  { label: "Licence Fees", category: "Licences & compliance", sa103s_box: 19, car_cost: "No" },
];

const AIRPORT_PREFIX = "Airport: ";
const AIRPORTS: string[] = [
  "Heathrow",
  "Gatwick",
  "Stansted",
  "Luton",
  "London City",
  "Birmingham",
  "Manchester",
  "Edinburgh",
];

export function Section3Expenses({
  caseId,
  editable,
  initial,
  caseFeePence,
  vehicleInitial,
  personalAllowance,
}: {
  caseId: string;
  editable: boolean;
  initial: ExpenseLine[];
  caseFeePence: number;
  vehicleInitial: VehicleInitial;
  personalAllowance: PersonalAllowanceInitial;
}) {
  // Partition initial expense lines into fixed-slot matches + airport
  // rows + "other" rows the client created elsewhere (shouldn't happen
  // via this UI but we don't want to lose data).
  type UiFixedRow = {
    slot: ExpenseSlot;
    id: string | null;
    amount_pence: number;
  };
  type UiAirportRow = {
    key: string;             // stable React key
    id: string | null;
    airport: string;         // "Heathrow", etc.
    amount_pence: number;
  };

  const [fixedRows, setFixedRows] = useState<UiFixedRow[]>(() =>
    FIXED_SLOTS.map((slot) => {
      const match = initial.find((l) => l.label === slot.label);
      const defaultAmount =
        slot.label === "Accountancy Fees" && !match ? caseFeePence : 0;
      return {
        slot,
        id: match?.id ?? null,
        amount_pence: match?.amount_paid_pence ?? defaultAmount,
      };
    }),
  );

  const [airportRows, setAirportRows] = useState<UiAirportRow[]>(() =>
    initial
      .filter((l) => l.label.startsWith(AIRPORT_PREFIX))
      .map((l) => ({
        key: l.id,
        id: l.id,
        airport: l.label.slice(AIRPORT_PREFIX.length),
        amount_pence: l.amount_paid_pence,
      })),
  );

  const addAirport = (airport: string) => {
    if (airport !== "" && airportRows.find((r) => r.airport === airport)) return;
    setAirportRows((prev) => [
      ...prev,
      {
        key: "new-" + Math.random().toString(36).slice(2),
        id: null,
        airport,
        amount_pence: 0,
      },
    ]);
  };

  const removeAirport = async (row: UiAirportRow) => {
    setAirportRows((prev) => prev.filter((r) => r.key !== row.key));
    if (row.id) await deletePchExpenseLineAction(caseId, row.id);
  };
  const patchAirportName = (key: string, name: string) => {
    setAirportRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, airport: name } : r)),
    );
  };

  const patchFixed = (label: string, patch: Partial<UiFixedRow>) => {
    setFixedRows((prev) =>
      prev.map((r) => (r.slot.label === label ? { ...r, ...patch } : r)),
    );
  };
  const patchAirport = (key: string, patch: Partial<UiAirportRow>) => {
    setAirportRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const { setSectionDone } = useOptionalIntakeProgress();
  useEffect(() => {
    // Flatten fixed slots + airport rows into the shared ExpenseLine
    // shape the completion helper expects. Fields other than
    // amount_paid_pence don't influence the check, so defaults are
    // fine where the UI doesn't track them (e.g. category/box).
    const lines: ExpenseLine[] = [
      ...fixedRows.map((r) => ({
        id: r.id ?? r.slot.label,
        label: r.slot.label,
        amount_paid_pence: r.amount_pence,
        category: r.slot.category,
        sa103s_box: r.slot.sa103s_box,
        car_cost: r.slot.car_cost,
      })),
      ...airportRows.map((r) => ({
        id: r.id ?? r.key,
        label: AIRPORT_PREFIX + r.airport,
        amount_paid_pence: r.amount_pence,
        category: "Congestion, ULEZ, tolls & parking",
        sa103s_box: 12 as const,
        car_cost: "Yes" as const,
      })),
    ];
    setSectionDone("expenses", isExpensesComplete(lines));
  }, [fixedRows, airportRows, setSectionDone]);

  return (
    <section id="pch-section-expenses" className="mb-8 scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold">3. Expenses</h2>
      <p className="mb-4 text-xs text-slate-600">
        Everything you spent on the business this year. Round yearly
        totals are fine. Each row has an Upload receipt button that
        reads the amount off a photo or PDF for you.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fixedRows.map((row) => (
          <FixedExpenseRow
            key={row.slot.label}
            caseId={caseId}
            editable={editable}
            row={row}
            onPatch={(patch) => patchFixed(row.slot.label, patch)}
          />
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-bold text-ink">Airport drop-off charges</div>
        <p className="mb-3 text-xs text-slate-600">
          Pick each airport you dropped off at and type the yearly total
          you were charged.
        </p>
        <div className="flex flex-wrap gap-2">
          {AIRPORTS.map((airport) => {
            const picked = !!airportRows.find((r) => r.airport === airport);
            return (
              <button
                key={airport}
                type="button"
                onClick={() => addAirport(airport)}
                disabled={!editable || picked}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                  (picked
                    ? "border border-sky bg-sky/10 text-sky"
                    : "border border-slate-300 bg-white text-slate-700 hover:border-sky hover:text-sky")
                }
              >
                {airport}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => addAirport("")}
            disabled={!editable}
            className="rounded-full border border-dashed border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
          >
            + Other airport
          </button>
        </div>
        {airportRows.length > 0 ? (
          <div className="mt-4 space-y-2">
            {airportRows.map((row) => (
              <AirportRow
                key={row.key}
                caseId={caseId}
                editable={editable}
                row={row}
                onPatch={(patch) => patchAirport(row.key, patch)}
                onNameChange={(name) => patchAirportName(row.key, name)}
                onDelete={() => removeAirport(row)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div id="pch-section-vehicle" className="mt-8 scroll-mt-24">
        <Section3Vehicle
          caseId={caseId}
          editable={editable}
          initial={vehicleInitial}
          personalAllowance={personalAllowance}
        />
      </div>
    </section>
  );
}

function FixedExpenseRow({
  caseId, editable, row, onPatch,
}: {
  caseId: string;
  editable: boolean;
  row: { slot: ExpenseSlot; id: string | null; amount_pence: number };
  onPatch: (patch: { id?: string | null; amount_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);

  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.amount_pence),
    save: async (v) => {
      const pence = strToPence(v);
      const id = latestRef.current.id;
      if (!id && pence === 0) return;
      if (!id) {
        const r = await upsertPchExpenseLineAction(caseId, null, {
          label: row.slot.label,
          amount_paid_pence: pence,
          category: row.slot.category,
          sa103s_box: row.slot.sa103s_box,
          car_cost: row.slot.car_cost,
        });
        if (!r.ok) throw new Error(r.error);
        onPatch({ id: r.id, amount_pence: pence });
        return;
      }
      const r = await upsertPchExpenseLineAction(caseId, id, {
        label: row.slot.label,
        amount_paid_pence: pence,
        category: row.slot.category,
        sa103s_box: row.slot.sa103s_box,
        car_cost: row.slot.car_cost,
      });
      if (!r.ok) throw new Error(r.error);
      onPatch({ amount_pence: pence });
    },
  });

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const openPicker = () => fileRef.current?.click();
  const uploadFile = async (file: File) => {
    let id = latestRef.current.id;
    if (!id) {
      const created = await upsertPchExpenseLineAction(caseId, null, {
        label: row.slot.label,
        amount_paid_pence: latestRef.current.amount_pence,
        category: row.slot.category,
        sa103s_box: row.slot.sa103s_box,
        car_cost: row.slot.car_cost,
      });
      if (!created.ok) { setUploadErr(created.error); return; }
      id = created.id;
      onPatch({ id });
    }

    setUploading(true);
    setUploadErr(null);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await extractExpenseAmountFromUploadAction(caseId, id, fd);
      if (!r.ok) { setUploadErr(r.error); return; }
      if (r.amount_paid_pence !== null) {
        onPatch({ amount_pence: r.amount_paid_pence });
        setUploadMsg(`Got ${penceToStr(r.amount_paid_pence)} off your receipt.`);
      } else {
        setUploadMsg("File saved. We couldn't read the amount; type it in instead.");
      }
    } catch (ex) {
      setUploadErr(ex instanceof Error ? ex.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await uploadFile(file);
  };
  const { dropProps, isDragOver } = useFileDrop({
    onFile: uploadFile,
    accept: "application/pdf,image/jpeg,image/png,image/webp,image/heic",
    disabled: !editable || uploading,
  });

  return (
    <div
      {...dropProps}
      className={
        "rounded-xl border bg-white p-4 transition "
        + (isDragOver ? "border-sky ring-2 ring-sky/30" : "border-slate-200")
      }
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>{row.slot.label}</span>
        <SaveStatusPill status={amount.status} error={amount.error} />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm text-slate-500">£</span>
        <input
          type="text"
          inputMode="decimal"
          value={amount.value}
          onChange={(e) => amount.onChange(cleanMoneyInput(e.target.value))}
          placeholder="0.00"
          disabled={!editable}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
        />
      </div>
      {row.slot.helpText ? (
        <p className="mt-1 text-[11px] text-slate-500">{row.slot.helpText}</p>
      ) : null}
      <button
        type="button"
        onClick={openPicker}
        disabled={!editable || uploading}
        className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
      >
        {uploading ? "Reading..." : "Upload receipt"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        onChange={onFile}
        className="hidden"
      />
      {isDragOver ? (
        <p className="mt-1 text-[11px] font-medium text-sky-800">Drop to upload.</p>
      ) : null}
      {uploadMsg ? <p className="mt-1 text-xs text-emerald-700">{uploadMsg}</p> : null}
      {uploadErr ? <p className="mt-1 text-xs text-rose-700">{uploadErr}</p> : null}
    </div>
  );
}

function AirportRow({
  caseId, editable, row, onPatch, onNameChange, onDelete,
}: {
  caseId: string;
  editable: boolean;
  row: { key: string; id: string | null; airport: string; amount_pence: number };
  onPatch: (patch: { id?: string | null; amount_pence?: number }) => void;
  onNameChange: (name: string) => void;
  onDelete: () => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);

  // Free-text "Other airport" rows need their name saved as part of
  // the label on the pch_expense_lines row. Any row that was created
  // from a preset airport chip has its name fixed, so for those the
  // name hook is effectively a no-op.
  const nameHook = useDebouncedSave<string>({
    initial: row.airport,
    save: async (v) => {
      const trimmed = v.trim();
      onNameChange(trimmed);
      const id = latestRef.current.id;
      if (!id) return; // row not yet created; amount save creates it
      const r = await upsertPchExpenseLineAction(caseId, id, {
        label: AIRPORT_PREFIX + trimmed,
        amount_paid_pence: latestRef.current.amount_pence,
        category: "Congestion, ULEZ, tolls & parking",
        sa103s_box: 12,
        car_cost: "Yes",
      });
      if (!r.ok) throw new Error(r.error);
    },
  });

  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.amount_pence),
    save: async (v) => {
      const pence = strToPence(v);
      const id = latestRef.current.id;
      const airportName = latestRef.current.airport.trim();
      if (!airportName) return; // free-text row without a name yet
      if (!id && pence === 0) return;
      const label = AIRPORT_PREFIX + airportName;
      if (!id) {
        const r = await upsertPchExpenseLineAction(caseId, null, {
          label,
          amount_paid_pence: pence,
          category: "Congestion, ULEZ, tolls & parking",
          sa103s_box: 12,
          car_cost: "Yes",
        });
        if (!r.ok) throw new Error(r.error);
        onPatch({ id: r.id, amount_pence: pence });
        return;
      }
      const r = await upsertPchExpenseLineAction(caseId, id, {
        label,
        amount_paid_pence: pence,
        category: "Congestion, ULEZ, tolls & parking",
        sa103s_box: 12,
        car_cost: "Yes",
      });
      if (!r.ok) throw new Error(r.error);
      onPatch({ amount_pence: pence });
    },
  });

  // Free-text row = airport was selected via "+ Other airport" (empty
  // on creation) and the row id hasn't been minted yet with a fixed
  // name. Preset chips create rows with the airport name hard-set.
  const isFreeText = row.id === null && row.airport.trim() === "";

  return (
    <div className="flex items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex-1">
        <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
          <span>{isFreeText ? "Airport name" : row.airport || "Airport"}</span>
          <SaveStatusPill status={amount.status} error={amount.error} />
        </div>
        {isFreeText || row.id === null ? (
          <input
            type="text"
            value={nameHook.value}
            onChange={(e) => nameHook.onChange(e.target.value)}
            placeholder="Type airport name"
            disabled={!editable}
            className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
          />
        ) : null}
        <div className="flex items-center gap-1">
          <span className="text-sm text-slate-500">£</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount.value}
            onChange={(e) => amount.onChange(cleanMoneyInput(e.target.value))}
            placeholder="0.00"
            disabled={!editable}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={!editable}
        className="rounded-lg px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}

function SaveStatusPill({
  status, error,
}: {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  if (status === "saving") return <span className="text-[11px] text-slate-500">Saving...</span>;
  if (status === "saved") return <span className="text-[11px] font-medium text-emerald-700">Saved</span>;
  if (status === "error") return <span className="text-[11px] font-medium text-rose-700">{error ?? "Save failed"}</span>;
  return null;
}

function penceToStr(pence: number): string {
  if (!Number.isFinite(pence) || pence === 0) return "";
  return (pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

function strToPence(raw: string): number {
  const trimmed = raw.replace(/,/g, "").trim();
  if (trimmed.length === 0) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function cleanMoneyInput(raw: string): string {
  const stripped = raw.replace(/[^0-9.]/g, "");
  const parts = stripped.split(".");
  if (parts.length <= 1) return stripped;
  return parts[0] + "." + parts.slice(1).join("");
}
