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
import {
  addExtraIncomeLineAction,
  deleteIncomeLineAction,
  markLineReviewedAction,
  setLinesPersonalAction,
  updateExtraIncomeLineAction,
} from "@/app/client/pch/bulk-intake-actions";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import { useOptionalIntakeProgress } from "./intake-progress-context";
import { isIncomeComplete } from "./intake-completion";
import { useFileDrop, useMultiFileDrop } from "./upload-dropzone";

export type IncomeLine = {
  id: string;
  source: string;
  gross_takings_pence: number;
  // Phase B optional metadata. Null/undefined on every row that
  // predates migration 0124; the row components only render the
  // "Auto-read, not yet checked" badge when auto_extracted is
  // explicitly true, so manual-path rows show no new chrome.
  auto_extracted?: boolean;
  client_reviewed?: boolean;
  extraction_note?: string | null;
  // Phase B UX fix: true when the extractor judged this line clearly
  // personal (a bank transfer to a named individual, a non-driving
  // subscription, an unrelated salary credit). Only meaningful on an
  // extra row; routes it into the collapsed "Skipped as personal"
  // tray instead of the main review list.
  likely_personal?: boolean;
};

export type IntakeAttachment = { docId: string; fileName: string };

import { INCOME_FIXED_SLOTS, type IncomeSlot } from "@/lib/pch/intake-slots";
import { normalizeLabelCore } from "@/lib/pch/label-normalize";

// Phase J: five fixed sources mirroring the PL.xlsx template rows.
// Lives in src/lib/pch/intake-slots.ts so the accountant P&L review
// surface can agree on the same five labels.
const FIXED_SLOTS = INCOME_FIXED_SLOTS;

function matchesSlot(label: string, source: string): boolean {
  return source.trim().toLowerCase() === label.toLowerCase();
}

export function Section2Income({
  caseId,
  editable,
  initial,
  attachmentsByLineId,
  allowExtraRows,
  extraLines,
}: {
  caseId: string;
  editable: boolean;
  initial: IncomeLine[];
  attachmentsByLineId?: Record<string, IntakeAttachment[]>;
  // Phase B: when the case picked intake_method='auto_upload', the
  // parent passes allowExtraRows=true and separates out any
  // extracted lines that didn't match a fixed slot into extraLines.
  // In the manual path (allowExtraRows undefined / false) nothing
  // extra renders - the section is byte-for-byte unchanged.
  allowExtraRows?: boolean;
  extraLines?: IncomeLine[];
}) {
  type UiRow = {
    slot: IncomeSlot;
    id: string | null;
    gross_takings_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
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
        auto_extracted: match?.auto_extracted ?? false,
        client_reviewed: match?.client_reviewed ?? false,
        extraction_note: match?.extraction_note ?? null,
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

      {allowExtraRows ? (
        <ExtraIncomeRows
          caseId={caseId}
          editable={editable}
          initial={extraLines ?? []}
        />
      ) : null}
    </section>
  );
}

