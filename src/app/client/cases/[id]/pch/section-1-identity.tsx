"use client";

// Section 1: Identity.
//
// Driving licence front + back upload is the one mandatory upload in
// the whole intake flow. The front triggers OCR of name / DOB /
// address / postcode which auto-populate the inputs below the moment
// the vision call finishes (live-merged in from pch_cases). Every
// other input is a plain mandatory text/number field with debounced
// per-field save - no page submit, no refresh. UTR and NI number
// have an inline optional "upload document" button that runs a
// single-shot OCR for just that one field.

import { useEffect, useRef, useState } from "react";
import { useLiveList, useLiveRow } from "@/lib/realtime-live-merge";
import { useDebouncedSave } from "@/lib/hooks/use-debounced-save";
import {
  savePchHeadFieldAction,
  extractUtrFromUploadAction,
  extractNinoFromUploadAction,
  autoApplyPch24ExtractionAction,
} from "@/app/client/pch/intake-actions";
import { uploadPchDocumentAction, setPchPhotoIdKindAction } from "@/app/client/pch/actions";

type LicenceDoc = {
  id: string;
  file_name: string;
  uploaded_at: string;
  photo_id_side: "front" | "back" | null;
};

type Pch24Extraction = {
  id: string;
  status: string;
  photo_id_side: "front" | "back" | null;
  applied_at: string | null;
};

export type Section1InitialHead = {
  cl_name: string | null;
  cl_dob: string | null;
  cl_address: string | null;
  cl_postcode: string | null;
  cl_phone: string | null;
  cl_email: string | null;
  cl_utr: string | null;
  cl_nino: string | null;
  photo_id_kind: "passport" | "licence" | null;
};

export function Section1Identity({
  caseId,
  editable,
  initial,
  licenceDocs,
  pch24Extractions,
}: {
  caseId: string;
  editable: boolean;
  initial: Section1InitialHead;
  licenceDocs: LicenceDoc[];
  pch24Extractions: Pch24Extraction[];
}) {
  // Pch_cases head is live-merged so OCR-applied fields populate the
  // inputs the moment the background extraction (auto-applied via
  // autoApplyPch24ExtractionAction when the vision call completes)
  // writes them. We only track the fields section 1 reads here; other
  // sections mount their own useLiveRow against the same table with a
  // scoped map.
  type LiveHead = Section1InitialHead;
  const live = useLiveRow<LiveHead>(initial, {
    table: "pch_cases",
    filter: `case_id=eq.${caseId}`,
    channel: `section-1-head-${caseId}`,
    map: (row, prev) => ({
      cl_name: pick(row.cl_name, prev.cl_name),
      cl_dob: pick(row.cl_dob, prev.cl_dob),
      cl_address: pick(row.cl_address, prev.cl_address),
      cl_postcode: pick(row.cl_postcode, prev.cl_postcode),
      cl_phone: pick(row.cl_phone, prev.cl_phone),
      cl_email: pick(row.cl_email, prev.cl_email),
      cl_utr: pick(row.cl_utr, prev.cl_utr),
      cl_nino: pick(row.cl_nino, prev.cl_nino),
      photo_id_kind: pick(row.photo_id_kind, prev.photo_id_kind) as
        | "passport" | "licence" | null,
    }),
  });

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-bold">1. Identity</h2>
      <p className="mb-4 text-xs text-slate-600">
        Starts with your driving licence. We&apos;ll read your name,
        date of birth, address and postcode off it so you don&apos;t
        have to type them. Everything else is a quick field below.
      </p>

      <LicenceCard
        caseId={caseId}
        editable={editable}
        docs={licenceDocs}
        extractions={pch24Extractions}
        photoIdKind={live.photo_id_kind}
      />

      <FieldGrid>
        <HeadTextField
          caseId={caseId}
          field="cl_name"
          label="Full name"
          placeholder="As it appears on your licence"
          liveValue={live.cl_name}
          editable={editable}
          required
        />
        <HeadTextField
          caseId={caseId}
          field="cl_dob"
          label="Date of birth"
          type="date"
          liveValue={live.cl_dob}
          editable={editable}
          required
        />
        <HeadTextField
          caseId={caseId}
          field="cl_address"
          label="Address"
          placeholder="House number, street, town"
          liveValue={live.cl_address}
          editable={editable}
          required
          wide
        />
        <HeadTextField
          caseId={caseId}
          field="cl_postcode"
          label="Postcode"
          placeholder="e.g. SW1A 2AA"
          liveValue={live.cl_postcode}
          editable={editable}
          required
          autoCapitalize="characters"
        />
        <HeadTextField
          caseId={caseId}
          field="cl_phone"
          label="Phone"
          type="tel"
          placeholder="+44 7..."
          liveValue={live.cl_phone}
          editable={editable}
          required
        />
        <HeadTextField
          caseId={caseId}
          field="cl_email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          liveValue={live.cl_email}
          editable={editable}
          required
        />
      </FieldGrid>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HeadFieldWithOcrUpload
          caseId={caseId}
          field="cl_utr"
          label="UTR (Unique Taxpayer Reference)"
          placeholder="10 digits"
          liveValue={live.cl_utr}
          editable={editable}
          runUpload={extractUtrFromUploadAction}
          responseField="utr"
          autoCapitalize="off"
          inputMode="numeric"
          helpText="Optional: upload your HMRC letter and we&apos;ll read the UTR off it. You can also just type it in."
        />
        <HeadFieldWithOcrUpload
          caseId={caseId}
          field="cl_nino"
          label="National Insurance number"
          placeholder="e.g. AB123456C"
          liveValue={live.cl_nino}
          editable={editable}
          runUpload={extractNinoFromUploadAction}
          responseField="nino"
          autoCapitalize="characters"
          helpText="Optional: upload any payslip, P60 or HMRC letter and we&apos;ll read your NI number off it."
        />
      </div>
    </section>
  );
}

