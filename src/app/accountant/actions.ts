"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertAddonPendingAdminNotifications } from "@/lib/notifications";
import { type ActionResult, fail } from "@/lib/action-result";

export type { ActionResult };

// Suspended accountants keep read access to their assigned cases (RLS is
// unchanged), but every case-mutating server action goes through this
// gate. Blocking here rather than in RLS means Realtime subscriptions and
// SELECTs still work — only the mutations are refused.
function assertNotSuspended(status: string, action: string): void {
  if (status === "suspended") {
    throw new Error(
      `Your account is suspended and can't ${action}. Contact support to reinstate.`,
    );
  }
}

type CaseStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "prepared"
  | "client_approval"
  | "filed"
  | "complete";

// Which transitions the accountant can perform.
// client_approval -> filed is INTENTIONALLY absent: only the client can move
// a case past client_approval (they click "Approve and file" on their portal).
// Accountants marking a case as filed without client sign-off was the loophole
// this closes.
const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  draft: [],
  submitted: ["in_review"],
  in_review: ["prepared"],
  prepared: ["client_approval"],
  client_approval: [],
  filed: ["complete"],
  complete: [],
};

async function loadCaseForAccountant(caseId: string) {
  const me = await requireApprovedAccountant();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cases")
    .select("id, client_id, accountant_id, status, stripe_payment_status")
    .eq("id", caseId)
    .single();
  if (error || !data) throw new Error("Case not found or you don't have access.");
  return { me, supabase, row: data };
}

// -------------------------------------------------------------------------
// Take a case from the queue (atomic — race-safe using WHERE accountant_id IS NULL).
// -------------------------------------------------------------------------
export async function takeCaseAction(caseId: string): Promise<ActionResult> {
  try {
    const me = await requireApprovedAccountant();
    assertNotSuspended(me.status, "take new cases");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("cases")
      .update({
        accountant_id: me.id,
        status: "in_review",
      })
      .eq("id", caseId)
      .eq("status", "submitted")
      .eq("stripe_payment_status", "succeeded")
      .is("accountant_id", null)
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(
        "Couldn't take this case. Someone may have grabbed it, or it's not in the queue anymore.",
      );
    }

    revalidatePath("/accountant");
    revalidatePath(`/accountant/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Move a case through the lifecycle. Only valid forward transitions allowed.
// -------------------------------------------------------------------------
export async function updateCaseStatusAction(
  caseId: string,
  next: string,
): Promise<ActionResult> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    assertNotSuspended(me.status, "advance case status");
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }

    const current = row.status as CaseStatus;
    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next as CaseStatus)) {
      throw new Error(`Can't go from ${current} to ${next}.`);
    }

    const { error } = await supabase
      .from("cases")
      .update({ status: next })
      .eq("id", caseId);
    if (error) throw new Error(error.message);

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/accountant`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Add-on: preset. Snapshots the catalog row's description + amount into
// case_addons at status 'pending_payment' — the client sees a Pay banner
// immediately, no admin review. Catalog row must still be active at the
// moment of insert; edits to the catalog after this do not rewrite the
// snapshot.
// -------------------------------------------------------------------------
export async function requestPresetAddonAction(
  caseId: string,
  presetKey: string,
): Promise<ActionResult> {
  try {
    const me = await requireApprovedAccountant();
    assertNotSuspended(me.status, "request add-ons");
    const supabase = await createClient();

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, accountant_id, status")
      .eq("id", caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }
    if (caseRow.status === "complete") {
      throw new Error("Case is already complete — no more add-ons.");
    }

    // Read the price from the DB — never trust a client-supplied amount.
    const { data: preset, error: presetErr } = await supabase
      .from("addon_catalog")
      .select("key, name, description, amount_pence, active")
      .eq("key", presetKey)
      .single();
    if (presetErr || !preset) throw new Error("That add-on doesn't exist.");
    if (!preset.active) {
      throw new Error("That add-on is currently unavailable.");
    }

    const { error: insertErr } = await supabase.from("case_addons").insert({
      case_id: caseId,
      accountant_id: me.id,
      kind: "preset",
      preset_key: preset.key,
      description: `${preset.name} — ${preset.description}`,
      amount_pence: preset.amount_pence,
      status: "pending_payment",
    });
    if (insertErr) throw new Error(insertErr.message);

    revalidatePath(`/accountant/cases/${caseId}`);
    revalidatePath(`/client/cases/${caseId}`);
    revalidatePath(`/client`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Add-on: custom. Inserts at 'pending_admin' — admin has to approve before
// the client sees it. Accountant sets the description and amount here; both
// are validated server-side, and no downstream code trusts anything below
// this line to have been price-verified until admin approval flips it to
// pending_payment.
// -------------------------------------------------------------------------
export async function requestCustomAddonAction(input: {
  caseId: string;
  description: string;
  amountPence: number;
}): Promise<ActionResult> {
  try {
    const me = await requireApprovedAccountant();
    assertNotSuspended(me.status, "request add-ons");
    const supabase = await createClient();

    const description = input.description.trim();
    const amountPence = Math.round(input.amountPence);
    if (description.length < 3) {
      throw new Error("Describe the extra work in at least a short sentence.");
    }
    if (!Number.isFinite(amountPence) || amountPence <= 0) {
      throw new Error("Amount must be greater than zero.");
    }
    // Sanity cap so a stray decimal doesn't slip through as £100k.
    if (amountPence > 500_000) {
      throw new Error("Custom add-ons over £5,000 need to go through support.");
    }

    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("id, accountant_id, status")
      .eq("id", input.caseId)
      .single();
    if (caseErr || !caseRow) throw new Error("Case not found.");
    if (caseRow.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }
    if (caseRow.status === "complete") {
      throw new Error("Case is already complete — no more add-ons.");
    }

    const { error: insertErr } = await supabase.from("case_addons").insert({
      case_id: input.caseId,
      accountant_id: me.id,
      kind: "custom",
      preset_key: null,
      description,
      amount_pence: amountPence,
      status: "pending_admin",
    });
    if (insertErr) throw new Error(insertErr.message);

    // Email the accountant so the admin notification message is human-readable.
    const admin = createAdminClient();
    const { data: meRow } = await admin
      .from("users")
      .select("email")
      .eq("id", me.id)
      .single();

    await insertAddonPendingAdminNotifications({
      caseId: input.caseId,
      accountantEmail: meRow?.email ?? me.email,
      amountPence,
      description,
    });

    revalidatePath(`/accountant/cases/${input.caseId}`);
    revalidatePath(`/admin/addon-requests`);
    revalidatePath(`/admin`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------------------
// Signed URL for an accountant to download a document on a case they own.
// -------------------------------------------------------------------------
export async function getDocSignedUrlForAccountant(
  caseId: string,
  filePath: string,
): Promise<ActionResult<string>> {
  try {
    const { me, supabase, row } = await loadCaseForAccountant(caseId);
    if (row.accountant_id !== me.id) {
      throw new Error("You haven't taken this case.");
    }
    const { data, error } = await supabase.storage
      .from("case-documents")
      .createSignedUrl(filePath, 60);
    if (error || !data) throw new Error(error?.message ?? "Sign URL failed.");
    return { ok: true, data: data.signedUrl };
  } catch (e) {
    return fail(e);
  }
}
