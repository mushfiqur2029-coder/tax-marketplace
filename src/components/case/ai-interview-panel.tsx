"use client";

// Phase 7 Slice 7.6a: shared chat UI for PCH client-side AI interviews.
// Generalised out of the Phase 6 Slice 4 VehicleInterviewPanel so the
// four new Slice 7.6 flows (RELIEFS, INCOME_PROBE, EXPENSES_PROBE,
// FILING_DETAILS) and the VEHICLE_CA extension all share one chat
// shell. Flow-specific pieces, the header labels, the saving/commit
// button copy, the finish message, come in as props along with the
// start/advance/commit server actions.
//
// Conversation state lives in the browser so an abandoned chat costs
// nothing. On commit the server re-runs the finalising turn so the
// values written to the DB are the AI's output, never something the
// browser could hand-craft.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  InterviewMessage,
  InterviewTurnResult,
} from "@/lib/pch/ai-interview";

// Server action signatures the panel talks to. Each flow provides its
// own trio; the shapes are identical to vehicle-interview-actions.ts.
export type StartResult =
  | { ok: true; opener: InterviewMessage }
  | { ok: false; error: string };
export type AdvanceResult =
  | { ok: true; turn: InterviewTurnResult }
  | { ok: false; error: string };
export type CommitResult =
  | { ok: true }
  | { ok: false; error: string };

type Props = {
  caseId: string;
  onClose: () => void;

  // Header + button copy. Keeping these as props so flows can speak in
  // their own voice (reliefs vs vehicle vs filing details).
  flowLabel: string;              // e.g. "Vehicle conversation"
  flowSubtitle?: string;          // e.g. "Capital allowances explained in plain English"
  // Shown as the final AI "Thanks, that's everything on X. Saving your
  // answers now." bubble when the flow reaches done.
  finishedMessage: string;
  // Button copy for the Save step after finish.
  commitButtonLabel: string;      // e.g. "Save vehicle details"
  commitPendingLabel: string;     // e.g. "Saving your vehicle details..."
  // Placeholder for the chat input textarea.
  inputPlaceholder?: string;

  start: (caseId: string) => Promise<StartResult>;
  advance: (caseId: string, transcript: InterviewMessage[]) => Promise<AdvanceResult>;
  commit: (caseId: string, transcript: InterviewMessage[]) => Promise<CommitResult>;
};

const DEFAULT_PLACEHOLDER =
  'Your answer. Write "I don\'t know" if you genuinely don\'t have the figure, we will not guess.';

export function AiInterviewPanel({
  caseId,
  onClose,
  flowLabel,
  flowSubtitle,
  finishedMessage,
  commitButtonLabel,
  commitPendingLabel,
  inputPlaceholder,
  start: startAction,
  advance: advanceAction,
  commit: commitAction,
}: Props) {
  const router = useRouter();
  const [transcript, setTranscript] = useState<InterviewMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    start(async () => {
      setErr(null);
      const r = await startAction(caseId);
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
    // Intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const r = await advanceAction(caseId, next);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (r.turn.kind === "ask") {
        setTranscript([...next, { role: "assistant", content: r.turn.assistant }]);
        inputRef.current?.focus();
        return;
      }
      setTranscript([
        ...next,
        { role: "assistant", content: finishedMessage },
      ]);
      setFinished(true);
    });
  };

  const commit = () => {
    start(async () => {
      setErr(null);
      const r = await commitAction(caseId, transcript);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-xs">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-slate-900">{flowLabel}</span>
          {flowSubtitle ? (
            <span className="ml-2 text-slate-600">{flowSubtitle}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
            placeholder={inputPlaceholder ?? DEFAULT_PLACEHOLDER}
            className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            disabled={pending}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">Ctrl/Cmd+Enter to send</span>
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
            {pending ? commitPendingLabel : commitButtonLabel}
          </button>
        </div>
      )}
    </div>
  );
}
