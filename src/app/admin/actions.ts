"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "case-documents";

// -------------------------------------------------------------------------
// Approve or reject a pending accountant.
// -------------------------------------------------------------------------
export async function setAccountantApprovalAction(
  accountantId: string,
  decision: "approved" | "rejected",
  note: string | null,
) {
  const me = await requireRole("admin");
  const admin = createAdminClient();

  const { error: updateErr } = await admin
    .from("accountant_profiles")
    .update({ approval_status: decision })
    .eq("user_id", accountantId);
  if (updateErr) throw new Error(updateErr.message);

  await admin.from("admin_actions").insert({
    target_user_id: accountantId,
    admin_id: me.id,
    action: decision === "approved" ? "approve_accountant" : "reject_accountant",
    note: note?.trim() || null,
  });

  revalidatePath("/admin/accountants");
  revalidatePath(`/admin/accountants/${accountantId}`);
  revalidatePath("/admin");
}

// -------------------------------------------------------------------------
// Create a new admin account (only callable by an existing admin).
// -------------------------------------------------------------------------
export async function createAdminAction(input: {
  name: string;
  email: string;
  password: string;
}) {
  await requireRole("admin");
  const admin = createAdminClient();
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name || !email) throw new Error("Name and email are required.");
  if (input.password.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { role: "admin", name },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Failed to create user.");

  // Trigger created a users row with role='admin' (from metadata) but no
  // client_profiles / accountant_profiles row — that's what we want.
  revalidatePath("/admin/admins");
  return data.user.id;
}

// -------------------------------------------------------------------------
// Reassign a case to a different (or first) accountant.
// -------------------------------------------------------------------------
export async function reassignCaseAction(
  caseId: string,
  newAccountantId: string,
  note: string | null,
) {
  const me = await requireRole("admin");
  const supabase = await createClient();

  const { data: current, error: fetchErr } = await supabase
    .from("cases")
    .select("id, accountant_id, status")
    .eq("id", caseId)
    .single();
  if (fetchErr || !current) throw new Error("Case not found.");

  const prevAccountantId = current.accountant_id;
  const nextStatus =
    current.status === "draft" || current.status === "submitted"
      ? "in_review"
      : current.status;

  const { error: updateErr } = await supabase
    .from("cases")
    .update({
      accountant_id: newAccountantId,
      status: nextStatus,
    })
    .eq("id", caseId);
  if (updateErr) throw new Error(updateErr.message);

  // Log to admin_actions for both the old and new accountant.
  const rows: Array<{
    target_user_id: string;
    admin_id: string;
    action: "warning";
    note: string;
  }> = [];
  const reason = note?.trim() ? `. ${note.trim()}` : "";
  if (prevAccountantId && prevAccountantId !== newAccountantId) {
    rows.push({
      target_user_id: prevAccountantId,
      admin_id: me.id,
      action: "warning",
      note: `Case ${caseId} reassigned to another accountant${reason}`,
    });
  }
  if (newAccountantId !== prevAccountantId) {
    rows.push({
      target_user_id: newAccountantId,
      admin_id: me.id,
      action: "warning",
      note: `Case ${caseId} assigned to you${reason}`,
    });
  }
  if (rows.length) {
    await supabase.from("admin_actions").insert(rows);
  }

  revalidatePath(`/admin/cases/${caseId}`);
  revalidatePath(`/admin`);
  revalidatePath(`/accountant`);
}

// -------------------------------------------------------------------------
// Mark a withdrawal as paid + upload receipt.
// Receipt goes to case-documents/receipts/{requestId}/... via admin client
// (server-only, no RLS complexity for a rarely-used bucket subfolder).
// -------------------------------------------------------------------------
export async function markWithdrawalPaidAction(
  requestId: string,
  formData: FormData,
) {
  await requireRole("admin");
  const supabase = await createClient();
  const admin = createAdminClient();

  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A receipt is required.");
  }
  const MAX = 25 * 1024 * 1024;
  if (file.size > MAX) throw new Error("Receipt is over 25 MB.");

  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `receipts/${requestId}/${Date.now()}_${safe}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  const { error: rpcErr } = await supabase.rpc("mark_withdrawal_paid", {
    p_request_id: requestId,
    p_receipt_path: path,
  });
  if (rpcErr) {
    // best-effort cleanup
    await admin.storage.from(BUCKET).remove([path]);
    throw new Error(rpcErr.message);
  }

  revalidatePath(`/admin/withdrawals`);
  revalidatePath(`/accountant/wallet`);
}

// Signed URL for a receipt file. Callable by admin OR the owning accountant.
// The path always has the shape "receipts/{withdrawal_id}/..." — we look up
// the withdrawal and verify caller access before minting the URL.
export async function getReceiptSignedUrl(path: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const parts = path.split("/");
  if (parts[0] !== "receipts" || parts.length < 3) {
    throw new Error("Not a receipt path.");
  }
  const requestId = parts[1];

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("withdrawal_requests")
    .select("accountant_id")
    .eq("id", requestId)
    .single();
  if (!req) throw new Error("Withdrawal not found.");

  const { data: me } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = me?.role === "admin";
  const isOwner = req.accountant_id === user.id;
  if (!isAdmin && !isOwner) throw new Error("Not allowed.");

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (error || !data) throw new Error(error?.message ?? "Sign URL failed.");
  return data.signedUrl;
}
