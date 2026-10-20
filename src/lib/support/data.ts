import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AttachmentRecord,
  SupportMessageView,
  SupportThreadView,
} from "./types";

// Server-only data helpers for support threads. Importable from server
// actions (src/app/support/actions.ts) and from server components
// (page.tsx files) alike. Sits outside "use server" so sync exports
// are allowed.

export async function loadThreadMessages(
  admin: ReturnType<typeof createAdminClient>,
  threadId: string,
): Promise<SupportMessageView[]> {
  const { data: rows } = await admin
    .from("support_messages")
    .select("id, author_id, author_role, body, created_at, attachments")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  const list = (rows ?? []) as Array<{
    id: string; author_id: string;
    author_role: "client" | "accountant" | "admin";
    body: string; created_at: string;
    attachments: unknown;
  }>;
  if (list.length === 0) return [];
  const authorIds = Array.from(new Set(list.map((m) => m.author_id)));
  const { data: users } = await admin
    .from("users")
    .select("id, email")
    .in("id", authorIds);
  const labelById = new Map(
    (users ?? []).map((u) => [u.id as string, u.email as string]),
  );
  return list.map((m) => ({
    id: m.id,
    authorRole: m.author_role,
    authorLabel: labelById.get(m.author_id) ?? m.author_id.slice(0, 8),
    body: m.body,
    createdAt: m.created_at,
    attachments: Array.isArray(m.attachments)
      ? (m.attachments as AttachmentRecord[])
      : null,
  }));
}

export function shapeThread(
  row: {
    id: string; case_id: string; user_id: string;
    user_role: "client" | "accountant";
    status: "open" | "resolved"; assigned_admin_id: string | null;
    last_message_at: string | null; created_at: string;
  },
  messages: SupportMessageView[],
): SupportThreadView {
  return {
    id: row.id,
    caseId: row.case_id,
    userId: row.user_id,
    userRole: row.user_role,
    status: row.status,
    assignedAdminId: row.assigned_admin_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    messages,
  };
}

// Read-only load for a case's support thread owned by `userId`. Returns
// null if the thread doesn't exist (lazy-creation happens via the
// server action on first user interaction, not here).
//
// Call sites: client/accountant/admin case page.tsx files render the
// Support tab empty by default and hydrate from this result if a thread
// exists.
export async function loadSupportThreadForCaseAndUser(
  caseId: string,
  userId: string,
): Promise<SupportThreadView | null> {
  const admin = createAdminClient();
  const { data: thread } = await admin
    .from("support_threads")
    .select("id, case_id, user_id, user_role, status, assigned_admin_id, last_message_at, created_at")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!thread) return null;
  const messages = await loadThreadMessages(admin, thread.id);
  return shapeThread(thread, messages);
}
