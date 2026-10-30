"use client";

// Phase B upload panel for the auto_upload intake path. Only mounted
// when pch_cases.intake_method === 'auto_upload'; the manual path
// never renders this component.
//
// Two parts stacked:
//
//   Dropzone (useMultiFileDrop, same visual language as the other
//   intake upload tiles - rounded-xl, border-slate-200, bg-white).
//   Accepts PDF/JPG/PNG/WebP, kicks off uploadBulkIntakeDocumentAction
//   per file. The action schedules the extraction job via after(),
//   so this component doesn't block on Claude.
//
//   Live-status list of uploads from listBulkIntakeUploadsAction.
//   Each row subscribes to its own pch_intake_uploads row via
//   useLiveRow so the "Reading..." chip flips to "Sorted into N
//   lines" (or the error message in red) the moment the background
//   job writes status='done'/'error'. On that flip we also fire the
//   onDoneCallback up to the parent, which bumps the linesVersion
//   key on Section2Income/Section3Expenses to force a remount with
//   the fresh server-side income/expense lines.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLiveRow } from "@/lib/realtime-live-merge";
import {
  deleteBulkIntakeUploadAction,
  uploadBulkIntakeDocumentAction,
  type BulkIntakeUploadView,
} from "@/app/client/pch/bulk-intake-actions";
import { useMultiFileDrop, ProcessingIndicator } from "./upload-dropzone";

const UPLOAD_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,text/csv,"
  + "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
  + "application/vnd.ms-excel,.csv,.xlsx,.xls";

export type BulkIntakeInitialUpload = BulkIntakeUploadView;

