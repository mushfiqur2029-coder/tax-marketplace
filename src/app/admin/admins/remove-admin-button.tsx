"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  targetUserId: string;
  targetEmail: string;
  removeAdmin: (targetUserId: string) => Promise<ActionResult>;
};

// Remove-admin control. Rendered only on non-primary admin rows, and
// only to the primary admin per the parent page's gate. Two-step
// confirmation: open modal → type the exact email to confirm →
// confirm. Enter triggers nothing; the user has to click the button
// so there's no muscle-memory submit.
export function RemoveAdminButton({
  targetUserId,
  targetEmail,
  removeAdmin,
}: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const matches = typed.trim().toLowerCase() === targetEmail.toLowerCase();

  const onConfirm = () => {
    setError(null);
    start(async () => {
      const res = await removeAdmin(targetUserId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setTyped("");
          setError(null);
          setOpen(true);
        }}
        className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition"
        style={{
          background: "rgba(220,38,38,0.08)",
          color: "#B91C1C",
          fontFamily: "var(--font-mono)",
        }}
        aria-label={`Remove admin ${targetEmail}`}
      >
        Remove
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,30,77,0.45)", backdropFilter: "blur(2px)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-admin-heading"
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
          id="remove-admin-heading"
          className="text-lg font-semibold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Permanently remove this admin?
        </h3>
        <p className="mt-2 text-sm text-slate">
          This permanently deletes{" "}
          <strong className="text-ink">{targetEmail}</strong> — auth record,
          admin profile, and all admin history. The audit trail of actions
          they took is preserved (attributed to a deleted user).
        </p>
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
            {pending ? "Removing…" : "Remove permanently"}
          </SLButton>
        </div>
      </div>
    </div>
  );
}
