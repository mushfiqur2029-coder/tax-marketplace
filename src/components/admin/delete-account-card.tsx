"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

// Permanent-delete control for a client or accountant account. Shows
// a pre-check panel listing exactly what's attached (so admin isn't
// surprised post-delete), and either:
//   - a disabled Delete button + "suspend instead" message when the
//     pre-check marks the account as blocked (any paid cases for a
//     client; any wallet / withdrawal / add-on / VAT cycle for an
//     accountant), OR
//   - an active Delete button that opens a type-the-email confirmation
//     modal, same pattern as the admin-removal flow.
//
// The server action re-runs the pre-check before actually deleting,
// so this component is strictly a UI gate — the authoritative "safe
// to delete" decision is made server-side.

export type PreCheckRow = {
  label: string;
  value: string | number;
};

type Props = {
  targetUserId: string;
  targetEmail: string;
  // One-sentence role label for the modal copy ("client", "accountant").
  roleLabel: string;
  // Pre-check summary rows (counts). Rendered in a definition list.
  summary: PreCheckRow[];
  // Null = allowed to delete. String = blocked, this is the reason shown.
  blockReason: string | null;
  // What permanent deletion will touch beyond the user row itself. Shown
  // in the modal so admin confirms with eyes open.
  cascadeNote: string;
  // Server action to call. Takes the user id.
  deleteAccount: (targetUserId: string) => Promise<ActionResult>;
};

export function DeleteAccountCard({
  targetUserId,
  targetEmail,
  roleLabel,
  summary,
  blockReason,
  cascadeNote,
  deleteAccount,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const matches = typed.trim().toLowerCase() === targetEmail.toLowerCase();

  const onConfirm = () => {
    setError(null);
    start(async () => {
      const res = await deleteAccount(targetUserId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
      // Deletion wiped the detail-page target. Send admin back to
      // the list where the row no longer exists.
      router.push(roleLabel === "accountant" ? "/admin/accountants" : "/admin/clients");
    });
  };

  return (
    <div className="mt-6 border-t border-line pt-4">
      <span
        className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Permanent deletion
      </span>

      {/* Pre-check panel */}
      <dl className="mb-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
        {summary.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between">
            <dt
              className="uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {r.label}
            </dt>
            <dd
              className="font-semibold text-ink"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      {blockReason ? (
        <div
          className="rounded-xl border px-3 py-2 text-xs"
          style={{
            background: "rgba(217,159,25,0.08)",
            borderColor: "rgba(217,159,25,0.35)",
            color: "#8a5c05",
          }}
        >
          <strong className="font-semibold">Cannot delete.</strong>{" "}
          {blockReason}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setTyped("");
              setError(null);
              setOpen(true);
            }}
            className="w-full rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition"
            style={{
              background: "rgba(220,38,38,0.08)",
              color: "#B91C1C",
              fontFamily: "var(--font-mono)",
            }}
          >
            Delete account permanently
          </button>
          <p className="mt-2 text-[11px] text-slate">
            Preferred alternative: Suspend. Deletion is only here for
            genuinely abandoned / mistakenly-created accounts.
          </p>
        </>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{
            background: "rgba(15,30,77,0.45)",
            backdropFilter: "blur(2px)",
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-heading"
        >
          <div className="card-sl w-full max-w-md p-6 sm:p-7">
            <div
              className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl text-white"
              style={{
                background: "linear-gradient(135deg, #B91C1C, #F97316)",
              }}
              aria-hidden="true"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </div>
            <h3
              id="delete-account-heading"
              className="text-lg font-semibold text-ink"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Permanently delete this {roleLabel}?
            </h3>
            <p className="mt-2 text-sm text-slate">
              This permanently deletes{" "}
              <strong className="text-ink">{targetEmail}</strong> — auth
              record, {roleLabel} profile, and everything cascading from
              the user row.
            </p>
            <p className="mt-2 text-sm text-slate">{cascadeNote}</p>
            <p className="mt-2 text-sm text-slate">
              <strong>This cannot be undone.</strong>
            </p>
            <label className="mt-4 block">
              <span
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Type the email to confirm
              </span>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={targetEmail}
                autoComplete="off"
                className="input-sl"
                autoFocus
              />
            </label>
            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700"
                style={{ background: "rgba(220,38,38,0.08)" }}
              >
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink hover:border-sky/50"
              >
                Cancel
              </button>
              <SLButton
                type="button"
                variant="primary"
                disabled={!matches || pending}
                onClick={onConfirm}
                style={{
                  background:
                    matches && !pending
                      ? "linear-gradient(135deg, #B91C1C, #F97316)"
                      : undefined,
                }}
              >
                {pending ? "Deleting…" : "Delete permanently"}
              </SLButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
