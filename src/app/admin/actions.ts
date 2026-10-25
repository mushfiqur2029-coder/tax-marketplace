"use server";

import { revalidatePath } from "next/cache";
import { requireRole, PRIMARY_ADMIN_EMAIL } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertWithdrawalPaidNotification,
  insertReassignmentNotifications,
  insertAccountantApprovalNotification,
  insertAddonReadyToPayNotification,
  insertAddonReviewDecisionNotification,
  insertCaseCreatedAdminNotification,
  insertEnquiryQuotedNotification,
} from "@/lib/notifications";
import { type ActionResult, fail } from "@/lib/action-result";
import {
  getTier,
  updateServiceCatalogRow,
  type ServiceCatalogPatch,
} from "@/lib/service-catalog";
import type {
  ClientDeletionCheck,
  AccountantDeletionCheck,
} from "./account-deletion-types";
import { STALE_DRAFT_DAYS } from "./constants";

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
// Permanent admin removal. Primary-admin-only. Deletes the auth user,
// which cascades through public.users → admin_profiles + notifications
// + pending_profile_changes; admin_actions.admin_id gets SET NULL so
// the audit trail survives the admin leaving (migration 0056 relaxed
// those cascades).
//
// Guards in order:
//   1. Caller must be the primary admin (isPrimaryAdmin).
//   2. Target must exist and be role=admin.
//   3. Target must NOT be the primary admin.
//   4. DB trigger protect_primary_admin_trg is the final defense if
//      any of the above are bypassed.
//
// Belt and braces: log the admin_actions row BEFORE the delete so the
// target_user_id captures their id before the FK gets nulled, and so
// the log survives if something later in the function throws.
// -------------------------------------------------------------------------
export async function removeAdminAction(
  targetUserId: string,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    if (me.email.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
      throw new Error("Only the primary admin can remove other admins.");
    }
    const admin = createAdminClient();

    const { data: target, error: targetErr } = await admin
      .from("users")
      .select("id, email, role")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetErr || !target) throw new Error("Admin not found.");
    if (target.role !== "admin") throw new Error("User is not an admin.");
    if (target.email.toLowerCase() === PRIMARY_ADMIN_EMAIL) {
      throw new Error("Primary admin cannot be removed.");
    }
    if (target.id === me.id) {
      // Caller is primary admin, target is primary admin → already blocked
      // above. This belt-and-braces path catches an attempt to self-
      // remove via a crafted request where target != primary (which
      // shouldn't be possible, but costs nothing to guard).
      throw new Error("Admins cannot remove themselves.");
    }

    // Audit log BEFORE delete so the target id is captured.
    await admin.from("admin_actions").insert({
      target_user_id: target.id,
      admin_id: me.id,
      action: "admin_removed",
      note: `Removed admin ${target.email}.`,
    });

    // Delete at the auth layer; cascades through public.users via
    // auth.users's ON DELETE CASCADE.
    const { error: delErr } = await admin.auth.admin.deleteUser(target.id);
    if (delErr) throw new Error(delErr.message);

    revalidatePath("/admin/admins");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Permanent account deletion (client or accountant). Primary-admin only.
//
// Hard-blocked when the account has any financial / audit significance.
// For a client: any case with stripe_payment_status='succeeded'.
// For an accountant: any wallet_transactions row, withdrawal_requests
// row, case_addons row they issued, or vat_return_cycles row they
// created. The soft "warn and allow anyway" path is intentionally
// NOT available, once the row count on the ledger is non-zero,
// admin is directed to Suspend instead (which keeps every row intact
// and immediately blocks the user from acting).
//
// Case documents the user uploaded (either as client-on-own-case or
// accountant-on-assigned-case) are kept by the uploaded_by SET NULL
// path from migration 0060 when the case survives (accountant delete
// paths). When the case cascade-deletes (client path), the storage
// files are explicitly removed before auth.admin.deleteUser fires.
// Audit log goes in BEFORE the delete so admin_actions.target_user_id
// is captured before the FK gets nulled.

// Shapes returned by the pre-check helpers below live in
// account-deletion-types.ts. Next's "use server" directive on this
// file forbids any non-async-function export, so `export type` here
// would make Turbopack reject the entire module.

export async function getClientDeletionCheck(
  clientId: string,
): Promise<ClientDeletionCheck> {
  const admin = createAdminClient();
  const [cases, docs, bookings, enquiries] = await Promise.all([
    admin
      .from("cases")
      .select("id, stripe_payment_status", { count: "exact" })
      .eq("client_id", clientId),
    admin
      .from("case_documents")
      .select("id", { count: "exact", head: true })
      .eq("uploaded_by", clientId),
    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
    admin
      .from("service_enquiries")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId),
  ]);
  const rows = cases.data ?? [];
  const paidCases = rows.filter(
    (c) => c.stripe_payment_status === "succeeded",
  ).length;
  const draftCases = rows.filter(
    (c) => c.stripe_payment_status !== "succeeded",
  ).length;
  const blocked = paidCases > 0;
  return {
    blocked,
    blockReason: blocked
      ? `This client has ${paidCases} paid case${paidCases === 1 ? "" : "s"} on record. Suspend the account instead; permanent deletion would erase that payment history.`
      : null,
    paidCases,
    draftCases,
    totalCases: rows.length,
    documents: docs.count ?? 0,
    bookings: bookings.count ?? 0,
    enquiries: enquiries.count ?? 0,
  };
}

