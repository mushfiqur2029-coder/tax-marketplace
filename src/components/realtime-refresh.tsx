"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type RealtimeSubscription = {
  /** Postgres table name (schema is always `public`). */
  table: string;
  /** Postgres `postgres_changes` filter, e.g. `case_id=eq.<uuid>`. */
  filter?: string;
  /** Default `*` (INSERT + UPDATE + DELETE). Narrow when you need to. */
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
};

// Generic realtime-driven router refresh. Subscribes to postgres_changes
// on the given tables and calls `router.refresh()` whenever any of them
// fires. Debounced to 400ms so a burst of related writes (e.g. case
// INSERT + case_addons INSERT) collapses into a single server-component
// re-render.
//
// Mount this once per page that needs to stay fresh when another user's
// action changes the DB. The notification bell handles its own
// subscription separately — this covers the page content.
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
  const router = useRouter();
  const pending = useRef<number | null>(null);
  // Stabilise the subscriptions prop for the effect so the channel
  // isn't torn down and rebuilt on every render.
  const subscriptionsKey = subscriptions
    .map((s) => `${s.table}:${s.filter ?? ""}:${s.event ?? "*"}`)
    .join("|");

  useEffect(() => {
    const scheduleRefresh = () => {
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        router.refresh();
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
        scheduleRefresh,
      );
    }
    const ref = ch.subscribe();
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      void supabase.removeChannel(ref);
    };
    // subscriptionsKey captures the array shape; we don't want the
    // array identity to force a resubscribe each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, router, channel, subscriptionsKey]);

  return null;
}
