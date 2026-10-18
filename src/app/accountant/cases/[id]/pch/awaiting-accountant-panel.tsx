"use client";

// Slice 5: proactive surface for slots the client flagged as needing
// the accountant's help. One panel per PCH case, rendered near the top
// of the accountant workspace. Each row shows the slot code + label,
// the client's note (prefixed with the stable "[Client asked for help
// on YYYY-MM-DD]" marker from the client-side action), and a single
// "Mark resolved" button that flips the slot to 'Not applicable' with
// an audit note.
//
// Deliberately not a chat. The follow-up conversation happens in the
// existing case-messages panel further down the page.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolvePchBlockedSlotAction } from "@/app/accountant/pch/actions";

export type BlockedSlot = {
  slotCode: string;
  displayName: string;
  section: string;
  note: string | null;
  updatedAt: string | null;
};

export function AwaitingAccountantPanel({
  caseId,
  blocked,
}: {
  caseId: string;
  blocked: BlockedSlot[];
}) {
  if (blocked.length === 0) return null;
  return (
    <section className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-amber-900">
          {blocked.length} question{blocked.length === 1 ? "" : "s"} from the client
        </h2>
        <span className="text-xs text-amber-800">
          The client flagged these slots as &quot;I don&apos;t have this document&quot; and asked you to help.
        </span>
      </header>
      <ul className="mt-3 space-y-2">
        {blocked.map((b) => (
          <BlockedRow key={b.slotCode} caseId={caseId} slot={b} />
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-amber-800">
        Clarify in the case chat below; use the override cells to record any
        figure you fill in. &quot;Mark resolved&quot; flips the slot to
        &quot;Not applicable&quot; and preserves the full audit note.
      </p>
    </section>
  );
}

function BlockedRow({ caseId, slot }: { caseId: string; slot: BlockedSlot }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);

  const resolve = () => {
    start(async () => {
      setErr(null);
      const r = await resolvePchBlockedSlotAction(caseId, slot.slotCode, note.trim() || undefined);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="rounded border border-amber-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-slate-500">
            {slot.slotCode} <span className="text-slate-400">·</span> {slot.section}
          </div>
          <div className="mt-0.5 font-medium text-slate-900">{slot.displayName}</div>
          {slot.note ? (
            <div className="mt-1 whitespace-pre-wrap text-slate-700">{slot.note}</div>
          ) : null}
          {slot.updatedAt ? (
            <div className="mt-1 text-[10px] text-slate-400">
              Flagged {new Date(slot.updatedAt).toLocaleString("en-GB")}
            </div>
          ) : null}
        </div>
        <div className="shrink-0">
          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-800 hover:bg-emerald-100"
            >
              Mark resolved
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="mt-2 space-y-2">
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How you resolved this (e.g. 'DVLA lookup, filled vehicle reg via override', 'client confirmed in chat')"
            className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            disabled={pending}
          />
          <div className="flex items-center justify-between gap-2">
            {err ? <span className="text-rose-700">{err}</span> : <span />}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                disabled={pending}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resolve}
                disabled={pending}
                className="rounded bg-emerald-600 px-2 py-1 font-medium text-white disabled:opacity-50"
              >
                {pending ? "Saving..." : "Confirm resolved"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}
