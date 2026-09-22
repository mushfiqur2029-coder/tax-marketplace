"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import type { PasswordChangeResult } from "@/app/profile-actions";

type Props = {
  change: (
    current: string,
    next: string,
    confirm: string,
  ) => Promise<PasswordChangeResult>;
};

type MatchStatus = "empty" | "match" | "mismatch";

export function ChangePasswordForm({ change }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const nextLongEnough = next.length >= 8;
  const matchStatus: MatchStatus =
    confirm.length === 0 ? "empty" : next === confirm ? "match" : "mismatch";
  const canSubmit =
    !pending &&
    current.length > 0 &&
    nextLongEnough &&
    matchStatus === "match" &&
    next !== current;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  return (
    <form
      action={() => {
        setError(null);
        setOk(false);
        start(async () => {
          const res = await change(current, next, confirm);
          if (res.error) setError(res.error);
          else if (res.ok) {
            setOk(true);
            reset();
          }
        });
      }}
      className="space-y-5 card-sl p-6 sm:p-8 max-w-2xl"
    >
      <p className="text-sm text-slate">
        Password changes take effect immediately — no admin approval required.
        Enter your current password to confirm it&apos;s you.
      </p>

      <PasswordInput
        label="Current password"
        name="current_password"
        autoComplete="current-password"
        value={current}
        onChange={setCurrent}
      />
      <PasswordInput
        label="New password"
        name="new_password"
        autoComplete="new-password"
        value={next}
        onChange={setNext}
        minLength={8}
        hint={
          next.length > 0
            ? nextLongEnough
              ? null
              : { tone: "warn", text: "At least 8 characters." }
            : null
        }
      />
      <PasswordInput
        label="Confirm new password"
        name="confirm_password"
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
        minLength={8}
        hint={
          matchStatus === "empty"
            ? null
            : matchStatus === "match"
              ? { tone: "ok", text: "Passwords match." }
              : { tone: "err", text: "Passwords don't match." }
        }
      />

      {error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
      {ok ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium"
          role="status"
          style={{ background: "rgba(19,217,160,0.14)", color: "#0E9E77" }}
        >
          Password updated.
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" disabled={!canSubmit}>
        {pending ? "Updating…" : "Update password"}
      </SLButton>
    </form>
  );
}

type Hint = { tone: "ok" | "warn" | "err"; text: string };

function PasswordInput({
  label,
  name,
  value,
  onChange,
  autoComplete,
  minLength,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: Hint | null;
}) {
  const [visible, setVisible] = useState(false);
  const hintColor =
    hint?.tone === "ok"
      ? { bg: "rgba(19,217,160,0.14)", color: "#0E9E77" }
      : hint?.tone === "warn"
        ? { bg: "rgba(217,159,25,0.15)", color: "#8A6A0F" }
        : { bg: "rgba(220,38,38,0.08)", color: "#B91C1C" };

  return (
    <label className="block">
      <span
        className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <div className="relative">
        <input
          name={name}
          type={visible ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          className="input-sl pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-2 my-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate transition hover:bg-sky/10 hover:text-navy-deep"
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.32 19.32 0 0 1 5.06-6.06" />
              <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.34 19.34 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {hint ? (
        <p
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
          style={{ background: hintColor.bg, color: hintColor.color }}
          role="status"
          aria-live="polite"
        >
          {hint.tone === "ok" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : hint.tone === "err" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : null}
          {hint.text}
        </p>
      ) : null}
    </label>
  );
}
