"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

type Current = {
  name: string;
  contact_number: string;
  email: string;
};

type Props = {
  current: Current;
  submit: (edit: Current) => Promise<void>;
};

export function AdminProfileForm({ current, submit }: Props) {
  const [form, setForm] = useState<Current>(current);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const onChange = (k: keyof Current) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      action={() => {
        setError(null);
        setOk(false);
        start(async () => {
          try {
            await submit(form);
            setOk(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed.");
          }
        });
      }}
      className="space-y-5 card-sl p-6 sm:p-8 max-w-2xl"
    >
      <p className="text-sm text-slate">
        Admin edits apply immediately. There&apos;s no one above admin to
        approve them.
      </p>

      <Field
        label="Name"
        required
        value={form.name}
        onChange={onChange("name")}
      />
      <Field
        label="Contact number"
        required
        value={form.contact_number}
        onChange={onChange("contact_number")}
        type="tel"
      />
      <Field
        label="Email"
        required
        value={form.email}
        onChange={onChange("email")}
        type="email"
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
          Profile updated.
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </SLButton>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span
        className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
        {required ? <span className="text-sky">*</span> : null}
      </span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-sl"
        required={required}
      />
    </label>
  );
}
