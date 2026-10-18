"use client";

// Chat-style AI interview UI (Slice 3).
//
// Inline on the slot card. Opens when the client clicks
// "I don't have this document". Walks them through the figures one or
// two questions at a time, then commits a pch_doc_extractions row
// (source='ai_interview') that lands in the same review panel used for
// document extractions.
//
// Conversation state lives here (not on the server) so an abandoned
// interview costs nothing. On commit, the server re-runs the final
// Anthropic turn and persists its output, so the committed values can
// never be hand-crafted in the browser.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startInterviewAction,
  advanceInterviewAction,
  commitInterviewAction,
} from "@/app/client/pch/interview-actions";
import type { InterviewMessage } from "@/lib/pch/ai-interview";

type Props = {
  caseId: string;
  slotCode: string;
  slotLabel: string;
  onClose: () => void;
};

export function InterviewPanel({ caseId, slotCode, slotLabel, onClose }: Props) {
  const router = useRouter();
  const [transcript, setTranscript] = useState<InterviewMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Kick the interview off on first mount. The opener is deterministic
  // (no Anthropic round-trip), so this is a cheap server-action call.
  useEffect(() => {
    let cancelled = false;
    start(async () => {
      setErr(null);
      const r = await startInterviewAction(caseId, slotCode);
      if (cancelled) return;
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setTranscript([r.opener]);
    });
    return () => {
      cancelled = true;
    };
    // Intentionally only runs on mount; caseId/slotCode don't change
    // over the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autoscroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, pending]);

  const send = () => {
    const body = draft.trim();
    if (body.length === 0 || finished) return;
    start(async () => {
      setErr(null);
      const next: InterviewMessage[] = [
        ...transcript,
        { role: "user", content: body },
      ];
      setTranscript(next);
      setDraft("");

      const r = await advanceInterviewAction(caseId, slotCode, next);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (r.turn.kind === "ask") {
        setTranscript([...next, { role: "assistant", content: r.turn.assistant }]);
        inputRef.current?.focus();
        return;
      }
      // Model has enough info. Lock the composer, show the hand-off
      // message, then commit on the next click.
      setTranscript([
        ...next,
        {
          role: "assistant",
          content:
            "Thanks, that's everything we need. Saving your answers now, you'll see them in the review panel in a moment.",
        },
      ]);
      setFinished(true);
    });
  };

  const commit = () => {
    start(async () => {
      setErr(null);
      const r = await commitInterviewAction(caseId, slotCode, transcript);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-xs">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-slate-900">
            AI conversation
          </span>
          <span className="ml-2 text-slate-600">
            for {slotLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </header>

      <div
        ref={scrollRef}
        className="mb-2 max-h-72 overflow-y-auto rounded border border-indigo-100 bg-white p-2"
      >
        {transcript.length === 0 ? (
          <p className="text-slate-500">Starting the conversation...</p>
        ) : (
          <ul className="space-y-2">
            {transcript.map((m, i) => (
              <li
                key={i}
                className={
                  m.role === "assistant"
                    ? "rounded border border-slate-200 bg-white px-2 py-1.5"
                    : "rounded border border-sky-200 bg-sky-50 px-2 py-1.5"
                }
              >
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {m.role === "assistant" ? "AI assistant" : "You"}
                </div>
                <div className="whitespace-pre-wrap text-slate-800">{m.content}</div>
              </li>
            ))}
            {pending ? (
              <li className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-500 italic">
                Thinking...
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {!finished ? (
        <div className="space-y-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send();
            }}
            placeholder={'Your answer. Write "I don\'t know" if you genuinely don\'t have the figure, we will not guess.'}
            className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            disabled={pending}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              Ctrl/Cmd+Enter to send
            </span>
            <div className="flex items-center gap-2">
              {err ? <span className="text-rose-700">{err}</span> : null}
              <button
                type="button"
                onClick={send}
                disabled={pending || draft.trim().length === 0}
                className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {pending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {err ? <div className="text-rose-700">{err}</div> : null}
          <button
            type="button"
            onClick={commit}
            disabled={pending}
            className="w-full rounded bg-emerald-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            {pending
              ? "Saving your answers..."
              : "Save and show me the review"}
          </button>
          <p className="text-[11px] text-slate-500">
            Your answers land in the same review step as uploaded documents. You can still confirm, edit, or skip each field there.
          </p>
        </div>
      )}
    </div>
  );
}
