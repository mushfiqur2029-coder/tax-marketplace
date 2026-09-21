"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import { PasswordField } from "@/components/password-field";
import type { PasswordChangeResult } from "@/app/profile-actions";

type Props = {
  change: (
    current: string,
    next: string,
    confirm: string,
  ) => Promise<PasswordChangeResult>;
};

export function ChangePasswordForm({ change }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <form
      action={(fd) => {
        setError(null);
        setOk(false);
        const current = String(fd.get("current_password") ?? "");
        const next = String(fd.get("new_password") ?? "");
        const confirm = String(fd.get("confirm_password") ?? "");
        start(async () => {
          const res = await change(current, next, confirm);
          if (res.error) setError(res.error);
          else if (res.ok) {
            setOk(true);
            (document.getElementById(FORM_ID) as HTMLFormElement | null)?.reset();
          }
        });
      }}
      id={FORM_ID}
      className="space-y-5 card-sl p-6 sm:p-8 max-w-2xl"
    >
      <p className="text-sm text-slate">
        Password changes take effect immediately — no admin approval required.
        Enter your current password to confirm it&apos;s you.
      </p>

      <PasswordField
        name="current_password"
        label="Current password"
        autoComplete="current-password"
        required
      />
      <PasswordField
        name="new_password"
        label="New password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <PasswordField
        name="confirm_password"
        label="Confirm new password"
        autoComplete="new-password"
        minLength={8}
        required
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

      <SLButton type="submit" variant="primary" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </SLButton>
    </form>
  );
}

const FORM_ID = "change-password-form";
