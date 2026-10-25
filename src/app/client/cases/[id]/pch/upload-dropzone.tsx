"use client";

// Shared file-upload primitives for the PCH intake. Three exports:
//
//   useFileDrop({ onFile, accept, disabled })
//     Hook that returns dropProps + isDragOver so any custom layout
//     can accept drag-and-drop. The upload-progress / error state
//     stays with the caller.
//
//   <UploadControl />
//     Full inline-card upload: label, help text, "has a file"
//     indicator, Upload button, optional Take-photo button, and
//     drag-and-drop on the whole surface. One call per site.
//
//   <TileUpload />
//     Thinner tile variant (used for the licence front/back pair).
//     Same drag + Take-photo behaviour, different chrome.
//
// All of them run the caller's async onFile(file) exactly once per
// file and show a Uploading... state until it resolves; errors are
// surfaced via throwing from onFile.

import { useRef, useState } from "react";

const DEFAULT_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic";

type FileDropOpts = {
  onFile: (file: File) => void | Promise<void>;
  accept?: string;
  disabled?: boolean;
};

type DropProps = {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

export function useFileDrop({ onFile, accept, disabled }: FileDropOpts): {
  dropProps: DropProps;
  isDragOver: boolean;
} {
  const [isDragOver, setIsDragOver] = useState(false);

  const dropProps: DropProps = {
    onDragOver: (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    },
    onDragLeave: (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    },
    onDragEnd: (e) => {
      if (disabled) return;
      e.preventDefault();
      setIsDragOver(false);
    },
    onDrop: (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (accept && !acceptsFile(file, accept)) return;
      void onFile(file);
    },
  };

  return { dropProps, isDragOver };
}

function acceptsFile(file: File, accept: string): boolean {
  const list = accept.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return list.some((entry) => {
    if (entry.startsWith(".")) return name.endsWith(entry);
    if (entry.endsWith("/*")) return type.startsWith(entry.slice(0, -1));
    return type === entry;
  });
}

type UploadControlProps = {
  onFile: (file: File) => void | Promise<void>;
  disabled?: boolean;
  accept?: string;
  idleLabel?: string;
  busyLabel?: string;
  replaceLabel?: string;
  current?: boolean;         // true if a file is already uploaded for this slot
  heading?: string;          // small all-caps row above the button
  helpText?: string;
  successText?: string | null;
  error?: string | null;
  busy?: boolean;            // externally controlled; otherwise managed internally
  withCamera?: boolean;
  cameraCapture?: "user" | "environment";
};

export function UploadControl({
  onFile,
  disabled,
  accept = DEFAULT_ACCEPT,
  idleLabel = "Upload",
  busyLabel = "Uploading...",
  replaceLabel = "Replace file",
  current,
  heading,
  helpText,
  successText,
  error,
  busy: busyProp,
  withCamera,
  cameraCapture = "environment",
}: UploadControlProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const busy = busyProp ?? internalBusy;
  const run = async (file: File) => {
    if (busyProp === undefined) setInternalBusy(true);
    try {
      await onFile(file);
    } finally {
      if (busyProp === undefined) setInternalBusy(false);
    }
  };
  const { dropProps, isDragOver } = useFileDrop({
    onFile: run,
    accept,
    disabled: disabled || busy,
  });
  const pickRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);

  const pickFiles = () => pickRef.current?.click();
  const openCamera = () => camRef.current?.click();

  const label = busy ? busyLabel : current ? replaceLabel : idleLabel;

  return (
    <div
      {...dropProps}
      className={
        "rounded-lg border p-3 transition "
        + (isDragOver
          ? "border-sky bg-sky/5"
          : "border-slate-200 bg-slate-50")
      }
    >
      {heading ? (
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
          {heading}
        </div>
      ) : null}
      {current && !isDragOver ? (
        <p className="mb-2 text-xs text-emerald-700">
          {successText ?? "File uploaded. Drop another or pick one to replace it."}
        </p>
      ) : null}
      {isDragOver ? (
        <p className="mb-2 text-xs font-medium text-sky-800">
          Drop to upload.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={pickFiles}
          disabled={disabled || busy}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
        >
          {label}
        </button>
        {withCamera ? (
          <button
            type="button"
            onClick={openCamera}
            disabled={disabled || busy}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
          >
            Take photo
          </button>
        ) : null}
      </div>
      <input
        ref={pickRef}
        type="file"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void run(f);
        }}
        className="hidden"
      />
      {withCamera ? (
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture={cameraCapture}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(f);
          }}
          className="hidden"
        />
      ) : null}
      {helpText && !error ? (
        <p className="mt-2 text-[11px] text-slate-500">{helpText}</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

type TileUploadProps = {
  onFile: (file: File) => void | Promise<void>;
  disabled?: boolean;
  accept?: string;
  heading: string;              // "Front" / "Back" etc.
  fileName?: string | null;     // the uploaded file name, if any
  emptyHint: string;            // shown before the first upload
  idleLabel?: string;
  busyLabel?: string;
  replaceLabel?: string;
  busy?: boolean;
  error?: string | null;
  withCamera?: boolean;
  cameraCapture?: "user" | "environment";
};

export function TileUpload({
  onFile,
  disabled,
  accept = DEFAULT_ACCEPT,
  heading,
  fileName,
  emptyHint,
  idleLabel = "Upload",
  busyLabel = "Uploading...",
  replaceLabel = "Replace file",
  busy: busyProp,
  error,
  withCamera,
  cameraCapture = "environment",
}: TileUploadProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const busy = busyProp ?? internalBusy;
  const run = async (file: File) => {
    if (busyProp === undefined) setInternalBusy(true);
    try {
      await onFile(file);
    } finally {
      if (busyProp === undefined) setInternalBusy(false);
    }
  };
  const { dropProps, isDragOver } = useFileDrop({
    onFile: run,
    accept,
    disabled: disabled || busy,
  });
  const pickRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const uploaded = !!fileName;

  return (
    <div
      {...dropProps}
      className={
        "rounded-lg border p-3 transition "
        + (isDragOver
          ? "border-sky bg-sky/5"
          : "border-slate-200 bg-slate-50")
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          {heading}
        </div>
        <span
          className={
            "text-[10px] font-semibold uppercase tracking-wider "
            + (uploaded ? "text-emerald-700" : "text-amber-900")
          }
        >
          {uploaded ? "Uploaded" : "Needed"}
        </span>
      </div>
      {uploaded ? (
        <p className="truncate text-xs text-slate-700" title={fileName ?? undefined}>
          {fileName}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          {isDragOver ? "Drop to upload." : emptyHint}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => pickRef.current?.click()}
          disabled={disabled || busy}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
        >
          {busy ? busyLabel : uploaded ? replaceLabel : idleLabel}
        </button>
        {withCamera ? (
          <button
            type="button"
            onClick={() => camRef.current?.click()}
            disabled={disabled || busy}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
          >
            Take photo
          </button>
        ) : null}
      </div>
      <input
        ref={pickRef}
        type="file"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void run(f);
        }}
        className="hidden"
      />
      {withCamera ? (
        <input
          ref={camRef}
          type="file"
          accept="image/*"
          capture={cameraCapture}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(f);
          }}
          className="hidden"
        />
      ) : null}
      {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
