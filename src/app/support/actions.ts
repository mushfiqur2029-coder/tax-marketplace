"use server";

// Phase 7 Slice 7.3 / 7.3b: server actions for the admin / support
// contact channel. 7.3b pivots scope from one-thread-per-user (standalone
// /help) to one-thread-per-(case,user) (tabbed inside the case page).
//
// Everything case-related must go through this file so author_role
// lands authoritatively (not spoofable from the client) and the
// case-membership guard (caller must be client_id or accountant_id on
// the target case) runs server-side.
//
// Types + sync data helpers live in src/lib/support/{types,data}.ts to
// keep this file strictly async-exports (the "use server" contract).

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadThreadMessages, shapeThread } from "@/lib/support/data";
import type {
  AttachmentRecord,
  SupportThreadView,
  SupportThreadListItem,
} from "@/lib/support/types";

type ActionOk<T = Record<never, never>> = { ok: true } & T;
type ActionErr = { ok: false; error: string };
type ActionResult<T = Record<never, never>> = ActionOk<T> | ActionErr;

const MAX_BODY_LENGTH = 4000;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const ALLOWED_EXT_RE = /\.(pdf|jpe?g|png|heic|heif|webp|csv|xlsx?|xls)$/i;

// -------------------------------------------------------------------
// User-side: get-or-create thread for a case, send message, read own
// -------------------------------------------------------------------

async function requireCaseMembership(
  admin: ReturnType<typeof createAdminClient>,
  caseId: string,
  userId: string,
): Promise<{ ok: true; role: "client" | "accountant" } | { ok: false; error: string }> {
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return { ok: false, error: "Case not found." };
  if (caseRow.client_id === userId) return { ok: true, role: "client" };
  if (caseRow.accountant_id === userId) return { ok: true, role: "accountant" };
  return { ok: false, error: "You do not have access to this case." };
}

