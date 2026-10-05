"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import { DocumentUploader } from "@/components/case/document-uploader";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import type { TierId } from "@/lib/plans";
import {
  ENCRYPTED_FIELD_ID,
  LEGACY_DRIVING_LICENCE_ID,
  fieldIsVisible,
  type ChecklistField,
  type ChecklistSectionDef,
} from "@/lib/engagement/checklist";

type UploadedDoc = { id: string; file_name: string; uploaded_at: string };

type Props = {
  tierId: TierId;
  sections: ChecklistSectionDef[];
  // All fields visible for this tier (sections included for this tier,
  // regardless of showWhen). The form filters by `showWhen` live from
  // the answer state so a branch toggle re-renders without a round
  // trip, and recomputes required-count from the resulting visible set.
  fields: ChecklistField[];
  answers: Record<string, string>;
  /** Keyed by requirement_key. Empty record when nothing uploaded yet. */
  docsByKey: Record<string, UploadedDoc[]>;
  /** True when the Company Authentication Code has already been encrypted + stored. */
  authCodeAlreadySet: boolean;
  footer: string;
  saveAnswers: (fd: FormData) => Promise<ActionResult>;
  uploadDoc: (
    requirementKey: string,
    fd: FormData,
  ) => Promise<ActionResult<UploadedDoc>>;
  removeDoc: (docId: string) => Promise<ActionResult>;
  submit: () => Promise<ActionResult>;
};

