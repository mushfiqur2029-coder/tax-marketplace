"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  accountantId: string;
  initial: {
    legalName: string;
    tradingName: string;
    legalCompanyNumber: string;
  };
  save: (
    accountantId: string,
    input: {
      legalName: string;
      tradingName: string;
      legalCompanyNumber: string;
    },
  ) => Promise<ActionResult>;
  // setAccountantLegalIdentityAction is primary-admin-only server-side.
  // Passing false here (any admin who isn't the primary) disables the
  // form instead of letting someone fill it in and only discover the
  // rejection after clicking Save.
  readOnly?: boolean;
};

// Three-field form for the accountant_profiles columns that migration
// 0074 added. These values flow into the engagement letter template;
// leaving them blank keeps the letter on the Shann / NAFH / 12636834
// fallback, which is the right behavior for every accountant we had
// before the field was introduced.
export function LegalIdentityForm({ accountantId, initial, save, readOnly }: Props) {
  const [legalName, setLegalName] = useState(initial.legalName);
  const [tradingName, setTradingName] = useState(initial.tradingName);
  const [legalCompanyNumber, setLegalCompanyNumber] = useState(
    initial.legalCompanyNumber,
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    legalName !== initial.legalName ||
    tradingName !== initial.tradingName ||
    legalCompanyNumber !== initial.legalCompanyNumber;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await save(accountantId, {
        legalName,
        tradingName,
        legalCompanyNumber,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {readOnly ? (
        <p
          role="status"
          className="rounded-lg border border-line bg-cloud px-3 py-2 text-xs text-slate"
        >
          Only the primary admin can change legal identity.
        </p>
      ) : null}
      <fieldset disabled={readOnly} className="space-y-4">
        <Field
          label="Legal name"
          hint="Appears on the engagement letter as the signing party on our side."
          value={legalName}
          onChange={setLegalName}
          placeholder="e.g. New Age Finance Hub Ltd"
        />
        <Field
          label="Trading name"
          hint="Shown in the letter footer. Leave blank to use the legal name."
          value={tradingName}
          onChange={setTradingName}
          placeholder="e.g. Sterling Ledger"
        />
        <Field
          label="Companies House number"
          hint="UK Companies House registration number of the legal entity above."
          value={legalCompanyNumber}
          onChange={setLegalCompanyNumber}
          placeholder="e.g. 12636834"
        />
      </fieldset>

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !dirty || readOnly}
          className="inline-flex items-center rounded-full border border-navy-deep bg-navy-deep px-4 py-2 text-xs font-bold uppercase tracking-wider text-paper hover:bg-sky hover:border-sky disabled:opacity-60"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {pending ? "Saving." : "Save"}
        </button>
        {savedAt && !dirty ? (
          <span
            className="text-[11px] uppercase tracking-wider text-[#0E9E77]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Saved.
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-slate">
        Blank fields mean the engagement letter falls back to the Shann /
        NAFH / 12636834 defaults baked into the template.
      </p>
    </form>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span
        className="block text-[11px] font-semibold uppercase tracking-wider text-slate"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30"
      />
      <span className="mt-1 block text-[11px] text-slate">{hint}</span>
    </label>
  );
}
