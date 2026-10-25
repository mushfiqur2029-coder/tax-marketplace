"use client";

// Section 2: Income.
//
// Phase J: five fixed cards, no freeform add. Each card matches a
// pch_income_lines row by source name; the row is only created when
// the client types a non-zero amount or uploads a document. The card
// layout mirrors the expense cards: label on top, £ amount below, an
// Upload receipt button for optional OCR.

import { useEffect, useRef, useState } from "react";
import {
  extractIncomeAmountFromUploadAction,
  upsertPchIncomeLineAction,
} from "@/app/client/pch/intake-actions";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { isIncomeComplete } from "./intake-completion";
import { useFileDrop } from "./upload-dropzone";

export type IncomeLine = {
  id: string;
  source: string;
  gross_takings_pence: number;
};

type IncomeSlot = {
  label: string;        // the client-visible label, also the stored source value
  helpText?: string;
};

// Phase J: five fixed sources mirroring the PL.xlsx template rows.
const FIXED_SLOTS: IncomeSlot[] = [
  { label: "Uber" },
  { label: "Bolt" },
  { label: "Free Now" },
  { label: "Cash receipt", helpText: "Fares taken in cash across the year." },
  { label: "Others income", helpText: "Anything from a platform not listed above." },
];

function matchesSlot(label: string, source: string): boolean {
  return source.trim().toLowerCase() === label.toLowerCase();
}

export function Section2Income({
  caseId,
  editable,
  initial,
}: {
  caseId: string;
  editable: boolean;
  initial: IncomeLine[];
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
        {rows.map((row) => (
          <FixedIncomeRow
            key={row.slot.label}
            caseId={caseId}
            editable={editable}
            row={row}
            onPatch={(patch) => patchRow(row.slot.label, patch)}
          />
        ))}
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

  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.gross_takings_pence),
    save: async (v) => {
      const pence = strToPence(v);
      const id = latestRef.current.id;
      if (!id && pence === 0) return;
      if (!id) {
        const r = await upsertPchIncomeLineAction(caseId, null, {
          source: row.slot.label,
          gross_takings_pence: pence,
        });
        if (!r.ok) throw new Error(r.error);
        onPatch({ id: r.id, gross_takings_pence: pence });
        return;
      }
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
    let id = latestRef.current.id;
    if (!id) {
      const created = await upsertPchIncomeLineAction(caseId, null, {
        source: row.slot.label,
        gross_takings_pence: latestRef.current.gross_takings_pence,
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