// A null-safe "server pushed me a value or I keep what I had" merge.
// The hook ignores server-pushed value changes while the user is
// actively typing (see use-debounced-save), so this is only consulted
// between keystrokes - safe to always prefer the server value when
// it's non-null, and keep the previous local value when the server
// explicitly nulled a field (e.g. a bad OCR applied an empty string).
function pick<T>(incoming: unknown, prev: T): T {
  if (incoming === undefined) return prev;
  return incoming as T;
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {children}
    </div>
  );
}

type HeadTextFieldProps = {
  caseId: string;
  field: string;
  label: string;
  liveValue: string | null;
  editable: boolean;
  required?: boolean;
  wide?: boolean;
  type?: "text" | "date" | "tel" | "email" | "number";
  placeholder?: string;
  autoCapitalize?: "off" | "characters" | "words" | "sentences" | "none";
  inputMode?: "text" | "numeric" | "tel" | "email" | "decimal";
};

function HeadTextField(props: HeadTextFieldProps) {
  const { value, onChange, status, error } = useDebouncedSave<string>({
    initial: props.liveValue ?? "",
    save: async (v) => {
      const r = await savePchHeadFieldAction(
        props.caseId,
        props.field,
        v.trim().length === 0 ? null : v.trim(),
      );
      if (!r.ok) throw new Error(r.error);
    },
  });
  return (
    <label className={props.wide ? "sm:col-span-2" : undefined}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>
          {props.label}
          {props.required ? <span className="text-rose-600"> *</span> : null}
        </span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <input
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoCapitalize={props.autoCapitalize}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={props.placeholder}
        disabled={!props.editable}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
      />
    </label>
  );
}

