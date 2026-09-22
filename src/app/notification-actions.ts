"use server";

import { createClient } from "@/lib/supabase/server";

// Both actions are user-scoped by RLS — no server-side auth check needed
// beyond "signed in", because notifications_owner_update policy restricts
// the UPDATE to rows where recipient_id = auth.uid().

export async function markNotificationReadAction(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("recipient_id", user.id);
}

export async function markAllNotificationsReadAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("recipient_id", user.id)
    .eq("read", false);
}
