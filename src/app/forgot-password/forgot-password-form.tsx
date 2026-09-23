"use client";

import { useActionState } from "react";
import { sendPasswordResetAction, type AuthState } from "@/app/actions";
import { SLButton } from "@/components/sl-button";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    sendPasswordResetAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="input-sl"
        />
      </label>

      {state?.error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220, 38, 38, 0.08)" }}
        >
          {state.error}
        </p>
      ) : null}
      {state?.info ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium"
          role="status"
          style={{ background: "rgba(19,217,160,0.14)", color: "#0E9E77" }}
        >
          {state.info}
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" block disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </SLButton>
    </form>
  );
}