// Phase B extra-rows block: items the bulk-intake extractor couldn't
// match to a fixed slot plus anything the client added via "+ Add
// income row". Each row is editable (debounced label + amount save),
// shows the amber "Auto-read, not yet checked" badge until the
// client acknowledges or edits it, and has a delete button. Only
// rendered when the parent passes allowExtraRows=true (i.e. the
// case picked intake_method='auto_upload').
function ExtraIncomeRows({
  caseId, editable, initial,
}: {
  caseId: string;
  editable: boolean;
  initial: IncomeLine[];
}) {
  type UiExtra = {
    key: string;
    id: string;
    label: string;
    gross_takings_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
    likely_personal: boolean;
  };

  const [extras, setExtras] = useState<UiExtra[]>(() =>
    initial
      .map((l) => ({
        key: l.id,
        id: l.id,
        label: l.source,
        gross_takings_pence: l.gross_takings_pence,
        auto_extracted: l.auto_extracted ?? false,
        client_reviewed: l.client_reviewed ?? false,
        extraction_note: l.extraction_note ?? null,
        likely_personal: l.likely_personal ?? false,
      }))
      // Biggest amounts first, once, on mount. Not re-sorted on edit
      // so a row being typed into doesn't jump around.
      .sort((a, b) => b.gross_takings_pence - a.gross_takings_pence),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsReview = extras.filter((x) => !x.likely_personal);
  const skippedPersonal = extras.filter((x) => x.likely_personal);

  // Repeat transfers to the same payee (very common on a real bank
  // statement, e.g. several "Transfer to self" lines) compress into
  // one row showing the combined total instead of one row each.
  // Grouped purely on the normalized label text; a single-item group
  // renders as the normal fully-editable row, unchanged.
  const needsReviewGroups = groupIncomeExtrasByLabel(needsReview)
    .sort((a, b) => sumIncomePence(b.items) - sumIncomePence(a.items));
  const skippedPersonalGroups = groupIncomeExtrasByLabel(skippedPersonal)
    .sort((a, b) => sumIncomePence(b.items) - sumIncomePence(a.items));

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroupSelected = (ids: string[]) => {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      return next;
    });
  };
  const selectAllNeedsReview = () => {
    setSelected(new Set(needsReview.map((x) => x.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const add = async () => {
    if (!editable || adding) return;
    setAdding(true);
    setErr(null);
    try {
      const r = await addExtraIncomeLineAction(caseId, { label: "", amount_pence: 0 });
      if (!r.ok) { setErr(r.error); return; }
      setExtras((prev) => [
        {
          key: r.id,
          id: r.id,
          label: "",
          gross_takings_pence: 0,
          auto_extracted: false,
          client_reviewed: true,
          extraction_note: null,
          likely_personal: false,
        },
        ...prev,
      ]);
    } finally {
      setAdding(false);
    }
  };

  const removeExtra = async (id: string) => {
    const prev = extras;
    setExtras((xs) => xs.filter((x) => x.id !== id));
    const r = await deleteIncomeLineAction(caseId, id);
    if (!r.ok) {
      setExtras(prev);
      setErr(r.error);
    }
  };

  const patchExtra = (id: string, patch: Partial<UiExtra>) => {
    setExtras((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const setPersonal = async (ids: string[], personal: boolean) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    setErr(null);
    try {
      const r = await setLinesPersonalAction(caseId, "income", ids, personal);
      if (!r.ok) { setErr(r.error); return; }
      setExtras((prev) =>
        prev.map((x) =>
          ids.includes(x.id) ? { ...x, likely_personal: personal, client_reviewed: true } : x,
        ),
      );
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          Other income lines{needsReview.length > 0 ? ` (${needsReview.length})` : ""}
        </h3>
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPersonal([...selected], true)}
              disabled={!editable || bulkBusy}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Not related to my driving work ({selected.size})
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-slate-600">
        Everything else your uploads turned up, plus anything you want
        to add by hand. Edit the label or amount if we got it wrong,
        or select a few and mark them as not related to your driving.
      </p>

      {needsReview.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          Nothing extra yet. Add a line below if you have income that
          doesn't fit the categories above.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={selected.size === needsReview.length ? clearSelection : selectAllNeedsReview}
            className="mb-2 text-[11px] font-medium text-sky hover:underline"
          >
            {selected.size === needsReview.length ? "Deselect all" : "Select all"}
          </button>
          <ul className="mb-3 space-y-1.5">
            {needsReviewGroups.map((g) =>
              g.items.length === 1 ? (
                <ExtraIncomeRow
                  key={g.items[0].key}
                  caseId={caseId}
                  editable={editable}
                  row={g.items[0]}
                  selected={selected.has(g.items[0].id)}
                  onToggleSelect={() => toggleSelected(g.items[0].id)}
                  onPatch={(patch) => patchExtra(g.items[0].id, patch)}
                  onRemove={() => removeExtra(g.items[0].id)}
                />
              ) : (
                <GroupedExtraIncomeRow
                  key={g.key}
                  caseId={caseId}
                  editable={editable}
                  label={g.label}
                  items={g.items}
                  selected={g.items.every((it) => selected.has(it.id))}
                  onToggleSelect={() => toggleGroupSelected(g.items.map((it) => it.id))}
                  onPatchItem={patchExtra}
                  onRemoveItem={removeExtra}
                />
              ),
            )}
          </ul>
        </>
      )}

      {skippedPersonalGroups.length > 0 ? (
        <details className="mb-3 rounded-lg border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">
            Skipped as personal ({skippedPersonal.length})
          </summary>
          <ul className="space-y-1 px-3 pb-3">
            {skippedPersonalGroups.map((g) => (
              <li
                key={g.key}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs text-slate-600"
              >
                <span className="truncate">
                  {g.label || "(no label)"}
                  {g.items.length > 1 ? ` ×${g.items.length}` : ""}, £{penceToStr(sumIncomePence(g.items)) || "0.00"}
                </span>
                <button
                  type="button"
                  onClick={() => setPersonal(g.items.map((it) => it.id), false)}
                  disabled={!editable || bulkBusy}
                  className="shrink-0 text-[11px] font-semibold text-sky hover:underline disabled:opacity-50"
                >
                  Actually, this is related, move to my review list
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <button
        type="button"
        onClick={add}
        disabled={!editable || adding}
        className="w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:border-sky hover:text-sky disabled:opacity-50 sm:w-auto sm:px-4"
      >
        {adding ? "Adding." : "+ Add income row"}
      </button>
      {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
    </div>
  );
}

function ExtraIncomeRow({
  caseId, editable, row, selected, onToggleSelect, onPatch, onRemove,
}: {
  caseId: string;
  editable: boolean;
  row: {
    id: string;
    label: string;
    gross_takings_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
  };
  selected: boolean;
  onToggleSelect: () => void;
  onPatch: (patch: { label?: string; gross_takings_pence?: number; client_reviewed?: boolean }) => void;
  onRemove: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState<boolean>(row.client_reviewed);

  const label = useDebouncedSave<string>({
    initial: row.label,
    save: async (v) => {
      const r = await updateExtraIncomeLineAction(caseId, row.id, { label: v });
      if (!r.ok) throw new Error(r.error);
      setReviewed(true);
      onPatch({ label: v, client_reviewed: true });
    },
  });
  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.gross_takings_pence),
    save: async (v) => {
      const pence = strToPence(v);
      const r = await updateExtraIncomeLineAction(caseId, row.id, {
        amount_pence: pence,
      });
      if (!r.ok) throw new Error(r.error);
      setReviewed(true);
      onPatch({ gross_takings_pence: pence, client_reviewed: true });
    },
  });

  const needsReview = row.auto_extracted && !reviewed;

  const markReviewed = async () => {
    setReviewed(true);
    const r = await markLineReviewedAction(caseId, "income", row.id);
    if (!r.ok) setReviewed(false);
  };

  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    try { await onRemove(); } finally { setRemoving(false); }
  };

  return (
    <li className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={!editable}
          aria-label={`Select ${row.label || "this row"}`}
          className="h-4 w-4 shrink-0 self-start rounded border-slate-300 text-sky sm:self-center"
        />
        {needsReview ? (
          <span
            title="Auto-read, not yet checked"
            className="inline-flex h-2 w-2 shrink-0 self-start rounded-full bg-amber-400 sm:self-center"
          />
        ) : null}
        <input
          type="text"
          value={label.value}
          onChange={(e) => label.onChange(e.target.value)}
          placeholder="What's this for?"
          disabled={!editable}
          maxLength={80}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
        />
        <div className="flex items-center gap-1">
          <span className="text-sm text-slate-500">£</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount.value}
            onChange={(e) => amount.onChange(cleanMoneyInput(e.target.value))}
            placeholder="0.00"
            disabled={!editable}
            className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-sm text-slate-900 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
          />
          {needsReview ? (
            <button
              type="button"
              onClick={markReviewed}
              title="Looks right"
              className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-sky hover:bg-sky/10"
            >
              ✓
            </button>
          ) : null}
          <button
            type="button"
            onClick={remove}
            disabled={!editable || removing}
            aria-label={`Remove ${row.label}`}
            title="Delete row"
            className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          >
            {removing ? "..." : "×"}
          </button>
        </div>
      </div>
      {row.extraction_note ? (
        <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-500">
          From your upload: {row.extraction_note}
        </p>
      ) : null}
    </li>
  );
}

function FixedIncomeRow({
  caseId, editable, row, onPatch,
}: {
  caseId: string;
  editable: boolean;
  row: {
    slot: IncomeSlot;
    id: string | null;
    gross_takings_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
  };
  onPatch: (patch: { id?: string | null; gross_takings_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);
  // Phase B review state. Mirrors row.client_reviewed on mount and
  // flips to true after any save (upsertPchIncomeLineAction also
  // sets the column server-side on update, so this just keeps the
  // amber badge from reappearing after a successful commit). The
  // "Looks right" button sets this too via markLineReviewedAction.
  const [reviewed, setReviewed] = useState<boolean>(row.client_reviewed);
  const needsReview = row.auto_extracted && !reviewed;
  const markReviewed = async () => {
    const current = latestRef.current.id;
    if (!current) {
      setReviewed(true);
      return;
    }
    setReviewed(true);
    const r = await markLineReviewedAction(caseId, "income", current);
    if (!r.ok) setReviewed(false);
  };

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
      // Server-side action also sets client_reviewed=true on update;
      // mirror locally so the badge disappears without waiting on a
      // round-trip refetch.
      setReviewed(true);
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
        <div className="flex items-center gap-2">
          {needsReview ? (
            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
              Auto-read
            </span>
          ) : null}
          <SaveStatusPill status={amount.status} error={amount.error} />
        </div>
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
      {row.extraction_note ? (
        <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-500">
          From your upload: {row.extraction_note}
        </p>
      ) : null}
      {needsReview ? (
        <button
          type="button"
          onClick={markReviewed}
          disabled={!editable}
          className="mt-1 text-[11px] font-semibold text-sky hover:underline disabled:opacity-50"
        >
          Looks right
        </button>
      ) : null}
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
  row: {
    slot: IncomeSlot;
    id: string | null;
    gross_takings_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
  };
  initialAttachments: IntakeAttachment[];
  onPatch: (patch: { id?: string | null; gross_takings_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);
  // Same auto-review state as FixedIncomeRow above; the badge
  // appears next to the SaveStatusPill when auto_extracted and
  // not yet reviewed, and clears on any save or on "Looks right".
  const [reviewed, setReviewed] = useState<boolean>(row.client_reviewed);
  const needsReview = row.auto_extracted && !reviewed;
  const markReviewed = async () => {
    const current = latestRef.current.id;
    if (!current) {
      setReviewed(true);
      return;
    }
    setReviewed(true);
    const r = await markLineReviewedAction(caseId, "income", current);
    if (!r.ok) setReviewed(false);
  };

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
      setReviewed(true);
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
        <div className="flex items-center gap-2">
          {needsReview ? (
            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
              Auto-read
            </span>
          ) : null}
          <SaveStatusPill status={amount.status} error={amount.error} />
        </div>
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
      {row.extraction_note ? (
        <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-500">
          From your upload: {row.extraction_note}
        </p>
      ) : null}
      {needsReview ? (
        <button
          type="button"
          onClick={markReviewed}
          disabled={!editable}
          className="mt-1 text-[11px] font-semibold text-sky hover:underline disabled:opacity-50"
        >
          Looks right
        </button>
      ) : null}
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

// Groups repeat extra-income rows by normalized payee (see
// label-normalize.ts: strips money amounts, generic transaction
// words wherever they appear in the label, and a trailing legal
// suffix like PLC/LTD, so "Whitbread Group PL - salary/wages payment
// (BGC)" and "Payment in from Whitbread Group PLC" both collapse to
// the same group even though the AI worded the two occurrences very
// differently). A blank label (a freshly added, not-yet-typed-into
// row) always gets its own group, keyed by id, so two blank rows
// never merge into an uneditable combined row before the client has
// typed anything.
function groupIncomeExtrasByLabel<
  T extends { id: string; label: string; gross_takings_pence: number },
>(items: T[]): { key: string; label: string; items: T[] }[] {
  const order: string[] = [];
  const map = new Map<string, { label: string; items: T[] }>();
  for (const it of items) {
    const trimmed = it.label.trim();
    const core = normalizeLabelCore(trimmed);
    const key = trimmed.length === 0 ? `id:${it.id}` : core.length > 0 ? core : trimmed.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.items.push(it);
      // Prefer the shortest non-blank label seen for this group as
      // the display label - with word order and filler words varying
      // a lot across occurrences, the shortest wording tends to be
      // the cleanest one to show.
      if (trimmed.length > 0 && trimmed.length < existing.label.trim().length) {
        existing.label = it.label;
      }
    } else {
      map.set(key, { label: it.label, items: [it] });
      order.push(key);
    }
  }
  return order.map((key) => ({ key, label: map.get(key)!.label, items: map.get(key)!.items }));
}

function sumIncomePence(items: { gross_takings_pence: number }[]): number {
  return items.reduce((sum, it) => sum + it.gross_takings_pence, 0);
}

// Compact combined row for a group of 2+ same-label rows: one
// checkbox (selects every row in the group at once), the combined
// total, a "looks right, all" action, a "delete all" action, and an
// expand toggle to see (and individually remove) each underlying
// line if the client needs to correct just one of them.
function GroupedExtraIncomeRow({
  caseId, editable, label, items, selected, onToggleSelect, onPatchItem, onRemoveItem,
}: {
  caseId: string;
  editable: boolean;
  label: string;
  items: {
    id: string;
    gross_takings_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
  }[];
  selected: boolean;
  onToggleSelect: () => void;
  onPatchItem: (id: string, patch: { client_reviewed?: boolean }) => void;
  onRemoveItem: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const totalPence = sumIncomePence(items);
  const anyNeedsReview = items.some((it) => it.auto_extracted && !it.client_reviewed);

  const markAllReviewed = async () => {
    setBusy(true);
    try {
      await Promise.all(items.map((it) => markLineReviewedAction(caseId, "income", it.id)));
      items.forEach((it) => onPatchItem(it.id, { client_reviewed: true }));
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const it of items) await onRemoveItem(it.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          disabled={!editable}
          aria-label={`Select all ${label} lines`}
          className="h-4 w-4 shrink-0 self-start rounded border-slate-300 text-sky sm:self-center"
        />
        {anyNeedsReview ? (
          <span
            title="Auto-read, not yet checked"
            className="inline-flex h-2 w-2 shrink-0 self-start rounded-full bg-amber-400 sm:self-center"
          />
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="min-w-0 flex-1 truncate text-left text-sm text-slate-900 hover:underline"
        >
          {expanded ? "▾" : "▸"} {label || "(no label)"} ×{items.length}
        </button>
        <div className="flex items-center gap-1">
          <span className="shrink-0 text-sm font-semibold text-slate-900">
            £{penceToStr(totalPence) || "0.00"}
          </span>
          {anyNeedsReview ? (
            <button
              type="button"
              onClick={markAllReviewed}
              disabled={!editable || busy}
              title="Looks right, all"
              className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-sky hover:bg-sky/10 disabled:opacity-50"
            >
              ✓
            </button>
          ) : null}
          <button
            type="button"
            onClick={removeAll}
            disabled={!editable || busy}
            aria-label={`Remove all ${label} lines`}
            title="Delete all"
            className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          >
            {busy ? "..." : "×"}
          </button>
        </div>
      </div>
      {expanded ? (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 pl-5">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 text-xs text-slate-600">
              <span className="min-w-0 flex-1 truncate">{it.extraction_note ?? "No note"}</span>
              <span className="shrink-0">£{penceToStr(it.gross_takings_pence) || "0.00"}</span>
              <button
                type="button"
                onClick={() => onRemoveItem(it.id)}
                disabled={!editable}
                aria-label="Remove this one line"
                className="shrink-0 rounded px-1 text-slate-400 hover:text-rose-700 disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
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
