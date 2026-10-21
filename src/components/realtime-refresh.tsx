"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recentLocalMutation } from "@/lib/realtime-self-mutation";

export type RealtimeSubscription = {
  /** Postgres table name (schema is always `public`). */
  table: string;
  /** Postgres `postgres_changes` filter, e.g. `case_id=eq.<uuid>`. */
  filter?: string;
  /** Default `*` (INSERT + UPDATE + DELETE). Narrow when you need to. */
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
};

// Generic realtime watcher for another user's changes landing on this
// page. Subscribes to postgres_changes on the given tables, debounced to
// 400ms so a burst of related writes (e.g. case INSERT + case_addons
// INSERT) collapses into one notice.
//
// Task #14: this used to call router.refresh() on every change, but
// router.refresh() is confirmed unreliable on this app (see
// pch-client-workspace.tsx), it would silently fail to bring in the
// new data. A full window.location.reload() would fix that, but firing
// it out from under someone mid-task (typing into a field, say) the
// moment any other party touches an unrelated row is a worse
// regression than the hard-refresh-on-every-click problem this app is
// being fixed for. So instead we surface a small "new activity" notice
// first.
//
// recentLocalMutation() already filters out the viewer's own actions
// landing back through this same subscription (see
// realtime-self-mutation.ts), so by the time a notice actually shows,
// it's someone (or something) else's change. There's nothing left for
// the person to decide, so the notice applies itself a couple of
// seconds later rather than sitting there waiting to be clicked;
// Dismiss is there for the rare case someone notices it and wants to
// finish what they're doing on the current view first.
//
// Mount this once per page that needs to stay fresh when another user's
// action changes the DB. The notification bell handles its own
// subscription separately, this covers the page content.
//
// Each instance uses a unique `channel` string. Supabase routes
// per-channel so collisions would silently drop events; keep the name
// scoped by role + user + page intent.
export function RealtimeRefresh({
  channel,
  subscriptions,
}: {
  channel: string;
  subscriptions: ReadonlyArray<RealtimeSubscription>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const pending = useRef<number | null>(null);
  const autoTimer = useRef<number | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  // Stabilise the subscriptions prop for the effect so the channel
  // isn't torn down and rebuilt on every render.
  const subscriptionsKey = subscriptions
    .map((s) => `${s.table}:${s.filter ?? ""}:${s.event ?? "*"}`)
    .join("|");

  useEffect(() => {
    const scheduleNotice = () => {
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        // Skip the notice if this change is almost certainly the
        // viewer's own action landing back through the subscription
        // (see realtime-self-mutation.ts for why we can't just check
        // the row's author here).
        if (recentLocalMutation()) return;
        setHasUpdate(true);
        // Having already filtered out the viewer's own actions above,
        // every notice that does show is, by construction, someone (or
        // something) else's change, so apply it on its own after a
        // short grace period rather than making the person notice the
        // banner and click Refresh themselves. Dismiss still cancels
        // this if they're mid-task and want to keep their current view
        // a little longer.
        if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
        autoTimer.current = window.setTimeout(() => {
          window.location.reload();
        }, 2500);
      }, 400);
    };

    let ch = supabase.channel(channel);
    for (const sub of subscriptions) {
      ch = ch.on(
        "postgres_changes",
        {
          event: sub.event ?? "*",
          schema: "public",
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        },
        scheduleNotice,
      );
    }
    const ref = ch.subscribe();
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
      void supabase.removeChannel(ref);
    };
    // subscriptionsKey captures the array shape; we don't want the
    // array identity to force a resubscribe each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, channel, subscriptionsKey]);

  if (!hasUpdate) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-2 bottom-4 z-[70] mx-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-2.5 shadow-xl sm:inset-x-auto sm:right-4"
    >
      <p className="text-xs font-medium text-ink">
        New updates, refreshing…
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
            setHasUpdate(false);
          }}
          className="text-xs font-semibold text-slate hover:text-ink"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg px-3 py-1 text-xs font-semibold text-white"
          style={{ background: "linear-gradient(135deg, var(--sky), var(--mint))" }}
        >
          Refresh now
        </button>
      </div>
    </div>
  );
}
