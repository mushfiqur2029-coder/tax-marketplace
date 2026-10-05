"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import { DocumentUploader } from "@/components/case/document-uploader";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import type { ChecklistField } from "@/lib/engagement/checklist";
import { isVatUploadRequired } from "@/lib/vat/cycle";

type UploadedDoc = { id: string; file_name: string; uploaded_at: string };

type Props = {
  fields: ChecklistField[];
  docsByKey: Record<string, UploadedDoc[]>;
  requiredCount: number;
  requiredDone: number;
  footer: string;
  uploadDoc: (
    requirementKey: string,
    fd: FormData,
  ) => Promise<ActionResult>;
  removeDoc: (docId: string) => Promise<ActionResult>;
  submit: () => Promise<ActionResult>;
};

// Mirror of period-docs-form, trimmed to the VAT cycle's four upload
// slots. Progress bar matches dashboard styling; disabled Submit shows
// a countdown of remaining required items.
export function VatCycleUploadForm({
  fields,
  docsByKey: initialDocsByKey,
  requiredCount,
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

  const doneCount = fields.filter(
    (f) => isVatUploadRequired(f.id) && (docsByKey[f.id]?.length ?? 0) > 0,
  ).length;
  const pct =
    requiredCount === 0 ? 100 : Math.round((doneCount / requiredCount) * 100);

  const handleSubmit = () => {
    setSubmitError(null);
    startSubmit(async () => {
      const res = await submit();
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      router.refresh();
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
            VAT period progress
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
            <VatUploadRow
              key={field.id}
              field={field}
              required={isVatUploadRequired(field.id)}
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
            ? `Submit VAT documents (${requiredCount - doneCount} more to go)`
            : "Submit VAT documents"}
      </SLButton>
    </div>
  );
}

function VatUploadRow({
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
  ) => Promise<ActionResult>;
  removeDoc: (docId: string) => Promise<ActionResult>;
}) {
  const [removing, startRemove] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const slotAction = useCallback(
    async (fd: FormData): Promise<ActionResult> => {
      setError(null);
      const res = await uploadDoc(field.id, fd);
      if (res.ok) {
        const file = fd.get("file");
        if (file instanceof File) {
          onUploaded({
            id: `optimistic-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            file_name: file.name,
            uploaded_at: new Date().toISOString(),
          });
        }
      } else {
        setError(res.error);
      }
      return res;
    },
    [field.id, uploadDoc, onUploaded],
  );

  if (field.kind !== "upload") return null;

  const allowMultiple = !!field.multi;
  const isBankStatementPdf = field.id === "vat_bank_statement_pdf";
  const hint = isBankStatementPdf
    ? "PDF only · up to 50 MB each · multiple files ok"
    : allowMultiple
      ? "PDF, image, or spreadsheet · up to 50 MB each · multiple files ok"
      : "PDF or image · up to 50 MB";
  // PDF-only bank statement is enforced browser-side (accept) plus
  // server-side (vat-actions.ts). Other VAT slots are freeform.
  const accept = isBankStatementPdf ? ".pdf,application/pdf" : undefined;

  const handleRemove = (docId: string) => {
    setError(null);
    startRemove(async () => {
      const res = await removeDoc(docId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onRemoved(docId);
    });
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
            accept={accept}
            hint={hint}
          />
        </div>
      )}
      {docs.length > 0 ? (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-paper">
          {docs.map((d) => (
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
                disabled={removing || d.id.startsWith("optimistic-")}
                className="text-xs font-semibold text-red-700 underline underline-offset-4 hover:text-red-900 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
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
