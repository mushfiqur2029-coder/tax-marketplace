"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Admin dashboard sees every case. Any INSERT/UPDATE to cases warrants a
// refresh so the tab counts + list stay live. Debounced to 400ms.
export function AdminCasesRealtimeRefresh() {
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
      .channel("admin-cases")
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
  }, [supabase, router]);

  return null;
}
