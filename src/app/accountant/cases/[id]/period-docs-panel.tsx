"use client";

import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import type { ChecklistField } from "@/lib/engagement/checklist";
import type { TierId } from "@/lib/plans";

type ClientDoc = {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
};

type Props = {
  tierId: TierId;
  fields: ChecklistField[];
  docsByKey: Record<string, ClientDoc[]>;
  submittedAt: string | null;
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
};

// Read-only view of the client's second-stage uploads, grouped by
// requirement_key. The accountant can click a file to open a signed URL
// in a new tab (same pattern as the onboarding panel).
export function PeriodDocsPanel({
  tierId,
  fields,
  docsByKey,
  submittedAt,
  getDocUrl,
}: Props) {
  return (
    <div className="space-y-4">
      {submittedAt ? (
        <p className="rounded-xl border border-line bg-paper px-3 py-2 text-xs text-slate">
          Client submitted period documents {formatDateTime(submittedAt)}.
        </p>
      ) : (
        <p className="rounded-xl border border-line bg-paper px-3 py-2 text-xs text-slate">
          Client hasn&apos;t submitted period documents yet. These uploads
          will grow as they add files.
        </p>
      )}

      <ul className="space-y-4">
        {fields.map((field) => {
          const required = field.requiredFor.includes(tierId);
          const docs = docsByKey[field.id] ?? [];
          return (
            <li key={field.id}>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider text-slate"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {field.label}
                </span>
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{
                    color: required ? "#B91C1C" : "#4b5c89",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {required ? "Required" : "Optional"}
                </span>
              </div>
              {docs.length === 0 ? (
                <p className="mt-1 text-xs text-slate italic">
                  (nothing uploaded)
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-paper">
                  {docs.map((d) => (
                    <PeriodDocRow key={d.id} doc={d} getDocUrl={getDocUrl} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PeriodDocRow({
  doc,
  getDocUrl,
}: {
  doc: ClientDoc;
  getDocUrl: (path: string) => Promise<ActionResult<string>>;
}) {
  const [opening, startOpen] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    setError(null);
    startOpen(async () => {
      const res = await getDocUrl(doc.file_url);
      if (res.ok) {
        window.open(res.data, "_blank", "noopener,noreferrer");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <button
          type="button"
          onClick={handleOpen}
          disabled={opening}
          className="truncate text-left text-sm font-semibold text-navy-deep underline underline-offset-4 hover:text-sky disabled:opacity-50"
        >
          {opening ? "Opening…" : doc.file_name}
        </button>
        <div className="text-xs text-slate">
          {formatDateTime(doc.uploaded_at)}
        </div>
        {error ? (
          <p className="mt-1 text-xs font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}
