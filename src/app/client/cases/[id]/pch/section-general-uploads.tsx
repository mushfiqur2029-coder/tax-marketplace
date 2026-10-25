"use client";

// Final section: general multi-file upload area. Bank statements and
// anything else that's relevant to the return. Optional. Files land
// in case_documents with requirement_key='intake-general'; the
// accountant can open them on review. No OCR, no auto-apply - these
// are reference material.

import { useRef, useState } from "react";
import { uploadPchGeneralDocumentAction } from "@/app/client/pch/intake-actions";

export type GeneralUpload = {
  id: string;
  file_name: string;
  uploaded_at: string;
};

export function SectionGeneralUploads({
  caseId,
  editable,
  initial,
}: {
  caseId: string;
  editable: boolean;
  initial: GeneralUpload[];
}) {
  const [uploads, setUploads] = useState<GeneralUpload[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => fileRef.current?.click();
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    setUploading(true);
    setErr(null);
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const r = await uploadPchGeneralDocumentAction(caseId, fd);
        if (!r.ok) {
          setErr(r.error);
          break;
        }
        setUploads((prev) => [
          { id: r.id, file_name: r.file_name, uploaded_at: new Date().toISOString() },
          ...prev,
        ]);
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : "Upload failed.");
        break;
      }
    }
    setUploading(false);
  };

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-bold">Any other documents</h2>
      <p className="mb-4 text-xs text-slate-600">
        Bank statements, receipts, invoices, anything else that might
        help your accountant. Multi-file; drop as many as you like.
        Optional. Your typed figures above stay the source of truth
        either way.
      </p>
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <button
          type="button"
          onClick={openPicker}
          disabled={!editable || uploading}
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Add files"}
        </button>
        <p className="mt-2 text-[11px] text-slate-500">
          PDF, JPG, PNG, WebP, or CSV / XLSX up to 50 MB each.
        </p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={onFiles}
          className="hidden"
        />
      </div>
      {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
      {uploads.length > 0 ? (
        <ul className="mt-4 space-y-1">
          {uploads.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-emerald-600"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="truncate">{u.file_name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
