"use client";

import { useState } from "react";
import type { Segment } from "@/lib/segments";
import { SLButton } from "@/components/sl-button";

type Props = {
  segment: Segment;
  initial: Record<string, string>;
  action: (fd: FormData) => Promise<void>;
};

export function IntakeForm({ segment, initial, action }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        setError(null);
        setPending(true);
        try {
          await action(fd);
        } catch (e) {
          setPending(false);
          setError(e instanceof Error ? e.message : "Could not save.");
        }
      }}
      className="space-y-5"
    >
      {segment.intake.map((f) => {
        const value = initial[f.name] ?? "";
        return (
          <label key={f.name} className="block">
            <span
              className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {f.label}
              {f.required ? <span className="text-sky">*</span> : null}
            </span>
            {f.hint ? <span className="mb-1.5 block text-xs text-slate">{f.hint}</span> : null}
            {f.type === "textarea" ? (
              <textarea
                name={f.name}
                required={f.required}
                defaultValue={value}
                rows={3}
                className="input-sl min-h-[88px] resize-y"
              />
            ) : f.type === "select" ? (
              <select
                name={f.name}
                required={f.required}
                defaultValue={value}
                className="input-sl"
              >
                <option value="">Choose one…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.prefix ? (
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate">
                  {f.prefix}
                </span>
                <input
                  name={f.name}
                  type={f.type}
                  required={f.required}
                  defaultValue={value}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  className="input-sl pl-8"
                />
              </div>
            ) : (
              <input
                name={f.name}
                type={f.type}
                required={f.required}
                defaultValue={value}
                className="input-sl"
              />
            )}
          </label>
        );
      })}

      {error ? (
        <p className="rounded-lg px-3 py-2 text-sm font-medium text-red-700" role="alert" style={{ background: "rgba(220,38,38,0.08)" }}>
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <SLButton type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Continue"}
        </SLButton>
      </div>
    </form>
  );
}
