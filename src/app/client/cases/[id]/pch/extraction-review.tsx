"use client";

import { useState, useTransition } from "react";
import {
  acceptPchExtractionFieldAction,
  editPchExtractionFieldAction,
  rejectPchExtractionFieldAction,
} from "@/app/client/pch/extraction-actions";
import { markLocalMutation } from "@/lib/realtime-self-mutation";
import { SLOT_APPLY_MAPS, coerceValueForTarget } from "@/lib/pch/extraction-apply";
import type { IdentityHead } from "./identity-section";

// Per-document review panel. Lives next to the Upload button in the
// client workspace. Renders every field the AI extracted, with its
// confidence badge, its explanation note, and three buttons (Confirm,
// Edit, Skip). Each Confirm/Edit auto-writes the value through to the
// intake tables, so the identity + totals sections update immediately.
// Skip leaves the field for manual entry or re-upload.

export type ExtractionFieldPayload = {
  value: string | number | null;
  confidence: "high" | "medium" | "low" | "missing";
  note: string;
};
export type ExtractionFieldState = {
  status: "proposed" | "accepted" | "edited" | "rejected";
  overrideValue?: string | number | null;
  actedAt?: string;
  // Author of the state change. Normal client actions carry the user
  // UUID; auto-skip markers written by the extraction trigger carry
  // "system:auto-skip" so the review UI can hide fields the server
  // already knows are N/A for this side of a licence.
  actedBy?: string;
};
export type ExtractionSource = "document" | "ai_interview";

export type ExtractionReviewPayload = {
  id: string;
  slotCode: string;
  status: "pending" | "done" | "error" | "skipped";
  overallConfidence: "high" | "medium" | "low" | "missing" | null;
  documentType: string | null;
  fields: Record<string, ExtractionFieldPayload>;
  fieldStates: Record<string, ExtractionFieldState>;
  errorMessage: string | null;
  // Provenance of this extraction. `document` means the fields came
  // from AI reading an uploaded file; `ai_interview` means the client
  // walked through a guided conversation when they didn't have the
  // document. The confirm/edit/skip UI is identical either way; only
  // the banner at the top of the panel changes.
  source: ExtractionSource;
  // Phase 8 Slice 8.3: for PCH-24 licence uploads, which side of the
  // card this extraction read. Null for passports and non-PCH-24.
  // Lets the review card show "From the front of your licence" so the
  // client can tell the two sub-extractions apart.
  photoIdSide: "front" | "back" | null;
  labels: Partial<Record<string, string>>;
  targetable: Record<string, boolean>;
};

