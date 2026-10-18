"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptPchExtractionFieldAction,
  editPchExtractionFieldAction,
  rejectPchExtractionFieldAction,
  applyPchExtractionAction,
} from "@/app/client/pch/extraction-actions";

// Per-document review panel. Lives next to the Upload button in the
// client workspace. Renders every field the AI extracted, with its
// confidence badge, its explanation note, and three buttons (Confirm,
// Edit, Skip). Nothing is written to the intake tables until the
// client clicks "Apply confirmed fields" at the bottom; even then
// only accepted + edited fields flow through.

export type ExtractionFieldPayload = {
  value: string | number | null;
  confidence: "high" | "medium" | "low" | "missing";
  note: string;
};
export type ExtractionFieldState = {
  status: "proposed" | "accepted" | "edited" | "rejected";
  overrideValue?: string | number | null;
  actedAt?: string;
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
  labels: Partial<Record<string, string>>;
  targetable: Record<string, boolean>;
};

export function ExtractionReview({ ext, canEdit }: {
  ext: ExtractionReviewPayload;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

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
  const fieldKeys = Object.keys(ext.fields);
  const toApplyCount = fieldKeys.filter((k) => {
    const s = ext.fieldStates[k];
    return (s?.status === "accepted" || s?.status === "edited") && ext.targetable[k];
  }).length;

  const fromInterview = ext.source === "ai_interview";
  const headline = fromInterview
    ? "Confirmed through AI conversation"
    : low
      ? "We had trouble reading this"
      : "Extracted from your document";
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
        {fieldKeys.map((key) => (
          <FieldRow
            key={key}
            extractionId={ext.id}
            fieldKey={key}
            label={ext.labels[key] ?? key}
            field={ext.fields[key]}
            state={ext.fieldStates[key] ?? { status: "proposed" }}
            targetable={!!ext.targetable[key]}
            canEdit={canEdit}
          />
        ))}
      </ul>

      {canEdit ? (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={pending || toApplyCount === 0}
            onClick={() => start(async () => {
              setErr(null); setApplied(false);
              const r = await applyPchExtractionAction(ext.id);
              if (!r.ok) setErr(r.error);
              else { setApplied(true); router.refresh(); }
            })}
            className="rounded bg-slate-900 px-3 py-1.5 text-white text-xs font-medium disabled:opacity-50"
          >
            {pending ? "Applying..." : `Apply ${toApplyCount} confirmed field${toApplyCount === 1 ? "" : "s"} to your intake`}
          </button>
          {applied ? <span className="text-emerald-700">Applied.</span> : null}
          {err ? <span className="text-rose-700">{err}</span> : null}
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

function FieldRow({ extractionId, fieldKey, label, field, state, targetable, canEdit }: {
  extractionId: string;
  fieldKey: string;
  label: string;
  field: ExtractionFieldPayload;
  state: ExtractionFieldState;
  targetable: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<string>(
    state.overrideValue != null ? String(state.overrideValue) :
    field.value != null ? String(field.value) : "",
  );
  const [editing, setEditing] = useState(false);

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    after?: () => void,
  ) => {
    start(async () => {
      const r = await fn();
      if (r.ok) { if (after) after(); router.refresh(); }
      else alert(r.error ?? "Action failed");
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
    state.status === "edited" ? "Edited" :
    state.status === "rejected" ? "Skipped" :
    "Not reviewed";

  return (
    <li className="rounded border border-slate-200 bg-white p-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{label}</span>
            <span className={"rounded px-1.5 py-0.5 text-[10px] font-medium " + statusChip}>{statusLabel}</span>
            {!targetable ? (
              <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600">
                Informational
              </span>
            ) : null}
          </div>
          {editing ? (
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Enter the correct value"
            />
          ) : (
            <div className="mt-1 text-slate-700">{effectiveDisplay}</div>
          )}
          {field.note ? <div className="mt-1 text-[11px] italic text-slate-500">{field.note}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ConfidenceBadge value={field.confidence} />
        </div>
      </div>

      {canEdit && targetable ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {editing ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const next: string | number | null =
                    draft === "" ? null :
                    isFinite(Number(draft)) && draft.match(/^-?\d/) ? Number(draft) : draft;
                  run(
                    () => editPchExtractionFieldAction(extractionId, fieldKey, next),
                    () => setEditing(false),
                  );
                }}
                className="rounded bg-sky-600 px-2 py-1 text-white disabled:opacity-50"
              >Save edit</button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setEditing(false)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700"
              >Cancel</button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={pending || field.confidence === "missing" || field.value == null}
                onClick={() => run(() => acceptPchExtractionFieldAction(extractionId, fieldKey))}
                className="rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-50"
              >Confirm</button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setEditing(true)}
                className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-sky-800"
              >Edit</button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => rejectPchExtractionFieldAction(extractionId, fieldKey))}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700"
              >Skip</button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