export function OnboardingForm({
  tierId,
  sections,
  fields,
  answers: initialAnswers,
  docsByKey: initialDocsByKey,
  authCodeAlreadySet: initialAuthCodeSet,
  footer,
  saveAnswers,
  uploadDoc,
  removeDoc,
  submit,
}: Props) {
  const router = useRouter();

  // Local state that mirrors server reality after save/upload actions.
  // We update optimistically on text blur / upload success so the progress
  // bar moves without a full page refresh.
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [docsByKey, setDocsByKey] =
    useState<Record<string, UploadedDoc[]>>(initialDocsByKey);
  const [authCodeSet, setAuthCodeSet] = useState<boolean>(initialAuthCodeSet);
  const [authCodeDraft, setAuthCodeDraft] = useState<string>("");
  const [savingField, setSavingField] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  // Visibility is derived from the current answers so conditional
  // branches (Section B: Passport vs Driving licence) toggle live.
  // Required count re-computes on every answer change — picking
  // Passport drops the driving-licence slots out of both the count
  // and the submit guard.
  const visibleFields = fields.filter((f) => fieldIsVisible(f, answers));
  const requiredFields = visibleFields.filter((f) =>
    f.requiredFor.includes(tierId),
  );
  const requiredCount = requiredFields.length;
  const doneCount = requiredFields.filter((f) => {
    if (f.kind === "upload") return (docsByKey[f.id]?.length ?? 0) > 0;
    if (f.id === ENCRYPTED_FIELD_ID) return authCodeSet;
    const v = answers[f.id];
    return !!v && v.trim().length > 0;
  }).length;
  const pct = requiredCount === 0 ? 100 : Math.round((doneCount / requiredCount) * 100);

  // Legacy driving-licence uploads: before the Passport vs Driving-
  // licence branch landed, the Driving licence slot had a single
  // upload at this requirement_key. Surface any existing uploads as
  // a read-only "previously uploaded" row — removable, doesn't count
  // toward progress.
  const legacyDrivingLicenceDocs = docsByKey[LEGACY_DRIVING_LICENCE_ID] ?? [];

  // --- Field save (text / select / date) ---
  // On blur we POST a FormData containing just this one field. Keeps the
  // server-side logic simple (always merges), and means a failed save
  // doesn't block editing other fields.
  const saveField = useCallback(
    async (field: ChecklistField, value: string, extraValue?: string) => {
      setFieldError((e) => ({ ...e, [field.id]: "" }));
      setSavingField(field.id);
      const fd = new FormData();
      fd.set(field.id, value);
      if (
        field.kind === "select" &&
        field.showOtherOn &&
        extraValue !== undefined
      ) {
        fd.set(`${field.id}_other`, extraValue);
      }
      const res = await saveAnswers(fd);
      setSavingField(null);
      if (!res.ok) {
        setFieldError((e) => ({ ...e, [field.id]: res.error }));
        return;
      }
      if (field.id === ENCRYPTED_FIELD_ID) {
        setAuthCodeSet(true);
        setAuthCodeDraft("");
      }
    },
    [saveAnswers],
  );

  const handleSubmit = () => {
    setSubmitError(null);
    startSubmit(async () => {
      const res = await submit();
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      // Server marks onboarding_submitted_at; redirect back to the case
      // page where the "awaiting accountant" state is shown.
      router.push(window.location.pathname.replace(/\/onboarding\/?$/, ""));
    });
  };

  const bySection = (sectionKey: string) =>
    visibleFields.filter((f) => f.section === sectionKey);

  return (
    <div className="space-y-6">
      {/* Progress bar — matches the case-progress style used on the dashboard */}
      <div className="card-sl p-5">
        <div className="flex items-baseline justify-between">
          <span
            className="text-xs font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Checklist progress
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

      {sections.map((section) => (
        <section key={section.key} className="card-sl p-6 sm:p-8">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2
              className="text-lg font-semibold text-ink"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Section {section.key} — {section.title}
            </h2>
          </div>
          <div className="space-y-5">
            {/* Section A opens with the Company identity captured at
                engagement sign — read-only here. Rendered as a single
                locked card so the client doesn't try to re-type details
                that are already baked into the signed PDF. */}
            {section.key === "A" ? (
              <CompanyIdentityReadonly
                name={answers.company_name ?? ""}
                number={answers.company_number ?? ""}
                status={answers.company_status ?? "unknown"}
              />
            ) : null}
            {bySection(section.key).map((field) => {
              // Skip the two company identity fields in the normal loop
              // — they're rendered above as a locked block. The entries
              // still live in CHECKLIST_FIELDS so progress math and
              // the required-count submit guard treat them normally.
              if (
                field.id === "company_name" ||
                field.id === "company_number"
              ) {
                return null;
              }
              const required = field.requiredFor.includes(tierId);
              if (field.kind === "upload") {
                return (
                  <UploadRow
                    key={field.id}
                    field={field}
                    required={required}
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
                );
              }
              if (field.kind === "text") {
                const isAuthCode = field.id === ENCRYPTED_FIELD_ID;
                if (isAuthCode) {
                  return (
                    <AuthCodeRow
                      key={field.id}
                      field={field}
                      required={required}
                      alreadySet={authCodeSet}
                      draft={authCodeDraft}
                      setDraft={setAuthCodeDraft}
                      saving={savingField === field.id}
                      error={fieldError[field.id] ?? null}
                      onSave={(value) => saveField(field, value)}
                    />
                  );
                }
                return (
                  <TextRow
                    key={field.id}
                    field={field}
                    required={required}
                    value={answers[field.id] ?? ""}
                    saving={savingField === field.id}
                    error={fieldError[field.id] ?? null}
                    onChange={(v) =>
                      setAnswers((a) => ({ ...a, [field.id]: v }))
                    }
                    onBlurSave={(v) => saveField(field, v)}
                  />
                );
              }
              if (field.kind === "date") {
                return (
                  <DateRow
                    key={field.id}
                    field={field}
                    required={required}
                    value={answers[field.id] ?? ""}
                    saving={savingField === field.id}
                    error={fieldError[field.id] ?? null}
                    onChange={(v) =>
                      setAnswers((a) => ({ ...a, [field.id]: v }))
                    }
                    onBlurSave={(v) => saveField(field, v)}
                  />
                );
              }
              // select
              return (
                <SelectRow
                  key={field.id}
                  field={field}
                  required={required}
                  value={answers[field.id] ?? ""}
                  otherValue={answers[`${field.id}_other`] ?? ""}
                  saving={savingField === field.id}
                  error={fieldError[field.id] ?? null}
                  onChange={(v) => {
                    setAnswers((a) => ({ ...a, [field.id]: v }));
                    saveField(field, v, answers[`${field.id}_other`] ?? "");
                  }}
                  onOtherChange={(v) => {
                    setAnswers((a) => ({ ...a, [`${field.id}_other`]: v }));
                  }}
                  onOtherBlur={(v) =>
                    saveField(field, answers[field.id] ?? "", v)
                  }
                />
              );
            })}

            {/* Legacy driving-licence upload (pre-ID-choice schema). Only
                rendered on Section B and only when we actually have
                legacy docs — otherwise invisible. */}
            {section.key === "B" && legacyDrivingLicenceDocs.length > 0 ? (
              <LegacyDrivingLicenceBlock
                docs={legacyDrivingLicenceDocs}
                onRemoved={(id) =>
                  setDocsByKey((prev) => ({
                    ...prev,
                    [LEGACY_DRIVING_LICENCE_ID]: (
                      prev[LEGACY_DRIVING_LICENCE_ID] ?? []
                    ).filter((d) => d.id !== id),
                  }))
                }
                removeDoc={removeDoc}
              />
            ) : null}
          </div>
        </section>
      ))}

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
            ? `Submit for onboarding (${requiredCount - doneCount} more to go)`
            : "Submit for onboarding"}
      </SLButton>
    </div>
  );
}

