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
import type {
  InterviewMessage,
  InterviewTurnResult,
} from "@/lib/pch/ai-interview";
import { markLocalMutation } from "@/lib/realtime-self-mutation";

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

  // Phase 8 Slice 8.1: optional one-click "Not applicable" escape hatch
  // so a client with nothing to say for this flow (no pension, no other
  // income, no refund due) can mark the matching checklist item(s) done
  // without typing the whole conversation. Flows that pass this prop
  // render a "Not applicable" button in the header next to Close; the
  // button calls the action and then invokes onClose on success. The
  // action is expected to upsert pch_check_status with Done + a note
  // of "Client confirmed not applicable". VEHICLE_CA deliberately does
  // not use this because 'No vehicle' is already an in-flow answer.
  notApplicable?: {
    label?: string;               // Button copy, defaults to "Not applicable"
    action: () => Promise<{ ok: true } | { ok: false; error: string }>;
    // Task #14: unlike commit (where the AI's finalising turn decides
    // data server-side), a successful "not applicable" write is
    // all-or-nothing and tells us everything we need, so the caller
    // can update its own local "skipped" state instead of reloading.
    // Falls back to a reload when a caller hasn't been updated yet.
    onConfirmed?: () => void;
  };
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
  notApplicable,
}: Props) {
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
      // Task #14: router.refresh() was live-tested and confirmed to leave
      // stale data on screen after a commit here (same as the Identity
      // save), which is worse than a visible reload because nothing
      // tells the client their answers didn't visibly land. Unlike a
      // simple field edit, the commit step re-runs the AI's finalising
      // turn server-side, so the client genuinely doesn't know what was
      // written, there's no local value to optimistically apply. A full
      // reload is the correct, honest fallback until each flow's summary
      // panel is wired to re-fetch its own data directly.
      window.location.reload();
    });
  };

  const notApplicableClick = () => {
    if (!notApplicable) return;
    start(async () => {
      setErr(null);
      // Fire before the request goes out, not after it resolves: when
      // onConfirmed is provided (no reload), the realtime push for this
      // write can reach the browser before this action's own response
      // does, so marking only on success can lose that race.
      if (notApplicable.onConfirmed) markLocalMutation();
      const r = await notApplicable.action();
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (notApplicable.onConfirmed) {
        notApplicable.onConfirmed();
        onClose();
      } else {
        window.location.reload();
      }
    });
  };

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 text-xs">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold text-slate-900">{flowLabel}</span>
          {flowSubtitle ? (
            <span className="ml-2 text-slate-600">{flowSubtitle}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {notApplicable ? (
            <button
              type="button"
              onClick={notApplicableClick}
              disabled={pending}
              title="Mark this section as not applicable without running the chat"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {notApplicable.label ?? "Not applicable"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Close
          </button>
        </div>
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
              <li className="rounded border border-slate-200 bg-white px-2 py-2 text-slate-500">
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  AI assistant
                </div>
                <div className="italic">Thinking...</div>
                {/* Mini indeterminate progress bar so the client can see
                    the AI is actively working, not that the chat has
                    stalled, while a turn (or the commit/finalise step)
                    is in flight. Shared design-system class, see
                    globals.css. */}
                <div className="sl-ai-progress mt-1.5" />
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
              // Enter sends, same as the Send button. Shift+Enter still
              // inserts a newline for a client who genuinely wants to
              // write more than one line.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={inputPlaceholder ?? DEFAULT_PLACEHOLDER}
            className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            disabled={pending}
          />
          <div className="flex items-center justify-end gap-2">
            {err ? <span className="text-rose-700">{err}</span> : null}
            <button
              type="button"
              onClick={send}
              disabled={pending || draft.trim().length === 0}
              title="Enter to send, Shift+Enter for a new line"
              className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send"}
            </button>
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
          {pending ? <div className="sl-ai-progress" /> : null}
        </div>
      )}
    </div>
  );
}
