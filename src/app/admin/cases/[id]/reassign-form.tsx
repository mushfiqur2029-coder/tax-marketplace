"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

type Option = { id: string; email: string };

export function ReassignForm({
  caseId,
  current,
  options,
  reassign,
}: {
  caseId: string;
  current: string | null;
  options: Option[];
  reassign: (accountantId: string, note: string | null) => Promise<void>;
}) {
  void caseId;
  const [selected, setSelected] = useState<string>(current ?? "");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="mt-4 space-y-3"
      action={() => {
        setError(null);
        setSaved(false);
        if (!selected) {
          setError("Pick an accountant.");
          return;
        }
        if (selected === current) {
          setError("Already assigned to that accountant.");
          return;
        }
        start(async () => {
          try {
            await reassign(selected, note || null);
            setSaved(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Reassign failed.");
          }
        });
      }}
    >
      <label className="block">
        <span
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Accountant
        </span>
        <select
          className="input-sl"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">. unassigned.</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.email} {o.id === current ? "· current" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Reason (optional)
        </span>
        <input
          className="input-sl"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. workload balancing"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SLButton type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Reassign"}
        </SLButton>
        {saved ? <span className="text-xs text-[#0E9E77] font-semibold">Reassigned ✓</span> : null}
      </div>
      {error ? (
        <p className="text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
