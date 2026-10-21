"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import { AvatarPicker } from "@/components/avatar-picker";

type Current = {
  name: string;
  contact_number: string;
  email: string;
  address: string;
};

type Props = {
  current: Current;
  currentAvatarPath: string | null;
  pending: Record<string, string> | null;
  submit: (edit: Current, avatar: File | null) => Promise<import("@/lib/action-result").ActionResult>;
};

export function ClientProfileForm({
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
  // Task #14: router.refresh() is confirmed unreliable on this app (see
  // pch-client-workspace.tsx). `submit` always queues exactly the form
  // values (and avatar, if any) the user just sent as the new pending
  // request, so we can build the "pending" banner state locally instead
  // of refreshing to pick it up from the server prop.
  const [localPending, setLocalPending] = useState(pending);

  const isPending = (field: keyof Current) =>
    localPending != null &&
    (localPending[field] ?? "") !== "" &&
    localPending[field] !== current[field];
  const pendingAvatar = localPending?.avatar_path ?? null;

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
            const hadAvatar = avatarFile != null;
            setAvatarFile(null);
            setLocalPending({
              name: form.name !== current.name ? form.name : "",
              contact_number:
                form.contact_number !== current.contact_number
                  ? form.contact_number
                  : "",
              email: form.email !== current.email ? form.email : "",
              address: form.address !== current.address ? form.address : "",
              avatar_path: hadAvatar ? "pending" : "",
            });
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
          change are marked below. Submitting again replaces the pending
          request.
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
        label="Address"
        value={form.address}
        onChange={onChange("address")}
        pending={isPending("address") ? pending?.address : null}
        textarea
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
  textarea,
  pending,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  textarea?: boolean;
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
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="input-sl min-h-[80px] resize-y"
          required={required}
        />
      ) : (
        <input
          type={type ?? "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-sl"
          required={required}
        />
      )}
      {pending ? (
        <p className="mt-1 text-xs text-slate">
          Awaiting approval:{" "}
          <span className="font-semibold text-ink">{pending}</span>
        </p>
      ) : null}
    </label>
  );
}
