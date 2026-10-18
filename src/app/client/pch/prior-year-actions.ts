"use server";

// Spawn linked draft cases for prior tax years flagged by returns-owed.
//
// The client answers a per-year yes/no prompt before submitting their
// current-year intake. Every "yes" creates:
//   - a new cases row at status=draft, tier=same, parent_case_id=current,
//     tax_year_label=<year>, no payment yet so the client's dashboard
//     surfaces it with a "pay to continue" nudge (standard draft flow)
//   - a matching pch_cases head row pre-filled from the current case so
//     the client doesn't re-type UTR / NINO / address / vehicle details
//
// RLS stays intact: the client owns these new cases (same client_id),
// the normal engagement letter + payment + intake pipeline applies.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRatePackFor } from "@/lib/tax-engine";

type ActionOk = { ok: true; spawnedCaseIds: string[] };
type ActionErr = { ok: false; error: string };
type ActionResult = ActionOk | ActionErr;

export async function spawnPriorYearCasesAction(
  parentCaseId: string,
  taxYears: string[],
): Promise<ActionResult> {
  const me = await requireRole("client");
  const admin = createAdminClient();

  const { data: parent } = await admin
    .from("cases")
    .select("id, client_id, segment, tier, status, deadline")
    .eq("id", parentCaseId)
    .single();
  if (!parent) return { ok: false, error: "Parent case not found." };
  if (parent.client_id !== me.id) return { ok: false, error: "Not your case." };
  if (parent.tier !== "uber_phv_automated") {
    return { ok: false, error: "Prior-year linking is PCH automated only right now." };
  }

  const { data: parentHead } = await admin
    .from("pch_cases")
    .select("*")
    .eq("case_id", parentCaseId)
    .single();
  if (!parentHead) return { ok: false, error: "Parent intake row missing." };

  // Skip any year we already spawned a case for on this parent (idempotent
  // if the client ticks + unticks + re-submits).
  const { data: existingChildren } = await admin
    .from("cases")
    .select("id, tax_year_label")
    .eq("parent_case_id", parentCaseId);
  const alreadySpawned = new Set(
    (existingChildren ?? []).map((c) => c.tax_year_label).filter(Boolean) as string[],
  );

  const spawnedCaseIds: string[] = [];
  for (const taxYear of taxYears) {
    if (alreadySpawned.has(taxYear)) continue;
    if (!hasRatePackFor(taxYear)) {
      // Caller should have filtered these out already; defensive skip.
      continue;
    }

    const { data: inserted, error: insErr } = await admin
      .from("cases")
      .insert({
        client_id: me.id,
        segment: parent.segment,
        tier: parent.tier,
        status: "draft",
        stripe_payment_status: "pending",
        deadline: parent.deadline,
        parent_case_id: parentCaseId,
        tax_year_label: taxYear,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return { ok: false, error: "Could not create prior-year case: " + insErr?.message };
    }

    // Pre-fill the pch_cases head with the client's standing details so
    // they don't retype them. Year-specific numeric fields stay at zero.
    const { error: headErr } = await admin.from("pch_cases").insert({
      case_id: inserted.id,
      tax_year: taxYear,
      cl_name: parentHead.cl_name,
      cl_utr: parentHead.cl_utr,
      cl_nino: parentHead.cl_nino,
      cl_dob: parentHead.cl_dob,
      cl_address: parentHead.cl_address,
      cl_postcode: parentHead.cl_postcode,
      cl_phone: parentHead.cl_phone,
      cl_email: parentHead.cl_email,
      cl_licensing_authority: parentHead.cl_licensing_authority,
      cl_platforms: parentHead.cl_platforms,
      marriage_allowance_status: parentHead.marriage_allowance_status ?? "None",
      student_loan_plan: parentHead.student_loan_plan,
    });
    if (headErr) {
      return { ok: false, error: "Could not pre-fill prior-year intake: " + headErr.message };
    }
    spawnedCaseIds.push(inserted.id);
  }

  revalidatePath("/client");
  revalidatePath(`/client/cases/${parentCaseId}/pch`);
  return { ok: true, spawnedCaseIds };
}
