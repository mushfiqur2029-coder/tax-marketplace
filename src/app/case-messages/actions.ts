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
//
// Phase 7 Slice 7.2: accepts up to 5 file attachments per message.
// Payload shape is FormData so files can ride alongside the body
// without a separate upload round-trip. Files land under the
// case-documents bucket at {case_id}/messages/{msg_id}/{filename};
// a jsonb array of {path, name, mime, size_bytes} is written onto
// the message row so renderers can show chips without a join.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCaseMessageNotification } from "@/lib/case/message-email";

type ActionResult = { ok: true } | { ok: false; error: string };
type SignedUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const MAX_BODY_LENGTH = 4000;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file, mirrors uploadPchDocumentAction

// Allowed mimetypes for case-message attachments. Union of PCH-14 (bank
// statement) and PCH-24 (photo ID) accept lists plus the handful of
// office formats the accountant workflow commonly needs. HEIC allowed
// here because the attachment doesn't go through the Claude vision
// parser; the receiver just downloads it.
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

type AttachmentRecord = {
  path: string;
  name: string;
  mime: string;
  size_bytes: number;
};

// --- Case-ownership guard, shared by send + signed-URL actions. -----
async function requireCaseAccess(
  caseId: string,
): Promise<
  | { ok: true; me: Awaited<ReturnType<typeof getCurrentUser>> & object; authorRole: "client" | "accountant" | "admin"; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; error: string }
> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Sign in first." };
  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select("id, client_id, accountant_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return { ok: false, error: "Case not found." };
  let authorRole: "client" | "accountant" | "admin";
  if (caseRow.client_id === me.id) authorRole = "client";
  else if (caseRow.accountant_id === me.id) authorRole = "accountant";
  else if (me.role === "admin") authorRole = "admin";
  else return { ok: false, error: "You do not have access to this case." };
  return { ok: true, me, authorRole, admin };
}

export async function sendCaseMessageAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResult> {
  const body = formData.get("body");
  const trimmed = typeof body === "string" ? body.trim() : "";

  // Validate body text up-front so an empty body + files combo doesn't
  // sneak through. The composer can send either a text-only message
  // (no files entry) or a message with text + attachments; the
  // "attachments only, no body" case is rejected because every
  // compliance review flagged "mystery attachment, no note" as a
  // readability issue.
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
    const typeOk = ALLOWED_MIME.has(typeLower);
    const extOk = ALLOWED_EXT_RE.test(nameLower);
    if (!typeOk && !extOk) {
      return {
        ok: false,
        error:
          `"${f.name}": only PDF, images (JPG/PNG/HEIC/WebP), CSV or Excel allowed as attachments.`,
      };
    }
  }

  const guard = await requireCaseAccess(caseId);
  if (!guard.ok) return guard;
  const { me, authorRole, admin } = guard;

  // Generate the message id up front so file paths are stable before
  // the DB insert. If any file upload fails we try to clean up every
  // path we created so storage doesn't accumulate orphans.
  const messageId = randomUUID();
  const uploaded: AttachmentRecord[] = [];
  try {
    for (const f of files) {
      const safeName = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${caseId}/messages/${messageId}/${Date.now()}_${safeName}`;
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
    // Best-effort cleanup of anything we did manage to upload.
    if (uploaded.length > 0) {
      await admin.storage.from("case-documents").remove(uploaded.map((u) => u.path));
    }
    return { ok: false, error: e instanceof Error ? e.message : "Attachment upload failed." };
  }

  const { error } = await admin.from("case_messages").insert({
    id: messageId,
    case_id: caseId,
    author_id: me?.id,
    author_role: authorRole,
    body: trimmed,
    attachments: uploaded.length > 0 ? uploaded : null,
  });
  if (error) {
    // Message insert failed after files uploaded; clean up storage so
    // the orphaned blobs don't sit under the case forever.
    if (uploaded.length > 0) {
      await admin.storage.from("case-documents").remove(uploaded.map((u) => u.path));
    }
    return { ok: false, error: error.message };
  }

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

// Mint a short-lived signed URL for a message attachment. Guards:
//   - caller must have case access (requireCaseAccess, same as send)
//   - path must appear in that message's attachments array (prevents
//     URL enumeration across other messages / cases)
export async function getCaseMessageAttachmentUrlAction(
  messageId: string,
  path: string,
): Promise<SignedUrlResult> {
  const admin = createAdminClient();
  const { data: msg } = await admin
    .from("case_messages")
    .select("case_id, attachments")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return { ok: false, error: "Message not found." };

  const guard = await requireCaseAccess(msg.case_id);
  if (!guard.ok) return { ok: false, error: guard.error };

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
