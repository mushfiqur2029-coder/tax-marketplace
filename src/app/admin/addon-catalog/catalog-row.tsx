"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";
import type { ActionResult } from "@/lib/action-result";

type Row = {
  key: string;
  name: string;
  description: string;
  amount_pence: number;
  active: boolean;
  updated_at: string;
};

type UpdateFn = (
  key: string,
  input: {
    name: string;
    description: string;
    amountPence: number;
    active: boolean;
  },
) => Promise<ActionResult>;

export function CatalogRow({ row, update }: { row: Row; update: UpdateFn }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description);
  const [amountGbp, setAmountGbp] = useState((row.amount_pence / 100).toFixed(2));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const priceGbp = (row.amount_pence / 100).toFixed(2);

  const save = () => {
    setError(null);
    start(async () => {
      const pence = Math.round(parseFloat(amountGbp) * 100);
      const res = await update(row.key, {
        name,
        description,
        amountPence: pence,
        active: row.active, // save() only edits fields; keep active as-is
      });
      if (res.ok) setEditing(false);
      else setError(res.error);
    });
  };

  const toggleActive = () => {
    setError(null);
    start(async () => {
      const res = await update(row.key, {
        name: row.name,
        description: row.description,
        amountPence: row.amount_pence,
        active: !row.active,
      });
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <div className={"card-sl p-5 " + (row.active ? "" : "opacity-70")}>
      {/* Header row: key, price, active pill, actions */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <code
          className="rounded bg-cloud px-1.5 py-0.5 text-[11px] text-ink"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {row.key}
        </code>
        <span
          className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: row.active
              ? "rgba(19,217,160,0.14)"
              : "rgba(217,159,25,0.14)",
            color: row.active ? "#0E9E77" : "#B57E12",
            fontFamily: "var(--font-mono)",
          }}
        >
          {row.active ? "Active" : "Deactivated"}
        </span>
        <span
          className="text-sm font-semibold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          £{priceGbp}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!editing ? (
            <>
              <SLButton
                type="button"
                variant="outline"
                onClick={() => setEditing(true)}
                disabled={pending}
              >
                Edit
              </SLButton>
              <SLButton
                type="button"
                variant="outline"
                onClick={toggleActive}
                disabled={pending}
              >
                {row.active ? "Deactivate" : "Activate"}
              </SLButton>
            </>
          ) : (
            <>
              <SLButton
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setName(row.name);
                  setDescription(row.description);
                  setAmountGbp(priceGbp);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </SLButton>
              <SLButton
                type="button"
                variant="primary"
                onClick={save}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save"}
              </SLButton>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} />
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
            />
          </label>
          <label className="block max-w-[160px]">
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
            />
          </label>
        </div>
      ) : (
        <>
          <div className="text-sm font-semibold text-ink">{row.name}</div>
          <p className="mt-1 text-sm text-slate">{row.description}</p>
        </>
      )}

      {error ? (
        <p className="mt-3 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
        className="input-sl"
      />
    </label>
  );
}