export async function getAccountantDeletionCheck(
  accountantId: string,
): Promise<AccountantDeletionCheck> {
  const admin = createAdminClient();
  const [
    walletTx,
    withdrawals,
    addons,
    vatCycles,
    docs,
    liveCases,
  ] = await Promise.all([
    admin
      .from("wallet_transactions")
      .select("amount_pence", { count: "exact" })
      .eq("accountant_id", accountantId),
    admin
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("accountant_id", accountantId),
    admin
      .from("case_addons")
      .select("id", { count: "exact", head: true })
      .eq("accountant_id", accountantId),
    admin
      .from("vat_return_cycles")
      .select("id", { count: "exact", head: true })
      .eq("created_by", accountantId),
    admin
      .from("case_documents")
      .select("id", { count: "exact", head: true })
      .eq("uploaded_by", accountantId),
    admin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("accountant_id", accountantId)
      .neq("status", "complete"),
  ]);
  const txRows = walletTx.data ?? [];
  const walletBalancePence = txRows.reduce(
    (sum, r) => sum + (r.amount_pence ?? 0),
    0,
  );
  const blockers: string[] = [];
  if ((walletTx.count ?? 0) > 0) {
    blockers.push(
      `${walletTx.count} wallet transaction${walletTx.count === 1 ? "" : "s"}`,
    );
  }
  if ((withdrawals.count ?? 0) > 0) {
    blockers.push(
      `${withdrawals.count} withdrawal request${withdrawals.count === 1 ? "" : "s"}`,
    );
  }
  if ((addons.count ?? 0) > 0) {
    blockers.push(
      `${addons.count} add-on${addons.count === 1 ? "" : "s"} issued`,
    );
  }
  if ((vatCycles.count ?? 0) > 0) {
    blockers.push(
      `${vatCycles.count} VAT cycle${vatCycles.count === 1 ? "" : "s"} created`,
    );
  }
  const blocked = blockers.length > 0;
  return {
    blocked,
    blockReason: blocked
      ? `This accountant has ${blockers.join(", ")} on record. Suspend the account instead; permanent deletion would erase that financial / audit history.`
      : null,
    walletTransactions: walletTx.count ?? 0,
    walletBalancePence,
    withdrawalRequests: withdrawals.count ?? 0,
    addonsIssued: addons.count ?? 0,
    vatCyclesCreated: vatCycles.count ?? 0,
    documentsUploaded: docs.count ?? 0,
    assignedLiveCases: liveCases.count ?? 0,
  };
}