// ---------------- Field rows ----------------

// Section A opener. Company Name + Number were captured at engagement
// sign and baked into the PDF, so they are not editable here — if the
// client needs a correction it goes through support (the engagement
// letter would need re-issuing anyway).
function CompanyIdentityReadonly({
  name,
  number,
  status,
}: {
  name: string;
  number: string;
  status: string;
}) {
  const statusLabel = companyStatusText(status);
  const hasAny = !!name || !!number;
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div
        className="text-[10px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Company (locked)
      </div>
      {hasAny ? (
        <>
          <div className="mt-1 text-base font-semibold text-ink">
            {name || "—"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate">
            <span
              className="rounded bg-cloud px-1.5 py-0.5 font-semibold text-ink"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {number || "—"}
            </span>
            {statusLabel ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background:
                    status.toLowerCase() === "active"
                      ? "rgba(19,217,160,0.14)"
                      : "rgba(217,159,25,0.14)",
                  color:
                    status.toLowerCase() === "active" ? "#0E9E77" : "#8a5c05",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {statusLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-[11px] text-slate">
            Captured when you signed the engagement letter. Contact support
            if either value is wrong — the engagement letter would need to
            be re-issued.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-slate">
          Company details aren&apos;t set on this case. If you reached
          this screen without signing the engagement letter, contact
          support.
        </p>
      )}
    </div>
  );
}

function companyStatusText(s: string): string {
  const t = s.trim().toLowerCase();
  if (!t) return "";
  if (t === "unknown") return "Unverified";
  if (t === "active") return "Active";
  if (t === "dissolved") return "Dissolved";
  return t.replace(/-/g, " ");
}

function FieldLabel({
  label,
  required,
  hint,
}: {
  label: string;
  required: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
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
      {hint ? <p className="mt-0.5 text-xs text-slate">{hint}</p> : null}
    </div>
  );
}

function TextRow({
  field,
  required,
  value,
  saving,
  error,
  onChange,
  onBlurSave,
}: {
  field: ChecklistField;
  required: boolean;
  value: string;
  saving: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onBlurSave: (v: string) => void;
}) {
  return (
    <label className="block">
      <FieldLabel label={field.label} required={required} hint={field.hint} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Always save the input's actual value on blur. The earlier
        // `e.target.value !== value → skip` guard was backwards: that's
        // exactly the window where state hasn't flushed yet and the
        // DOM holds the authoritative user input, so skipping dropped
        // the save on fast type-and-blur sequences.
        onBlur={(e) => onBlurSave(e.target.value)}
        className="input-sl mt-2"
      />
      {saving ? (
        <p className="mt-1 text-[11px] text-slate">Saving…</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function DateRow({
  field,
  required,
  value,
  saving,
  error,
  onChange,
  onBlurSave,
}: {
  field: ChecklistField;
  required: boolean;
  value: string;
  saving: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onBlurSave: (v: string) => void;
}) {
  return (
    <label className="block max-w-xs">
      <FieldLabel label={field.label} required={required} hint={field.hint} />
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlurSave(e.target.value)}
        className="input-sl mt-2"
      />
      {saving ? (
        <p className="mt-1 text-[11px] text-slate">Saving…</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function SelectRow({
  field,
  required,
  value,
  otherValue,
  saving,
  error,
  onChange,
  onOtherChange,
  onOtherBlur,
}: {
  field: ChecklistField;
  required: boolean;
  value: string;
  otherValue: string;
  saving: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onOtherChange: (v: string) => void;
  onOtherBlur: (v: string) => void;
}) {
  if (field.kind !== "select") return null;
  const showOther = field.showOtherOn && value === field.showOtherOn;
  return (
    <div>
      <FieldLabel label={field.label} required={required} hint={field.hint} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-sl mt-2 max-w-xs"
      >
        <option value="">Choose one…</option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {showOther ? (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          onBlur={(e) => onOtherBlur(e.target.value)}
          placeholder="Scheme name"
          className="input-sl mt-2 max-w-xs"
        />
      ) : null}
      {saving ? (
        <p className="mt-1 text-[11px] text-slate">Saving…</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AuthCodeRow({
  field,
  required,
  alreadySet,
  draft,
  setDraft,
  saving,
  error,
  onSave,
}: {
  field: ChecklistField;
  required: boolean;
  alreadySet: boolean;
  draft: string;
  setDraft: (v: string) => void;
  saving: boolean;
  error: string | null;
  onSave: (v: string) => void;
}) {
  return (
    <div>
      <FieldLabel label={field.label} required={required} hint={field.hint} />
      {alreadySet ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink">
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white text-[11px] font-bold"
            style={{
              background:
                "linear-gradient(135deg, var(--sky), var(--mint))",
            }}
            aria-hidden="true"
          >
            ✓
          </span>
          Saved securely. You can overwrite it below if it&rsquo;s changed.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={alreadySet ? "Enter a new code to replace" : "Enter code"}
          className="input-sl max-w-xs"
          autoComplete="off"
          spellCheck={false}
          // Hint to browsers to not surface this in autofill UX.
          style={{ fontFamily: "var(--font-mono)" }}
        />
        <SLButton
          type="button"
          variant="outline"
          onClick={() => draft.trim() && onSave(draft.trim())}
          disabled={saving || draft.trim().length === 0}
        >
          {saving ? "Saving…" : "Save code"}
        </SLButton>
      </div>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Read-only display of legacy pre-schema driving-licence uploads so
// test cases that already have docs under the old single-slot key
// still see them in the form. Not counted toward progress. Removable
// so the client can tidy up before moving on.
function LegacyDrivingLicenceBlock({
  docs,
  onRemoved,
  removeDoc,
}: {
  docs: UploadedDoc[];
  onRemoved: (id: string) => void;
  removeDoc: (docId: string) => Promise<ActionResult>;
}) {
  const [removing, startRemove] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
  return (
    <div className="rounded-xl border border-dashed border-line bg-paper p-4">
      <div
        className="text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Previous driving licence upload
      </div>
      <p className="mt-1 text-xs text-slate">
        You uploaded this before we split the Driving licence slot into
        front and back. It won&apos;t count toward the new requirements
        — please re-upload the front and back above if that&apos;s the
        ID you&apos;re providing. Remove it here when you&apos;re done.
      </p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-white">
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
              disabled={removing}
              className="text-xs font-semibold text-red-700 underline underline-offset-4 hover:text-red-900 disabled:opacity-50"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function UploadRow({
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
  // Per-doc removing flag. useTransition sets a single boolean for the
  // whole slot, which would race if the user clicked multiple Remove
  // buttons in quick succession. Tracking the removing set per-id lets
  // each button self-disable the moment it's clicked and blocks a
  // second click from re-firing the same action.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  // Adapter: DocumentUploader hands us a FormData per file. We delegate
  // to the parent's uploadDoc with this slot's requirement_key baked in,
  // and on success the server returns the real doc row (id + name +
  // uploaded_at), which we feed into the parent list so the Remove
  // button can act on a real DB id without waiting for a refresh.
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
    // Guard against repeat clicks before the server round-trip returns.
    // setRemovingIds flips synchronously so the second click sees the
    // id in the set and short-circuits before touching the network.
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

  // Non-multi slots that already have a doc: hide the uploader until the
  // existing file is removed. Keeps the "one file" semantic honest and
  // avoids the user wondering why their second drop was ignored.
  const uploaderHidden = !allowMultiple && docs.length > 0;

  return (
    <div>
      <FieldLabel label={field.label} required={required} hint={field.hint} />
      {uploaderHidden ? null : (
        <div className="mt-2">
          <DocumentUploader
            action={slotAction}
            multiple={allowMultiple}
            hint={
              allowMultiple
                ? "PDF or image · up to 50 MB each · multiple files ok"
                : "PDF or image · up to 50 MB"
            }
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
