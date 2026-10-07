"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import { DocumentUploader } from "@/components/case/document-uploader";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import type { TierId } from "@/lib/plans";
import {
  isFieldRequired,
  type ChecklistField,
} from "@/lib/engagement/checklist";

type UploadedDoc = { id: string; file_name: string; uploaded_at: string };

type Props = {
  tierId: TierId;
  fields: ChecklistField[];
  docsByKey: Record<string, UploadedDoc[]>;
  requiredCount: number;
  requiredDone: number;
  footer: string;
  uploadDoc: (
    requirementKey: string,
    fd: FormData,
  ) => Promise<ActionResult<UploadedDoc>>;
  removeDoc: (docId: string) => Promise<ActionResult>;
  submit: () => Promise<ActionResult>;
};

// Period-docs form. Single-section layout — no text/select fields,
// uploads only — so it's lighter than OnboardingForm. Progress bar
// matches the dashboard style, same visual language as the rest of
// the app.
export function PeriodDocsForm({
  tierId,
  fields,
  docsByKey: initialDocsByKey,
  requiredCount,
  requiredDone: initialRequiredDone,
  footer,
  uploadDoc,
  removeDoc,
  submit,
}: Props) {
  const router = useRouter();
  const [docsByKey, setDocsByKey] =
    useState<Record<string, UploadedDoc[]>>(initialDocsByKey);
  const [submitting, startSubmit] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const requiredFields = fields.filter((f) => isFieldRequired(tierId, f));
  const doneCount = requiredFields.filter(
    (f) => (docsByKey[f.id]?.length ?? 0) > 0,
  ).length;
  const pct = requiredCount === 0 ? 100 : Math.round((doneCount / requiredCount) * 100);

  const handleSubmit = () => {
    setSubmitError(null);
    startSubmit(async () => {
      const res = await submit();
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      router.push(window.location.pathname.replace(/\/period-docs\/?$/, ""));
    });
  };

  return (
    <div className="space-y-6">
      <div className="card-sl p-5">
        <div className="flex items-baseline justify-between">
          <span
            className="text-xs font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Period documents progress
          </span>
          <span
            className="text-sm font-bold text-ink"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {pct}%
          </span>
        </div>
        <div className="mt-2 text-sm font-semibold text-ink">
          {doneCount} of {requiredCount} required items done
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-cloud">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background:
                "linear-gradient(90deg, var(--sky), var(--mint))",
            }}
          />
        </div>
      </div>

      <section className="card-sl p-6 sm:p-8">
        <div className="space-y-5">
          {fields.map((field) => (
            <PeriodUploadRow
              key={field.id}
              field={field}
              required={isFieldRequired(tierId, field)}
              docs={docsByKey[field.id] ?? []}
              onUploaded={(doc) =>
                setDocsByKey((prev) => ({
                  ...prev,
                  [field.id]: [...(prev[field.id] ?? []), doc],
                }))
              }
              onRemoved={(id) =>
                setDocsByKey((prev) => ({
                  ...prev,
                  [field.id]: (prev[field.id] ?? []).filter(
                    (d) => d.id !== id,
                  ),
                }))
              }
              uploadDoc={uploadDoc}
              removeDoc={removeDoc}
            />
          ))}
        </div>
      </section>

      <p className="rounded-xl border border-line bg-paper p-4 text-sm text-slate">
        {footer}
      </p>

      {submitError ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {submitError}
        </p>
      ) : null}

      <SLButton
        type="button"
        variant="primary"
        block
        onClick={handleSubmit}
        disabled={submitting || doneCount < requiredCount}
      >
        {submitting
          ? "Submitting…"
          : doneCount < requiredCount
            ? `Submit period documents (${requiredCount - doneCount} more to go)`
            : "Submit period documents"}
      </SLButton>
    </div>
  );
}

function PeriodUploadRow({
  field,
  required,
  docs,
  onUploaded,
  onRemoved,
  uploadDoc,
  removeDoc,
}: {
  field: ChecklistField;
  required: boolean;
  docs: UploadedDoc[];
  onUploaded: (doc: UploadedDoc) => void;
  onRemoved: (id: string) => void;
  uploadDoc: (
    requirementKey: string,
    fd: FormData,
  ) => Promise<ActionResult<UploadedDoc>>;
  removeDoc: (docId: string) => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const slotAction = useCallback(
    async (fd: FormData): Promise<ActionResult> => {
      setError(null);
      const res = await uploadDoc(field.id, fd);
      if (res.ok) {
        onUploaded(res.data);
        return { ok: true };
      }
      setError(res.error);
      return res;
    },
    [field.id, uploadDoc, onUploaded],
  );

  if (field.kind !== "upload") return null;

  const allowMultiple = !!field.multi;

  const handleRemove = (docId: string) => {
    if (removingIds.has(docId)) return;
    setError(null);
    setRemovingIds((prev) => {
      const next = new Set(prev);
      next.add(docId);
      return next;
    });
    void (async () => {
      try {
        const res = await removeDoc(docId);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onRemoved(docId);
      } finally {
        setRemovingIds((prev) => {
          if (!prev.has(docId)) return prev;
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
      }
    })();
  };

  const uploaderHidden = !allowMultiple && docs.length > 0;

  return (
    <div>
      <div>
        <div className="flex items-baseline gap-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {field.label}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider"
            style={{
              color: required ? "#B91C1C" : "#4b5c89",
              fontFamily: "var(--font-mono)",
            }}
          >
            {required ? "Required" : "Optional"}
          </span>
        </div>
        {field.hint ? (
          <p className="mt-0.5 text-xs text-slate">{field.hint}</p>
        ) : null}
      </div>
      {uploaderHidden ? null : (
        <div className="mt-2">
          <DocumentUploader
            action={slotAction}
            multiple={allowMultiple}
            accept={acceptForPeriodDocSlot(field.id)}
            hint={hintForPeriodDocSlot(field.id, allowMultiple)}
          />
        </div>
      )}
      {docs.length > 0 ? (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
          {docs.map((d) => {
            const isRemoving = removingIds.has(d.id);
            return (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">
                    {d.file_name}
                  </div>
                  <div className="text-xs text-slate">
                    {formatDateTime(d.uploaded_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(d.id)}
                  disabled={isRemoving}
                  className="text-xs font-semibold text-red-700 underline underline-offset-4 hover:text-red-900 disabled:opacity-50"
                >
                  {isRemoving ? "Removing…" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Per-slot accept + hint for the period-docs section. The two bank-
// statement slots are restricted strictly to their format — a PDF
// uploaded into the CSV slot (or vice versa) would stall accounts
// prep later, so we filter at upload time rather than discover it in
// review. Server-side enforcement in uploadPeriodDocumentAction
// mirrors these.
function acceptForPeriodDocSlot(fieldId: string): string | undefined {
  if (fieldId === "period_bank_statements_pdf") {
    return ".pdf,application/pdf";
  }
  if (fieldId === "period_bank_statements_csv") {
    return ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return undefined;
}

function hintForPeriodDocSlot(
  fieldId: string,
  allowMultiple: boolean,
): string {
  const limit = "up to 50 MB each";
  const suffix = allowMultiple ? ` · multiple files ok` : "";
  if (fieldId === "period_bank_statements_pdf") {
    return `PDF only · ${limit}${suffix}`;
  }
  if (fieldId === "period_bank_statements_csv") {
    return `CSV or spreadsheet (XLSX / XLS) · ${limit}${suffix}`;
  }
  return allowMultiple
    ? `PDF, image, or spreadsheet · ${limit}${suffix}`
    : `PDF or image · up to 50 MB`;
}
