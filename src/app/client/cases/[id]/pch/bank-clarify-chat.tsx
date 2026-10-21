"use client";

// Phase 6 Slice 3: chat-style clarification for bank transactions that
// the categoriser was unsure about.
//
// Flow per round:
//   1. UI calls nextBankClarifyTargetAction → gets the top-priority
//      transaction (null if nothing needs clarifying).
//   2. UI renders a friendly templated question that includes the
//      amount, date, and description. Answer goes into a textarea.
//   3. On submit, UI calls recordBankClarifyAnswerAction which re-runs
//      the AI classifier against the row + the client's extra context,
//      updates pch_bank_transactions, re-aggregates the ledger, and
//      returns the new category.
//   4. UI pulls the next target, loops. When no target is left, the
//      chat shows a "done" state.
//
// Deliberately simple: one transaction per turn, free-text input, no
// quick-pick chips in v1. If the AI's new pick still isn't right, the
// client can override from the ledger table below.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  nextBankClarifyTargetAction,
  recordBankClarifyAnswerAction,
  type ClarifyTarget,
} from "@/app/client/pch/bank-actions";

type Props = {
  caseId: string;
  // Initial queue size so the UI shows "N transactions still need your
  // input" without a round-trip. Loaded by the parent server component.
  initialPendingCount: number;
  // Task #14: no reload. recordBankClarifyAnswerAction returns the new
  // category straight away, so we hand it up to LedgerSection (the
  // shared source of truth for the transaction list) instead of
  // reloading the page, which also keeps the ledger table below in
  // sync without a round-trip.
  onAnswered: (txnId: string, category: string, confidence: string) => void;
};

type Turn =
  | { role: "ai"; question: string; txnId?: string }
  | { role: "user"; text: string }
  | { role: "status"; text: string };

export function BankClarifyChat({ caseId, initialPendingCount, onAnswered }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [current, setCurrent] = useState<ClarifyTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(initialPendingCount);
  const [done, setDone] = useState(initialPendingCount === 0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadNext = useCallback(() => {
    start(async () => {
      setErr(null);
      const r = await nextBankClarifyTargetAction(caseId);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      if (!r.target) {
        setCurrent(null);
        setDone(true);
        setRemaining(0);
        setTurns((prev) => [
          ...prev,
          {
            role: "status",
            text: "All transactions sorted. Your ledger below is up to date.",
          },
        ]);
        return;
      }
      setCurrent(r.target);
      setTurns((prev) => [
        ...prev,
        { role: "ai", question: templateQuestion(r.target!), txnId: r.target!.id },
      ]);
      // Autofocus after the question renders.
      setTimeout(() => inputRef.current?.focus(), 10);
    });
  }, [caseId]);

  // Kick the first turn off on mount if there's anything to clarify.
  useEffect(() => {
    if (initialPendingCount > 0) loadNext();
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autoscroll on turn additions.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const submit = () => {
    if (!current) return;
    const body = draft.trim();
    if (body.length === 0) return;
    start(async () => {
      setErr(null);
      const txnId = current.id;
      setTurns((prev) => [...prev, { role: "user", text: body }]);
      setDraft("");
      const r = await recordBankClarifyAnswerAction(caseId, txnId, body);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          role: "status",
          text: `Saved as "${friendlyCategoryLabel(r.newCategory)}" (${r.newConfidence} confidence). Pulling the next one...`,
        },
      ]);
      setRemaining((n) => Math.max(0, n - 1));
      onAnswered(txnId, r.newCategory, r.newConfidence);
      loadNext();
    });
  };

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
        <h3 className="text-sm font-semibold text-emerald-900">
          All transactions sorted
        </h3>
        <p className="mt-1 text-emerald-900">
          Nothing needs your input right now. If you spot anything wrong in the
          ledger below, use the inline category picker to fix it.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-xs">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-slate-900">
            A few things to check
          </span>
          <span className="ml-2 text-slate-600">
            {remaining} transaction{remaining === 1 ? "" : "s"} to clarify
          </span>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="mb-2 max-h-72 overflow-y-auto rounded border border-indigo-100 bg-white p-2"
      >
        {turns.length === 0 ? (
          <p className="text-slate-500">Looking at your statement...</p>
        ) : (
          <ul className="space-y-2">
            {turns.map((t, i) =>
              t.role === "ai" ? (
                <li
                  key={i}
                  className="rounded border border-slate-200 bg-white px-2 py-1.5"
                >
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    AI assistant
                  </div>
                  <div className="whitespace-pre-wrap text-slate-800">{t.question}</div>
                </li>
              ) : t.role === "user" ? (
                <li
                  key={i}
                  className="rounded border border-sky-200 bg-sky-50 px-2 py-1.5"
                >
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    You
                  </div>
                  <div className="whitespace-pre-wrap text-slate-800">{t.text}</div>
                </li>
              ) : (
                <li
                  key={i}
                  className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-900"
                >
                  {t.text}
                </li>
              ),
            )}
            {pending ? (
              <li className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-500 italic">
                Thinking...
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {current ? (
        <div className="space-y-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit();
            }}
            placeholder="A short description of what this transaction was for."
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
                onClick={submit}
                disabled={pending || draft.trim().length === 0}
                className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {pending ? "Saving..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Templated question. Deliberately friendly, not literal "please
// categorise". Reads amount + date + description back to the client so
// they don't have to flip to the ledger below to recall what we're
// asking about.
function templateQuestion(t: ClarifyTarget): string {
  const amount = formatAmount(t.amountPence);
  const direction = t.amountPence >= 0 ? "paid in" : "paid out";
  const dateBit = t.txnDate ? " on " + formatDate(t.txnDate) : "";
  const whyBit =
    t.currentCategory === "uncategorized"
      ? " I couldn't tell what this was for."
      : t.currentConfidence === "low"
        ? " I guessed this was a business expense but I'd like to check."
        : "";
  return `I saw ${amount} ${direction}${dateBit} to "${t.description}".${whyBit} What was this for?`;
}

function formatAmount(pence: number): string {
  const abs = Math.abs(pence) / 100;
  return "£" + abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

// Loose human label fallback for the status messages. Precise labels
// live in bank-categories.ts but importing that into a client bundle
// would pull in server-only helpers; a short switch here is cheaper.
function friendlyCategoryLabel(key: string): string {
  switch (key) {
    case "platform_fares": return "Platform fares";
    case "cash_fares": return "Cash fares";
    case "other_income": return "Other income";
    case "fuel": return "Fuel";
    case "insurance": return "Insurance";
    case "rental": return "PCO rental";
    case "repairs_mot": return "Repairs / MOT";
    case "tolls_parking": return "Tolls / parking";
    case "licence": return "Licence fees";
    case "phone": return "Mobile phone";
    case "finance_interest": return "Finance interest";
    case "cleaning": return "Vehicle cleaning";
    case "accountancy": return "Accountancy";
    case "other_business": return "Other business expense";
    case "transfer": return "Transfer";
    case "personal": return "Personal";
    case "hmrc_payment": return "HMRC payment";
    case "fine": return "Fine";
    case "uncategorized": return "Still uncategorised";
    default: return key;
  }
}
