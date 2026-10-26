"use client";

// Section 2: Income.
//
// Phase J: five fixed cards, no freeform add. Each card matches a
// pch_income_lines row by source name; the row is only created when
// the client types a non-zero amount or uploads a document. The card
// layout mirrors the expense cards: label on top, £ amount below, an
// Upload receipt button for optional OCR.
//
// Phase K/L: "Cash receipt" and "Others income" are multi-file rows.
// Each file is uploaded as its own case_documents attachment
// (intake-income-attach-<lineId>) and its extracted amount is added
// to the running £ total. The three platform rows (Uber / Bolt /
// Free Now) stay single-file.

import { useEffect, useRef, useState } from "react";
import {
  deleteIntakeAttachmentAction,
  extractIncomeAmountFromUploadAction,
  uploadIntakeAttachmentAction,
  upsertPchIncomeLineAction,
} from "@/app/client/pch/intake-actions";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { isIncomeComplete } from "./intake-completion";
import { useFileDrop, useMultiFileDrop } from "./upload-dropzone";

export type IncomeLine = {
  id: string;
  source: string;
  gross_takings_pence: number;
};

export type IntakeAttachment = { docId: string; fileName: string };

type IncomeSlot = {
  label: string;        // the client-visible label, also the stored source value
  helpText?: string;
  multiFile?: boolean;  // Phase K: Others income runs the multi-file path
};

// Phase J: five fixed sources mirroring the PL.xlsx template rows.
const FIXED_SLOTS: IncomeSlot[] = [
  { label: "Uber" },
  { label: "Bolt" },
  { label: "Free Now" },
  {
    label: "Cash receipt",
    helpText: "Fares taken in cash across the year. Drop multiple files; we read each one and add it to the total.",
    multiFile: true,
  },
  {
    label: "Others income",
    helpText: "Anything from a platform not listed above. Drop multiple files; we read each one and add it to the total.",
    multiFile: true,
  },
];

function matchesSlot(label: string, source: string): boolean {
  return source.trim().toLowerCase() === label.toLowerCase();
}

export function Section2Income({
  caseId,
  editable,
  initial,
  attachmentsByLineId,
}: {
  caseId: string;
  editable: boolean;
  initial: IncomeLine[];
  attachmentsByLineId?: Record<string, IntakeAttachment[]>;
}) {
  type UiRow = {
    slot: IncomeSlot;
    id: string | null;
    gross_takings_pence: number;
  };

  const [rows, setRows] = useState<UiRow[]>(() => {
    const used = new Set<string>();
    return FIXED_SLOTS.map((slot) => {
      const match = initial.find(
        (l) => !used.has(l.id) && matchesSlot(slot.label, l.source),
      );
      if (match) used.add(match.id);
      return {
        slot,
        id: match?.id ?? null,
        gross_takings_pence: match?.gross_takings_pence ?? 0,
      };
    });
  });

  const patchRow = (label: string, patch: Partial<UiRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.slot.label === label ? { ...r, ...patch } : r)),
    );
  };

  const { setSectionDone } = useOptionalIntakeProgress();
  useEffect(() => {
    const lines: IncomeLine[] = rows.map((r) => ({
      id: r.id ?? r.slot.label,
      source: r.slot.label,
      gross_takings_pence: r.gross_takings_pence,
    }));
    setSectionDone("income", isIncomeComplete(lines));
  }, [rows, setSectionDone]);

  return (
    <section id="pch-section-income" className="mb-8 scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold">2. Income</h2>
      <p className="mb-4 text-xs text-slate-600">
        What each platform paid you across the year, before fees. Round
        yearly totals are fine. Drop in a tax-summary PDF and we'll read
        the amount off it.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((row) =>
          row.slot.multiFile ? (
            <MultiFileIncomeRow
              key={row.slot.label}
              caseId={caseId}
              editable={editable}
              row={row}
              initialAttachments={
                row.id ? attachmentsByLineId?.[row.id] ?? [] : []
              }
              onPatch={(patch) => patchRow(row.slot.label, patch)}
            />
          ) : (
            <FixedIncomeRow
              key={row.slot.label}
              caseId={caseId}
              editable={editable}
              row={row}
              onPatch={(patch) => patchRow(row.slot.label, patch)}
            />
          ),
        )}
      </div>
    </section>
  );
}

