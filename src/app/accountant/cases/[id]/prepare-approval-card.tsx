"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import { DocumentUploader } from "@/components/case/document-uploader";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

type AccountantDoc = {
  id: string;
  file_name: string;
  uploaded_at: string;
};

type Props = {
  // Pre-existing accountant uploads keyed by requirement_key.
  initialAnnualAccounts: AccountantDoc[];
  initialCt600: AccountantDoc[];
  annualAccountsKey: string;
  ct600Key: string;
  uploadDoc: (
    requirementKey: string,
    fd: FormData,
  ) => Promise<ActionResult<AccountantDoc>>;
  removeDoc: (docId: string) => Promise<ActionResult>;
  prepare: (input: {
    ctLiabilityPence: number;
    hmrcPaymentReference: string;
    note: string;
  }) => Promise<ActionResult>;
};

// "Prepare approval" card. The accountant uploads Annual Accounts +
// CT600, fills in the three approval fields, and submits. Submission
// writes the approval_payload and moves status directly to
// client_approval (prepared is collapsed for limited-company).
export function PrepareApprovalCard({
  initialAnnualAccounts,
  initialCt600,
  annualAccountsKey,
  ct600Key,
  uploadDoc,
  removeDoc,
  prepare,
}: Props) {
  const router = useRouter();
  const [annualAccounts, setAnnualAccounts] =
    useState<AccountantDoc[]>(initialAnnualAccounts);
  const [ct600, setCt600] = useState<AccountantDoc[]>(initialCt600);

  const [ctPounds, setCtPounds] = useState("");
  const [hmrcRef, setHmrcRef] = useState("");
  const [note, setNote] = useState("");

  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    annualAccounts.length > 0 &&
    ct600.length > 0 &&
    ctPounds.trim().length > 0 &&
    !submitting;

  const handleSubmit = () => {
    setError(null);
    const amount = Number(ctPounds);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("CT liability must be zero or more.");
      return;
    }
    const pence = Math.round(amount * 100);
    startSubmit(async () => {
      const res = await prepare({
        ctLiabilityPence: pence,
        hmrcPaymentReference: hmrcRef,
        note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <AccountantUploadSlot
        label="Annual Accounts"
        hint="PDF only — client sees this on their approval screen."
        requirementKey={annualAccountsKey}
        docs={annualAccounts}
        onUploaded={(d) => setAnnualAccounts((prev) => [...prev, d])}
        onRemoved={(id) =>
          setAnnualAccounts((prev) => prev.filter((d) => d.id !== id))
        }
        uploadDoc={uploadDoc}
        removeDoc={removeDoc}
      />
      <AccountantUploadSlot
        label="CT600"
        hint="PDF only — HMRC Corporation Tax return."
        requirementKey={ct600Key}
        docs={ct600}
        onUploaded={(d) => setCt600((prev) => [...prev, d])}
        onRemoved={(id) => setCt600((prev) => prev.filter((d) => d.id !== id))}
        uploadDoc={uploadDoc}
        removeDoc={removeDoc}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            CT liability (£)
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={ctPounds}
            onChange={(e) => setCtPounds(e.target.value)}
            placeholder="e.g. 1250.00"
            className="input-sl mt-1"
          />
        </label>
        <label className="block">
          <span
            className="text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            HMRC payment reference
          </span>
          <input
            type="text"
            value={hmrcRef}
            onChange={(e) => setHmrcRef(e.target.value)}
            placeholder="17-char reference from CT600"
            className="input-sl mt-1"
          />
        </label>
      </div>

      <label className="block">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Note to client (optional)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Anything the client should read before approving."
          className="input-sl mt-1"
        />
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}

      <SLButton
        type="button"
        variant="primary"
        block
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {submitting ? "Sending…" : "Send for client approval"}
      </SLButton>
    </div>
  );
}

function AccountantUploadSlot({
  label,
  hint,
  requirementKey,
  docs,
  onUploaded,
  onRemoved,
  uploadDoc,
  removeDoc,
}: {
  label: string;
  hint: string;
  requirementKey: string;
  docs: AccountantDoc[];
  onUploaded: (doc: AccountantDoc) => void;
  onRemoved: (id: string) => void;
  uploadDoc: (
    requirementKey: string,
    fd: FormData,
  ) => Promise<ActionResult<AccountantDoc>>;
  removeDoc: (docId: string) => Promise<ActionResult>;
}) {
  const [error, setError] = useState<string | null>(null);
  // Per-doc removing set (vs a single boolean) so a specific Remove
  // click self-disables immediately, blocking a second click from
  // double-firing the delete.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const slotAction = useCallback(
    async (fd: FormData): Promise<ActionResult> => {
      setError(null);
      const res = await uploadDoc(requirementKey, fd);
      if (res.ok) {
        // Real DB id comes back from the server now — no more "optimistic-"
        // placeholder that disabled the Remove button until a page
        // refresh.
        onUploaded(res.data);
        return { ok: true };
      }
      setError(res.error);
      return res;
    },
    [requirementKey, uploadDoc, onUploaded],
  );

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
          style={{ color: "#B91C1C", fontFamily: "var(--font-mono)" }}
        >
          Required
        </span>
      </div>
      {docs.length === 0 ? (
        <div className="mt-2">
          <DocumentUploader
            action={slotAction}
            multiple={false}
            accept=".pdf,application/pdf"
            hint={hint}
          />
        </div>
      ) : null}
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
