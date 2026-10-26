import "server-only";

// Shared helper for the client_approval -> filed cases.status
// transition, used by:
//   src/app/client/actions.ts            approveAndFileAction (generic)
//   src/app/client/pch/actions.ts        approvePchFinalDocsAction (PCH)
//
// Both paths need the same RLS-correct update + 0-row-detection
// behaviour; extracting it here keeps the shape identical across
// case types so an RLS-policy tweak only has to land in one place.
//
// The caller is responsible for case-ownership + "no other
// transition path should win" checks (status === client_approval,
// user is the client, etc). This function just does the write.

import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export type ApprovalFlipResult =
  | { ok: true }
  | { ok: false; error: string };

export async function flipClientApprovalToFiled(
  supabase: ServerSupabase,
  caseId: string,
): Promise<ApprovalFlipResult> {
  // .select().single() turns a 0-row RLS-filtered update into a
  // PGRST116 error, so a silently-blocked policy can't look like a
  // success. The matching .eq("status", "client_approval") is the
  // concurrency guard: a second-click race-loser gets "didn't take"
  // instead of a double flip.
  const { data, error } = await supabase
    .from("cases")
    .update({ status: "filed" })
    .eq("id", caseId)
    .eq("status", "client_approval")
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      error: "Approval didn't take. Reload and try again.",
    };
  }
  return { ok: true };
}
