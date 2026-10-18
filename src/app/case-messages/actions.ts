"use server";

// Shared case-messages server action. One entry point used by both
// the client workspace and the accountant workspace. The caller's
// role is derived from the signed-in user and verified against the
// case; a client posting on a case they don't own gets refused, same
// for an accountant posting on a case assigned to someone else.
//
// The write uses the service-role admin client so the author_role
// column lands authoritatively (as the server-resolved role, not
// whatever the client could try to spoof), while RLS still protects
// reads from other users.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCaseMessageNotification } from "@/lib/case/message-email";

type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_BODY_LENGTH = 4000;

export async function sendCaseMessageAction(
  caseId: string,
  body: string,
): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Sign in first." };

  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: "Write a message first." };
  if (trimmed.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Message is too long (max ${MAX_BODY_LENGTH} characters).` };
  }

  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return { ok: false, error: "Case not found." };

  // Resolve the author's role from the case relationship. A user who
  // is neither the client nor the accountant on this case can only
  // post if they're an admin (service_role bypasses RLS, and admin
  // messages are the only path with no case ownership).
  let authorRole: "client" | "accountant" | "admin";
  if (caseRow.client_id === me.id) {
    authorRole = "client";
  } else if (caseRow.accountant_id === me.id) {
    authorRole = "accountant";
  } else if (me.role === "admin") {
    authorRole = "admin";
  } else {
    return { ok: false, error: "You do not have access to this case." };
  }

  const { error } = await admin.from("case_messages").insert({
    case_id: caseId,
    author_id: me.id,
    author_role: authorRole,
    body: trimmed,
  });
  if (error) return { ok: false, error: error.message };

  // Nudge the other party by email; non-blocking.
  after(() => sendCaseMessageNotification({ caseId, authorRole, body: trimmed }));

  // Revalidate both workspace surfaces so the sender's own screen
  // reflects the new message immediately; the other side gets it via
  // the realtime subscription + their next render.
  revalidatePath(`/client/cases/${caseId}/pch`);
  revalidatePath(`/client/cases/${caseId}`);
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  revalidatePath(`/accountant/cases/${caseId}`);
  return { ok: true };
}
