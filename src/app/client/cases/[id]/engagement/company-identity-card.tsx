"use client";

import { useState, useTransition } from "react";
import {
  CompanyLookup,
  type CompanyPick,
} from "@/components/case/company-lookup";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  initial: CompanyPick | null;
  setIdentity: (input: {
    companyName: string;
    companyNumber: string;
    companyStatus: string | null;
  }) => Promise<ActionResult>;
  clearIdentity: () => Promise<ActionResult>;
};

// Thin wrapper around <CompanyLookup> that owns the server round-trip
// for the engagement page. Separated so the lookup component stays
// decoupled from the case / server-action layer and can be reused on
// a future wizard step without carrying any case-specific wiring.
export function CompanyIdentityCard({
  initial,
  setIdentity,
  clearIdentity,
}: Props) {
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Task #14: router.refresh() is confirmed unreliable on this app (see
  // pch-client-workspace.tsx). CompanyLookup already mirrors whatever
  // `initial` we pass it into its own local state (re-syncing whenever
  // it changes), so we just track the saved pick ourselves instead of
  // refreshing, the save actions always write exactly this pick (or
  // clear it), so the outcome is fully known client-side.
  const [current, setCurrent] = useState<CompanyPick | null>(initial);

  const onPick = async (pick: CompanyPick) => {
    setError(null);
    await new Promise<void>((resolve) => {
      startBusy(async () => {
        const res = await setIdentity({
          companyName: pick.company_name,
          companyNumber: pick.company_number,
          companyStatus: pick.company_status,
        });
        if (!res.ok) setError(res.error);
        else setCurrent(pick);
        resolve();
      });
    });
  };

  const onClear = async () => {
    setError(null);
    await new Promise<void>((resolve) => {
      startBusy(async () => {
        const res = await clearIdentity();
        if (!res.ok) setError(res.error);
        else setCurrent(null);
        resolve();
      });
    });
  };

  return (
    <div className="space-y-3">
      <CompanyLookup initial={current} onPick={onPick} onClear={onClear} busy={busy} />
      {error ? (
        <p
          role="alert"
          className="rounded-lg px-3 py-2 text-sm font-medium text-red-700"
          style={{ background: "rgba(220,38,38,0.08)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
