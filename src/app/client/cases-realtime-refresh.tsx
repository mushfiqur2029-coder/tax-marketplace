"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Mirror of the accountant version — subscribes to postgres_changes on the
// cases table and refreshes the server component so the tab counts + list
// stay in sync as this client's cases move (payment lands, status advances,
// filed by client action, marked complete by accountant, etc.).
//
// Debounced so bursts collapse into one refresh.
export function ClientCasesRealtimeRefresh({ clientId }: { clientId: string }) {
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
      .channel(`client-cases-${clientId}`)
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
  }, [supabase, router, clientId]);

  return null;
}
