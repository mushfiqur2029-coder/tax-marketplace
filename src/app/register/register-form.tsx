"use client";

import { useActionState, useState } from "react";
import { signUpAction, type AuthState } from "@/app/actions";
import { SLButton } from "@/components/sl-button";
import { AvatarPicker } from "@/components/avatar-picker";

type Role = "client" | "accountant";

export function RegisterForm() {
  const [role, setRole] = useState<Role>("client");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signUpAction,
    null,
  );

  return (
    <form
      action={(fd) => {
        if (avatar) fd.set("avatar", avatar);
        return formAction(fd);
      }}
      className="space-y-5"
    >
      <fieldset>
        <legend
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          I am a
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <RoleTab
            value="client"
            current={role}
            onSelect={setRole}
            label="Client"
            hint="I need a tax return filed"
          />
          <RoleTab
            value="accountant"
            current={role}
            onSelect={setRole}
            label="Accountant"
            hint="I file tax returns"
          />
        </div>
      </fieldset>
      <input type="hidden" name="role" value={role} />

      {/* Avatar */}
      <div>
        <span
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Profile picture
        </span>
        <AvatarPicker onChange={setAvatar} />
      </div>

      <Field
        label="Full name"
        name="name"
        type="text"
        autoComplete="name"
        required
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <Field
        label="Contact number"
        name="contact_number"
        type="tel"
        autoComplete="tel"
        required
      />

      {role === "client" ? (
        <Field
          label="Address"
          name="address"
          type="textarea"
          autoComplete="street-address"
          required
        />
      ) : (
        <>
          <Field
            label="Company email"
            hint="Optional"
            name="company_email"
            type="email"
            autoComplete="email"
          />
          <Field
            label="Company name"
            hint="Optional"
            name="company_name"
            type="text"
            autoComplete="organization"
          />
        </>
      )}

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />

      {state?.error ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          role="alert"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {state.error}
        </p>
      ) : null}
      {state?.info ? (
        <p
          className="rounded-lg px-3 py-2 text-sm font-medium"
          role="status"
          style={{
            background: "rgba(19, 217, 160, 0.14)",
            color: "#0E9E77",
          }}
        >
          {state.info}
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" block disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </SLButton>

      {role === "accountant" ? (
        <p className="text-center text-xs text-slate">
          Sterling Ledger admins review every accountant before you can take
          cases. You'll be able to sign in immediately; approval usually happens
          within one working day.
        </p>
      ) : null}
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  minLength,
  hint,
  required,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  minLength?: number;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span
        className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
        {hint ? (
          <span
            className="rounded-full bg-cloud px-2 py-0.5 text-[9px] tracking-widest text-slate/80"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {hint}
          </span>
        ) : null}
      </span>
      {type === "textarea" ? (
        <textarea
          name={name}
          required={required}
          autoComplete={autoComplete}
          rows={3}
          className="input-sl min-h-[80px] resize-y"
        />
      ) : (
        <input
          name={name}
          type={type}
          required={required}
          autoComplete={autoComplete}
          minLength={minLength}
          className="input-sl"
        />
      )}
    </label>
  );
}

function RoleTab({
  value,
  current,
  onSelect,
  label,
  hint,
}: {
  value: Role;
  current: Role;
  onSelect: (v: Role) => void;
  label: string;
  hint: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={
        "rounded-xl border-[1.5px] p-3 text-left transition " +
        (active
          ? "border-navy-deep bg-navy-deep text-white"
          : "border-line bg-paper text-ink hover:border-sky/60")
      }
      style={
        active
          ? { boxShadow: "0 10px 24px -12px rgba(15,30,77,0.5)" }
          : undefined
      }
    >
      <div className="text-sm font-bold">{label}</div>
      <div
        className={
          "mt-0.5 text-[11px] " + (active ? "opacity-80" : "text-slate")
        }
      >
        {hint}
      </div>
    </button>
  );
}
