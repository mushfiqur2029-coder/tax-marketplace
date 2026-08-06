"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

export function AddAdminForm({
  create,
}: {
  create: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const gen = () => {
    // Simple readable temporary password.
    const w = "abcdefghjkmnpqrstuvwxyz23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += w[Math.floor(Math.random() * w.length)];
    setPassword(s);
  };

  return (
    <form
      action={() => {
        setError(null);
        setOk(null);
        start(async () => {
          try {
            await create({ name, email, password });
            setOk(`${email} added. Temporary password: ${password}`);
            setName("");
            setEmail("");
            setPassword("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed.");
          }
        });
      }}
      className="space-y-3"
    >
      <Field label="Name" value={name} onChange={setName} required />
      <Field label="Email" value={email} onChange={setEmail} type="email" required />
      <div>
        <div className="flex items-center justify-between">
          <span
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Temporary password
          </span>
          <button
            type="button"
            onClick={gen}
            className="text-[11px] font-semibold text-sky hover:underline"
          >
            Generate
          </button>
        </div>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-sl"
          minLength={8}
          required
        />
      </div>
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p
          className="rounded-lg px-2.5 py-2 text-[12px] font-medium"
          style={{
            background: "rgba(19, 217, 160, 0.14)",
            color: "#0E9E77",
          }}
          role="status"
        >
          {ok}
        </p>
      ) : null}
      <SLButton type="submit" variant="primary" block disabled={pending}>
        {pending ? "Creating…" : "Add admin"}
      </SLButton>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span
        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        required={required}
        className="input-sl"
      />
    </label>
  );
}
