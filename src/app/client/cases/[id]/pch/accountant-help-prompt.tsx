"use client";

// Lightweight "I don't have this document" fallback for non-interview
// slots (Slice 5). Opens inline on the slot card; the client leaves a
// short note explaining what they tried, we flip the slot into the
// 'Awaiting accountant' state, and the accountant workspace surfaces it.
//
// Deliberately NOT a full chat: free-text one-shot is enough for the
// handoff. Follow-up conversation happens in the case-messages panel.

import { useRef, useState, useTransition } from "react";
import { requestPchAccountantHelpAction } from "@/app/client/pch/actions";

type Props = {
  caseId: string;
  slotCode: string;
  slotLabel: string;
  onClose: () => void;
  // Task #14: no reload. requestPchAccountantHelpAction just upserts one
  // pch_doc_status row to "Awaiting accountant", which the parent DocRow
  // already renders from its own local status override, so we tell it
  // directly instead of reloading the whole page out from under the
  // "Help requested" confirmation below.
  onRequested?: () => void;
};

export function AccountantHelpPrompt({
  caseId,
  slotCode,
  slotLabel,
  onClose,
  onRequested,
}: Props) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = () => {
    start(async () => {
      setErr(null);
      const r = await requestPchAccountantHelpAction(caseId, slotCode, note.trim() || undefined);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setDone(true);
      onRequested?.();
    });
  };

  if (done) {
    return (
      <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">
        <div className="font-semibold text-slate-900">Help requested.</div>
        <p className="mt-1 text-slate-700">
          Your accountant will see this on their workspace and will reach out
          through the case messages below.
        </p>
        <div className="mt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-xs">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-slate-900">
            Ask your accountant for help
          </span>
          <span className="ml-2 text-slate-600">on {slotLabel}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </header>

      <p className="mb-2 text-slate-700">
        Short note on why you can&apos;t upload this (optional). Your
        accountant will reach out in the case messages below.
      </p>

      <textarea
        ref={inputRef}
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. my insurance was in my ex-partner's name and I can't get a copy"
        className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        disabled={pending}
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">
          You can keep adding detail in the case chat afterwards.
        </span>
        <div className="flex items-center gap-2">
          {err ? <span className="text-rose-700">{err}</span> : null}
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Sending..." : "Request accountant help"}
          </button>
        </div>
      </div>
    </div>
  );
}
