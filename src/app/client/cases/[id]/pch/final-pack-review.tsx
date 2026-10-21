"use client";

// Phase 6 Slice 7: final-pack review card shown to the client AFTER
// they have approved the figures AND the accountant has sent the
// final accounts pack.
//
// Two parts:
//   - Download link to the client-facing accounts pack (reuses the
//     Phase 2b export endpoints, same output the accountant can
//     download via the Workspace export buttons).
//   - A "type your name to confirm" form. Mirrors the Phase 2b
//     figures approval UX but is a distinct second gate.
//
// Once confirmed, the server flips pch_cases.final_pack_confirmed_*
// and the accountant workspace unlocks the "Mark filed with HMRC"
// button.

import { useState, useTransition } from "react";
import { confirmFinalPackAction } from "@/app/client/pch/actions";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

type Props = {
  caseId: string;
  sentAt: string;
  confirmedAt: string | null;
  confirmedName: string | null;
  prefillName: string;
};

export function FinalPackReview({
  caseId,
  sentAt,
  confirmedAt: initialConfirmedAt,
  confirmedName: initialConfirmedName,
  prefillName,
}: Props) {
  const [name, setName] = useState(prefillName);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Task #14: no reload. confirmFinalPackAction only writes
  // final_pack_confirmed_at/_name, it doesn't touch cases.status, so
  // we already know exactly what to show once it succeeds.
  const [confirmedAt, setConfirmedAt] = useState(initialConfirmedAt);
  const [confirmedName, setConfirmedName] = useState(initialConfirmedName);

  // markLocalMutation() fires before the request goes out: the realtime
  // push for this write (pch_cases, a watched table) can reach the
  // browser before this action's own HTTP response does, so marking
  // only on success can lose that race and trigger an unwanted
  // RealtimeRefresh reload for the viewer's own click.
  const confirm = () => start(async () => {
    setErr(null);
    markLocalMutation();
    const trimmed = name.trim();
    const r = await confirmFinalPackAction(caseId, trimmed);
    // Refresh the mark now that the write is confirmed: a slow request
    // can otherwise outrun the fixed suppression window counted from
    // the mark above.
    markLocalMutation();
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setConfirmedAt(new Date().toISOString());
    setConfirmedName(trimmed);
  });

  if (confirmedAt) {
    return (
      <section className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 p-5">
        <div
          className="text-[11px] font-semibold uppercase tracking-widest text-emerald-800"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Final pack confirmed
        </div>
        <div className="mt-1 text-base font-semibold text-emerald-900">
          {confirmedName}, {new Date(confirmedAt).toLocaleString("en-GB")}
        </div>
        <p className="mt-1 text-xs text-emerald-900">
          Your accountant will now file this with HMRC and let you know
          once it&apos;s accepted.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-sky-300 bg-sky-50 p-5">
      <div
        className="text-[11px] font-semibold uppercase tracking-widest text-sky-800"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Final accounts pack ready
      </div>
      <h2 className="mt-1 text-base font-semibold text-ink">
        Download and confirm your final accounts
      </h2>
      <p className="mt-1 text-xs text-slate-700">
        Your accountant sent the final pack on {new Date(sentAt).toLocaleString("en-GB")}. Download, read through, then type your full name to confirm. Your accountant then submits to HMRC.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`/accountant/cases/${caseId}/pch/export/pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
        >
          Download PDF
        </a>
        <a
          href={`/accountant/cases/${caseId}/pch/export/xlsx`}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
        >
          Download Excel
        </a>
      </div>

      <div className="mt-4">
        <label className="block">
          <span className="text-xs font-semibold text-slate-700">
            Type your full name to confirm
          </span>
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            disabled={pending}
            autoComplete="name"
          />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={confirm}
            disabled={pending || name.trim().length < 2}
            className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Confirming..." : "Confirm final pack"}
          </button>
          {err ? <span className="text-xs text-rose-700">{err}</span> : null}
        </div>
      </div>
    </section>
  );
}