export function ExtractionReview({ ext, canEdit, onIdentityFieldApplied }: {
  ext: ExtractionReviewPayload;
  canEdit: boolean;
  // Photo ID (PCH-24) fields map straight onto pch_cases.cl_name /
  // cl_dob / cl_address / cl_postcode, which "2. Your identity" also
  // displays. Reporting a confirmed/edited value up through here lets
  // that section update live the instant the client confirms it here,
  // instead of only on the next full page reload.
  onIdentityFieldApplied?: (patch: Partial<IdentityHead>) => void;
}) {
  // Task #14: no reload per click. Confirm/Edit/Skip each write a value
  // we already know (the extracted value verbatim, or exactly what the
  // client just typed), so this card owns its own copy of fieldStates
  // and updates it directly, the summary counts below recompute from
  // the same state so they stay in sync with each row's own display.
  const [fieldStates, setFieldStates] = useState(ext.fieldStates);
  const setFieldState = (key: string, next: ExtractionFieldState) => {
    setFieldStates((prev) => ({ ...prev, [key]: next }));
    if (!onIdentityFieldApplied) return;
    if (next.status !== "accepted" && next.status !== "edited") return;
    const target = SLOT_APPLY_MAPS[ext.slotCode]?.targets[key];
    if (!target || target.table !== "pch_cases") return;
    const raw = next.status === "edited" ? next.overrideValue : ext.fields[key]?.value;
    const value = coerceValueForTarget(raw, undefined);
    onIdentityFieldApplied({
      [target.column]: value == null ? null : String(value),
    } as Partial<IdentityHead>);
  };
  if (ext.status === "pending") {
    return (
      <div className="mt-3 rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
        Reading this document, hold on a few seconds.
      </div>
    );
  }
  if (ext.status === "error") {
    return (
      <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
        We could not read this document automatically. Please enter the figures by hand.
        {ext.errorMessage ? <div className="mt-1 opacity-70">{ext.errorMessage}</div> : null}
      </div>
    );
  }
  if (ext.status === "skipped") return null;

  const low = ext.overallConfidence === "low" || ext.overallConfidence === "missing";
  const allKeys = Object.keys(ext.fields);
  // Only show fields that will actually pre-fill the intake. Informational
  // fields (e.g. "ID document number" on PCH-24) are tracked for audit
  // but add noise to the client-facing review card; hide them entirely.
  const targetableKeys = allKeys.filter((k) => ext.targetable[k]);
  // Also hide fields that have been auto-rejected by the system (fields
  // on the wrong side of a licence, where we already know the AI can't
  // read them). The server marks these with actedBy='system:auto-skip';
  // the client should see them resolved in the summary chip count but
  // not have to Confirm/Edit/Skip each one by hand.
  const displayedKeys = targetableKeys.filter((k) => {
    const s = fieldStates[k];
    return !(s?.status === "rejected" && typeof s.actedBy === "string" && s.actedBy.startsWith("system:"));
  });
  const autoSkippedCount = targetableKeys.length - displayedKeys.length;
  const savedCount = targetableKeys.filter((k) => {
    const s = fieldStates[k];
    return s?.status === "accepted" || s?.status === "edited" || s?.status === "rejected";
  }).length;
  const pendingCount = displayedKeys.length - targetableKeys.filter((k) => {
    const s = fieldStates[k];
    return s?.status === "accepted" || s?.status === "edited";
  }).length;

  const fromInterview = ext.source === "ai_interview";
  const sideLabel =
    ext.photoIdSide === "front"
      ? " (front of licence)"
      : ext.photoIdSide === "back"
        ? " (back of licence)"
        : "";
  const headline = fromInterview
    ? "Confirmed through AI conversation"
    : low
      ? "We had trouble reading this" + sideLabel
      : "Extracted from your document" + sideLabel;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">{headline}</span>
            <SourceBadge source={ext.source} />
          </div>
          {ext.documentType ? (
            <div className="mt-0.5 text-slate-500">
              {fromInterview ? "Captured: " : "Looks like: "}
              {ext.documentType}
            </div>
          ) : null}
        </div>
        <ConfidenceBadge value={ext.overallConfidence ?? "missing"} />
      </div>

      {low ? (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
          Confidence is low. Please check every field below and consider re-uploading a clearer scan.
        </div>
      ) : null}

      <ul className="space-y-2">
        {displayedKeys.map((key) => (
          <FieldRow
            key={key}
            extractionId={ext.id}
            fieldKey={key}
            label={ext.labels[key] ?? key}
            field={ext.fields[key]}
            state={fieldStates[key] ?? { status: "proposed" }}
            onStateChanged={(next) => setFieldState(key, next)}
            targetable={!!ext.targetable[key]}
            canEdit={canEdit}
          />
        ))}
      </ul>

      {canEdit && targetableKeys.length > 0 ? (
        <div className="mt-3 text-xs text-slate-600 space-y-1">
          <div>
            {savedCount === 0
              ? `Confirm each field above to save it to your intake. ${pendingCount} field${pendingCount === 1 ? "" : "s"} to review.`
              : pendingCount === 0
                ? `All ${savedCount} field${savedCount === 1 ? "" : "s"} saved to your intake.`
                : `${savedCount} of ${targetableKeys.length} fields saved. ${pendingCount} still to review.`}
          </div>
          {autoSkippedCount > 0 ? (
            <div className="text-slate-500">
              {autoSkippedCount} field{autoSkippedCount === 1 ? "" : "s"} skipped automatically (not shown on this side of the card).
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SourceBadge({ source }: { source: ExtractionSource }) {
  const map: Record<ExtractionSource, { label: string; className: string }> = {
    document: {
      label: "From your document",
      className: "bg-slate-100 text-slate-700 border-slate-300",
    },
    ai_interview: {
      label: "From AI conversation",
      className: "bg-indigo-100 text-indigo-800 border-indigo-300",
    },
  };
  const chip = map[source];
  return (
    <span className={"inline-block rounded border px-2 py-0.5 text-[11px] font-medium " + chip.className}>
      {chip.label}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SkippedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ConfidenceBadge({ value }: { value: ExtractionFieldPayload["confidence"] }) {
  const map: Record<string, { label: string; className: string }> = {
    high: { label: "High confidence", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    medium: { label: "Medium", className: "bg-sky-100 text-sky-800 border-sky-200" },
    low: { label: "Low, please check", className: "bg-amber-100 text-amber-800 border-amber-200" },
    missing: { label: "Not found", className: "bg-slate-200 text-slate-700 border-slate-300" },
  };
  const chip = map[value];
  return (
    <span className={"inline-block rounded border px-2 py-0.5 text-[11px] font-medium " + chip.className}>
      {chip.label}
    </span>
  );
}

function FieldRow({ extractionId, fieldKey, label, field, state, onStateChanged, targetable, canEdit }: {
  extractionId: string;
  fieldKey: string;
  label: string;
  field: ExtractionFieldPayload;
  state: ExtractionFieldState;
  onStateChanged: (next: ExtractionFieldState) => void;
  targetable: boolean;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<string>(
    state.overrideValue != null ? String(state.overrideValue) :
    field.value != null ? String(field.value) : "",
  );
  const [editing, setEditing] = useState(false);

  // Task #14: no reload. Each action below writes a value we already
  // know client-side, so on success we update this field's state
  // directly (via the parent's fieldStates map) instead of reloading.
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    nextState: ExtractionFieldState,
    after?: () => void,
  ) => {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        markLocalMutation();
        if (after) after();
        onStateChanged(nextState);
      } else {
        alert(r.error ?? "Action failed");
      }
    });
  };

  const effective = state.status === "edited" ? state.overrideValue : field.value;
  const effectiveDisplay = effective == null || effective === "" ? "(empty)" : String(effective);

  const statusChip =
    state.status === "accepted" ? "bg-emerald-100 text-emerald-800" :
    state.status === "edited" ? "bg-sky-100 text-sky-800" :
    state.status === "rejected" ? "bg-rose-100 text-rose-800" :
    "bg-slate-200 text-slate-700";
  const statusLabel =
    state.status === "accepted" ? "Confirmed" :
    state.status === "edited" ? "Saved" :
    state.status === "rejected" ? "Skipped" :
    "Not reviewed";
  // Once a field has been acted on, the action row below stops showing
  // the same Confirm/Edit/Skip trio (which reads as "still pending")
  // and instead shows a settled, done state with a small way to change
  // your mind. Editing always reopens the input regardless of prior
  // status.
  const reviewed = state.status !== "proposed";

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{label}</span>
            {!targetable ? (
              <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">
                Informational
              </span>
            ) : null}
          </div>
          {editing ? (
            <input
              className="mt-1.5 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Enter the correct value"
              autoFocus
            />
          ) : (
            <div className="mt-1 text-sm text-slate-700">{effectiveDisplay}</div>
          )}
          {field.note ? <div className="mt-1 text-[11px] italic text-slate-500">{field.note}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ConfidenceBadge value={field.confidence} />
        </div>
      </div>

      {canEdit && targetable ? (
        editing ? (
          <div className="mt-2.5 flex flex-wrap gap-2 text-[11px]">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const next: string | number | null =
                  draft === "" ? null :
                  isFinite(Number(draft)) && draft.match(/^-?\d/) ? Number(draft) : draft;
                run(
                  () => editPchExtractionFieldAction(extractionId, fieldKey, next),
                  { status: "edited", overrideValue: next, actedAt: new Date().toISOString() },
                  () => setEditing(false),
                );
              }}
              className="rounded-full bg-sky-600 px-3 py-1.5 font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >Cancel</button>
          </div>
        ) : reviewed ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold " + statusChip
              }
            >
              {state.status === "rejected" ? (
                <SkippedIcon />
              ) : (
                <CheckIcon />
              )}
              {statusLabel}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(true)}
              className="rounded-full px-2.5 py-1 font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900 disabled:opacity-50"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-2 text-[11px]">
            <button
              type="button"
              disabled={pending || field.confidence === "missing" || field.value == null}
              onClick={() => run(
                () => acceptPchExtractionFieldAction(extractionId, fieldKey),
                { status: "accepted", overrideValue: undefined, actedAt: new Date().toISOString() },
              )}
              className="rounded-full bg-emerald-600 px-3 py-1.5 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Confirming…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(true)}
              className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >Edit</button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(
                () => rejectPchExtractionFieldAction(extractionId, fieldKey),
                { status: "rejected", overrideValue: undefined, actedAt: new Date().toISOString() },
              )}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >Skip</button>
          </div>
        )
      ) : null}
    </li>
  );
}
