"use client";

import { useActionState, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  completePasswordResetAction,
  type AuthState,
} from "@/app/actions";
import { SLButton } from "@/components/sl-button";

// The email link lands here with a recovery token in the URL fragment. The
// client-side Supabase SDK (detectSessionInUrl = true by default) trades
// that token for a session cookie once mounted. We poll getUser() to know
// when that finishes and only then let the form submit — otherwise the
// server action's updateUser({ password }) fires with no session.
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    completePasswordResetAction,
    null,
  );
  const [ready, setReady] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    // Give the SDK a moment to pick up the URL fragment on first paint.
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      if (data.user) setReady(true);
      else setCheckFailed(true);
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  const match =
    confirm.length === 0
      ? "empty"
      : password === confirm
        ? "match"
        : "mismatch";
  const canSubmit =
    ready && password.length >= 8 && match === "match" && !pending;

  if (checkFailed) {
    return (
      <p
        className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
        role="alert"
        style={{ background: "rgba(220,38,38,0.08)" }}
      >
        This reset link is invalid or has expired. Request a fresh one
        from the login page.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <PasswordInput
        label="New password"
        name="password"
        value={password}
        onChange={setPassword}
        show={showPw}
        onToggleShow={() => setShowPw((v) => !v)}
        autoComplete="new-password"
        minLength={8}
      />
      <div>
        <PasswordInput
          label="Confirm new password"
          name="confirm"
          value={confirm}
          onChange={setConfirm}
          show={showConfirm}
          onToggleShow={() => setShowConfirm((v) => !v)}
          autoComplete="new-password"
          minLength={8}
        />
        {match === "match" ? (
          <p
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: "rgba(19,217,160,0.14)", color: "#0E9E77" }}
          >
            Passwords match.
          </p>
        ) : match === "mismatch" ? (
          <p
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: "rgba(220,38,38,0.08)", color: "#B91C1C" }}
          >
            Passwords don&apos;t match.
          </p>
        ) : null}
      </div>

      {state?.error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {state.error}
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" block disabled={!canSubmit}>
        {pending ? "Updating…" : ready ? "Set new password" : "Verifying link…"}
      </SLButton>
    </form>
  );
}

function PasswordInput({
  label,
  name,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  minLength,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: "new-password" | "current-password";
  minLength?: number;
}) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <div className="relative">
        <input
          name={name}
          type={show ? "text" : "password"}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          className="input-sl pr-11"
        />
        <button
          type="button"
          onClick={onToggleShow}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-2 my-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate hover:bg-sky/10 hover:text-navy-deep"
        >
          {show ? (
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
    </label>
  );
}
