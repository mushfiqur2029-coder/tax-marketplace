"use client";

import { useState } from "react";

type Props = {
  name: string;
  label?: string;
  autoComplete?: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
};

export function PasswordField({
  name,
  label = "Password",
  autoComplete = "current-password",
  minLength,
  required,
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      <span
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <div className="relative">
        <input
          name={name}
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          minLength={minLength}
          className="input-sl pr-11"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-2 my-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate transition hover:bg-sky/10 hover:text-navy-deep"
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.32 19.32 0 0 1 5.06-6.06" />
              <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a19.34 19.34 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </label>
  );
}
