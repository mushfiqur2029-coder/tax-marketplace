"use client";

import { useCallback, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import {
  ENCRYPTED_FIELD_ID,
  LEGACY_DRIVING_LICENCE_ID,
  fieldIsVisible,
  type ChecklistField,
  type ChecklistSectionDef,
} from "@/lib/engagement/checklist";

export type OnboardingDoc = {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
  requirement_key: string | null;
};

type Props = {
  sections: ChecklistSectionDef[];
  fields: ChecklistField[];
  answers: Record<string, string>;
  docs: OnboardingDoc[];
  authCodeAvailable: boolean;
  // Opens a signed URL for the given doc path in a new tab.
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
  // Decrypts the Company Authentication Code server-side and returns the
  // plaintext. Only wired on admin + assigned-accountant surfaces.
  revealAuthCode: () => Promise<ActionResult<string | null>>;
};

// Read-only view of the limited-company onboarding checklist for the
// accountant and admin case pages. Groups both the text answers from
// cases.intake_answers and the uploaded documents (by requirement_key)
// section by section, so a reviewer can tick through the same shape
// the client filled in.
export function OnboardingAnswersPanel({
  sections,
  fields,
  answers,
  docs,
  authCodeAvailable,
  getDocUrl,
  revealAuthCode,
}: Props) {
  const docsByKey: Record<string, OnboardingDoc[]> = {};
  for (const d of docs) {
    if (!d.requirement_key) continue;
    (docsByKey[d.requirement_key] ??= []).push(d);
  }

  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const [docPending, startDoc] = useTransition();
  const [docError, setDocError] = useState<Record<string, string>>({});

  const openDoc = useCallback(
    (doc: OnboardingDoc) => {
      setDocError((e) => ({ ...e, [doc.id]: "" }));
      setPendingDocId(doc.id);
      startDoc(async () => {
        const res = await getDocUrl(doc.file_url);
        setPendingDocId(null);
        if (res.ok) window.open(res.data, "_blank", "noopener");
        else setDocError((e) => ({ ...e, [doc.id]: res.error }));
      });
    },
    [getDocUrl],
  );

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        // Only render fields whose showWhen matches the current answers.
        // Mirrors the client form so the accountant sees the same branch
        // the client was filling in.
        const fieldsHere = fields.filter(
          (f) => f.section === section.key && fieldIsVisible(f, answers),
        );
        const legacyDl =
          section.key === "B"
            ? docsByKey[LEGACY_DRIVING_LICENCE_ID] ?? []
            : [];
        if (fieldsHere.length === 0 && legacyDl.length === 0) return null;
        return (
          <div
            key={section.key}
            className="rounded-xl border border-line bg-paper p-4"
          >
            <h4
              className="mb-3 text-sm font-semibold text-ink"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {section.key === "P"
                ? section.title
                : `Section ${section.key}: ${section.title}`}
            </h4>
            <dl className="divide-y divide-line">
              {fieldsHere.map((field) => (
                <Row
                  key={field.id}
                  field={field}
                  answers={answers}
                  docs={docsByKey[field.id] ?? []}
                  openDoc={openDoc}
                  pendingDocId={pendingDocId}
                  docPending={docPending}
                  docError={docError}
                  authCodeAvailable={authCodeAvailable}
                  revealAuthCode={revealAuthCode}
                />
              ))}
              {legacyDl.length > 0 ? (
                <LegacyDrivingLicenceRow
                  docs={legacyDl}
                  openDoc={openDoc}
                  pendingDocId={pendingDocId}
                  docPending={docPending}
                  docError={docError}
                />
              ) : null}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  field,
  answers,
  docs,
  openDoc,
  pendingDocId,
  docPending,
  docError,
  authCodeAvailable,
  revealAuthCode,
}: {
  field: ChecklistField;
  answers: Record<string, string>;
  docs: OnboardingDoc[];
  openDoc: (doc: OnboardingDoc) => void;
  pendingDocId: string | null;
  docPending: boolean;
  docError: Record<string, string>;
  authCodeAvailable: boolean;
  revealAuthCode: () => Promise<ActionResult<string | null>>;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
      <dt
        className="text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {field.label}
      </dt>
      <dd className="text-sm text-ink">
        <FieldValue
          field={field}
          answers={answers}
          docs={docs}
          openDoc={openDoc}
          pendingDocId={pendingDocId}
          docPending={docPending}
          docError={docError}
          authCodeAvailable={authCodeAvailable}
          revealAuthCode={revealAuthCode}
        />
      </dd>
    </div>
  );
}

function FieldValue({
  field,
  answers,
  docs,
  openDoc,
  pendingDocId,
  docPending,
  docError,
  authCodeAvailable,
  revealAuthCode,
}: {
  field: ChecklistField;
  answers: Record<string, string>;
  docs: OnboardingDoc[];
  openDoc: (doc: OnboardingDoc) => void;
  pendingDocId: string | null;
  docPending: boolean;
  docError: Record<string, string>;
  authCodeAvailable: boolean;
  revealAuthCode: () => Promise<ActionResult<string | null>>;
}) {
  if (field.id === ENCRYPTED_FIELD_ID) {
    return (
      <AuthCodeReveal
        available={authCodeAvailable}
        revealAuthCode={revealAuthCode}
      />
    );
  }

  if (field.kind === "upload") {
    if (docs.length === 0) {
      return <span className="italic text-slate">(not uploaded)</span>;
    }
    return (
      <ul className="space-y-1">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {d.file_name}
              </div>
              <div className="text-[11px] text-slate">
                {formatDateTime(d.uploaded_at)}
              </div>
              {docError[d.id] ? (
                <p className="mt-1 text-[11px] text-red-700" role="alert">
                  {docError[d.id]}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => openDoc(d)}
              disabled={docPending && pendingDocId === d.id}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-navy-deep transition hover:bg-sky/10 disabled:opacity-50"
            >
              {docPending && pendingDocId === d.id ? "Opening…" : "Open"}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (field.kind === "select") {
    const v = answers[field.id];
    if (!v) return <span className="italic text-slate">(not answered)</span>;
    if (field.showOtherOn && v === field.showOtherOn) {
      const other = answers[`${field.id}_other`];
      return (
        <span>
          {v}
          {other ? <>: {other}</> : null}
        </span>
      );
    }
    return <span>{v}</span>;
  }

  const value = answers[field.id];
  if (!value) return <span className="italic text-slate">(not answered)</span>;
  return <span>{value}</span>;
}

function AuthCodeReveal({
  available,
  revealAuthCode,
}: {
  available: boolean;
  revealAuthCode: () => Promise<ActionResult<string | null>>;
}) {
  const [plain, setPlain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!available) {
    return (
      <span className="italic text-slate">(not provided by client yet)</span>
    );
  }

  if (plain !== null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <code
          className="rounded bg-cloud px-2 py-1 text-sm text-ink"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {plain}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(plain).catch(() => {});
          }}
          className="text-[11px] font-semibold text-navy-deep underline underline-offset-4 hover:text-sky"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={() => setPlain(null)}
          className="text-[11px] text-slate underline underline-offset-4 hover:text-navy-deep"
        >
          Hide
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await revealAuthCode();
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setPlain(res.data ?? null);
          });
        }}
        disabled={pending}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-navy-deep transition hover:bg-sky/10 disabled:opacity-50"
      >
        {pending ? "Decrypting…" : "Reveal authentication code"}
      </button>
      <p className="mt-1 text-[11px] text-slate">
        Decrypted on demand. Not stored or logged by the browser.
      </p>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Read-only legacy driving-licence row for cases that have uploads