export async function getOrCreateCaseSupportThreadAction(
  caseId: string,
): Promise<ActionResult<{ thread: SupportThreadView }>> {
  try {
    const me = await getCurrentUser();
    if (!me) return { ok: false, error: "Sign in first." };
    if (me.role !== "client" && me.role !== "accountant") {
      return { ok: false, error: "Support channel is for clients and accountants." };
    }
    const admin = createAdminClient();
    const membership = await requireCaseMembership(admin, caseId, me.id);
    if (!membership.ok) return membership;

    const { data: existing } = await admin
      .from("support_threads")
      .select("id, case_id, user_id, user_role, status, assigned_admin_id, last_message_at, created_at")
      .eq("case_id", caseId)
      .eq("user_id", me.id)
      .maybeSingle();

    let threadRow = existing;
    if (!threadRow) {
      const { data: inserted, error } = await admin
        .from("support_threads")
        .insert({ case_id: caseId, user_id: me.id, user_role: membership.role })
        .select("id, case_id, user_id, user_role, status, assigned_admin_id, last_message_at, created_at")
        .single();
      if (error || !inserted) {
        return { ok: false, error: error?.message ?? "Could not create your support thread." };
      }
      threadRow = inserted;
    }

    const messages = await loadThreadMessages(admin, threadRow.id);
    revalidatePath(`/client/cases/${caseId}/pch`);
    revalidatePath(`/accountant/cases/${caseId}/pch`);
    return { ok: true, thread: shapeThread(threadRow, messages) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load your support thread." };
  }
}

export async function sendSupportMessageAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResult> {
  const body = formData.get("body");
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (trimmed.length === 0) return { ok: false, error: "Write a message first." };
  if (trimmed.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Message is too long (max ${MAX_BODY_LENGTH} characters).` };
  }

  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Max ${MAX_ATTACHMENTS} attachments per message.` };
  }
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return { ok: false, error: `"${f.name}" is over 50 MB. Shrink the file and retry.` };
    }
    const typeLower = (f.type || "").toLowerCase();
    const nameLower = f.name.toLowerCase();
    if (!ALLOWED_MIME.has(typeLower) && !ALLOWED_EXT_RE.test(nameLower)) {
      return {
        ok: false,
        error: `"${f.name}": only PDF, images (JPG/PNG/HEIC/WebP), CSV or Excel allowed.`,
      };
    }
  }

  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Sign in first." };
  if (me.role !== "client" && me.role !== "accountant") {
    return { ok: false, error: "Support channel is for clients and accountants." };
  }
  const admin = createAdminClient();
  const membership = await requireCaseMembership(admin, caseId, me.id);
  if (!membership.ok) return membership;

  // Lazy-create the thread on first message so a user can arrive via
  // the tab, type, and send without a prior "start" step. The UNIQUE
  // (case_id, user_id) constraint protects against double-insert races.
  let thread = (
    await admin
      .from("support_threads")
      .select("id")
      .eq("case_id", caseId)
      .eq("user_id", me.id)
      .maybeSingle()
  ).data as { id: string } | null;
  if (!thread) {
    const { data: inserted, error } = await admin
      .from("support_threads")
      .insert({ case_id: caseId, user_id: me.id, user_role: membership.role })
      .select("id")
      .single();
    if (error || !inserted) {
      return { ok: false, error: error?.message ?? "Could not open your support thread." };
    }
    thread = inserted;
  }

  const messageId = randomUUID();
  const uploaded: AttachmentRecord[] = [];
  try {
    for (const f of files) {
      const safeName = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `support/${thread.id}/${messageId}/${Date.now()}_${safeName}`;
      const buf = new Uint8Array(await f.arrayBuffer());
      const { error: upErr } = await admin.storage
        .from("case-documents")
        .upload(path, buf, {
          contentType: f.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw new Error(`Attachment "${f.name}" failed to upload: ${upErr.message}`);
      uploaded.push({
        path,
        name: f.name,
        mime: f.type || "application/octet-stream",
        size_bytes: f.size,
      });
    }
  } catch (e) {
    if (uploaded.length > 0) {
      await admin.storage.from("case-documents").remove(uploaded.map((u) => u.path));
    }
    return { ok: false, error: e instanceof Error ? e.message : "Attachment upload failed." };
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin.from("support_messages").insert({
    id: messageId,
    thread_id: thread.id,
    author_id: me.id,
    author_role: me.role,
    body: trimmed,
    attachments: uploaded.length > 0 ? uploaded : null,
  });
  if (error) {
    if (uploaded.length > 0) {
      await admin.storage.from("case-documents").remove(uploaded.map((u) => u.path));
    }
    return { ok: false, error: error.message };
  }

  await admin
    .from("support_threads")
    .update({ last_message_at: nowIso, updated_at: nowIso, status: "open" })
    .eq("id", thread.id);

  await notifyAdmins(admin, {
    threadId: thread.id,
    senderLabel: me.name ?? me.email,
    senderRole: me.role,
    bodyPreview: trimmed,
  });

  revalidatePath(`/client/cases/${caseId}/pch`);
  revalidatePath(`/accountant/cases/${caseId}/pch`);
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${thread.id}`);
  return { ok: true };
}

// -------------------------------------------------------------------
// Admin-side: list, read, reply, resolve, reopen
// -------------------------------------------------------------------

export async function listSupportThreadsAction(
  status: "open" | "resolved" | "all" = "open",
): Promise<ActionResult<{ threads: SupportThreadListItem[] }>> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();
    let q = admin
      .from("support_threads")
      .select("id, case_id, user_id, user_role, status, assigned_admin_id, last_message_at, created_at")
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (status !== "all") q = q.eq("status", status);
    const { data: rows, error } = await q;
    if (error) return { ok: false, error: error.message };
    const list = (rows ?? []) as Array<{
      id: string; case_id: string; user_id: string;
      user_role: "client" | "accountant";
      status: "open" | "resolved"; assigned_admin_id: string | null;
      last_message_at: string | null; created_at: string;
    }>;
    if (list.length === 0) return { ok: true, threads: [] };

    const userIds = Array.from(new Set(list.map((t) => t.user_id)));
    const { data: users } = await admin
      .from("users")
      .select("id, email")
      .in("id", userIds);
    const labelById = new Map(
      (users ?? []).map((u) => [u.id as string, u.email as string]),
    );

    const { data: previews } = await admin
      .from("support_messages")
      .select("thread_id, body, created_at")
      .in("thread_id", list.map((t) => t.id))
      .order("created_at", { ascending: false });
    const previewByThread = new Map<string, string>();
    for (const p of previews ?? []) {
      const tid = p.thread_id as string;
      if (!previewByThread.has(tid)) {
        previewByThread.set(tid, (p.body as string).slice(0, 160));
      }
    }

    return {
      ok: true,
      threads: list.map((t) => ({
        id: t.id,
        caseId: t.case_id,
        caseShortId: t.case_id.slice(0, 8),
        userId: t.user_id,
        userRole: t.user_role,
        userLabel: labelById.get(t.user_id) ?? t.user_id.slice(0, 8),
        status: t.status,
        lastMessageAt: t.last_message_at,
        lastMessagePreview: previewByThread.get(t.id) ?? null,
        assignedAdminId: t.assigned_admin_id,
        createdAt: t.created_at,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not list threads." };
  }
}

export async function getSupportThreadAction(
  threadId: string,
): Promise<ActionResult<{ thread: SupportThreadView; userLabel: string; caseShortId: string }>> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();
    const { data: thread } = await admin
      .from("support_threads")
      .select("id, case_id, user_id, user_role, status, assigned_admin_id, last_message_at, created_at")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread) return { ok: false, error: "Thread not found." };
    const messages = await loadThreadMessages(admin, thread.id);
    const { data: user } = await admin
      .from("users")
      .select("email")
      .eq("id", thread.user_id)
      .maybeSingle();
    const label = user?.email ?? thread.user_id.slice(0, 8);
    return {
      ok: true,
      thread: shapeThread(thread, messages),
      userLabel: label,
      caseShortId: thread.case_id.slice(0, 8),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load thread." };
  }
}

export async function sendAdminSupportReplyAction(
  threadId: string,
  formData: FormData,
): Promise<ActionResult> {
  const body = formData.get("body");
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (trimmed.length === 0) return { ok: false, error: "Write a message first." };
  if (trimmed.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Message is too long (max ${MAX_BODY_LENGTH} characters).` };
  }

  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Max ${MAX_ATTACHMENTS} attachments per message.` };
  }
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return { ok: false, error: `"${f.name}" is over 50 MB. Shrink the file and retry.` };
    }
    const typeLower = (f.type || "").toLowerCase();
    const nameLower = f.name.toLowerCase();
    if (!ALLOWED_MIME.has(typeLower) && !ALLOWED_EXT_RE.test(nameLower)) {
      return {
        ok: false,
        error: `"${f.name}": only PDF, images (JPG/PNG/HEIC/WebP), CSV or Excel allowed.`,
      };
    }
  }

  const me = await requireRole("admin");
  const admin = createAdminClient();
  const { data: thread } = await admin
    .from("support_threads")
    .select("id, case_id, user_id")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return { ok: false, error: "Thread not found." };

  const messageId = randomUUID();
  const uploaded: AttachmentRecord[] = [];
  try {
    for (const f of files) {
      const safeName = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `support/${thread.id}/${messageId}/${Date.now()}_${safeName}`;
      const buf = new Uint8Array(await f.arrayBuffer());
      const { error: upErr } = await admin.storage
        .from("case-documents")
        .upload(path, buf, {
          contentType: f.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw new Error(`Attachment "${f.name}" failed to upload: ${upErr.message}`);
      uploaded.push({
        path, name: f.name, mime: f.type || "application/octet-stream", size_bytes: f.size,
      });
    }
  } catch (e) {
    if (uploaded.length > 0) {
      await admin.storage.from("case-documents").remove(uploaded.map((u) => u.path));
    }
    return { ok: false, error: e instanceof Error ? e.message : "Attachment upload failed." };
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin.from("support_messages").insert({
    id: messageId,
    thread_id: thread.id,
    author_id: me.id,
    author_role: "admin",
    body: trimmed,
    attachments: uploaded.length > 0 ? uploaded : null,
  });
  if (error) {
    if (uploaded.length > 0) {
      await admin.storage.from("case-documents").remove(uploaded.map((u) => u.path));
    }
    return { ok: false, error: error.message };
  }

  await admin
    .from("support_threads")
    .update({
      last_message_at: nowIso,
      updated_at: nowIso,
      assigned_admin_id: me.id,
    })
    .eq("id", thread.id);

  await admin.from("notifications").insert({
    recipient_id: thread.user_id,
    type: "new_support_message",
    message: "Support replied to your message.",
  });

  revalidatePath(`/client/cases/${thread.case_id}/pch`);
  revalidatePath(`/accountant/cases/${thread.case_id}/pch`);
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${thread.id}`);
  return { ok: true };
}

