"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fail } from "@/lib/action-result";

export type { ActionResult };

const BUCKET = "case-documents";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type MessageChannel =
  | "client_accountant"
  | "client_admin"
  | "accountant_admin";

export type ChatMessageRow = {
  id: string;
  case_id: string;
  channel: MessageChannel;
  sender_id: string;
  body: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
};

export type AttachmentUpload = {
  path: string;
  name: string;
  type: string;
};

// Send a text (and optional attachment) message on a channel.
// RLS enforces that the sender is actually a party to the channel.
export async function sendMessageAction(input: {
  caseId: string;
  channel: MessageChannel;
  body: string;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
}): Promise<ActionResult<ChatMessageRow>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const body = input.body.trim();
    if (!body && !input.attachmentPath) {
      throw new Error("Message can't be empty.");
    }
    if (body.length > 4000) throw new Error("Message is too long.");

    const { data, error } = await supabase
      .from("messages")
      .insert({
        case_id: input.caseId,
        channel: input.channel,
        sender_id: user.id,
        body,
        attachment_path: input.attachmentPath ?? null,
        attachment_name: input.attachmentName ?? null,
        attachment_type: input.attachmentType ?? null,
      })
      .select(
        "id, case_id, channel, sender_id, body, attachment_path, attachment_name, attachment_type, created_at",
      )
      .single();
    if (error) throw new Error(error.message);

    revalidatePath(`/client/cases/${input.caseId}`);
    revalidatePath(`/accountant/cases/${input.caseId}`);
    revalidatePath(`/admin/cases/${input.caseId}`);
    return { ok: true, data: data as ChatMessageRow };
  } catch (e) {
    return fail(e);
  }
}

// Upload an attachment for a chat message. Returns the storage path so the
// client can immediately post the message row referencing it.
export async function uploadMessageAttachmentAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResult<AttachmentUpload>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("No file provided.");
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("File is over 25 MB.");
    }

    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${caseId}/msg/${Date.now()}_${safe}`;

    const buf = new Uint8Array(await file.arrayBuffer());
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (error) throw new Error(error.message);

    return {
      ok: true,
      data: {
        path,
        name: file.name,
        type: file.type || "application/octet-stream",
      },
    };
  } catch (e) {
    return fail(e);
  }
}

// Signed URL for downloading a chat attachment (any case party can request).
export async function getMessageAttachmentSignedUrl(
  filePath: string,
): Promise<ActionResult<string>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 60);
    if (error || !data) throw new Error(error?.message ?? "Sign URL failed.");
    return { ok: true, data: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}
