"use client";

// Two reusable hooks that cover the two shapes of realtime update in
// this app, so most of the "stop firing the banner, merge the row
// directly into local state" conversions become one hook call + a
// slim state cell per panel.
//
// Why these specific shapes:
//
//   Shape A, useLiveRow:   a single record whose fields change over
//                           time (pch_cases head, a case row, a
//                           withdrawal_request row). The subscription
//                           fires UPDATE events; we take the merge of
//                           the old local value and payload.new.
//
//   Shape B, useLiveList:  a bounded list that gains rows (INSERT),
//                           edits rows (UPDATE), and sometimes drops
//                           them (DELETE). Admin's addon-requests,
//                           profile-changes, withdrawals, enquiries,
//                           and the per-case pch_check_status /
//                           pch_bank_transactions / pch_doc_extractions
//                           feeds all fit this shape.
//
// Both hooks:
//   - Filter the viewer's own writes out via recentLocalMutation()
//     so the viewer's own save never shows up as "someone else did
//     this". Call markLocalMutation() in your own save paths.
//   - Scope their channel name to the caller so two mounted panels
//     subscribed to the same table don't collide.
//   - Clean up the Supabase channel on unmount.
//
// What they don't do:
//   - Full re-derivation of computed state from the raw row (e.g.
//     refreshing a case's "readiness band" that depends on 3 joined
//     tables). If a panel's visible state is a derived cross-table
//     aggregate, a merge of one row's INSERT isn't enough; the
//     panel either needs its own compute step or stays on the
//     banner. See the Phase 2 report for the subscriptions that are
//     genuinely awkward to merge safely.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recentLocalMutation } from "@/lib/realtime-self-mutation";

type PostgresChangePayload = {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
  eventType?: "INSERT" | "UPDATE" | "DELETE";
};

export type LiveRowOptions<T> = {
  /** Postgres table name (schema is always `public`). */
  table: string;
  /** Postgres `postgres_changes` filter, e.g. `id=eq.<uuid>`. */
  filter: string;
  /** Channel name unique to this mount + table pair. */
  channel: string;
  /** Map a payload.new (loosely typed) into the local shape. */
  map: (row: Record<string, unknown>, prev: T) => T;
};

/**
 * Live-tracked single record. On UPDATE events for the matching
 * filter, `map` is called with the payload's new row and the current
 * local value; whatever it returns becomes the new state. The
 * viewer's own writes are filtered via recentLocalMutation().
 */
export function useLiveRow<T>(initial: T, opts: LiveRowOptions<T>): T {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<T>(initial);
  useEffect(() => {
    const channel = supabase
      .channel(opts.channel)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: opts.table,
          filter: opts.filter,
        },
        (payload: PostgresChangePayload) => {
          if (recentLocalMutation()) return;
          const row = payload.new;
          if (!row || typeof row !== "object") return;
          setState((prev) => opts.map(row as Record<string, unknown>, prev));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // Caller is expected to keep channel/table/filter stable per
    // mount. We intentionally don't resubscribe when `map` identity
    // changes; wrap it in useCallback upstream if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, opts.channel, opts.table, opts.filter]);
  return state;
}

export type LiveListOptions<T extends { id: string }> = {
  /** Postgres table name (schema is always `public`). */
  table: string;
  /** Postgres `postgres_changes` filter, e.g. `case_id=eq.<uuid>`. */
  filter?: string;
  /** Channel name unique to this mount + table pair. */
  channel: string;
  /** Map a payload.new into the local shape, or return null to skip. */
  map: (row: Record<string, unknown>) => T | null;
  /**
   * Where to put newly-inserted rows. `prepend` (default) matches
   * most "newest first" lists; `append` matches chronological
   * threads. Only applies to INSERT events; UPDATE preserves position.
   */
  insertAt?: "prepend" | "append";
};

/**
 * Live-tracked list of records. On INSERT prepends/appends (dedupes
 * by id), on UPDATE replaces the matching row in-place (same
 * position), on DELETE removes it. The viewer's own writes are
 * filtered via recentLocalMutation().
 */
export function useLiveList<T extends { id: string }>(
  initial: readonly T[],
  opts: LiveListOptions<T>,
): T[] {
  const supabase = useMemo(() => createClient(), []);
  const [list, setList] = useState<T[]>(() => [...initial]);
  useEffect(() => {
    const channel = supabase
      .channel(opts.channel)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: opts.table,
          ...(opts.filter ? { filter: opts.filter } : {}),
        },
        (payload: PostgresChangePayload) => {
          if (recentLocalMutation()) return;
          const ev = payload.eventType;
          if (ev === "DELETE") {
            const oldRow = payload.old;
            const oldId = oldRow && typeof oldRow === "object"
              ? (oldRow as Record<string, unknown>).id
              : undefined;
            if (typeof oldId !== "string") return;
            setList((prev) => prev.filter((r) => r.id !== oldId));
            return;
          }
          const row = payload.new;
          if (!row || typeof row !== "object") return;
          const mapped = opts.map(row as Record<string, unknown>);
          if (!mapped) return;
          if (ev === "INSERT") {
            setList((prev) => {
              if (prev.some((r) => r.id === mapped.id)) return prev;
              return opts.insertAt === "append"
                ? [...prev, mapped]
                : [mapped, ...prev];
            });
          } else if (ev === "UPDATE") {
            setList((prev) => {
              const i = prev.findIndex((r) => r.id === mapped.id);
              if (i === -1) {
                // Row we didn't have locally; treat as INSERT so the
                // list converges without a full refetch.
                return opts.insertAt === "append"
                  ? [...prev, mapped]
                  : [mapped, ...prev];
              }
              const next = prev.slice();
              next[i] = mapped;
              return next;
            });
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, opts.channel, opts.table, opts.filter]);
  return list;
}
