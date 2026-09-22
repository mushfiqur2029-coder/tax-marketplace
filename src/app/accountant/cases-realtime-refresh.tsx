"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Sibling to AccountantCasesFilter. Subscribes to postgres_changes on the
// cases table and refreshes the server component so tab counts + the case
// list stay in sync as cases move (someone else takes a queue case, a
// client approves, a status changes, etc.).
//
// Debounced: many changes in quick succession only trigger one refresh.
export function AccountantCasesRealtimeRefresh({
  accountantId,
}: {
  accountantId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, 400);
    };

    const channel = supabase
      .channel(`accountant-cases-${accountantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases" },
        scheduleRefresh,
      )
      .subscribe();
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      void supabase.removeChannel(channel);
    };
  }, [supabase, router, accountantId]);

  return null;
}
