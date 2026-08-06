"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  // Cases in the queue at page-load time (used to seed known IDs so we don't
  // double-count anything already visible).
  seedCaseIds: string[];
};

type CaseRow = {
  id: string;
  status: string;
  accountant_id: string | null;
  stripe_payment_status: string;
};

function isQueueCase(row: CaseRow | null) {
  if (!row) return false;
  return (
    row.status === "submitted" &&
    row.accountant_id === null &&
    row.stripe_payment_status === "succeeded"
  );
}

// Tiny beep using WebAudio — no asset needed.
function playBeep() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AC();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.34);
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Some browsers block audio until a user gesture — silent failure is fine.
  }
}

export function NotificationBell({ seedCaseIds }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [count, setCount] = useState(0);
  const [pulse, setPulse] = useState(false);
  const knownIds = useRef<Set<string>>(new Set(seedCaseIds));

  const notify = useCallback((row: CaseRow) => {
    if (knownIds.current.has(row.id)) return;
    knownIds.current.add(row.id);
    setCount((n) => n + 1);
    setPulse(true);
    playBeep();
    window.setTimeout(() => setPulse(false), 900);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("accountant-queue-watch")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "cases" },
        (payload) => {
          const row = payload.new as CaseRow;
          if (isQueueCase(row)) notify(row);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "cases" },
        (payload) => {
          const row = payload.new as CaseRow;
          if (isQueueCase(row)) notify(row);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, notify]);

  const clear = () => setCount(0);

  return (
    <button
      type="button"
      onClick={clear}
      aria-label={
        count > 0
          ? `${count} new case${count === 1 ? "" : "s"} in the queue`
          : "No new cases"
      }
      className={
        "relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-paper text-navy-deep transition hover:border-sky/50 hover:bg-sky/5 " +
        (pulse ? "animate-[pulse_.9s_ease-in-out]" : "")
      }
      title="Queue notifications"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 ? (
        <span
          className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
          style={{
            background: "linear-gradient(135deg, var(--sky), var(--mint))",
            fontFamily: "var(--font-mono)",
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
