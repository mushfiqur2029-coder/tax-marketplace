"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
        else router.refresh();
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
        else router.refresh();
        resolve();
      });
    });
  };

  return (
    <div className="space-y-3">
      <CompanyLookup initial={initial} onPick={onPick} onClear={onClear} busy={busy} />
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