export async function deleteClientAccountAction(
  targetUserId: string,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    if (me.email.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
      throw new Error(
        "Only the primary admin can permanently delete accounts.",
      );
    }
    const admin = createAdminClient();

    const { data: target, error: targetErr } = await admin
      .from("users")
      .select("id, email, role")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetErr || !target) throw new Error("User not found.");
    if (target.role !== "client") {
      throw new Error("That user is not a client.");
    }
    if (target.id === me.id) {
      throw new Error("Cannot delete yourself.");
    }

    // Re-run the pre-check on the server. The UI gates by the same
    // call but a crafted request could reach here directly.
    const check = await getClientDeletionCheck(targetUserId);
    if (check.blocked) {
      throw new Error(check.blockReason ?? "Deletion is blocked.");
    }

    // Collect every storage path the client's cases carry. The case
    // row cascade will drop case_documents + case_addons + messages
    // + notifications, but Supabase storage files are not FK-linked
    // and need an explicit remove. Non-fatal on failure.
    const { data: caseRows } = await admin
      .from("cases")
      .select("id")
      .eq("client_id", targetUserId);
    const caseIds = (caseRows ?? []).map((c) => c.id);
    const { data: docRows } =
      caseIds.length > 0
        ? await admin
            .from("case_documents")
            .select("file_url")
            .in("case_id", caseIds)
        : { data: [] as { file_url: string }[] };
    const storagePaths = (docRows ?? [])
      .map((d) => d.file_url)
      .filter((p): p is string => !!p);

    // Audit BEFORE delete. target_user_id survives because of the
    // SET NULL relaxation migration 0056 put in place.
    await admin.from("admin_actions").insert({
      target_user_id: target.id,
      admin_id: me.id,
      action: "account_deleted",
      note: `Deleted client ${target.email} (${caseIds.length} case(s), ${check.draftCases} draft, ${check.documents} documents, ${check.bookings} booking(s), ${check.enquiries} enquiry(ies)).`,
    });

    // Auth-layer delete cascades through public.users → everything.
    const { error: delErr } = await admin.auth.admin.deleteUser(target.id);
    if (delErr) throw new Error(delErr.message);

    if (storagePaths.length > 0) {
      const { error: storageErr } = await admin.storage
        .from(BUCKET)
        .remove(storagePaths);
      if (storageErr) {
        console.error(
          `[deleteClientAccount] storage remove failed for user=${target.id}:`,
          storageErr.message,
        );
      }
    }

    revalidatePath("/admin/clients");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccountantAccountAction(
  targetUserId: string,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    if (me.email.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
      throw new Error(
        "Only the primary admin can permanently delete accounts.",
      );
    }
    const admin = createAdminClient();

    const { data: target, error: targetErr } = await admin
      .from("users")
      .select("id, email, role")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetErr || !target) throw new Error("User not found.");
    if (target.role !== "accountant") {
      throw new Error("That user is not an accountant.");
    }
    if (target.id === me.id) {
      throw new Error("Cannot delete yourself.");
    }

    const check = await getAccountantDeletionCheck(targetUserId);
    if (check.blocked) {
      throw new Error(check.blockReason ?? "Deletion is blocked.");
    }

    // Case documents the accountant uploaded survive via SET NULL
    // (migration 0060), the DB row stays with uploaded_by=null,
    // the storage file is preserved. No storage cleanup needed on
    // this path. cases.accountant_id SET NULL (FK cascade) leaves the
    // cases themselves intact and unassigned, but the FK cascade only
    // touches accountant_id, not status: a case this accountant had
    // in in_review/prepared would otherwise sit accountant-less with
    // a stale status, invisible to the open queue (status='submitted'
    // filter) and still showing its old status pill. Reset those
    // first so they fall back into the queue as "Awaiting review"
    // once the FK cascade clears accountant_id.
    await admin
      .from("cases")
      .update({ status: "submitted" })
      .eq("accountant_id", targetUserId)
      .in("status", ["in_review", "prepared"]);

    await admin.from("admin_actions").insert({
      target_user_id: target.id,
      admin_id: me.id,
      action: "account_deleted",
      note: `Deleted accountant ${target.email} (${check.assignedLiveCases} assigned case(s) will become unassigned, ${check.documentsUploaded} uploaded document(s) preserved).`,
    });

    const { error: delErr } = await admin.auth.admin.deleteUser(target.id);
    if (delErr) throw new Error(delErr.message);

    revalidatePath("/admin/accountants");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Delete a stale, unpaid draft case. Primary-admin only.
//
// Eligibility (server-enforced, not just UI-filtered):
//   - case.status = 'draft'
//   - case.stripe_payment_status is NOT 'succeeded' (never fully paid;
//     an abandoned Stripe session that happened to flip succeeded then
//     was abandoned later would still be excluded)
//   - case.created_at < now() - 3 days
//
// Cleanup:
//   - case_documents rows CASCADE from cases, but the storage bucket
//     "case-documents" does NOT auto-delete the files. We explicitly
//     list every file_url for the case and remove them from storage
//     before dropping the DB row. If the delete fails we still drop
//     the row, orphaned storage objects are easier to clean up later
//     than a half-deleted DB state.
//
// Audit: logged to admin_actions with action='draft_case_deleted'
// BEFORE the delete, so the row survives even if the delete fails
// partway. Same belt-and-braces as the admin removal.
// -------------------------------------------------------------------------

// Threshold constant moved to ./constants so this "use server" file
// can keep its only-async-function-exports contract.