export function BulkDocumentUpload({
  caseId,
  editable,
  initialUploads,
  onExtractionDone,
}: {
  caseId: string;
  editable: boolean;
  initialUploads: BulkIntakeInitialUpload[];
  // Fires when any upload's live status flips to 'done'. Parent uses
  // this to bump linesVersion so Section2Income / Section3Expenses
  // remount with the fresh server-fetched lines.
  onExtractionDone: () => void;
}) {
  const [uploads, setUploads] = useState<BulkIntakeUploadView[]>(initialUploads);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uploadOne = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadBulkIntakeDocumentAction(caseId, fd);
    if (!r.ok) {
      setErr(r.error);
      return null;
    }
    // Prepend the new row at 'pending' so the list reflects the
    // click immediately; the per-row useLiveRow then flips it to
    // 'processing' and 'done'/'error' as the server updates.
    const optimistic: BulkIntakeUploadView = {
      id: r.uploadId,
      file_name: file.name,
      status: "pending",
      items_count: null,
      error_message: null,
      uploaded_at: new Date().toISOString(),
    };
    setUploads((prev) => [optimistic, ...prev]);
    return r.uploadId;
  };

  const uploadMany = async (files: File[]) => {
    if (!editable || files.length === 0) return;
    setUploading(true);
    setErr(null);
    try {
      for (const file of files) {
        await uploadOne(file);
      }
    } finally {
      setUploading(false);
    }
  };

  const { dropProps, isDragOver } = useMultiFileDrop({
    onFiles: uploadMany,
    accept: UPLOAD_ACCEPT,
    disabled: !editable || uploading,
  });

  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length > 0) await uploadMany(picked);
  };

  const removeUpload = async (uploadId: string) => {
    const r = await deleteBulkIntakeUploadAction(caseId, uploadId);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setUploads((prev) => prev.filter((u) => u.id !== uploadId));
  };

  return (
    <section id="pch-section-bulk-upload" className="mb-8 scroll-mt-24">
      <h2 className="mb-1 text-lg font-bold">
        Upload your documents
      </h2>
      <p className="mb-4 text-sm text-slate-600">
        Upload your bank statements, receipts and invoices. We'll read
        them and sort everything into the right categories below, check
        our work before you submit.
      </p>

      <div
        {...dropProps}
        className={
          "rounded-xl border bg-white p-5 transition sm:p-6 "
          + (isDragOver ? "border-sky ring-2 ring-sky/30" : "border-slate-200")
        }
      >
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Drag files here, or pick them from your device
            </p>
            <p className="mt-1 text-xs text-slate-500">
              PDF, JPG, PNG, WebP, CSV or Excel up to 25 MB each. Add
              as many documents as you like.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!editable || uploading}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {uploading ? "Uploading." : "Pick files"}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            onChange={onPicked}
            className="hidden"
          />
        </div>
        {isDragOver ? (
          <p className="mt-2 text-xs font-medium text-sky-800">Drop to upload.</p>
        ) : null}
        {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
      </div>

      {uploads.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {uploads.map((u) => (
            <BulkUploadRow
              key={u.id}
              initial={u}
              editable={editable}
              onDone={onExtractionDone}
              onRemove={() => removeUpload(u.id)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type LiveStatus = {
  status: "pending" | "processing" | "done" | "error";
  items_count: number | null;
  error_message: string | null;
};

function BulkUploadRow({
  initial, editable, onDone, onRemove,
}: {
  initial: BulkIntakeUploadView;
  editable: boolean;
  onDone: () => void;
  onRemove: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const live = useLiveRow<LiveStatus>(
    {
      status: initial.status,
      items_count: initial.items_count,
      error_message: initial.error_message,
    },
    {
      table: "pch_intake_uploads",
      filter: `id=eq.${initial.id}`,
      channel: `pch-intake-upload-${initial.id}`,
      map: (row, prev) => ({
        status:
          row.status === undefined
            ? prev.status
            : (row.status as LiveStatus["status"]),
        items_count:
          row.items_count === undefined
            ? prev.items_count
            : (row.items_count as number | null),
        error_message:
          row.error_message === undefined
            ? prev.error_message
            : (row.error_message as string | null),
      }),
    },
  );

  // Fire the parent callback (bump linesVersion -> remount Section2/
  // Section3 with fresh server lines) + a router.refresh() the moment
  // the extraction finishes. seenDoneRef guards against the callback
  // firing on every re-render after done.
  const seenDoneRef = useRef(false);
  useEffect(() => {
    if (live.status === "done" && !seenDoneRef.current) {
      seenDoneRef.current = true;
      router.refresh();
      onDone();
    }
  }, [live.status, onDone, router]);

  const chip =
    live.status === "pending"
      ? { label: "Queued", tone: "amber" as const }
      : live.status === "processing"
        ? { label: "Reading.", tone: "amber" as const }
        : live.status === "done"
          ? {
              label:
                live.items_count === null
                  ? "Done"
                  : `Sorted into ${live.items_count} line${live.items_count === 1 ? "" : "s"}`,
              tone: "emerald" as const,
            }
          : { label: "Could not read", tone: "rose" as const };

  const chipClass =
    chip.tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : chip.tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-amber-300 bg-amber-50 text-amber-900";

  const remove = () =>
    start(async () => {
      await onRemove();
    });

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900" title={initial.file_name}>
            {initial.file_name}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Added {new Date(initial.uploaded_at).toLocaleString("en-GB")}
          </p>
        </div>
        <span
          className={
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold "
            + chipClass
          }
        >
          {chip.label}
        </span>
        {editable ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-slate-500 hover:text-rose-700 disabled:opacity-50"
          >
            {pending ? "Removing." : "Remove"}
          </button>
        ) : null}
      </div>
      {live.status === "pending" || live.status === "processing" ? (
        <div className="mt-2">
          <ProcessingIndicator
            key={initial.id}
            label={
              live.status === "pending"
                ? "Queued, we'll start reading this shortly."
                : "Reading and sorting this document. Usually 10 to 30 seconds."
            }
            longWaitLabel="Still working on it, a longer or multi-page statement can take a bit more than usual."
          />
        </div>
      ) : null}
      {live.status === "error" && live.error_message ? (
        <p className="mt-2 text-xs text-rose-700">
          {live.error_message}. Re-upload the file, or split a long
          statement into smaller files if the model couldn't finish
          reading it.
        </p>
      ) : null}
    </li>
  );
}