export async function markSupportThreadResolvedAction(
  threadId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();
    const { data: thread } = await admin
      .from("support_threads")
      .select("case_id")
      .eq("id", threadId)
      .maybeSingle();
    const { error } = await admin
      .from("support_threads")
      .update({ status: "resolved", updated_at: new Date().toISOString() })
      .eq("id", threadId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/support");
    revalidatePath(`/admin/support/${threadId}`);
    if (thread?.case_id) {
      revalidatePath(`/client/cases/${thread.case_id}/pch`);
      revalidatePath(`/accountant/cases/${thread.case_id}/pch`);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not mark resolved." };
  }
}

export async function reopenSupportThreadAction(
  threadId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();
    const { data: thread } = await admin
      .from("support_threads")
      .select("case_id")
      .eq("id", threadId)
      .maybeSingle();
    const { error } = await admin
      .from("support_threads")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .eq("id", threadId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/support");
    revalidatePath(`/admin/support/${threadId}`);
    if (thread?.case_id) {
      revalidatePath(`/client/cases/${thread.case_id}/pch`);
      revalidatePath(`/accountant/cases/${thread.case_id}/pch`);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reopen thread." };
  }
}

export async function getSupportMessageAttachmentUrlAction(
  messageId: string,
  path: string,
): Promise<ActionResult<{ url: string }>> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Sign in first." };
  const admin = createAdminClient();
  const { data: msg } = await admin
    .from("support_messages")
    .select("thread_id, attachments")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return { ok: false, error: "Message not found." };

  if (me.role !== "admin") {
    const { data: thread } = await admin
      .from("support_threads")
      .select("user_id")
      .eq("id", msg.thread_id)
      .maybeSingle();
    if (!thread || thread.user_id !== me.id) {
      return { ok: false, error: "Not your thread." };
    }
  }

  const list = (msg.attachments ?? []) as AttachmentRecord[];
  const match = list.find((a) => a.path === path);
  if (!match) return { ok: false, error: "Attachment not found on this message." };

  const { data: signed, error } = await admin.storage
    .from("case-documents")
    .createSignedUrl(path, 60);
  if (error || !signed) {
    return { ok: false, error: error?.message ?? "Could not sign the URL." };
  }
  return { ok: true, url: signed.signedUrl };
}

// -------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------

async function notifyAdmins(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    threadId: string;
    senderLabel: string;
    senderRole: "client" | "accountant";
    bodyPreview: string;
  },
) {
  const { data: admins } = await admin
    .from("users")
    .select("id")
    .eq("role", "admin");
  if (!admins || admins.length === 0) return;
  const preview = args.bodyPreview.length > 120
    ? args.bodyPreview.slice(0, 117) + "..."
    : args.bodyPreview;
  const message = `New support message from ${args.senderLabel} (${args.senderRole}): ${preview}`;
  const rows = admins.map((a) => ({
    recipient_id: a.id as string,
    type: "new_support_message" as const,
    message,
  }));
  await admin.from("notifications").insert(rows);
}
