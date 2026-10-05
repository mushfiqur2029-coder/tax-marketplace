"use client";

import { useCallback, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  action: (fd: FormData) => Promise<ActionResult>;
  /**
   * When false, the file picker only accepts one file at a time and the
   * drop zone rejects extra files from a multi-file drop. Defaults to
   * true to match the existing case-documents + chat-attachment usage.
   * Onboarding checklist uses `false` for slots like Passport.
   */
  multiple?: boolean;
  /** Hint shown under the drop-zone title. Overrides the default copy. */
  hint?: string;
  /**
   * Comma-separated `accept` string (file extensions prefixed with `.`
   * and/or MIME types) passed to the `<input accept>` attribute AND
   * applied as a filter on drag-dropped files so the browser's file
   * picker *and* the drop zone enforce the same restriction. Omit to
   * allow any file. Example: ".pdf,application/pdf" for the bank
   * statement PDF slot.
   */
  accept?: string;
  /**
   * Fires after each individual file upload resolves ok. Lets a parent
   * that renders a server-component document list below the uploader
   * call router.refresh() so the new file appears immediately — the
   * uploader itself can't call useRouter because it doesn't own the
   * list, only the drop zone + chip strip.
   */
  onEachUploadSuccess?: () => void;
};

// Kept in sync with MAX in src/app/client/actions.ts (uploadDocumentAction).
const MAX_BYTES = 50 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type PendingItem = {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  error?: string;
};

let _seq = 0;
const nextId = () => `doc_${Date.now()}_${++_seq}`;

// Mirrors the chat-composer attach flow: drop zone + multi-file + auto-upload
// + chip per file. Each successful upload triggers the parent server-action
// revalidatePath, so the file appears in the documents list immediately.
// Does `file` match the `accept` restriction? Mirrors browser logic
// loosely: extension entry (".pdf") matches by name; MIME entry
// ("application/pdf") matches by type; a bare "image/*" wildcard
// matches by MIME prefix. Empty/undefined accept → match-all.
function fileMatchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const parts = accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  for (const p of parts) {
    if (p.startsWith(".")) {
      if (name.endsWith(p)) return true;
    } else if (p.endsWith("/*")) {
      const prefix = p.slice(0, -1); // keep the trailing slash
      if (type.startsWith(prefix)) return true;
    } else if (p === type) {
      return true;
    }
  }
  return false;
}

