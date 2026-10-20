"use client";

// Collapsible panel listing every file the client has uploaded on
// this PCH case. Rendered near the top of the accountant workspace so
// the Photo ID, bank statements, cash receipts, platform summaries,
// and any supporting evidence are one click away without hunting
// through chat attachments.
//
// Files are grouped by pch_doc_slots.section (Identity, Earnings,
// Expenses, Other) with a header per group. Each row has:
//   - file name
//   - uploaded timestamp
//   - slot label (e.g. "Photo ID (PCH-24)")
//   - Open button that fetches a 10-min signed URL and opens the file
//
// Signed URLs come from getDocSignedUrlForAccountant (see page.tsx);
// RLS already restricts storage access to the assigned accountant.

import { useMemo, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";

export type DocumentRow = {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
  requirement_key: string | null;
};

export type SlotMeta = {
  code: string;
  section: string;
  displayName: string;
};

type Props = {
  docs: DocumentRow[];
  slotMeta: SlotMeta[];
  signUrl: (path: string) => Promise<ActionResult<string>>;
};

const UNKNOWN_SECTION = "Other";

export function DocumentsPanel({ docs, slotMeta, signUrl }: Props) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const slotByCode = useMemo(() => {
    const m = new Map<string, SlotMeta>();
    for (const s of slotMeta) m.set(s.code, s);
    return m;
  }, [slotMeta]);

  const grouped = useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const d of docs) {
      const slot = d.requirement_key ? slotByCode.get(d.requirement_key) : null;
      const section = slot?.section ?? UNKNOWN_SECTION;
      const arr = map.get(section) ?? [];
      arr.push(d);
      map.set(section, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    }
    return map;
  }, [docs, slotByCode]);

  const sections = Array.from(grouped.keys()).sort((a, b) => {
    const order = ["Identity", "Earnings", "Expenses", "Vehicle", UNKNOWN_SECTION];
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    const av = ai === -1 ? order.length : ai;
    const bv = bi === -1 ? order.length : bi;
    if (av !== bv) return av - bv;
    return a.localeCompare(b);
  });

  const open = (doc: DocumentRow) => {
    setBusyId(doc.id);
    start(async () => {
      try {
        const res = await signUrl(doc.file_url);
        if (res.ok) window.open(res.data, "_blank", "noopener");
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <h2 className="text-sm font-semibold text-slate-900">
          Client documents{" "}
          <span className="text-xs font-normal text-slate-500">
            ({docs.length})
          </span>
        </h2>
        <span className="text-xs text-slate-500">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded ? (
        docs.length === 0 ? (
          <p className="mt-3 rounded border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">
            The client hasn&apos;t uploaded anything yet.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {sections.map((section) => (
              <div key={section}>
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {section}
                </h3>
                <ul className="divide-y divide-slate-100 rounded border border-slate-200">
                  {(grouped.get(section) ?? []).map((d) => {
                    const slot = d.requirement_key ? slotByCode.get(d.requirement_key) : null;
                    const slotLabel = slot
                      ? `${slot.displayName} (${slot.code})`
                      : d.requirement_key ?? "Uncategorized";
                    const busy = pending && busyId === d.id;
                    return (
                      <li
                        key={d.id}
                        className="flex items-center gap-3 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {d.file_name}
                          </div>
                          <div className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                            <span>{slotLabel}</span>
                            <span aria-hidden="true">·</span>
                            <span>Uploaded {formatDateTime(d.uploaded_at)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => open(d)}
                          disabled={busy}
                          className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {busy ? "Opening..." : "Open"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