// UTR / NI: text field with an inline "Upload document" button that
// triggers a single-shot OCR for just this one field. The returned
// value is written to pch_cases on the server; our useLiveRow picks
// it up and populates the input.
function HeadFieldWithOcrUpload(props: {
  caseId: string;
  field: "cl_utr" | "cl_nino";
  label: string;
  placeholder?: string;
  liveValue: string | null;
  editable: boolean;
  runUpload: (
    caseId: string,
    formData: FormData,
  ) => Promise<
    | { ok: true; utr?: string | null; nino?: string | null }
    | { ok: false; error: string }
  >;
  responseField: "utr" | "nino";
  autoCapitalize?: HeadTextFieldProps["autoCapitalize"];
  inputMode?: HeadTextFieldProps["inputMode"];
  helpText?: string;
}) {
  const { value, onChange, status, error } = useDebouncedSave<string>({
    initial: props.liveValue ?? "",
    save: async (v) => {
      const r = await savePchHeadFieldAction(
        props.caseId,
        props.field,
        v.trim().length === 0 ? null : v.trim().toUpperCase().replace(/\s/g, ""),
      );
      if (!r.ok) throw new Error(r.error);
    },
  });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<string | null>(null);

  const openPicker = () => fileRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-selecting the same file
    setUploading(true);
    setUploadError(null);
    setExtracted(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await props.runUpload(props.caseId, fd);
      if (!r.ok) {
        setUploadError(r.error);
        return;
      }
      const found = r[props.responseField] ?? null;
      if (found) {
        setExtracted(found);
        onChange(found);
      } else {
        setUploadError(
          "Uploaded, but we couldn&apos;t read it off this document. Type it below.",
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
        <span>
          {props.label}
          <span className="text-rose-600"> *</span>
        </span>
        <SaveStatusPill status={status} error={error} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          inputMode={props.inputMode}
          autoCapitalize={props.autoCapitalize}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={props.placeholder}
          disabled={!props.editable}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30 disabled:bg-slate-100"
        />
        <button
          type="button"
          onClick={openPicker}
          disabled={!props.editable || uploading}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
        >
          {uploading ? "Reading..." : "Upload document"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={onFile}
          className="hidden"
        />
      </div>
      {extracted ? (
        <p className="mt-1 text-xs text-emerald-700">
          Read {extracted} off your document. Check it&apos;s right, or
          edit above.
        </p>
      ) : null}
      {uploadError ? (
        <p className="mt-1 text-xs text-rose-700">{uploadError}</p>
      ) : props.helpText ? (
        <p className="mt-1 text-xs text-slate-500">{props.helpText}</p>
      ) : null}
    </div>
  );
}

function SaveStatusPill({
  status, error,
}: {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
}) {
  if (status === "saving") {
    return <span className="text-[11px] text-slate-500">Saving...</span>;
  }
  if (status === "saved") {
    return (
      <span className="text-[11px] font-medium text-emerald-700">
        <SavedTick /> Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-[11px] font-medium text-rose-700">
        {error ?? "Save failed"}
      </span>
    );
  }
  return null;
}

function SavedTick() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block align-[-1px]"
    >
      <polyline points="5 13 10 18 20 7" />
    </svg>
  );
}

// -------------------------------------------------------------------
// Licence upload card: the one mandatory upload in the whole flow.
// -------------------------------------------------------------------
function LicenceCard({
  caseId, editable, docs, extractions, photoIdKind,
}: {
  caseId: string;
  editable: boolean;
  docs: LicenceDoc[];
  extractions: Pch24Extraction[];
  photoIdKind: "passport" | "licence" | null;
}) {
  // Phase F: driving licence is the only ID we accept. Call
  // setPchPhotoIdKindAction once on first mount so the existing
  // uploadPchDocumentAction / PCH-24 server path (which requires
  // photo_id_kind to be set before accepting a side) still works.
  // No client-visible kind picker any more.
  const didSetKindRef = useRef(false);
  useEffect(() => {
    if (didSetKindRef.current) return;
    if (photoIdKind === "licence") {
      didSetKindRef.current = true;
      return;
    }
    didSetKindRef.current = true;
    void setPchPhotoIdKindAction(caseId, "licence");
  }, [caseId, photoIdKind]);

  // Live-track PCH-24 extraction rows so a vision call completing in
  // the background flips us from "AI is reading your licence..." to
  // "we read 4 fields off your ID, check each one below" without a
  // page refresh.
  const liveExtractions = useLiveList<Pch24Extraction>(extractions, {
    table: "pch_doc_extractions",
    filter: `case_id=eq.${caseId}`,
    channel: `section-1-pch24-ext-${caseId}`,
    map: (row) => {
      if (row.slot_code !== "PCH-24") return null;
      return {
        id: row.id as string,
        status: row.status as string,
        photo_id_side: (row.photo_id_side as "front" | "back" | null) ?? null,
        applied_at: (row.applied_at as string | null) ?? null,
      };
    },
  });

  // When a new 'done' extraction appears, fire the server-side
  // auto-apply exactly once per extraction id. We filter on applied_at
  // (migration 0114) as well as a client-side ref so a re-render
  // doesn't re-fire and a refresh with the server still thinking the
  // row is handled doesn't clobber a client edit.
  const [applied, setApplied] = useState<Record<string, string> | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const handledIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const target = liveExtractions.find((e) => {
      if (e.status !== "done") return false;
      if (e.photo_id_side === "back") return false;
      if (e.applied_at !== null) return false;
      return !handledIdsRef.current.has(e.id);
    });
    if (!target) return;
    handledIdsRef.current.add(target.id);
    setApplyPending(true);
    void autoApplyPch24ExtractionAction(caseId).then((r) => {
      setApplyPending(false);
      if (r.ok) setApplied(r.applied);
      else setApplyError(r.error);
    });
  }, [liveExtractions, caseId]);

  // Any pending/processing extraction on the licence front upload is
  // worth showing a "reading" indicator for.
  const readingExtraction = liveExtractions.find(
    (e) =>
      (e.status === "pending" || e.status === "processing")
      && e.photo_id_side === "front",
  );

  const frontDoc = docs.find((d) => d.photo_id_side === "front") ?? null;
  const backDoc = docs.find((d) => d.photo_id_side === "back") ?? null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-ink">Driving licence</div>
          <p className="mt-1 text-xs text-slate-600">
            Upload the front and back of your UK driving licence. We&apos;ll
            read your name, date of birth, address and postcode off the
            front automatically.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
          Required
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LicenceSideTile
          caseId={caseId}
          editable={editable}
          side="front"
          uploaded={frontDoc}
          runsOcr
        />
        <LicenceSideTile
          caseId={caseId}
          editable={editable}
          side="back"
          uploaded={backDoc}
        />
      </div>

      {applyPending || readingExtraction ? (
        <p className="mt-3 text-xs text-sky-800">
          Reading your ID... this usually takes 10-30 seconds.
        </p>
      ) : null}
      {applied && Object.keys(applied).length > 0 && !applyPending ? (
        <p className="mt-3 text-xs text-emerald-700">
          Read {Object.keys(applied).length}{" "}
          {Object.keys(applied).length === 1 ? "field" : "fields"} off
          your ID. Check each one below and edit if anything looks
          wrong.
        </p>
      ) : null}
      {applyError ? (
        <p className="mt-3 text-xs text-rose-700">{applyError}</p>
      ) : null}
    </div>
  );
}

function LicenceSideTile({
  caseId, editable, side, uploaded, runsOcr,
}: {
  caseId: string;
  editable: boolean;
  side: "front" | "back";
  uploaded: LicenceDoc | null;
  runsOcr?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = side === "front" ? "Front" : "Back";

  const openPicker = () => fileRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("photo_id_side", side);
      const r = await uploadPchDocumentAction(caseId, "PCH-24", fd);
      if (!r.ok) setErr(r.error);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-700">
          {label}
        </div>
        {uploaded ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Uploaded
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Needed
          </span>
        )}
      </div>
      {uploaded ? (
        <p className="truncate text-xs text-slate-700" title={uploaded.file_name}>
          {uploaded.file_name}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          PDF or photo. {runsOcr ? "We&apos;ll read it automatically." : "Keep it clear so your accountant can read it later."}
        </p>
      )}
      <button
        type="button"
        onClick={openPicker}
        disabled={!editable || uploading}
        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-sky hover:text-sky disabled:opacity-50"
      >
        {uploading ? "Uploading..." : uploaded ? "Replace file" : "Upload"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic"
        onChange={onFile}
        className="hidden"
      />
      {err ? <p className="mt-1 text-xs text-rose-700">{err}</p> : null}
    </div>
  );
}
