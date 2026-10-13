"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  initialPence: number;
  save: (amountPence: number) => Promise<ActionResult>;
};

// Dedicated editor for the __custom_max__ sentinel row on addon_catalog
// (migration 0076). Admin types pounds; we convert to pence before the
// server action. The sentinel is kept out of the normal Active list on
// the page above this card, so this card is the only control that edits
// its amount.
export function CustomCapCard({ initialPence, save }: Props) {
  const initialPounds = (initialPence / 100).toFixed(2).replace(/\.00$/, "");
  const [valueGbp, setValueGbp] = useState(initialPounds);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = valueGbp !== initialPounds;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const pounds = parseFloat(valueGbp);
    if (!Number.isFinite(pounds) || pounds <= 0) {
      setError("Enter an amount in pounds, greater than zero.");
      return;
    }
    const amountPence = Math.round(pounds * 100);
    start(async () => {
      const res = await save(amountPence);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
    });
  };

  return (
    <section className="card-sl p-6">
      <h2
        className="text-sm font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Custom add-on cap
      </h2>
      <p className="mt-2 text-xs text-slate">
        Maximum amount an accountant can enter when requesting a custom
        add-on. Requests above this fall out as{" "}
        <em>&ldquo;over £X need to go through support&rdquo;</em> at
        submit time. Pre-migration default was £5,000.
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span
            className="block text-[11px] font-semibold uppercase tracking-wider text-slate"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Cap (£)
          </span>
          <div className="mt-1 flex items-center">
            <span
              className="mr-1 text-sm text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              £
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              step="1"
              value={valueGbp}
              onChange={(e) => setValueGbp(e.target.value)}
              className="w-32 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30"
            />
          </div>
        </label>
        <button
          type="submit"
          disabled={pending || !dirty}
          className="inline-flex items-center rounded-full border border-navy-deep bg-navy-deep px-4 py-2 text-xs font-bold uppercase tracking-wider text-paper hover:bg-sky hover:border-sky disabled:opacity-60"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {pending ? "Saving." : "Save cap"}
        </button>
        {savedAt && !dirty ? (
          <span
            className="text-[11px] uppercase tracking-wider text-[#0E9E77]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Saved.
          </span>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
