"use client";

// RealtimeRefresh (components/realtime-refresh.tsx) watches a page's own
// tables for changes made by *other* people and surfaces a "new updates"
// notice when it sees one. The problem: Supabase's postgres_changes feed
// doesn't tell us who made a change, only that a row changed, so the
// viewer's own click (confirm a field, change a category, save an
// answer, etc.) comes right back through the same subscription and the
// notice fires for a change the viewer already sees reflected locally,
// every single time.
//
// Fix: every PCH workspace component that writes to one of RealtimeRefresh's
// watched tables and already updates its own local state on success calls
// markLocalMutation() right after. RealtimeRefresh checks
// recentLocalMutation() before showing its notice and skips it if the
// viewer caused this themselves a moment ago. A plain module-level
// variable is enough, this only needs to hold for one browser tab's
// lifetime, no persistence or cross-tab sharing required.
let lastLocalMutationAt = 0;

export function markLocalMutation() {
  lastLocalMutationAt = Date.now();
}

// Generous window: the debounce in RealtimeRefresh is 400ms, and a
// server action round-trip (plus the realtime event reaching this tab)
// can comfortably take another second or two.
export function recentLocalMutation(withinMs = 4000): boolean {
  return Date.now() - lastLocalMutationAt < withinMs;
}
