"use client";

// Section 2: Income.
//
// Three preset rows (Uber / Bolt / Free Now) always appear. Any
// pch_income_lines row whose `source` (case-insensitive) matches one
// of those titles is used as the backing row for that preset; others
// render below as "custom" rows (editable title + delete button).
// "Add income" appends an empty custom row the client can title and
// value.
//
// Every row's amount input live-saves on 500ms debounce; the optional
// "Upload document" button runs a single-shot OCR that fills in the
// amount after the upload lands (via extractIncomeAmountFromUpload
// Action). Nothing is mandatory except the top-level "did you have
// income" implicit answer: an empty section is fine.

import { useEffect, useRef, useState } from "react";
import {
  deletePchIncomeLineAction,
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

const PRESETS: Array<{ title: string }> = [
  { title: "Uber" },
  { title: "Bolt" },
  { title: "Free Now" },
];

function matchesPreset(title: string, source: string): boolean {
  return source.trim().toLowerCase() === title.toLowerCase();
}

type UiRow = {
  key: string;              // stable React key
  id: string | null;        // db id once saved; null until first save
  presetTitle: string | null; // if non-null, title is read-only
  source: string;           // client-visible title
  gross_takings_pence: number;
};

export function Section2Income({
  caseId,
  editable,
  initial,
}: {
  caseId: string;
  editable: boolean;
  initial: IncomeLine[];
}) {
  // Build initial UI rows: each preset gets either the matching DB
  // row or an empty slot; any extras from the DB become custom rows.
  const [rows, setRows] = useState<UiRow[]>(() => {
    const uiRows: UiRow[] = [];
    const used = new Set<string>();
    for (const preset of PRESETS) {
      const match = initial.find(
        (l) => !used.has(l.id) && matchesPreset(preset.title, l.source),
      );
      if (match) {
        used.add(match.id);
        uiRows.push({
          key: match.id,
          id: match.id,
          presetTitle: preset.title,
          source: preset.title,
          gross_takings_pence: match.gross_takings_pence,
        });
      } else {
        uiRows.push({
          key: `preset-${preset.title}`,
          id: null,
          presetTitle: preset.title,
          source: preset.title,
          gross_takings_pence: 0,
        });
      }
    }
    for (const line of initial) {
      if (used.has(line.id)) continue;
      uiRows.push({
        key: line.id,
        id: line.id,
        presetTitle: null,
        source: line.source,
        gross_takings_pence: line.gross_takings_pence,
      });
    }
    return uiRows;
  });

  const addCustom = () => {
    setRows((prev) => [
      ...prev,
      {
        key: "new-" + Math.random().toString(36).slice(2),
        id: null,
        presetTitle: null,
        source: "",
        gross_takings_pence: 0,
      },
    ]);
  };

  const removeRow = async (row: UiRow) => {
    setRows((prev) => prev.filter((r) => r.key !== row.key));
    if (row.id) await deletePchIncomeLineAction(caseId, row.id);
  };

  const patchRow = (key: string, patch: Partial<UiRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const { setSectionDone } = useOptionalIntakeProgress();
  useEffect(() => {
    const lines: IncomeLine[] = rows.map((r) => ({
      id: r.id ?? r.key,
      source: r.source,
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

      <div className="space-y-3">
        {rows.map((row) => (
          <IncomeRow
            key={row.key}
            caseId={caseId}
            editable={editable}
            row={row}
            onPatch={(patch) => patchRow(row.key, patch)}
            onDelete={() => removeRow(row)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addCustom}
        disabled={!editable}
        className="mt-3 rounded-lg border border-dashed border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
      >
        + Add income
      </button>
    </section>
  );
}

function IncomeRow({
  caseId, editable, row, onPatch, onDelete,
}: {
  caseId: string;
  editable: boolean;
  row: UiRow;
  onPatch: (patch: Partial<UiRow>) => void;
  onDelete: () => void;
}) {
  // Fresh pointer to the current row for async callbacks (upload
  // handlers kick off before the next render but need to read the
  // latest id / title the parent has handed us).
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);

  // Title debounced save (custom rows only - preset titles are fixed).
  const title = useDebouncedSave<string>({
    initial: row.source,
    save: async (v) => {
      if (row.presetTitle) return; // preset rows don't change their title
      const trimmed = v.trim();
      if (trimmed.length === 0 && latestRef.current.gross_takings_pence === 0) {
        return;
      }
      const r = await upsertPchIncomeLineAction(caseId, latestRef.current.id, {
        source: trimmed,
      });
      if (!r.ok) throw new Error(r.error);
      if (!latestRef.current.id) onPatch({ id: r.id });
      onPatch({ source: trimmed });
    },
  });

  // Amount: the hook is the sole source of truth for the input's
  // visible value. Pass `penceToStr(row.gross_takings_pence)` as
  // `initial` each render; the hook's own useEffect syncs it in when
  // the user isn't actively typing (OCR autofill via onPatch bumps
  // row.gross_takings_pence and the hook picks it up).
  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.gross_takings_pence),
    save: async (v) => {
      const pence = strToPence(v);
      const id = latestRef.current.id;
      const source = latestRef.current.presetTitle ?? latestRef.current.source.trim();
      if (!id && pence === 0) return; // nothing to save yet
      if (!id && !source) return;     // custom row without title: wait
      if (!id) {
        const r = await upsertPchIncomeLineAction(caseId, null, {
          source,
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
    const source = latestRef.current.presetTitle ?? latestRef.current.source.trim();
    if (!id) {
      if (!source) {
        setUploadErr("Give this row a title first.");
        return;
      }
      const created = await upsertPchIncomeLineAction(caseId, null, {
        source,
        gross_takings_pence: latestRef.current.gross_takings_pence,
      });
      if (!created.ok) {
        setUploadErr(created.error);
        return;
      }
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
      if (!r.ok) {
        setUploadErr(r.error);
        return;
      }
      if (r.gross_takings_pence !== null) {
        onPatch({ gross_takings_pence: r.gross_takings_pence });
        setUploadMsg(`Got ${penceToStr(r.gross_takings_pence)} off your document.`);
      } else {
        setUploadMsg(
          "File saved, but we couldn't read a figure off it. Type it in instead.",
        );
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
            <span>{row.presetTitle ? row.presetTitle : "Platform / source"}</span>
            {!row.presetTitle ? (
              <SaveStatusPill status={title.status} error={title.error} />
            ) : null}
          </div>
          {row.presetTitle ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-ink">
              {row.presetTitle}
            </div>
          ) : (
            <input
              type="text"
              value={title.value}
              onChange={(e) => title.onChange(e.target.value)}
              placeholder="e.g. Just Eat, rent, side-income"
              disabled={!editable}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
            />
          )}
        </label>
        <label className="w-full sm:w-40">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
            <span>Amount</span>
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
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={openPicker}
          disabled={!editable || uploading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
        >
          {uploading ? "Reading..." : "Upload"}
        </button>
        {!row.presetTitle ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={!editable}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Remove
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
          onChange={onFile}
          className="hidden"
        />
      </div>
      {isDragOver ? (
        <p className="mt-2 text-xs font-medium text-sky-800">Drop to upload.</p>
      ) : null}
      {uploadMsg ? (
        <p className="mt-2 text-xs text-emerald-700">{uploadMsg}</p>
      ) : null}
      {uploadErr ? (
        <p className="mt-2 text-xs text-rose-700">{uploadErr}</p>
      ) : null}
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
