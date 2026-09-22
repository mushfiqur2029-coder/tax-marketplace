"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedAccountant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
export async function takeCaseAction(caseId: string) {
  const me = await requireApprovedAccountant();
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
      "Couldn't take this case. someone may have grabbed it, or it's not in the queue anymore.",
    );
  }

  revalidatePath("/accountant");
  revalidatePath(`/accountant/cases/${caseId}`);
}

// -------------------------------------------------------------------------
// Move a case through the lifecycle. Only valid forward transitions allowed.
// -------------------------------------------------------------------------
export async function updateCaseStatusAction(caseId: string, next: string) {
  const { me, supabase, row } = await loadCaseForAccountant(caseId);
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
}

// -------------------------------------------------------------------------
// Signed URL for an accountant to download a document on a case they own.
// -------------------------------------------------------------------------
export async function getDocSignedUrlForAccountant(
  caseId: string,
  filePath: string,
) {
  const { me, supabase, row } = await loadCaseForAccountant(caseId);
  if (row.accountant_id !== me.id) {
    throw new Error("You haven't taken this case.");
  }
  const { data, error } = await supabase.storage
    .from("case-documents")
    .createSignedUrl(filePath, 60);
  if (error || !data) throw new Error(error?.message ?? "Sign URL failed.");
  return data.signedUrl;
}
