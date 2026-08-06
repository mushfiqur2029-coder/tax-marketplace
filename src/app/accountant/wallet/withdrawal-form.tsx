"use client";

import { useState, useTransition } from "react";
import { SLButton } from "@/components/sl-button";

function formatMoney(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export function WithdrawalRequestForm({
  available,
  request,
}: {
  available: number;
  request: (input: {
    accountName: string;
    sortCode: string;
    accountNumber: string;
  }) => Promise<void>;
}) {
  const [accountName, setAccountName] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const disabled = pending || available <= 0;

  return (
    <form
      action={() => {
        setError(null);
        setSaved(false);
        start(async () => {
          try {
            await request({ accountName, sortCode, accountNumber });
            setAccountName("");
            setSortCode("");
            setAccountNumber("");
            setSaved(true);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Request failed.");
          }
        });
      }}
      className="space-y-3"
    >
      <div className="rounded-xl border border-line bg-cloud/50 p-3 text-center">
        <div
          className="text-[10px] font-semibold uppercase tracking-wider text-slate"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Amount
        </div>
        <div
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {formatMoney(available)}
        </div>
      </div>

      <Field label="Account name" value={accountName} onChange={setAccountName} placeholder="Jane Doe" />
      <Field
        label="Sort code"
        value={sortCode}
        onChange={setSortCode}
        placeholder="12-34-56"
        maxLength={8}
      />
      <Field
        label="Account number"
        value={accountNumber}
        onChange={setAccountNumber}
        placeholder="12345678"
        inputMode="numeric"
        maxLength={10}
      />

      {error ? (
        <p className="text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-xs font-medium text-[#0E9E77]" role="status">
          Withdrawal requested. We'll confirm once paid.
        </p>
      ) : null}

      <SLButton type="submit" variant="primary" block disabled={disabled}>
        {available <= 0 ? "Nothing to withdraw" : pending ? "Requesting…" : "Request withdrawal"}
      </SLButton>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
  maxLength?: number;
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
        className="input-sl"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
      />
    </label>
  );
}
