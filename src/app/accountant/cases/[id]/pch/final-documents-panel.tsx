"use client";

// Phase I.4c + I.4d: FinalDocumentsPanel.
//
// Three sub-sections, each anchored to the matching progress-bar
// chip:
//
//   #pch-acc-docs-generate   -> "Documents generated" chip
//     "Generate documents" button + status + Open links for the two
//     generated PDFs (SA Forwarding Letter, PCH Accounts). Disabled
//     entirely until pl_confirmed_at is set, with a clear "confirm
//     the P&L first" prompt.
//
//   #pch-acc-docs-upload     -> "SA302 + SA100 uploaded" chip
//     Two upload tiles for SA302 + SA100. Drag/drop + file picker,
//     25 MB cap, Open link once a path is set, Remove button to pull
//     a wrong file.
//
//   #pch-acc-send            -> "Sent for client confirmation" chip
//     "Send for client confirmation" button. Enabled only when all
//     four doc paths are populated. On click: flips the case to
//     client_approval, stamps docs_sent_for_approval_at. Shows a
//     "Sent on <date>" caption once sent.

import { useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import {
  deletePchFinalDocAction,
  generateFinalDocsAction,
  sendForClientConfirmationAction,
  uploadPchFinalDocAction,
} from "@/app/accountant/pch/final-docs-actions";
import { useAccountantProgress } from "./accountant-progress-context";

type SignUrl = (path: string) => Promise<ActionResult<string>>;

export function FinalDocumentsPanel({
  caseId,
  plConfirmed,
  initialSaForwardingPdfPath,
  initialPchAccountsPdfPath,
  initialSa302UploadPath,
  initialSa100UploadPath,
  initialDocsSentForApprovalAt,
  signUrl,
}: {
  caseId: string;
  plConfirmed: boolean;
  initialSaForwardingPdfPath: string | null;
  initialPchAccountsPdfPath: string | null;
  initialSa302UploadPath: string | null;
  initialSa100UploadPath: string | null;
  initialDocsSentForApprovalAt: string | null;
  signUrl: SignUrl;
}) {
  const [saForwarding, setSaForwarding] = useState(initialSaForwardingPdfPath);
  const [pchAccounts, setPchAccounts] = useState(initialPchAccountsPdfPath);
  const [sa302, setSa302] = useState(initialSa302UploadPath);
  const [sa100, setSa100] = useState(initialSa100UploadPath);
  const [sentAt, setSentAt] = useState(initialDocsSentForApprovalAt);
  const { setStepDone } = useAccountantProgress();

  const refreshGeneratedChip = (letter: string | null, accounts: string | null) => {
    setStepDone("docsGenerated", !!letter && !!accounts);
  };
  const refreshUploadChip = (a: string | null, b: string | null) => {
    setStepDone("docsUploaded", !!a && !!b);
  };

  const allFourReady = !!saForwarding && !!pchAccounts && !!sa302 && !!sa100;

  return (
    <>
      <GenerateDocsSection
        caseId={caseId}
        plConfirmed={plConfirmed}
        saForwarding={saForwarding}
        pchAccounts={pchAccounts}
        onGenerated={(letter, accounts) => {
          setSaForwarding(letter);
          setPchAccounts(accounts);
          refreshGeneratedChip(letter, accounts);
        }}
        signUrl={signUrl}
      />
      <UploadDocsSection
        caseId={caseId}
        sa302={sa302}
        sa100={sa100}
        onSa302Changed={(path) => {
          setSa302(path);
          refreshUploadChip(path, sa100);
        }}
        onSa100Changed={(path) => {
          setSa100(path);
          refreshUploadChip(sa302, path);
        }}
        signUrl={signUrl}
      />
      <SendForConfirmationSection
        caseId={caseId}
        allFourReady={allFourReady}
        sentAt={sentAt}
        onSent={(ts) => {
          setSentAt(ts);
          setStepDone("sentForApproval", true);
        }}
      />
    </>
  );
}

// -------------------------------------------------------------------
// Sub-section 1: Generate documents
// -------------------------------------------------------------------

function GenerateDocsSection({
  caseId, plConfirmed, saForwarding, pchAccounts, onGenerated, signUrl,
}: {
  caseId: string;
  plConfirmed: boolean;
  saForwarding: string | null;
  pchAccounts: string | null;
  onGenerated: (letter: string | null, accounts: string | null) => void;
  signUrl: SignUrl;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const generate = () =>
    start(async () => {
      setErr(null);
      const r = await generateFinalDocsAction(caseId);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onGenerated(r.saForwardingPdfPath, r.pchAccountsPdfPath);
    });

  const hasBoth = !!saForwarding && !!pchAccounts;

  return (
    <section
      id="pch-acc-docs-generate"
      className="mb-6 scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Generate final documents
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Builds the SA Tax Return forwarding letter and the PCH
            Accounts pack from the confirmed P&amp;L. Regenerate any
            time before sending; the stored paths replace in place.
          </p>
        </div>
        {hasBoth ? (
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            ✓ Generated
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Needs generation
          </span>
        )}
      </header>

      {!plConfirmed ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Confirm the P&amp;L above first. The letter and accounts pack
          pull their figures from the confirmed engine snapshot.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DocCard
          title="SA Tax Return forwarding letter"
          path={saForwarding}
          signUrl={signUrl}
          placeholder="Not generated yet."
        />
        <DocCard
          title="PCH Accounts"
          path={pchAccounts}
          signUrl={signUrl}
          placeholder="Not generated yet."
        />
      </div>

      <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={generate}
          disabled={pending || !plConfirmed}
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending
            ? "Generating."
            : hasBoth
              ? "Regenerate documents"
              : "Generate documents"}
        </button>
        {err ? <p className="text-xs text-rose-700">{err}</p> : null}
      </div>
    </section>
  );
}

function DocCard({
  title, path, signUrl, placeholder,
}: {
  title: string;
  path: string | null;
  signUrl: SignUrl;
  placeholder: string;
}) {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async () => {
    if (!path) return;
    setOpening(true);
    setErr(null);
    try {
      const r = await signUrl(path);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      window.open(r.data, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {path ? (
        <>
          <p className="mt-1 truncate text-[11px] text-slate-500" title={path}>
            Stored
          </p>
          <button
            type="button"
            onClick={open}
            disabled={opening}
            className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
          >
            {opening ? "Opening." : "Open"}
          </button>
        </>
      ) : (
        <p className="mt-1 text-xs text-slate-500">{placeholder}</p>
      )}
      {err ? <p className="mt-1 text-xs text-rose-700">{err}</p> : null}
    </div>
  );
}

// -------------------------------------------------------------------
// Sub-section 2: SA302 + SA100 upload
// -------------------------------------------------------------------

function UploadDocsSection({
  caseId, sa302, sa100, onSa302Changed, onSa100Changed, signUrl,
}: {
  caseId: string;
  sa302: string | null;
  sa100: string | null;
  onSa302Changed: (path: string | null) => void;
  onSa100Changed: (path: string | null) => void;
  signUrl: SignUrl;
}) {
  const hasBoth = !!sa302 && !!sa100;

  return (
    <section
      id="pch-acc-docs-upload"
      className="mb-6 scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Upload SA302 + SA100
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Both are required before sending for client confirmation.
            PDF, JPG, PNG or WebP up to 25 MB each.
          </p>
        </div>
        {hasBoth ? (
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            ✓ Uploaded
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Needs upload
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UploadTile
          caseId={caseId}
          column="sa302_upload_path"
          title="SA302"
          path={sa302}
          onChanged={onSa302Changed}
          signUrl={signUrl}
        />
        <UploadTile
          caseId={caseId}
          column="sa100_upload_path"
          title="SA100"
          path={sa100}
          onChanged={onSa100Changed}
          signUrl={signUrl}
        />
      </div>
    </section>
  );
}

const UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

function UploadTile({
  caseId, column, title, path, onChanged, signUrl,
}: {
  caseId: string;
  column: "sa302_upload_path" | "sa100_upload_path";
  title: string;
  path: string | null;
  onChanged: (path: string | null) => void;
  signUrl: SignUrl;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadPchFinalDocAction(caseId, column, fd);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onChanged(r.path);
    } finally {
      setUploading(false);
    }
  };
  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) await upload(f);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await upload(f);
  };
  const open = async () => {
    if (!path) return;
    setOpening(true);
    setErr(null);
    try {
      const r = await signUrl(path);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      window.open(r.data, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  };
  const remove = async () => {
    setRemoving(true);
    setErr(null);
    try {
      const r = await deletePchFinalDocAction(caseId, column);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onChanged(null);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={onDrop}
      className={
        "rounded-lg border p-3 transition "
        + (dragOver ? "border-sky bg-sky/5" : "border-slate-200 bg-slate-50")
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <span
          className={
            "text-[10px] font-semibold uppercase tracking-wider "
            + (path ? "text-emerald-700" : "text-amber-900")
          }
        >
          {path ? "Uploaded" : "Required"}
        </span>
      </div>
      {path ? (
        <p className="mb-2 text-[11px] text-slate-500">
          File saved. Replace or remove below.
        </p>
      ) : (
        <p className="mb-2 text-[11px] text-slate-500">
          {dragOver ? "Drop to upload." : "Drag and drop or pick a file."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || removing}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
        >
          {uploading ? "Uploading." : path ? "Replace" : "Upload"}
        </button>
        {path ? (
          <>
            <button
              type="button"
              onClick={open}
              disabled={opening}
              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
            >
              {opening ? "Opening." : "Open"}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={removing}
              className="rounded-md px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {removing ? "Removing." : "Remove"}
            </button>
          </>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        onChange={onPicked}
        className="hidden"
      />
      {err ? <p className="mt-1 text-xs text-rose-700">{err}</p> : null}
    </div>
  );
}

// -------------------------------------------------------------------
// Sub-section 3: Send for client confirmation
// -------------------------------------------------------------------

function SendForConfirmationSection({
  caseId, allFourReady, sentAt, onSent,
}: {
  caseId: string;
  allFourReady: boolean;
  sentAt: string | null;
  onSent: (ts: string) => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const alreadySent = !!sentAt;

  const send = () =>
    start(async () => {
      setErr(null);
      const r = await sendForClientConfirmationAction(caseId);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onSent(new Date().toISOString());
    });

  return (
    <section
      id="pch-acc-send"
      className="mb-6 scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Send for client confirmation
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Moves the case to the client's approval queue. Nothing is
            filed with HMRC until the client signs off.
          </p>
        </div>
        {alreadySent ? (
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            ✓ Sent
          </span>
        ) : allFourReady ? (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Ready to send
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            Waiting on documents
          </span>
        )}
      </header>

      {alreadySent ? (
        <p className="text-xs text-slate-600">
          Sent{" "}
          {sentAt ? new Date(sentAt).toLocaleString("en-GB") : null}. The
          client has the four documents on their workspace; the "Client
          approved" chip above flips green as soon as they sign.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={send}
            disabled={pending || !allFourReady}
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Sending." : "Send for client confirmation"}
          </button>
          {!allFourReady ? (
            <p className="mt-2 text-xs text-slate-600">
              All four documents (SA Forwarding Letter, PCH Accounts,
              SA302, SA100) must be in place before this button enables.
            </p>
          ) : null}
          {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
        </>
      )}
    </section>
  );
}
