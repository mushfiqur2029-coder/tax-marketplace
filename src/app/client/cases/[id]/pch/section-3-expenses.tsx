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
  savePchVehicleFieldAction,
  uploadIntakeAttachmentAction,
  uploadPrivateUseAttachmentAction,
  upsertPchExpenseLineAction,
} from "@/app/client/pch/intake-actions";
import {
  addExtraExpenseLineAction,
  deleteExpenseLineAction,
  markLineReviewedAction,
  setLinesPersonalAction,
  updateExtraExpenseLineAction,
} from "@/app/client/pch/bulk-intake-actions";
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
  // Phase B optional metadata. Null/undefined on every pre-migration
  // row; the row components only render the "Auto-read, not yet
  // checked" badge when auto_extracted is explicitly true.
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

import { EXPENSE_FIXED_SLOTS, type ExpenseSlot } from "@/lib/pch/intake-slots";

// Phase J: 13 fixed cards in exact spec order. MOT and Road Tax are
// separate rows; "Parking, Congestion & ULEZ" uses the old Parking
// slot's category/box mapping. Lives in src/lib/pch/intake-slots.ts
// so the accountant P&L review surface can agree on the same labels
// and classifications.
const FIXED_SLOTS = EXPENSE_FIXED_SLOTS;

export function Section3Expenses({
  caseId,
  editable,
  initial,
  caseFeePence,
  attachmentsByLineId,
  privateUseInitialPence,
  privateUseAttachments,
  allowExtraRows,
  extraLines,
}: {
  caseId: string;
  editable: boolean;
  initial: ExpenseLine[];
  caseFeePence: number;
  attachmentsByLineId?: Record<string, IntakeAttachment[]>;
  // "Less: Private use" was in the Vehicle section until this change;
  // the amount still lives on pch_vehicle.private_use_amount_pence,
  // and the attachments go to case_documents with requirement_key
  // intake-private-use-attach (one key for all files on this case,
  // no per-line id). Page.tsx reads both and threads them in here.
  privateUseInitialPence: number;
  privateUseAttachments: IntakeAttachment[];
  // Phase B: when the case picked intake_method='auto_upload', the
  // parent passes allowExtraRows=true and the auto-extracted lines
  // that didn't match a fixed slot into extraLines. In the manual
  // path (allowExtraRows undefined / false) nothing extra renders.
  allowExtraRows?: boolean;
  extraLines?: ExpenseLine[];
}) {
  type UiFixedRow = {
    slot: ExpenseSlot;
    id: string | null;
    amount_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
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
        auto_extracted: match?.auto_extracted ?? false,
        client_reviewed: match?.client_reviewed ?? false,
        extraction_note: match?.extraction_note ?? null,
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
        <MultiFilePrivateUseRow
          caseId={caseId}
          editable={editable}
          initialPence={privateUseInitialPence}
          initialAttachments={privateUseAttachments}
        />
      </div>

      {allowExtraRows ? (
        <ExtraExpenseRows
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
// expense row". Mirror of ExtraIncomeRows in section-2-income.tsx;
// only rendered when the parent passes allowExtraRows=true.
function ExtraExpenseRows({
  caseId, editable, initial,
}: {
  caseId: string;
  editable: boolean;
  initial: ExpenseLine[];
}) {
  type UiExtra = {
    key: string;
    id: string;
    label: string;
    amount_paid_pence: number;
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
        label: l.label,
        amount_paid_pence: l.amount_paid_pence,
        auto_extracted: l.auto_extracted ?? false,
        client_reviewed: l.client_reviewed ?? false,
        extraction_note: l.extraction_note ?? null,
        likely_personal: l.likely_personal ?? false,
      }))
      // Biggest amounts first, once, on mount. Not re-sorted on edit
      // so a row being typed into doesn't jump around.
      .sort((a, b) => b.amount_paid_pence - a.amount_paid_pence),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsReview = extras.filter((x) => !x.likely_personal);
  const skippedPersonal = extras.filter((x) => x.likely_personal);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
      const r = await addExtraExpenseLineAction(caseId, {
        label: "",
        amount_pence: 0,
      });
      if (!r.ok) { setErr(r.error); return; }
      setExtras((prev) => [
        {
          key: r.id,
          id: r.id,
          label: "",
          amount_paid_pence: 0,
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
    const r = await deleteExpenseLineAction(caseId, id);
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
      const r = await setLinesPersonalAction(caseId, "expense", ids, personal);
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
          Other expense lines{needsReview.length > 0 ? ` (${needsReview.length})` : ""}
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
          Nothing extra yet. Add a line below if you have expenses
          that don't fit the categories above.
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
            {needsReview.map((x) => (
              <ExtraExpenseRow
                key={x.key}
                caseId={caseId}
                editable={editable}
                row={x}
                selected={selected.has(x.id)}
                onToggleSelect={() => toggleSelected(x.id)}
                onPatch={(patch) => patchExtra(x.id, patch)}
                onRemove={() => removeExtra(x.id)}
              />
            ))}
          </ul>
        </>
      )}

      {skippedPersonal.length > 0 ? (
        <details className="mb-3 rounded-lg border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">
            Skipped as personal ({skippedPersonal.length})
          </summary>
          <ul className="space-y-1 px-3 pb-3">
            {skippedPersonal.map((x) => (
              <li
                key={x.key}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs text-slate-600"
              >
                <span className="truncate">
                  {x.label || "(no label)"}, £{penceToStr(x.amount_paid_pence) || "0.00"}
                </span>
                <button
                  type="button"
                  onClick={() => setPersonal([x.id], false)}
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
        {adding ? "Adding." : "+ Add expense row"}
      </button>
      {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
    </div>
  );
}

function ExtraExpenseRow({
  caseId, editable, row, selected, onToggleSelect, onPatch, onRemove,
}: {
  caseId: string;
  editable: boolean;
  row: {
    id: string;
    label: string;
    amount_paid_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
  };
  selected: boolean;
  onToggleSelect: () => void;
  onPatch: (patch: { label?: string; amount_paid_pence?: number; client_reviewed?: boolean }) => void;
  onRemove: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState<boolean>(row.client_reviewed);

  const label = useDebouncedSave<string>({
    initial: row.label,
    save: async (v) => {
      const r = await updateExtraExpenseLineAction(caseId, row.id, { label: v });
      if (!r.ok) throw new Error(r.error);
      setReviewed(true);
      onPatch({ label: v, client_reviewed: true });
    },
  });
  const amount = useDebouncedSave<string>({
    initial: penceToStr(row.amount_paid_pence),
    save: async (v) => {
      const pence = strToPence(v);
      const r = await updateExtraExpenseLineAction(caseId, row.id, {
        amount_pence: pence,
      });
      if (!r.ok) throw new Error(r.error);
      setReviewed(true);
      onPatch({ amount_paid_pence: pence, client_reviewed: true });
    },
  });

  const needsReview = row.auto_extracted && !reviewed;
  const markReviewed = async () => {
    setReviewed(true);
    const r = await markLineReviewedAction(caseId, "expense", row.id);
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

function FixedExpenseRow({
  caseId, editable, row, onPatch,
}: {
  caseId: string;
  editable: boolean;
  row: {
    slot: ExpenseSlot;
    id: string | null;
    amount_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
  };
  onPatch: (patch: { id?: string | null; amount_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);
  // Phase B review state. Same shape as FixedIncomeRow in
  // section-2-income.tsx: amber badge next to SaveStatusPill when
  // auto_extracted && !client_reviewed, clears on any save or on
  // "Looks right".
  const [reviewed, setReviewed] = useState<boolean>(row.client_reviewed);
  const needsReview = row.auto_extracted && !reviewed;
  const markReviewed = async () => {
    const current = latestRef.current.id;
    if (!current) {
      setReviewed(true);
      return;
    }
    setReviewed(true);
    const r = await markLineReviewedAction(caseId, "expense", current);
    if (!r.ok) setReviewed(false);
  };

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
      // Server-side action also sets client_reviewed=true on update;
      // mirror locally so the amber badge disappears without a
      // refetch round-trip.
      setReviewed(true);
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
// multiFile:true (Cash expense, Other expense). Each dropped/picked
// receipt lands as its own case_documents attachment and its
// extracted amount is added to whatever the £ total currently
// shows. The £ input stays fully editable.
function MultiFileExpenseRow({
  caseId, editable, row, initialAttachments, onPatch,
}: {
  caseId: string;
  editable: boolean;
  row: {
    slot: ExpenseSlot;
    id: string | null;
    amount_pence: number;
    auto_extracted: boolean;
    client_reviewed: boolean;
    extraction_note: string | null;
  };
  initialAttachments: IntakeAttachment[];
  onPatch: (patch: { id?: string | null; amount_pence?: number }) => void;
}) {
  const latestRef = useRef(row);
  useEffect(() => { latestRef.current = row; }, [row]);
  // Phase B review state; same shape as FixedExpenseRow above and
  // the FixedIncomeRow / MultiFileIncomeRow in section-2-income.tsx.
  const [reviewed, setReviewed] = useState<boolean>(row.client_reviewed);
  const needsReview = row.auto_extracted && !reviewed;
  const markReviewed = async () => {
    const current = latestRef.current.id;
    if (!current) {
      setReviewed(true);
      return;
    }
    setReviewed(true);
    const r = await markLineReviewedAction(caseId, "expense", current);
    if (!r.ok) setReviewed(false);
  };

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
      setReviewed(true);
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

// "Less: Private use" lives next to Cash expense / Other expense but
// behaves differently: it's not a pch_expense_lines row, the amount
// is a single column on pch_vehicle (private_use_amount_pence) and
// multiple receipts stack against a case-scoped requirement_key in
// case_documents (intake-private-use-attach, no line id suffix). OCR
// reuses the expense prompt because the semantics are identical ("find
// the total paid"). Uploading accumulates into the amount field like
// the other multi-file boxes do; the £ input stays fully editable.
function MultiFilePrivateUseRow({
  caseId, editable, initialPence, initialAttachments,
}: {
  caseId: string;
  editable: boolean;
  initialPence: number;
  initialAttachments: IntakeAttachment[];
}) {
  const amount = useDebouncedSave<string>({
    initial: penceToStr(initialPence),
    save: async (v) => {
      const pence = strToPence(v);
      const r = await savePchVehicleFieldAction(
        caseId,
        "private_use_amount_pence",
        pence,
      );
      if (!r.ok) throw new Error(r.error);
    },
  });

  const [attachments, setAttachments] = useState<IntakeAttachment[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  // Same accumulate-on-upload trick MultiFileExpenseRow uses: the ref
  // keeps the running total consistent across the awaited OCR calls
  // so a multi-file loop sums instead of overwriting.
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
      const nextNotes: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await uploadPrivateUseAttachmentAction(caseId, fd);
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
        <span>Less: Private use</span>
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
      <p className="mt-1 text-[11px] text-slate-500">
        Personal-use portion of your vehicle or any other expense you're
        claiming. Leave at £0 if everything was for work.
      </p>
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
