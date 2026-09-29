"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

export function AddCatalogItemForm({
  create,
}: {
  create: (input: {
    key: string;
    name: string;
    description: string;
    amountPence: number;
  }) => Promise<ActionResult>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amountGbp, setAmountGbp] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <form
      action={() => {
        setError(null);
        setOk(null);
        start(async () => {
          const pence = Math.round(parseFloat(amountGbp) * 100);
          const res = await create({
            key,
            name,
            description,
            amountPence: pence,
          });
          if (res.ok) {
            setOk(`Added "${name}".`);
            setKey("");
            setName("");
            setDescription("");
            setAmountGbp("");
          } else {
            setError(res.error);
          }
        });
      }}
      className="space-y-3"
    >
      <Field
        label="Key"
        value={key}
        onChange={(v) => setKey(v.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
        placeholder="extra_property"
        mono
        required
      />
      <Field label="Name" value={name} onChange={setName} required />
      <label className="block">
        <span
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Description
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input-sl min-h-[72px] resize-y"
          rows={3}
          required
        />
      </label>
      <label className="block">
        <span
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Price (£)
        </span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amountGbp}
          onChange={(e) => setAmountGbp(e.target.value)}
          className="input-sl"
          required
        />
      </label>
      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p
          className="rounded-lg px-2.5 py-2 text-[12px] font-medium"
          style={{ background: "rgba(19, 217, 160, 0.14)", color: "#0E9E77" }}
          role="status"
        >
          {ok}
        </p>
      ) : null}
      <SLButton type="submit" variant="primary" block disabled={pending}>
        {pending ? "Adding…" : "Add add-on"}
      </SLButton>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
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
        placeholder={placeholder}
        required={required}
        className="input-sl"
        style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
      />
    </label>
  );
}
