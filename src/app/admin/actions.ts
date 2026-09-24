"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertWithdrawalPaidNotification,
  insertReassignmentNotifications,
  insertAccountantApprovalNotification,
} from "@/lib/notifications";
import { type ActionResult, fail } from "@/lib/action-result";

export type { ActionResult };

const BUCKET = "case-documents";

// -------------------------------------------------------------------------
// Toggle a client's account status. Suspended clients stay signed-in and
// keep read-only access to their existing cases, but assertActiveClient in
// src/app/client/actions.ts blocks mutating server actions (createCase,
// startCheckout, approveAndFile).
// -------------------------------------------------------------------------
export async function setClientStatusAction(
  clientId: string,
  status: "active" | "suspended",
  note: string | null,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    const admin = createAdminClient();

    const { data: target } = await admin
      .from("users")
      .select("id, role")
      .eq("id", clientId)
      .single();
    if (!target || target.role !== "client") {
      throw new Error("That user isn't a client.");
    }

    const { error: updateErr } = await admin
      .from("users")
      .update({ status })
      .eq("id", clientId);
    if (updateErr) throw new Error(updateErr.message);

    await admin.from("admin_actions").insert({
      target_user_id: clientId,
      admin_id: me.id,
      action: status === "suspended" ? "suspend" : "reinstate",
      note: note?.trim() || null,
    });

    revalidatePath("/admin/clients");
    revalidatePath(`/admin/clients/${clientId}`);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Toggle an accountant's account status. Suspended accountants stay
// signed-in and keep read-only access to their assigned cases, but the
// accountant/actions.ts guards block takeCaseAction and
// updateCaseStatusAction. Approval status (accountant_profiles.approval_status)
// is a separate axis and is unchanged here.
// -------------------------------------------------------------------------
export async function setAccountantStatusAction(
  accountantId: string,
  status: "active" | "suspended",
  note: string | null,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    const admin = createAdminClient();

    const { data: target } = await admin
      .from("users")
      .select("id, role")
      .eq("id", accountantId)
      .single();
    if (!target || target.role !== "accountant") {
      throw new Error("That user isn't an accountant.");
    }

    const { error: updateErr } = await admin
      .from("users")
      .update({ status })
      .eq("id", accountantId);
    if (updateErr) throw new Error(updateErr.message);

    await admin.from("admin_actions").insert({
      target_user_id: accountantId,
      admin_id: me.id,
      action: status === "suspended" ? "suspend" : "reinstate",
      note: note?.trim() || null,
    });

    revalidatePath("/admin/accountants");
    revalidatePath(`/admin/accountants/${accountantId}`);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Approve or reject a pending accountant.
// -------------------------------------------------------------------------
export async function setAccountantApprovalAction(
  accountantId: string,
  decision: "approved" | "rejected",
  note: string | null,
): Promise<ActionResult> {
  try {
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

    await insertAccountantApprovalNotification({
      accountantId,
      decision,
      note,
    });

    revalidatePath("/admin/accountants");
    revalidatePath(`/admin/accountants/${accountantId}`);
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Create a new admin account (only callable by an existing admin).
// -------------------------------------------------------------------------
export async function createAdminAction(input: {
  name: string;
  email: string;
  password: string;
}): Promise<ActionResult<string>> {
  try {
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

    revalidatePath("/admin/admins");
    return { ok: true, data: data.user.id };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Reassign a case to a different (or first) accountant.
// -------------------------------------------------------------------------
export async function reassignCaseAction(
  caseId: string,
  newAccountantId: string,
  note: string | null,
): Promise<ActionResult> {
  try {
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

  await insertReassignmentNotifications({
    caseId,
    prevAccountantId,
    newAccountantId,
    note,
  });

  revalidatePath(`/admin/cases/${caseId}`);
  revalidatePath(`/admin`);
  revalidatePath(`/accountant`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Mark a withdrawal as paid + upload receipt.
// Receipt goes to case-documents/receipts/{requestId}/... via admin client
// (server-only, no RLS complexity for a rarely-used bucket subfolder).
// -------------------------------------------------------------------------
export async function markWithdrawalPaidAction(
  requestId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
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

  // Notify the accountant whose withdrawal was just paid.
  const { data: req } = await admin
    .from("withdrawal_requests")
    .select("accountant_id, amount_pence")
    .eq("id", requestId)
    .single();
  if (req) {
    await insertWithdrawalPaidNotification({
      accountantId: req.accountant_id,
      amountPence: req.amount_pence,
    });
  }

  revalidatePath(`/admin/withdrawals`);
  revalidatePath(`/accountant/wallet`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Signed URL for a receipt file. Callable by admin OR the owning accountant.
// The path always has the shape "receipts/{withdrawal_id}/..." — we look up
// the withdrawal and verify caller access before minting the URL.
export async function getReceiptSignedUrl(
  path: string,
): Promise<ActionResult<string>> {
  try {
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
    return { ok: true, data: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}
