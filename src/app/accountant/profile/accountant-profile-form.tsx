"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import { AvatarPicker } from "@/components/avatar-picker";

type Current = {
  name: string;
  contact_number: string;
  email: string;
  company_name: string;
  company_email: string;
};

type Props = {
  current: Current;
  currentAvatarPath: string | null;
  pending: Record<string, string> | null;
  submit: (edit: Current, avatar: File | null) => Promise<import("@/lib/action-result").ActionResult>;
};

export function AccountantProfileForm({
  current,
  currentAvatarPath,
  pending,
  submit,
}: Props) {
  const [form, setForm] = useState<Current>(current);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [pendingSubmit, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const isPending = (field: keyof Current) =>
    pending != null && (pending[field] ?? "") !== "" && pending[field] !== current[field];
  const pendingAvatar = pending?.avatar_path ?? null;

  const onChange = (k: keyof Current) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      action={() => {
        setError(null);
        setOk(false);
        start(async () => {
          const res = await submit(form, avatarFile);
          if (res.ok) {
            setOk(true);
            setAvatarFile(null);
          } else {
            setError(res.error);
          }
        });
      }}
      className="space-y-5 card-sl p-6 sm:p-8 max-w-2xl"
    >
      {pending ? (
        <div
          role="status"
          className="rounded-xl border px-3 py-2 text-sm"
          style={{
            background: "rgba(217, 159, 25, 0.08)",
            borderColor: "rgba(217, 159, 25, 0.35)",
            color: "#8A6A0F",
          }}
        >
          You have a pending edit awaiting admin approval. Fields that would
          change are marked below.
        </div>
      ) : null}

      <div className="space-y-2">
        <span
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Profile picture
          {pendingAvatar ? (
            <span
              className="rounded-full px-2 py-0.5 text-[9px] tracking-widest"
              style={{
                background: "rgba(217,159,25,0.15)",
                color: "#8A6A0F",
                fontFamily: "var(--font-mono)",
              }}
            >
              Pending approval
            </span>
          ) : null}
        </span>
        <div className="w-full min-w-0">
          <AvatarPicker
            onChange={setAvatarFile}
            size={72}
            currentPath={currentAvatarPath}
            currentName={form.name}
            currentEmail={form.email}
          />
        </div>
        {pendingAvatar && !avatarFile ? (
          <p className="text-xs text-slate">
            A new picture is queued for admin approval.
          </p>
        ) : null}
      </div>

      <Field
        label="Name"
        required
        value={form.name}
        onChange={onChange("name")}
        pending={isPending("name") ? pending?.name : null}
      />
      <Field
        label="Contact number"
        required
        value={form.contact_number}
        onChange={onChange("contact_number")}
        pending={isPending("contact_number") ? pending?.contact_number : null}
        type="tel"
      />
      <Field
        label="Email"
        required
        value={form.email}
        onChange={onChange("email")}
        pending={isPending("email") ? pending?.email : null}
        type="email"
      />
      <Field
        label="Company name"
        value={form.company_name}
        onChange={onChange("company_name")}
        pending={isPending("company_name") ? pending?.company_name : null}
      />
      <Field
        label="Company email"
        value={form.company_email}
        onChange={onChange("company_email")}
        pending={isPending("company_email") ? pending?.company_email : null}
        type="email"
      />

      {error ? (
        <p className="rounded-lg px-3 py-2 text-sm font-medium text-red-700" role="alert" style={{ background: "rgba(220,38,38,0.08)" }}>
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="rounded-lg px-3 py-2 text-sm font-medium" role="status" style={{ background: "rgba(19,217,160,0.14)", color: "#0E9E77" }}>
          Change submitted for admin review.
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" disabled={pendingSubmit}>
        {pendingSubmit ? "Submitting…" : "Submit changes"}
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
  pending,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  pending?: string | null;
}) {
  return (
    <label className="block">
      <span
        className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
        {required ? <span className="text-sky">*</span> : null}
        {pending ? (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] tracking-widest"
            style={{
              background: "rgba(217,159,25,0.15)",
              color: "#8A6A0F",
              fontFamily: "var(--font-mono)",
            }}
          >
            Pending approval
          </span>
        ) : null}
      </span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-sl"
        required={required}
      />
      {pending ? (
        <p className="mt-1 text-xs text-slate">
          Awaiting approval:{" "}
          <span className="font-semibold text-ink">{pending}</span>
        </p>
      ) : null}
    </label>
  );
}