export async function deleteStaleDraftCaseAction(
  caseId: string,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    if (me.email.toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
      throw new Error(
        "Only the primary admin can delete stale draft cases.",
      );
    }
    const admin = createAdminClient();

    const { data: row, error: fetchErr } = await admin
      .from("cases")
      .select(
        "id, client_id, status, stripe_payment_status, created_at",
      )
      .eq("id", caseId)
      .maybeSingle();
    if (fetchErr || !row) throw new Error("Case not found.");

    if (row.status !== "draft") {
      throw new Error(
        "Only draft cases can be deleted here. Non-draft cases carry status + payment history.",
      );
    }
    if (row.stripe_payment_status === "succeeded") {
      throw new Error(
        "This draft shows a succeeded payment on record. Refusing to delete. Reconcile the payment first.",
      );
    }

    const createdMs = new Date(row.created_at).getTime();
    const ageDays = (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
    if (ageDays < STALE_DRAFT_DAYS) {
      throw new Error(
        `Draft is only ${ageDays.toFixed(1)} days old. Must be at least ${STALE_DRAFT_DAYS} days old before deletion.`,
      );
    }

    // Collect every storage path for this case so we can purge the
    // bucket after the DB cascade clears case_documents.
    const { data: docs } = await admin
      .from("case_documents")
      .select("file_url")
      .eq("case_id", caseId);
    const storagePaths = (docs ?? [])
      .map((d) => d.file_url)
      .filter((p): p is string => !!p);

    // Audit log BEFORE delete. target_user_id = the client who owned
    // the draft, so the admin_actions row still points to the right
    // user after the cases row vanishes.
    await admin.from("admin_actions").insert({
      target_user_id: row.client_id,
      admin_id: me.id,
      action: "draft_case_deleted",
      note: `Deleted stale draft case ${caseId} (age ${ageDays.toFixed(1)} days, ${storagePaths.length} file(s)).`,
    });

    // Delete the case row. CASCADE handles case_documents, case_addons,
    // messages, and anything else pointing at cases.id via a cascading
    // FK. Realtime fan-out keeps the admin dashboard refreshing.
    const { error: delErr } = await admin
      .from("cases")
      .delete()
      .eq("id", caseId);
    if (delErr) throw new Error(delErr.message);

    // Purge storage objects. Non-fatal: an orphaned file in a private
    // bucket costs pennies and is easy to clean up later; a failed
    // storage.remove must not undo the DB deletion we just logged.
    if (storagePaths.length > 0) {
      const { error: storageErr } = await admin.storage
        .from(BUCKET)
        .remove(storagePaths);
      if (storageErr) {
        console.error(
          `[deleteStaleDraftCase] storage remove failed for case=${caseId}:`,
          storageErr.message,
        );
      }
    }

    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Reassign a case to a different (or first) accountant.
// -------------------------------------------------------------------------
export async function reassignCaseAction(
  caseId: string,
  // null = clear the assignment and send the case back to the queue.
  // Any non-null value must correspond to an approved, not-suspended
  // accountant - checked below.
  newAccountantId: string | null,
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

  // When reassigning to a real accountant, re-check approval +
  // suspension server-side. The dropdown filters to approved +
  // not-suspended in the UI (see admin/cases/[id]/page.tsx), but a
  // crafted POST straight to this action could supply any user id.
  // null means "unassign to queue" which skips this check entirely.
  if (newAccountantId !== null) {
    const { data: targetAcc, error: targetErr } = await supabase
      .from("accountant_profiles")
      .select("user_id, approval_status, users!inner(id, status)")
      .eq("user_id", newAccountantId)
      .maybeSingle();
    if (targetErr) throw new Error(targetErr.message);
    if (!targetAcc) {
      throw new Error("That user isn't an accountant.");
    }
    if (targetAcc.approval_status !== "approved") {
      throw new Error(
        "Can't assign to a non-approved accountant. Approve them first.",
      );
    }
    const targetUser = (targetAcc as unknown as {
      users: { id: string; status: string };
    }).users;
    if (targetUser.status === "suspended") {
      throw new Error(
        "Can't assign to a suspended accountant. Lift the suspension first.",
      );
    }
  }

  // Historical behaviour promoted draft/submitted cases to in_review on
  // reassign, which was a workaround for the accountant dashboard not
  // surfacing admin-assigned cases in those statuses. The dashboard
  // now carries an "Assigned" bucket (see src/app/accountant/page.tsx)
  // that shows every case where accountant_id = me regardless of
  // status, so the status flip here is no longer needed, reassignment
  // is a pure assignment change, status transitions stay with the
  // accountant via updateCaseStatusAction.
  // Unassigning (back to the queue): a case sitting in in_review or
  // prepared implies an accountant was actively working it. Leaving
  // the status alone would strand the case, accountant_id null but
  // status past 'submitted', so it shows a stale status pill and
  // never resurfaces in the open queue (which filters on
  // status='submitted'). Reset to 'submitted' so it both re-queues
  // and reads "Awaiting review" via StatusPill. Advanced statuses
  // (client_approval/filed/complete) are left untouched, unassigning
  // at that stage is an edge case for admin judgement, not an
  // automatic requeue.
  const statusPatch: { accountant_id: string | null; status?: "submitted" } =
    { accountant_id: newAccountantId };
  if (
    newAccountantId === null &&
    (current.status === "in_review" || current.status === "prepared")
  ) {
    statusPatch.status = "submitted";
  }

  const { error: updateErr } = await supabase
    .from("cases")
    .update(statusPatch)
    .eq("id", caseId);
  if (updateErr) throw new Error(updateErr.message);

  // Log to admin_actions for both the old and new accountant. Both
  // rows carry action='case_reassigned' (0075) so the audit log can
  // be filtered by actual action type; the note text differentiates
  // "unassigned from you" vs "assigned to you".
  const rows: Array<{
    target_user_id: string;
    admin_id: string;
    action: "case_reassigned";
    note: string;
  }> = [];
  const reason = note?.trim() ? `. ${note.trim()}` : "";
  if (prevAccountantId && prevAccountantId !== newAccountantId) {
    rows.push({
      target_user_id: prevAccountantId,
      admin_id: me.id,
      action: "case_reassigned",
      note:
        newAccountantId === null
          ? `Case ${caseId} unassigned from you (returned to queue)${reason}`
          : `Case ${caseId} reassigned to another accountant${reason}`,
    });
  }
  // Only log an "assigned to you" row when there's an actual new
  // assignee. The unassign-to-queue path (newAccountantId === null)
  // writes only the "unassigned from you" row above.
  if (newAccountantId !== null && newAccountantId !== prevAccountantId) {
    rows.push({
      target_user_id: newAccountantId,
      admin_id: me.id,
      action: "case_reassigned",
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
// Admin editor for an accountant's legal identity (legal_name, trading_name,
// legal_company_number on accountant_profiles - migration 0074). These
// values flow into the engagement letter renderer: when any of them is
// null the letter falls back to Shann / NAFH / 12636834 hardcoded in the
// template, so leaving them unset is OK for legacy / early accounts.
// Each field is optional and trimmed-to-null; blank string clears it.
// -------------------------------------------------------------------------
export async function setAccountantLegalIdentityAction(
  accountantId: string,
  input: {
    legalName: string;
    tradingName: string;
    legalCompanyNumber: string;
  },
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();

    const normalize = (s: string) => (s.trim() ? s.trim() : null);
    const patch = {
      legal_name: normalize(input.legalName),
      trading_name: normalize(input.tradingName),
      legal_company_number: normalize(input.legalCompanyNumber),
    };

    const { error } = await admin
      .from("accountant_profiles")
      .update(patch)
      .eq("user_id", accountantId);
    if (error) throw new Error(error.message);

    revalidatePath(`/admin/accountants/${accountantId}`);
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
// Reveal the full account_number on a withdrawal request + log who
// did it. The admin page displays account_number masked to the last
// 4 digits by default (RevealBankButton); this action is called
// when the admin clicks Reveal. Each call writes an admin_actions
// row with action='withdrawal_bank_revealed' (migration 0073) so
// we have "who saw this and when". Admins only; service role role
// filter + the admin_actions insert fail closed on anything else.
export async function revealWithdrawalBankAction(
  requestId: string,
): Promise<ActionResult<{ accountName: string; sortCode: string; accountNumber: string }>> {
  try {
    const me = await requireRole("admin");
    const admin = createAdminClient();

    const { data: req, error } = await admin
      .from("withdrawal_requests")
      .select(
        "id, accountant_id, amount_pence, account_name, sort_code, account_number",
      )
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!req) throw new Error("Withdrawal request not found.");

    // Fire-and-forget would hide a failure to log, which is the
    // whole point here, so we DO wait on the insert. If audit
    // logging itself can't complete, the reveal doesn't happen -
    // same as the Company Authentication Code reveal flow's
    // fail-closed shape.
    const { error: logErr } = await admin.from("admin_actions").insert({
      target_user_id: req.accountant_id,
      admin_id: me.id,
      action: "withdrawal_bank_revealed",
      note: `Revealed bank details on withdrawal_request ${req.id} (£${(req.amount_pence / 100).toFixed(2)}).`,
    });
    if (logErr) throw new Error(`Audit log failed: ${logErr.message}`);

    return {
      ok: true,
      data: {
        accountName: req.account_name,
        sortCode: req.sort_code,
        accountNumber: req.account_number,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

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

// -------------------------------------------------------------------------
// Admin approve/reject for a custom add-on request.
//
// Approve flips pending_admin -> pending_payment, records the reviewer, and
// notifies both the client (add-on ready to pay) and the requesting
// accountant (approved, sent to client). Reject flips to 'rejected' and
// notifies only the accountant with the reason.
//
// Preset add-ons never reach this action, they short-circuit past admin
// review at insert time and go straight to pending_payment.
// -------------------------------------------------------------------------
export async function approveAddonAction(
  addonId: string,
  note: string | null,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    const admin = createAdminClient();

    const { data: row, error: rowErr } = await admin
      .from("case_addons")
      .select(
        "id, case_id, accountant_id, kind, status, amount_pence, description",
      )
      .eq("id", addonId)
      .single();
    if (rowErr || !row) throw new Error("Add-on not found.");
    if (row.kind !== "custom") {
      throw new Error("Only custom add-ons need admin review.");
    }
    if (row.status !== "pending_admin") {
      throw new Error(`Add-on is already ${row.status}, can't approve again.`);
    }

    const { error: updateErr } = await admin
      .from("case_addons")
      .update({
        status: "pending_payment",
        reviewed_at: new Date().toISOString(),
        reviewed_by: me.id,
        review_note: note?.trim() || null,
      })
      .eq("id", addonId)
      .eq("status", "pending_admin"); // race guard
    if (updateErr) throw new Error(updateErr.message);

    // Look up the client for the ready-to-pay notification.
    const { data: caseRow } = await admin
      .from("cases")
      .select("client_id")
      .eq("id", row.case_id)
      .single();
    if (caseRow?.client_id) {
      await insertAddonReadyToPayNotification({
        caseId: row.case_id,
        clientId: caseRow.client_id,
        amountPence: row.amount_pence,
        description: row.description,
      });
    }
    await insertAddonReviewDecisionNotification({
      caseId: row.case_id,
      accountantId: row.accountant_id,
      decision: "approved",
      amountPence: row.amount_pence,
      description: row.description,
      note: note?.trim() || null,
    });

    revalidatePath("/admin/addon-requests");
    revalidatePath(`/admin/cases/${row.case_id}`);
    revalidatePath(`/accountant/cases/${row.case_id}`);
    revalidatePath(`/client/cases/${row.case_id}`);
    revalidatePath(`/client`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function rejectAddonAction(
  addonId: string,
  note: string | null,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    const admin = createAdminClient();

    const { data: row, error: rowErr } = await admin
      .from("case_addons")
      .select(
        "id, case_id, accountant_id, kind, status, amount_pence, description",
      )
      .eq("id", addonId)
      .single();
    if (rowErr || !row) throw new Error("Add-on not found.");
    if (row.kind !== "custom") {
      throw new Error("Only custom add-ons need admin review.");
    }
    if (row.status !== "pending_admin") {
      throw new Error(`Add-on is already ${row.status}, can't reject.`);
    }

    const { error: updateErr } = await admin
      .from("case_addons")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: me.id,
        review_note: note?.trim() || null,
      })
      .eq("id", addonId)
      .eq("status", "pending_admin");
    if (updateErr) throw new Error(updateErr.message);

    await insertAddonReviewDecisionNotification({
      caseId: row.case_id,
      accountantId: row.accountant_id,
      decision: "rejected",
      amountPence: row.amount_pence,
      description: row.description,
      note: note?.trim() || null,
    });

    revalidatePath("/admin/addon-requests");
    revalidatePath(`/admin/cases/${row.case_id}`);
    revalidatePath(`/accountant/cases/${row.case_id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Add-on catalog CRUD. `key` is the stable PK referenced by case_addons.
// preset_key snapshots, once created, the key cannot change. Name, price,
// description, and active are editable at will; edits do not retroactively
// rewrite existing case_addons rows (they snapshot at creation).
// -------------------------------------------------------------------------
export async function createAddonCatalogAction(input: {
  key: string;
  name: string;
  description: string;
  amountPence: number;
}): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();

    const key = input.key.trim().toLowerCase();
    const name = input.name.trim();
    const description = input.description.trim();
    const amountPence = Math.round(input.amountPence);

    if (!/^[a-z0-9_]+$/.test(key)) {
      throw new Error("Key must be lowercase letters, digits, underscores.");
    }
    if (!name) throw new Error("Name is required.");
    if (!description) throw new Error("Description is required.");
    if (!Number.isFinite(amountPence) || amountPence <= 0) {
      throw new Error("Amount must be greater than zero.");
    }

    const { error } = await admin.from("addon_catalog").insert({
      key,
      name,
      description,
      amount_pence: amountPence,
    });
    if (error) {
      // 23505 = unique_violation
      if ((error as { code?: string }).code === "23505") {
        throw new Error(`An add-on with key "${key}" already exists.`);
      }
      throw new Error(error.message);
    }

    revalidatePath("/admin/addon-catalog");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Admin editor for the custom-add-on cap. The cap lives on the addon_catalog
// sentinel row (__custom_max__, migration 0076). This action targets only
// that row and only edits amount_pence - no name/description/active churn.
// Rejecting zero/negative/non-finite values here keeps the fallback logic in
// getCustomAddonCapPence from ever triggering on a bad admin edit.
// -------------------------------------------------------------------------
export async function setCustomAddonCapAction(
  amountPence: number,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();

    const rounded = Math.round(amountPence);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      throw new Error("Cap must be greater than zero.");
    }
    if (rounded > 100_000_000) {
      throw new Error("Cap looks unreasonably high. Double-check the pence.");
    }

    const { error } = await admin
      .from("addon_catalog")
      .update({ amount_pence: rounded, updated_at: new Date().toISOString() })
      .eq("key", "__custom_max__");
    if (error) throw new Error(error.message);

    revalidatePath("/admin/addon-catalog");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateAddonCatalogAction(
  key: string,
  input: {
    name: string;
    description: string;
    amountPence: number;
    active: boolean;
  },
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const admin = createAdminClient();

    const name = input.name.trim();
    const description = input.description.trim();
    const amountPence = Math.round(input.amountPence);
    if (!name) throw new Error("Name is required.");
    if (!description) throw new Error("Description is required.");
    if (!Number.isFinite(amountPence) || amountPence <= 0) {
      throw new Error("Amount must be greater than zero.");
    }

    const { error } = await admin
      .from("addon_catalog")
      .update({
        name,
        description,
        amount_pence: amountPence,
        active: input.active,
        updated_at: new Date().toISOString(),
      })
      .eq("key", key);
    if (error) throw new Error(error.message);

    revalidatePath("/admin/addon-catalog");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Create a bespoke-priced case from an existing service_enquiry row. The
// client lands in the normal engagement letter → pay → onboarding flow
// ,  the only differences are:
//   • cases.tier = vat_plus_accounts_bespoke (new enum value; the client
//     wizard filters it out, createCaseAction rejects it, so admin is
//     the only path in)
//   • cases.custom_fee_pence drives every price surface
//   • cases.accountant_id is pre-assigned, so the case never surfaces in
//     the open queue (filter at /accountant uses .is("accountant_id",
//     null), already excludes assigned cases, no new filter needed)
//   • cases.service_enquiry_id links back to the originating enquiry for
//     audit trail
//   • enquiry is auto-closed on quote creation
// -------------------------------------------------------------------------
export async function createBespokeCaseFromEnquiryAction(
  enquiryId: string,
  feeGbp: number,
  depositGbp: number,
  commissionGbp: number,
  accountantId: string,
  note: string | null,
): Promise<ActionResult<{ caseId: string }>> {
  try {
    const me = await requireRole("admin");
    const admin = createAdminClient();

    // Whole-£ inputs per the admin-UI constraint; all integers.
    // Deposit paid up front via Stripe before work starts; balance
    // (total - deposit) is charged automatically the moment the
    // client approves the prepared work. 0 < deposit < total so
    // there's a positive balance to collect at approval - the whole
    // point of the two-stage flow.
    //
    // Commission is the direct £ payout to the accountant on case
    // complete, set per engagement by admin. NOT a percentage of
    // anything (the trigger in 0067 uses it as the full v_amount, no
    // halving). Must be <= total so the accountant can't earn more
    // than the client paid.
    if (!Number.isInteger(feeGbp) || feeGbp <= 0) {
      throw new Error("Total fee must be a positive whole-£ amount.");
    }
    if (!Number.isInteger(depositGbp) || depositGbp <= 0) {
      throw new Error("Deposit must be a positive whole-£ amount.");
    }
    if (depositGbp >= feeGbp) {
      throw new Error(
        "Deposit must be less than the total fee so there's a balance to collect on approval.",
      );
    }
    if (!Number.isInteger(commissionGbp) || commissionGbp <= 0) {
      throw new Error("Accountant commission must be a positive whole-£ amount.");
    }
    if (commissionGbp > feeGbp) {
      throw new Error(
        "Accountant commission can't exceed the total fee the client pays.",
      );
    }
    const feePence = feeGbp * 100;
    const depositPence = depositGbp * 100;
    const balancePence = feePence - depositPence;
    const commissionPence = commissionGbp * 100;

    const { data: enquiry, error: enquiryErr } = await admin
      .from("service_enquiries")
      .select("id, client_id, service_key, status, company_name, company_number")
      .eq("id", enquiryId)
      .maybeSingle();
    if (enquiryErr || !enquiry) throw new Error("Enquiry not found.");

    // Guard against double-create: a 'closed' enquiry has already
    // been converted to a case (createBespokeCaseFromEnquiryAction
    // flips the enquiry status on success), and even a 'contacted'
    // or 'new' enquiry may already have an associated case if an
    // earlier conversion partially succeeded. Checking both the
    // enquiry status AND an explicit cases.service_enquiry_id lookup
    // means the user sees a clear "already created" message instead
    // of the raw cases_service_enquiry_id_key unique-violation from
    // the DB (migration 0070).
    if (enquiry.status === "closed") {
      throw new Error(
        "This enquiry is already closed - a case has already been created from it. Open the existing case rather than creating a new one.",
      );
    }
    const { data: existingCase } = await admin
      .from("cases")
      .select("id")
      .eq("service_enquiry_id", enquiryId)
      .maybeSingle();
    if (existingCase) {
      throw new Error(
        `A case already exists for this enquiry (case ${existingCase.id}). Open it from Cases rather than creating another.`,
      );
    }

    // Only the bespoke tier currently flows through this action. If a
    // future surface needs a different enquiry → case shape, add its
    // own action rather than overloading this one.
    if (enquiry.service_key !== "vat_plus_accounts_200k") {
      throw new Error(
        "Case creation from enquiry is only supported for the VAT-registered company (over £200k turnover) tier.",
      );
    }

    // Belt-and-braces: confirm the accountant exists and is approved
    // (same gate as the queue uses).
    const { data: accountant } = await admin
      .from("accountant_profiles")
      .select("user_id, approval_status")
      .eq("user_id", accountantId)
      .maybeSingle();
    if (!accountant || accountant.approval_status !== "approved") {
      throw new Error("Pick an approved accountant.");
    }

    // Pre-fill intake_answers with the company identity from the
    // enquiry so the engagement letter and Section A onboarding have
    // the right company name + number without the client having to
    // re-enter them.
    const intakeAnswers: Record<string, string> = {
      company_name: enquiry.company_name,
      company_number: enquiry.company_number,
    };

    const { data: inserted, error: insertErr } = await admin
      .from("cases")
      .insert({
        client_id: enquiry.client_id,
        segment: "limited_company_vat",
        tier: "vat_plus_accounts_bespoke",
        custom_fee_pence: feePence,
        deposit_pence: depositPence,
        balance_pence: balancePence,
        balance_payment_status: "pending",
        accountant_commission_pence: commissionPence,
        accountant_id: accountantId,
        service_enquiry_id: enquiry.id,
        status: "draft",
        stripe_payment_status: "pending",
        intake_answers: intakeAnswers,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Could not create case.");
    }
    const caseId = inserted.id as string;

    // Auto-close the enquiry, the quote replaces the "awaiting admin"
    // state. Note is appended to admin_notes if provided.
    const quoteSummary = `[Quote £${feeGbp} (£${depositGbp} deposit + £${feeGbp - depositGbp} balance, £${commissionGbp} accountant commission)]`;
    const closedNote = note?.trim()
      ? `${quoteSummary} ${note.trim()}`
      : `${quoteSummary} Case created.`;
    await admin
      .from("service_enquiries")
      .update({ status: "closed", admin_notes: closedNote })
      .eq("id", enquiryId);

    // Log the admin action for audit.
    await admin.from("admin_actions").insert({
      target_user_id: enquiry.client_id,
      admin_id: me.id,
      action: "bespoke_case_created",
      note: `Bespoke case ${caseId} created at £${feeGbp} total (£${depositGbp} deposit + £${feeGbp - depositGbp} balance), accountant commission £${commissionGbp}, assigned to accountant ${accountantId}.${
        note?.trim() ? ` Note: ${note.trim()}` : ""
      }`,
    });

    const tier = await getTier("vat_plus_accounts_bespoke");
    await insertEnquiryQuotedNotification({
      clientId: enquiry.client_id,
      caseId,
      feeGbp,
      depositGbp,
      serviceLabel: tier?.title ?? "bespoke engagement",
      note,
    }).catch((err) =>
      console.error("[bespoke case notification] failed:", err),
    );
    // Admin fan-out for the created case (the quote-to-client
    // notification above goes only to the client). The acting admin
    // sees their own notification too, which is intentional - the
    // audit trail is more useful if every admin sees every case
    // creation, regardless of who created it.
    const { data: clientRow } = await admin
      .from("users")
      .select("email")
      .eq("id", enquiry.client_id)
      .maybeSingle();
    await insertCaseCreatedAdminNotification({
      caseId,
      clientEmail: clientRow?.email ?? "A client",
      tierTitle: tier?.title ?? "bespoke engagement",
      feeLabel: `£${feeGbp} total (£${depositGbp} deposit + £${feeGbp - depositGbp} balance)`,
      isBespoke: true,
    }).catch((err) =>
      console.error("[bespoke case admin notification] failed:", err),
    );

    revalidatePath("/admin/enquiries");
    revalidatePath(`/admin/cases/${caseId}`);
    revalidatePath("/admin");

    return { ok: true, data: { caseId } };
  } catch (e) {
    return fail(e);
  }
}

// Service catalog edit. Admin-only. The patch shape is intentionally
// narrow, only the display + price fields are editable, never id /
// group / requires_enquiry / admin_create_only (those are code-level
// decisions driven by the TierId union + wizard routing).
export async function updateServiceCatalogAction(
  id: string,
  patch: ServiceCatalogPatch,
): Promise<ActionResult> {
  try {
    const me = await requireRole("admin");
    // Belt-and-braces: silently drop any fields the client sends that
    // are outside the admin surface.
    const safe: ServiceCatalogPatch = {};
    const copy = <K extends keyof ServiceCatalogPatch>(k: K) => {
      if (patch[k] !== undefined) safe[k] = patch[k];
    };
    copy("title");
    copy("tagline");
    copy("description");
    copy("features");
    copy("footer_line");
    copy("hero_line");
    copy("price_gbp");
    copy("sale_price_gbp");
    copy("original_gbp");
    copy("save_gbp");
    copy("price_display");
    copy("price_gbp_subtitle");
    copy("price_suffix");
    copy("price_per");
    copy("featured");
    copy("active");
    copy("display_order");

    if (safe.price_gbp !== undefined) {
      if (
        !Number.isFinite(safe.price_gbp) ||
        safe.price_gbp < 0 ||
        !Number.isInteger(safe.price_gbp)
      ) {
        throw new Error("Price must be a whole number of pounds (0 or more).");
      }
    }
    // Sale price validation. Null clears. When set, must be a positive
    // integer and strictly less than the (new or existing) regular
    // price so the DB check constraint doesn't bounce the write. The
    // < price check runs again in Postgres as a belt-and-braces.
    if (safe.sale_price_gbp !== undefined && safe.sale_price_gbp !== null) {
      if (
        !Number.isFinite(safe.sale_price_gbp) ||
        safe.sale_price_gbp <= 0 ||
        !Number.isInteger(safe.sale_price_gbp)
      ) {
        throw new Error(
          "Sale price must be a whole number of pounds greater than zero, or blank to clear.",
        );
      }
    }
    if (safe.title !== undefined && !safe.title.trim()) {
      throw new Error("Title cannot be empty.");
    }

    const res = await updateServiceCatalogRow(id, safe, me.id);
    if (!res.ok) throw new Error(res.error);

    // Admin surfaces that read service_catalog.
    revalidatePath("/admin/service-catalog");
    // Marketing + client pages that pull tiers from the catalog.
    revalidatePath("/");
    revalidatePath("/client/new");
    revalidatePath("/limited-company-tax-returns");

    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Signed URL for a receipt file. Callable by admin OR the owning accountant.
// The path always has the shape "receipts/{withdrawal_id}/..." ,  we look up
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
