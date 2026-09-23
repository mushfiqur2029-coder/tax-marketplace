"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signInAction, type AuthState } from "@/app/actions";
import { SLButton } from "@/components/sl-button";
import { PasswordField } from "@/components/password-field";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signInAction,
    null,
  );
  const params = useSearchParams();
  const justReset = params?.get("reset") === "1";

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <div className="space-y-1.5">
        <PasswordField name="password" autoComplete="current-password" required />
        <div className="text-right">
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-navy-deep underline-offset-4 hover:text-sky hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      {justReset && !state?.error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium"
          role="status"
          style={{ background: "rgba(19,217,160,0.14)", color: "#0E9E77" }}
        >
          Password updated. Sign in with your new one.
        </p>
      ) : null}

      {state?.error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220, 38, 38, 0.08)" }}
        >
          {state.error}
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" block disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </SLButton>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  minLength,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
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
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        minLength={minLength}
        className="input-sl"
      />
    </label>
  );
}
