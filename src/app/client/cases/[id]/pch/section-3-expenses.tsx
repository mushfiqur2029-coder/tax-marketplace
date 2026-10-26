"use client";

// Section 3: Expenses.
//
// Phase J: 13 fixed cards, no freeform add. Each slot is one
// pch_expense_lines row keyed by label; the row is only created when
// the client types a non-zero amount or uploads a receipt. Vehicle
// moved out to its own top-level Section 4 (see pch-client-workspace
// .tsx); the airport multi-select is gone, replaced by a single
// "Parking, Congestion & ULEZ" card that reuses the old Parking
// slot's category/box mapping.

import { useEffect, useRef, useState } from "react";
import {
  deleteIntakeAttachmentAction,
  extractExpenseAmountFromUploadAction,
  uploadIntakeAttachmentAction,
  upsertPchExpenseLineAction,
} from "@/app/client/pch/intake-actions";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { isExpensesComplete } from "./intake-completion";
import { useFileDrop, useMultiFileDrop } from "./upload-dropzone";
import type { IntakeAttachment } from "./section-2-income";

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
  // Phase K/L: Cash expense and Other expense are multi-file rows
  // like Cash receipt / Others income on the income side. The other
  // eleven cards stay single-file.
  multiFile?: boolean;
};

// Phase J: 13 fixed cards in exact spec order. MOT and Road Tax are
// now separate rows (reversing Phase F's merge). "Parking, Congestion
// & ULEZ" replaces the old Parking slot + airport multi-select with
// one card using the same category/box mapping as before.
const FIXED_SLOTS: ExpenseSlot[] = [
  { label: "Fuel", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Insurance", category: "Accountancy & insurance", sa103s_box: 14, car_cost: "Yes" },
  { label: "Cleaning", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Repairs & Maintenance", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Licence Fees", category: "Licences & compliance", sa103s_box: 19, car_cost: "No" },
  { label: "Pension", category: "Other expenses", sa103s_box: 19, car_cost: "No" },
  { label: "MOT", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Road Tax", category: "Vehicle running costs", sa103s_box: 12, car_cost: "Yes" },
  { label: "Mobile", category: "Phone & technology", sa103s_box: 18, car_cost: "Phone", helpText: "Phone bills for the year." },
  { label: "Accountancy Fees", category: "Accountancy & insurance", sa103s_box: 14, car_cost: "No", helpText: "Prefilled with what you're paying us for this return. Edit if you paid other fees too." },
  { label: "Parking, Congestion & ULEZ", category: "Congestion, ULEZ, tolls & parking", sa103s_box: 12, car_cost: "Yes", helpText: "Parking, congestion charge, ULEZ, and airport drop-off fees. Not fines." },
  {
    label: "Cash expense",
    category: "Other expenses",
    sa103s_box: 19,
    car_cost: "No",
    helpText: "Cash receipts you kept across the year. Drop multiple files; we read each one and add it to the total.",
    multiFile: true,
  },
  {
    label: "Other expense",
    category: "Other expenses",
    sa103s_box: 19,
    car_cost: "No",
    helpText: "Anything that doesn't fit the categories above. Drop multiple receipts; we read each one and add it to the total.",
    multiFile: true,
  },
];

export function Section3Expenses({
  caseId,
  editable,
  initial,
  caseFeePence,
  attachmentsByLineId,
}: {
  caseId: string;
  editable: boolean;
  initial: ExpenseLine[];
  caseFeePence: number;
  attachmentsByLineId?: Record<string, IntakeAttachment[]>;
}) {
  type UiFixedRow = {
    slot: ExpenseSlot;
    id: string | null;
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

  const patchFixed = (label: string, patch: Partial<UiFixedRow>) => {
    setFixedRows((prev) =>
      prev.map((r) => (r.slot.label === label ? { ...r, ...patch } : r)),
    );
  };

  const { setSectionDone } = useOptionalIntakeProgress();
  useEffect(() => {
    const lines: ExpenseLine[] = fixedRows.map((r) => ({
      id: r.id ?? r.slot.label,
      label: r.slot.label,
      amount_paid_pence: r.amount_pence,
      category: r.slot.category,
      sa103s_box: r.slot.sa103s_box,
      car_cost: r.slot.car_cost,
    }));
    setSectionDone("expenses", isExpensesComplete(lines));
  }, [fixedRows, setSectionDone]);

  return (
    <section id="pch-section-expenses" className="mb-8 scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold">3. Expenses</h2>
      <p className="mb-4 text-xs text-slate-600">
        Everything you spent on the business this year. Round yearly
        totals are fine. Each card has an Upload receipt button that
        reads the amount off a photo or PDF for you.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fixedRows.map((row) =>
          row.slot.multiFile ? (
            <MultiFileExpenseRow
              key={row.slot.label}
              caseId={caseId}
              editable={editable}
              row={row}
              initialAttachments={
                row.id ? attachmentsByLineId?.[row.id] ?? [] : []
              }
              onPatch={(patch) => patchFixed(row.slot.label, patch)}
            />
          ) : (
            <FixedExpenseRow
              key={row.slot.label}
              caseId={caseId}
              editable={editable}
              row={row}
              onPatch={(patch) => patchFixed(row.slot.label, patch)}
            />
          ),
        )}
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

  // Per-row creation lock. If two save paths (amount debounce vs
  // upload handler) fire concurrently while id is still null, both
  // would otherwise insert a new row for the same label. ensureLine
  // Id stores the in-flight create as a promise; concurrent callers
  // await the same promise and share the resulting id. See
  // FixedIncomeRow for the matching comment.
  const creationLockRef = useRef<Promise<string> | null>(null);
  const ensureLineId = async (amount_paid_pence: number): Promise<string> => {
    const existing = latestRef.current.id;
    if (existing) return existing;
    if (creationLockRef.current) return creationLockRef.current;
    const promise = (async () => {
      const r = await upsertPchExpenseLineAction(caseId, null, {
        label: row.slot.label,
        amount_paid_pence,
        category: row.slot.category,
        sa103s_box: row.slot.sa103s_box,
        car_cost: row.slot.car_cost,
      });
      if (!r.ok) throw new Error(r.error);
      latestRef.current = {
        ...latestRef.current,
        id: r.id,
        amount_pence: amount_paid_pence,
      };
      onPatch({ id: r.id, amount_pence: amount_paid_pence });
      return r.id;
    })();
    creationLockRef.current = promise;
    try {
      return await promise;
    } catch (e) {
      creationLockRef.current = null;
      throw e;
    }
  };

  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.amount_pence),
    save: async (v) => {
      const pence = strToPence(v);
      if (!latestRef.current.id && pence === 0) return;
      const id = await ensureLineId(pence);
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
    let id: string;
    try {
      id = await ensureLineId(latestRef.current.amount_pence);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Could not create row.");
      return;
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

// Phase K/L: multi-file variant used by every slot with
// multiFile:true (Cash expense, Other expense). Each dropped/picked
// receipt lands as its own case_documents attachment and its
// extracted amount is added to whatever the £ total currently
// shows. The £ input stays fully editable.
function MultiFileExpenseRow({
  caseId, editable, row, initialAttachments, onPatch,
}: {
  caseId: string;
  editable: boolean;
  row: { slot: ExpenseSlot; id: string | null; amount_pence: number };
  initialAttachments: IntakeAttachment[];
  onPatch: (patch: { id?: string | null; amount_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);

  // Per-row creation lock. See FixedExpenseRow for the matching
  // comment; same race, same fix. Shared by the amount debounce save
  // and the multi-file upload loop so an amount keystroke concurrent
  // with a file drop can't produce two rows for the same label.
  const creationLockRef = useRef<Promise<string> | null>(null);
  const ensureLineId = async (
    amount_paid_pence: number,
  ): Promise<string> => {
    const existing = latestRef.current.id;
    if (existing) return existing;
    if (creationLockRef.current) return creationLockRef.current;
    const promise = (async () => {
      const r = await upsertPchExpenseLineAction(caseId, null, {
        label: row.slot.label,
        amount_paid_pence,
        category: row.slot.category,
        sa103s_box: row.slot.sa103s_box,
        car_cost: row.slot.car_cost,
      });
      if (!r.ok) throw new Error(r.error);
      latestRef.current = {
        ...latestRef.current,
        id: r.id,
        amount_pence: amount_paid_pence,
      };
      onPatch({ id: r.id, amount_pence: amount_paid_pence });
      return r.id;
    })();
    creationLockRef.current = promise;
    try {
      return await promise;
    } catch (e) {
      creationLockRef.current = null;
      throw e;
    }
  };

  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.amount_pence),
    save: async (v) => {
      const pence = strToPence(v);
      if (!latestRef.current.id && pence === 0) return;
      const id = await ensureLineId(pence);
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

  const [attachments, setAttachments] = useState<IntakeAttachment[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  // See section-2-income.tsx MultiFileIncomeRow for the matching
  // comment: ref keeps the running total correct across awaits so a
  // multi-file loop accumulates instead of overwriting.
  const amountRef = useRef(amount.value);
  useEffect(() => { amountRef.current = amount.value; }, [amount.value]);

  const addAttachmentExtracted = (extractedPence: number) => {
    if (extractedPence <= 0) return;
    const currentPence = strToPence(amountRef.current);
    const next = currentPence + extractedPence;
    const nextStr = penceToStr(next);
    amountRef.current = nextStr;
    amount.onChange(nextStr);
  };

  const uploadFiles = async (files: File[]) => {
    setUploading(true);
    setUploadErr(null);
    setNotes([]);
    try {
      let lineId: string;
      try {
        lineId = await ensureLineId(latestRef.current.amount_pence);
      } catch (e) {
        setUploadErr(e instanceof Error ? e.message : "Could not create row.");
        return;
      }
      const nextNotes: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await uploadIntakeAttachmentAction(caseId, "expense", lineId, fd);
        if (!r.ok) {
          setUploadErr(r.error);
          continue;
        }
        setAttachments((prev) => [...prev, { docId: r.doc_id, fileName: r.file_name }]);
        if (r.extracted_pence !== null && r.extracted_pence > 0) {
          addAttachmentExtracted(r.extracted_pence);
          nextNotes.push(`Added ${penceToStr(r.extracted_pence)} off ${r.file_name}.`);
        } else {
          nextNotes.push(`Couldn't read ${r.file_name}; check the total.`);
        }
      }
      setNotes(nextNotes);
    } finally {
      setUploading(false);
    }
  };

  const fileRef = useRef<HTMLInputElement | null>(null);
  const openPicker = () => fileRef.current?.click();
  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;
    await uploadFiles(picked);
  };
  const { dropProps, isDragOver } = useMultiFileDrop({
    onFiles: uploadFiles,
    accept: "application/pdf,image/jpeg,image/png,image/webp,image/heic",
    disabled: !editable || uploading,
  });

  const removeAttachment = async (docId: string) => {
    const previous = attachments;
    setAttachments((prev) => prev.filter((a) => a.docId !== docId));
    const r = await deleteIntakeAttachmentAction(caseId, docId);
    if (!r.ok) {
      setUploadErr(r.error);
      setAttachments(previous);
    }
  };

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
        {uploading ? "Reading..." : "Upload receipts"}
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        onChange={onFileInput}
        className="hidden"
      />
      {isDragOver ? (
        <p className="mt-1 text-[11px] font-medium text-sky-800">Drop to upload. Multiple files are fine.</p>
      ) : null}
      {attachments.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {attachments.map((a) => (
            <li
              key={a.docId}
              className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700"
            >
              <span className="truncate" title={a.fileName}>{a.fileName}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.docId)}
                disabled={!editable}
                aria-label={`Remove ${a.fileName}`}
                className="shrink-0 rounded px-1 text-slate-500 hover:text-rose-700 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px]">
          {notes.map((n, i) => (
            <li
              key={i}
              className={
                n.startsWith("Added")
                  ? "text-emerald-700"
                  : "text-amber-800"
              }
            >
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      {uploadErr ? <p className="mt-1 text-xs text-rose-700">{uploadErr}</p> : null}
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