function FixedIncomeRow({
  caseId, editable, row, onPatch,
}: {
  caseId: string;
  editable: boolean;
  row: { slot: IncomeSlot; id: string | null; gross_takings_pence: number };
  onPatch: (patch: { id?: string | null; gross_takings_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);

  // Per-row creation lock. If two save paths (amount debounce vs
  // upload handler, or two multi-file iterations) fire concurrently
  // while id is still null, both would otherwise insert a new row for
  // the same label. ensureLineId stores the in-flight create as a
  // promise; concurrent callers await the same promise and share the
  // resulting id instead of racing a second insert.
  //
  // latestRef.current.id is also updated synchronously inside the
  // promise (not just via onPatch's re-render) so a save that already
  // read latestRef.id = null doesn't start a second create after the
  // promise resolves.
  const creationLockRef = useRef<Promise<string> | null>(null);
  const ensureLineId = async (
    gross_takings_pence: number,
  ): Promise<string> => {
    const existing = latestRef.current.id;
    if (existing) return existing;
    if (creationLockRef.current) return creationLockRef.current;
    const promise = (async () => {
      const r = await upsertPchIncomeLineAction(caseId, null, {
        source: row.slot.label,
        gross_takings_pence,
      });
      if (!r.ok) throw new Error(r.error);
      latestRef.current = {
        ...latestRef.current,
        id: r.id,
        gross_takings_pence,
      };
      onPatch({ id: r.id, gross_takings_pence });
      return r.id;
    })();
    creationLockRef.current = promise;
    try {
      return await promise;
    } catch (e) {
      // Clear on failure so a retry can create. On success we leave
      // the lock set; subsequent callers see id on latestRef and
      // return early before even touching the lock.
      creationLockRef.current = null;
      throw e;
    }
  };

  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.gross_takings_pence),
    save: async (v) => {
      const pence = strToPence(v);
      if (!latestRef.current.id && pence === 0) return;
      const id = await ensureLineId(pence);
      // Re-upsert with the current value in case ensureLineId created
      // with a stale value (we were the awaiter, not the creator).
      // Cheap no-op when values match.
      const r = await upsertPchIncomeLineAction(caseId, id, {
        gross_takings_pence: pence,
      });
      if (!r.ok) throw new Error(r.error);
      onPatch({ gross_takings_pence: pence });
    },
  });

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const openPicker = () => fileRef.current?.click();
  const uploadFile = async (file: File) => {
    let id: string;
    try {
      id = await ensureLineId(latestRef.current.gross_takings_pence);
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
      const r = await extractIncomeAmountFromUploadAction(caseId, id, fd);
      if (!r.ok) { setUploadErr(r.error); return; }
      if (r.gross_takings_pence !== null) {
        onPatch({ gross_takings_pence: r.gross_takings_pence });
        setUploadMsg(`Got ${penceToStr(r.gross_takings_pence)} off your document.`);
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
// multiFile:true (Cash receipt, Others income). Each dropped/picked
// file lands as its own case_documents attachment and its extracted
// amount is added to whatever the £ total currently shows. The £
// input stays fully editable; the client can override the running
// total at any time and a subsequent file will add to their typed
// value instead of silently resetting it.
function MultiFileIncomeRow({
  caseId, editable, row, initialAttachments, onPatch,
}: {
  caseId: string;
  editable: boolean;
  row: { slot: IncomeSlot; id: string | null; gross_takings_pence: number };
  initialAttachments: IntakeAttachment[];
  onPatch: (patch: { id?: string | null; gross_takings_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);

  // Amount is the same debounced save as the single-file rows: typing
  // in the input live-updates pch_income_lines.gross_takings_pence,
  // and we also call onChange() programmatically from the file-upload
  // handler to top up the running total.
  // Per-row creation lock (shared by amount save + the multi-file
  // upload loop). See FixedIncomeRow for the full comment; same
  // race, same fix.
  const creationLockRef = useRef<Promise<string> | null>(null);
  const ensureLineId = async (
    gross_takings_pence: number,
  ): Promise<string> => {
    const existing = latestRef.current.id;
    if (existing) return existing;
    if (creationLockRef.current) return creationLockRef.current;
    const promise = (async () => {
      const r = await upsertPchIncomeLineAction(caseId, null, {
        source: row.slot.label,
        gross_takings_pence,
      });
      if (!r.ok) throw new Error(r.error);
      latestRef.current = {
        ...latestRef.current,
        id: r.id,
        gross_takings_pence,
      };
      onPatch({ id: r.id, gross_takings_pence });
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
    initial: penceToStr(row.gross_takings_pence),
    save: async (v) => {
      const pence = strToPence(v);
      if (!latestRef.current.id && pence === 0) return;
      const id = await ensureLineId(pence);
      const r = await upsertPchIncomeLineAction(caseId, id, {
        gross_takings_pence: pence,
      });
      if (!r.ok) throw new Error(r.error);
      onPatch({ gross_takings_pence: pence });
    },
  });

  const [attachments, setAttachments] = useState<IntakeAttachment[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  // Ref mirror of amount.value so that a multi-file upload loop
  // accumulates correctly across awaits. Reading amount.value from
  // the closure would see the pre-loop snapshot every iteration and
  // each new file would overwrite the previous file's addition
  // instead of adding to it. The useEffect keeps the ref in sync
  // with the input (both OCR-driven and user-driven changes).
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
        lineId = await ensureLineId(latestRef.current.gross_takings_pence);
      } catch (e) {
        setUploadErr(e instanceof Error ? e.message : "Could not create row.");
        return;
      }
      const nextNotes: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await uploadIntakeAttachmentAction(caseId, "income", lineId, fd);
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
  // Keep digits + one decimal point only; drop commas and currency.
  const stripped = raw.replace(/[^0-9.]/g, "");
  const parts = stripped.split(".");
  if (parts.length <= 1) return stripped;
  return parts[0] + "." + parts.slice(1).join("");
}