export function DocumentUploader({
  action,
  multiple = true,
  hint,
  accept,
  onEachUploadSuccess,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [dragDepth, setDragDepth] = useState(0);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      // Single-file mode: keep only the first file. The parent slot
      // (e.g. passport) usually wants one and only one upload; if the
      // user drops a batch, drop the extras silently rather than
      // silently uploading extras.
      const picked = multiple ? files : files.slice(0, 1);
      const newItems: PendingItem[] = picked.map((file) => {
        const id = nextId();
        if (!fileMatchesAccept(file, accept)) {
          // Drop-zone counterpart to the input's `accept` filter — the
          // browser's native picker honours accept but drag-drop
          // doesn't, so we enforce it here too.
          return {
            id,
            file,
            status: "error",
            error: `This slot only accepts ${accept}.`,
          };
        }
        if (file.size > MAX_BYTES) {
          return {
            id,
            file,
            status: "error",
            error: `Over the ${formatBytes(MAX_BYTES)} limit.`,
          };
        }
        return { id, file, status: "uploading" };
      });
      setItems((prev) => [...prev, ...newItems]);

      for (const item of newItems) {
        if (item.status !== "uploading") continue;
        (async () => {
          const fd = new FormData();
          fd.set("file", item.file);
          const res = await action(fd);
          setItems((prev) =>
            prev.map((p) =>
              p.id !== item.id
                ? p
                : res.ok
                  ? { ...p, status: "done" }
                  : { ...p, status: "error", error: res.error },
            ),
          );
          // Auto-fade successful uploads after a few seconds — the file is
          // now visible in the documents list below, so the chip becomes
          // redundant confirmation noise otherwise.
          if (res.ok) {
            // Fire first so a parent that renders a server-component
            // list refreshes before the chip disappears — if we fired
            // after the setTimeout the list would briefly be out of
            // sync with "Uploaded" chip gone + file still missing.
            onEachUploadSuccess?.();
            window.setTimeout(() => {
              setItems((prev) => prev.filter((p) => p.id !== item.id));
            }, 3000);
          }
        })();
      }
    },
    [action, multiple, accept, onEachUploadSuccess],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  };
  const onDrop = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragDepth(0);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) addFiles(files);
  };

  const anyUploading = items.some((p) => p.status === "uploading");

  return (
    <div
      className="relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="rounded-2xl border-2 border-dashed border-line p-6 text-center transition hover:border-sky/50">
        <div
          className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl text-white"
          style={{
            background: "linear-gradient(135deg, var(--navy), var(--sky))",
          }}
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-ink">
          {multiple
            ? "Drop files here or choose from your device"
            : "Drop a file here or choose from your device"}
        </p>
        <p className="mt-1 text-xs text-slate">
          {hint ??
            (multiple
              ? "PDF, image, or spreadsheet · up to 50 MB each · multiple files ok"
              : "PDF or image · up to 50 MB · one file")}
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            addFiles(files);
            if (e.target) e.target.value = "";
          }}
        />

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn-sl btn-sl-primary"
            disabled={anyUploading}
          >
            {anyUploading
              ? "Uploading…"
              : multiple
                ? "Choose files"
                : "Choose file"}
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <ul
          className="mt-3 flex flex-wrap gap-2"
          aria-label="Files being uploaded"
        >
          {items.map((p) => (
            <li
              key={p.id}
              className="inline-flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5"
              style={{
                background:
                  p.status === "error"
                    ? "rgba(220,38,38,0.08)"
                    : p.status === "done"
                      ? "rgba(19,217,160,0.10)"
                      : "var(--paper)",
                borderColor:
                  p.status === "error"
                    ? "rgba(220,38,38,0.35)"
                    : p.status === "done"
                      ? "rgba(19,217,160,0.35)"
                      : "var(--color-line)",
              }}
            >
              <span aria-hidden="true">📎</span>
              <div className="min-w-0 max-w-[260px]">
                <div className="truncate text-xs font-semibold text-ink">
                  {p.file.name}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate">
                  <span>{formatBytes(p.file.size)}</span>
                  {p.status === "uploading" ? (
                    <span aria-live="polite">Uploading…</span>
                  ) : p.status === "done" ? (
                    <span
                      className="inline-flex items-center gap-0.5 font-semibold"
                      style={{ color: "#0E9E77" }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Uploaded
                    </span>
                  ) : (
                    <span
                      className="truncate font-semibold text-red-700"
                      title={p.error}
                    >
                      {p.error ?? "Upload failed"}
                    </span>
                  )}
                </div>
                {p.status === "uploading" ? (
                  <div
                    className="mt-1 h-1 w-full overflow-hidden rounded-full"
                    style={{ background: "rgba(25,156,217,0.15)" }}
                    role="progressbar"
                    aria-label="Upload progress"
                  >
                    <div
                      className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--sky), var(--mint))",
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => removeItem(p.id)}
                aria-label={`Remove ${p.file.name}`}
                className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-slate hover:bg-slate/10 hover:text-navy-deep"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {dragDepth > 0 ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed"
          style={{
            background: "rgba(25,156,217,0.10)",
            borderColor: "rgba(25,156,217,0.55)",
            backdropFilter: "blur(1px)",
          }}
          aria-hidden="true"
        >
          <p
            className="text-sm font-bold uppercase tracking-widest text-navy-deep"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {multiple ? "Drop files to upload" : "Drop file to upload"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