// under the old single-slot key (`director_driving_licence`) from
// before the Passport / Driving-licence ID branch landed. Rendered
// in Section B only, after the current fields, labelled clearly as a
// prior upload so a reviewer isn't confused about why there's a doc
// that doesn't match the new slot IDs.
function LegacyDrivingLicenceRow({
  docs,
  openDoc,
  pendingDocId,
  docPending,
  docError,
}: {
  docs: OnboardingDoc[];
  openDoc: (doc: OnboardingDoc) => void;
  pendingDocId: string | null;
  docPending: boolean;
  docError: Record<string, string>;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
      <dt
        className="text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Driving licence (legacy)
      </dt>
      <dd className="text-sm text-ink">
        <ul className="space-y-1">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">
                  {d.file_name}
                </div>
                <div className="text-[11px] text-slate">
                  {formatDateTime(d.uploaded_at)}
                </div>
                {docError[d.id] ? (
                  <p className="mt-1 text-[11px] text-red-700" role="alert">
                    {docError[d.id]}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => openDoc(d)}
                disabled={docPending && pendingDocId === d.id}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-navy-deep transition hover:bg-sky/10 disabled:opacity-50"
              >
                {docPending && pendingDocId === d.id ? "Opening…" : "Open"}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-slate">
          Uploaded before the ID choice schema. The client&apos;s current
          selection drives the required Passport / Driving-licence slots
          above.
        </p>
      </dd>
    </div>
  );
}
